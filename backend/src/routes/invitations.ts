import { Router } from "express";
import { route, z } from "../api.js";
import { one, q } from "../db.js";
import { HttpError, notFound } from "../errors.js";
import { maybeRetrainRanker } from "../services/learning.js";

export const router = Router();
const B = "/candidate/invitations";
const ROLE = ["candidate"] as const;

const DECLINE_REASONS = ["Мало денег", "Не тот стек", "Не тот формат работы", "Не интересна сфера", "Уже нашёл работу", "Другое"];

function dto(r: any) {
  return {
    id: r.id, title: r.title, description: r.description, salary_from: r.salary_from, salary_to: r.salary_to,
    contact_method: r.contact_method, status: r.status, source: r.source, decline_reason: r.decline_reason, salary_honest: r.salary_honest,
    created_at: r.created_at, viewed_at: r.viewed_at, responded_at: r.responded_at,
    why: r.match_snapshot?.why ?? null, match_percent: r.match_snapshot?.match_percent ?? null,
    // «Почему вы»: подтверждённые ингредиенты заказа с наибольшим весом и уровнем владения
    skills: (r.match_snapshot?.ingredients ?? []).filter((i: any) => i.confirmed).sort((a: any, b: any) => b.weight - a.weight).slice(0, 4)
      .map((i: any) => ({ title: i.title, pct: Math.round(i.mastery * 100) })),
    company: { id: r.company_id, name: r.company_name, sphere: r.sphere, website: r.website, honest_badge: r.honest_badge, trust: r.trust },
    vacancy: r.vacancy_id ? { id: r.vacancy_id, title: r.vacancy_title } : null,
  };
}

const SELECT = `SELECT i.*, co.name AS company_name, co.sphere, co.website, co.honest_badge, co.trust, v.title AS vacancy_title
  FROM invitations i JOIN companies co ON co.id = i.company_id LEFT JOIN vacancies v ON v.id = i.vacancy_id`;

route(router, B, { method: "get", path: "", tag: "Приглашения", summary: "Входящие приглашения (видны только свои)", roles: [...ROLE] }, async (req) => {
  const rows = await q(`${SELECT} WHERE i.candidate_id = $1 ORDER BY i.created_at DESC`, [req.user!.id]);
  return { reasons: DECLINE_REASONS, items: rows.map(dto) };
});

async function mine(id: string, uid: string) {
  const r = await one(`${SELECT} WHERE i.id = $1 AND i.candidate_id = $2`, [id, uid]);
  if (!r) throw notFound("Приглашение");
  return r;
}

route(router, B, { method: "post", path: "/:id/view", tag: "Приглашения", summary: "Отметить как просмотренное", roles: [...ROLE] }, async (req) => {
  await mine(req.params.id as string, req.user!.id);
  await q(`UPDATE invitations SET status = 'viewed', viewed_at = now() WHERE id = $1 AND status = 'sent'`, [req.params.id]);
  return dto(await mine(req.params.id as string, req.user!.id));
});

route(router, B, {
  method: "post", path: "/:id/accept", tag: "Приглашения", summary: "Принять — контакты раскрываются работодателю", roles: [...ROLE],
}, async (req) => {
  const r = await mine(req.params.id as string, req.user!.id);
  if (r.status === "accepted" || r.status === "declined") throw new HttpError(409, "На приглашение уже есть ответ");
  await q(`UPDATE invitations SET status = 'accepted', responded_at = now(), viewed_at = COALESCE(viewed_at, now()) WHERE id = $1`, [r.id]);
  void maybeRetrainRanker();
  return dto(await mine(r.id, req.user!.id));
});

route(router, B, {
  method: "post", path: "/:id/decline", tag: "Приглашения", summary: "Отклонить с причиной в один клик (обратная связь работодателю)", roles: [...ROLE],
  body: z.object({ reason: z.string().max(200).optional() }),
}, async (req) => {
  const r = await mine(req.params.id as string, req.user!.id);
  if (r.status === "accepted" || r.status === "declined") throw new HttpError(409, "На приглашение уже есть ответ");
  await q(`UPDATE invitations SET status = 'declined', decline_reason = $2, responded_at = now(), viewed_at = COALESCE(viewed_at, now()) WHERE id = $1`, [r.id, req.body.reason ?? null]);
  void maybeRetrainRanker();
  return dto(await mine(r.id, req.user!.id));
});

route(router, B, {
  method: "post", path: "/:id/salary-check", tag: "Приглашения",
  summary: "«Ценник не врёт»: совпала ли зарплата на собеседовании с вилкой приглашения", roles: [...ROLE],
  body: z.object({ honest: z.boolean() }),
  description: "Если нет — у компании падает репутация, урезаются талоны и снимается бейдж «Честный ценник».",
}, async (req) => {
  const r = await mine(req.params.id as string, req.user!.id);
  if (r.status !== "accepted") throw new HttpError(409, "Оценить можно только принятое приглашение");
  if (r.salary_honest !== null) throw new HttpError(409, "Оценка уже оставлена");
  await q(`UPDATE invitations SET salary_honest = $2 WHERE id = $1`, [r.id, req.body.honest]);
  if (!req.body.honest) {
    await q(`UPDATE companies SET trust = GREATEST(0, trust - 25), honest_badge = (trust - 25) >= 75 WHERE id = $1`, [r.company_id]);
  } else {
    await q(`UPDATE companies SET trust = LEAST(150, trust + 2) WHERE id = $1`, [r.company_id]);
  }
  return dto(await mine(r.id, req.user!.id));
});
