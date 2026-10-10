import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { route, z } from "../api.js";
import { clearToken, issueToken } from "../auth.js";
import { config } from "../config.js";
import { one, q, tx } from "../db.js";
import { HttpError } from "../errors.js";
import { engine } from "../engine.js";
import { button, layout, sendMail } from "../mail.js";
import { fspParticipant } from "../services/fsp.js";

export const router = Router();
const B = "/auth";

const Me = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["candidate", "employer", "admin"]),
  email_verified: z.boolean(),
}).openapi("Me");

function anonCode() {
  return String(1000 + crypto.randomInt(9000)) + crypto.randomBytes(1).toString("hex").toUpperCase();
}

route(router, B, {
  method: "post", path: "/register", tag: "Аутентификация", summary: "Регистрация по email (с подтверждением адреса)",
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8, "Пароль — минимум 8 символов"),
    role: z.enum(["candidate", "employer"]),
    company_name: z.string().min(2).optional(),
  }),
  response: z.object({ ok: z.boolean(), verify_url: z.string().optional() }),
}, async (req) => {
  const email = req.body.email.toLowerCase().trim();
  if (await one(`SELECT 1 FROM users WHERE email = $1`, [email])) throw new HttpError(409, "Этот email уже зарегистрирован", "email_taken");
  const token = crypto.randomBytes(24).toString("hex");
  const hash = await bcrypt.hash(req.body.password, 10);
  await tx(async (c) => {
    const u = (await c.query(`INSERT INTO users(email, password_hash, role, verify_token) VALUES ($1,$2,$3,$4) RETURNING id`,
      [email, hash, req.body.role, token])).rows[0];
    if (req.body.role === "candidate") {
      await c.query(`INSERT INTO candidates(user_id, anon_code) VALUES ($1, $2)`, [u.id, anonCode()]);
    } else {
      await c.query(`INSERT INTO companies(owner_id, name, contact_email) VALUES ($1, $2, $3)`, [u.id, req.body.company_name ?? "Новая компания", email]);
    }
  });
  const url = `${config.publicUrl}/verify?token=${token}`;
  await sendMail(email, "Подтвердите email — шаурматч_", layout("Подтвердите адрес почты",
    `<p>Чтобы начать работу на платформе, подтвердите email.</p>${button(url, "Подтвердить email")}`));
  return { ok: true, ...(config.demoMode ? { verify_url: url } : {}) };
});

route(router, B, {
  method: "post", path: "/verify", tag: "Аутентификация", summary: "Подтверждение email по токену из письма",
  body: z.object({ token: z.string().min(10) }), response: Me,
}, async (req, res) => {
  const u = await one(`UPDATE users SET email_verified = true, verify_token = NULL WHERE verify_token = $1 RETURNING id, email, role, email_verified`, [req.body.token]);
  if (!u) throw new HttpError(400, "Ссылка недействительна или уже использована", "bad_token");
  issueToken(res, { id: u.id, email: u.email, role: u.role });
  return u;
});

route(router, B, {
  method: "post", path: "/login", tag: "Аутентификация", summary: "Вход по email и паролю",
  body: z.object({ email: z.string().email(), password: z.string() }), response: Me,
}, async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE email = $1`, [req.body.email.toLowerCase().trim()]);
  if (!u || !u.password_hash || !(await bcrypt.compare(req.body.password, u.password_hash))) {
    throw new HttpError(401, "Неверный email или пароль", "bad_credentials");
  }
  if (!u.email_verified) throw new HttpError(403, "Подтвердите email — ссылка в письме", "email_not_verified");
  issueToken(res, { id: u.id, email: u.email, role: u.role });
  return { id: u.id, email: u.email, role: u.role, email_verified: u.email_verified };
});

route(router, B, {
  method: "post", path: "/resend", tag: "Аутентификация", summary: "Повторно отправить письмо подтверждения",
  body: z.object({ email: z.string().email() }),
}, async (req) => {
  const token = crypto.randomBytes(24).toString("hex");
  const u = await one(`UPDATE users SET verify_token = $2 WHERE email = $1 AND NOT email_verified RETURNING email`, [req.body.email.toLowerCase(), token]);
  const url = `${config.publicUrl}/verify?token=${token}`;
  if (u) await sendMail(u.email, "Подтвердите email — шаурматч_", layout("Подтвердите адрес почты", button(url, "Подтвердить email")));
  return { ok: true, ...(config.demoMode && u ? { verify_url: url } : {}) };
});

route(router, B, { method: "post", path: "/logout", tag: "Аутентификация", summary: "Выход" }, async (_req, res) => {
  clearToken(res);
  return { ok: true };
});

route(router, B, { method: "get", path: "/me", tag: "Аутентификация", summary: "Текущий пользователь (null — не авторизован)", response: z.object({ user: Me.nullable() }) }, async (req) => {
  if (!req.user) return { user: null };
  const u = await one(`SELECT id, email, role, email_verified FROM users WHERE id = $1`, [req.user.id]);
  return { user: u ?? null };
});

route(router, B, {
  method: "get", path: "/providers", tag: "Аутентификация", summary: "Доступные способы входа (email, ФСП ID через Keycloak)",
}, async () => ({ email: true, keycloak: !!config.keycloak, keycloak_login_url: config.keycloak ? "/api/v1/auth/keycloak/login" : null }));

// ---------- ФСП ID (Keycloak, OIDC Authorization Code) — включается переменными KEYCLOAK_* ----------
if (config.keycloak) {
  const kc = config.keycloak;
  router.get("/auth/keycloak/login", (req, res) => {
    const role = req.query.role === "employer" ? "employer" : "candidate";
    const state = Buffer.from(JSON.stringify({ role, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
    const url = new URL(`${kc.publicIssuer}/protocol/openid-connect/auth`);
    url.searchParams.set("client_id", kc.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("redirect_uri", `${config.publicUrl}/api/v1/auth/keycloak/callback`);
    url.searchParams.set("state", state);
    res.redirect(url.toString());
  });
  router.get("/auth/keycloak/callback", async (req, res, next) => {
    try {
      const tokenRes = await fetch(`${kc.issuer}/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code: String(req.query.code), client_id: kc.clientId, client_secret: kc.clientSecret,
          redirect_uri: `${config.publicUrl}/api/v1/auth/keycloak/callback`,
        }),
      });
      const tok: any = await tokenRes.json();
      const info: any = await (await fetch(`${kc.issuer}/protocol/openid-connect/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
      const role = JSON.parse(Buffer.from(String(req.query.state), "base64url").toString()).role;
      let u = await one(`SELECT * FROM users WHERE keycloak_sub = $1 OR email = $2`, [info.sub, info.email]);
      if (!u) {
        u = await tx(async (c) => {
          const nu = (await c.query(`INSERT INTO users(email, role, email_verified, keycloak_sub) VALUES ($1,$2,true,$3) RETURNING *`, [info.email, role, info.sub])).rows[0];
          if (role === "candidate") await c.query(`INSERT INTO candidates(user_id, anon_code, full_name, fsp_id) VALUES ($1,$2,$3,$4)`, [nu.id, anonCode(), info.name ?? null, info.fsp_id ?? null]);
          else await c.query(`INSERT INTO companies(owner_id, name, contact_email) VALUES ($1,$2,$3)`, [nu.id, "Новая компания", info.email]);
          return nu;
        });
        // ФСП ID несёт идентификатор участника — сразу подтягиваем достижения из реестра
        if (role === "candidate" && info.fsp_id) {
          const p = await fspParticipant(info.fsp_id).catch(() => null);
          if (p) {
            const { ratings } = await engine("/ratings/apply", { ratings: {}, achievements: p.achievements });
            await q(`UPDATE candidates SET fsp_linked_at = now(), fsp_achievements = $2, ratings = $3 WHERE user_id = $1`, [u.id, JSON.stringify(p.achievements), ratings]);
          }
        }
      } else if (!u.keycloak_sub) {
        await q(`UPDATE users SET keycloak_sub = $1, email_verified = true WHERE id = $2`, [info.sub, u.id]);
      }
      issueToken(res, { id: u.id, email: u.email, role: u.role });
      res.redirect(`${config.publicUrl}/${u.role === "employer" ? "employer" : "candidate"}`);
    } catch (e) {
      next(e);
    }
  });
}
