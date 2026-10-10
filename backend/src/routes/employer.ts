import { Router } from "express";
import { route, z } from "../api.js";
import { one, q } from "../db.js";
import { engine } from "../engine.js";
import { HttpError, notFound } from "../errors.js";
import { button, layout, sendMail } from "../mail.js";
import { config } from "../config.js";
import { maybeRetrainRanker, retrainTextModel } from "../services/learning.js";
import { GRADE_ORDER, GRADE_TITLES, SPEC_CODES, SPEC_TITLES, categoryCode, contactsVisible, employerView, engineProfile, fspSummary, listCategories, loadCategoryRow } from "../services/candidate.js";

export const router = Router();
const B = "/employer";
const ROLE = ["employer"] as const;
const Grade = z.enum(["intern", "junior", "middle", "senior"]);
const Spec = z.enum(["backend", "frontend", "data"]);
const Format = z.enum(["remote", "hybrid", "office"]);

export async function myCompany(userId: string) {
  const c = await one(`SELECT * FROM companies WHERE owner_id = $1`, [userId]);
  if (!c) throw notFound("Компания");
  return c;
}

/** «Талоны» на приглашения: лимит в неделю растёт с репутацией; талон возвращается, когда кандидат ответил. */
export async function tickets(company: any) {
  const limit = Math.round(5 + company.trust / 10);
  const used = await one(`SELECT count(*)::int AS n FROM invitations WHERE company_id = $1 AND created_at > now() - interval '7 days' AND status IN ('sent','viewed')`, [company.id]);
  return { limit, used: used!.n, left: Math.max(0, limit - used!.n) };
}

// Одна строка на (кандидат, категория): кандидат с BE·SEN и DS·MID виден в обеих выдачах, каждый раз со своим грейдом
const searchableCandidates = `SELECT c.*, u.email FROM candidate_category_view c JOIN users u ON u.id = c.user_id
  WHERE c.grade IS NOT NULL AND (c.privacy->>'searchable')::boolean IS NOT FALSE AND c.consent_publish`;

// ---------- Компания ----------
route(router, B, { method: "get", path: "/company", tag: "Работодатель", summary: "Профиль компании", roles: [...ROLE] }, async (req) => {
  const c = await myCompany(req.user!.id);
  return { ...c, tickets: await tickets(c) };
});

route(router, B, {
  method: "put", path: "/company", tag: "Работодатель", summary: "Обновить профиль компании", roles: [...ROLE],
  body: z.object({
    name: z.string().min(2).max(120), sphere: z.string().max(120).nullish(), description: z.string().max(3000).nullish(),
    website: z.string().max(200).nullish(), contact_email: z.string().email().nullish(), contact_phone: z.string().max(40).nullish(),
    contact_telegram: z.string().max(64).nullish(),
  }).partial(),
}, async (req) => {
  const c = await myCompany(req.user!.id);
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
  if (fields.length) await q(`UPDATE companies SET ${fields.map(([k], i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [c.id, ...fields.map(([, v]) => v)]);
  return myCompany(req.user!.id);
});

// ---------- Потребность («заказ») → рецепт ----------
const RecipeSchema = z.object({
  specialization: Spec, grade: Grade,
  ingredients: z.record(z.string(), z.number().min(0)),
  stacks: z.array(z.string()).default([]),
  formats: z.array(Format).default(["remote", "hybrid", "office"]),
  salary_from: z.number().int().positive().nullish(), salary_to: z.number().int().positive().nullish(),
}).passthrough().openapi("Recipe");

route(router, B, {
  method: "post", path: "/needs/parse", tag: "Работодатель", summary: "Разобрать описание потребности в рецепт (без сохранения)", roles: [...ROLE],
  body: z.object({ text: z.string().min(10) }),
}, async (req) => engine("/recipe/parse", { text: req.body.text }));

route(router, B, {
  method: "post", path: "/needs", tag: "Работодатель", summary: "Описать потребность: какие специалисты нужны, чем занимается команда, стек, грейд", roles: [...ROLE],
  body: z.object({ title: z.string().min(3).max(160), text: z.string().min(10).max(5000), recipe: RecipeSchema.optional() }),
}, async (req) => {
  const c = await myCompany(req.user!.id);
  const recipe = req.body.recipe ?? (await engine("/recipe/parse", { text: req.body.text }));
  return one(`INSERT INTO needs(company_id, title, text, recipe) VALUES ($1,$2,$3,$4) RETURNING *`, [c.id, req.body.title, req.body.text, recipe]);
});

route(router, B, { method: "get", path: "/needs", tag: "Работодатель", summary: "Мои потребности", roles: [...ROLE] }, async (req) => {
  const c = await myCompany(req.user!.id);
  return q(`SELECT * FROM needs WHERE company_id = $1 ORDER BY created_at DESC`, [c.id]);
});

route(router, B, {
  method: "put", path: "/needs/:id", tag: "Работодатель", summary: "Поправить рецепт (веса ингредиентов, грейд, стек)", roles: [...ROLE],
  body: z.object({ title: z.string().min(3).max(160).optional(), recipe: RecipeSchema }),
}, async (req) => {
  const c = await myCompany(req.user!.id);
  const n = await one(`UPDATE needs SET recipe = $3, title = COALESCE($4, title), updated_at = now() WHERE id = $1 AND company_id = $2 RETURNING *`,
    [req.params.id, c.id, req.body.recipe, req.body.title ?? null]);
  if (!n) throw notFound("Потребность");
  void retrainTextModel(); // «Маринад»: правка рецепта — обучающий пример для модели «текст → рецепт»
  return n;
});

route(router, B, {
  method: "get", path: "/needs/:id/selection", tag: "Работодатель",
  summary: "Подборка по потребности: рекомендованные категории + ранжированные кандидаты с объяснением", roles: [...ROLE],
  query: z.object({
    grades: z.string().optional(), stacks: z.string().optional(), formats: z.string().optional(),
    fsp_only: z.enum(["true", "false"]).optional(), salary_max: z.coerce.number().optional(), limit: z.coerce.number().max(200).optional(),
  }),
  description: "Фильтры применяются поверх сохранённого рецепта — подборка не теряется при уточнении запроса.",
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const need = await one(`SELECT * FROM needs WHERE id = $1 AND company_id = $2`, [req.params.id, comp.id]);
  if (!need) throw notFound("Потребность");
  const r = need.recipe;
  const pool = await q(`${searchableCandidates} AND c.specialization = $1`, [r.specialization]);
  const f = req.q;
  const filters = {
    grades: f.grades ? f.grades.split(",") : undefined, stacks: f.stacks ? f.stacks.split(",") : undefined,
    formats: f.formats ? f.formats.split(",") : undefined, fsp_only: f.fsp_only === "true", salary_max: f.salary_max,
  };
  // offer — для головы «Примет» ранжировщика: вилка из рецепта и репутация компании
  const offer = { salary_from: r.salary_from, salary_to: r.salary_to, formats: r.formats, trust: comp.trust };
  const ranked = await engine("/match", { recipe: r, candidates: pool.map(engineProfile), filters, limit: f.limit ?? 50, offer });
  const byId = new Map(pool.map((p: any) => [p.user_id, p]));
  const invited = new Map((await q(`SELECT candidate_id, status FROM invitations WHERE company_id = $1`, [comp.id])).map((x: any) => [x.candidate_id, x.status]));
  const categories = GRADE_ORDER.map((g) => {
    const inCat = pool.filter((p: any) => p.grade === g);
    return { code: categoryCode(r.specialization, g), grade: g, grade_title: GRADE_TITLES[g], n: inCat.length, recommended: g === r.grade || GRADE_ORDER.indexOf(g) === GRADE_ORDER.indexOf(r.grade) + 1 };
  });
  const results = await Promise.all(ranked.results.map(async (m: any) => {
    const c = byId.get(m.candidate_id);
    const visible = await contactsVisible(comp.id, m.candidate_id);
    return { ...m, candidate: employerView(c, { contacts: visible }), invitation_status: invited.get(m.candidate_id) ?? null };
  }));
  return { need, categories, total_in_specialization: pool.length, results, tickets: await tickets(comp) };
});

// ---------- Карта рынка и банк кандидатов ----------
route(router, B, { method: "get", path: "/market", tag: "Работодатель", summary: "Карта рынка: категории (специализация × грейд), число кандидатов, медиана ожиданий", roles: [...ROLE] }, async () => {
  const rows = await q(`SELECT specialization, grade, count(*)::int AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_expect)::int AS median_salary,
      count(*) FILTER (WHERE fsp_id IS NOT NULL)::int AS with_fsp
    FROM candidate_category_view WHERE grade IS NOT NULL AND consent_publish AND (privacy->>'searchable')::boolean IS NOT FALSE
    GROUP BY specialization, grade`);
  return Object.keys(SPEC_TITLES).map((s) => ({
    specialization: s, title: SPEC_TITLES[s], code: SPEC_CODES[s],
    cells: GRADE_ORDER.map((g) => {
      const r = rows.find((x: any) => x.specialization === s && x.grade === g);
      return { grade: g, grade_title: GRADE_TITLES[g], code: categoryCode(s, g), n: r?.n ?? 0, median_salary: r?.median_salary ?? null, with_fsp: r?.with_fsp ?? 0 };
    }),
  }));
});

route(router, B, {
  method: "get", path: "/candidates", tag: "Работодатель",
  summary: "Банк кандидатов: фильтры по специализации, грейду, категории, стеку, достижениям ФСП; ранжирование внутри категории", roles: [...ROLE],
  query: z.object({
    specialization: Spec.optional(), grade: Grade.optional(), stack: z.string().optional(), fsp_only: z.enum(["true", "false"]).optional(),
    format: Format.optional(), salary_max: z.coerce.number().optional(), q: z.string().optional(), limit: z.coerce.number().max(200).optional(), offset: z.coerce.number().optional(),
  }),
  description: "Внутри категории кандидаты ранжируются по силе подтверждённого профиля: консервативный рейтинг μ − 2·RD по ингредиентам + призовые места ФСП.",
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const f = req.q;
  const params: any[] = [];
  let sql = searchableCandidates;
  if (f.specialization) { params.push(f.specialization); sql += ` AND c.specialization = $${params.length}`; }
  if (f.grade) { params.push(f.grade); sql += ` AND c.grade = $${params.length}`; }
  if (f.stack) { params.push(f.stack.split(",")); sql += ` AND c.stacks && $${params.length}::text[]`; }
  if (f.fsp_only === "true") sql += ` AND c.fsp_id IS NOT NULL`;
  if (f.format) { params.push(f.format); sql += ` AND $${params.length} = ANY(c.formats)`; }
  if (f.salary_max) { params.push(f.salary_max); sql += ` AND (c.salary_expect IS NULL OR c.salary_expect <= $${params.length})`; }
  const rows = await q(sql, params);
  // Все категории каждого кандидата — чтобы показать их пометкой рядом с основной
  const codes = new Map<string, string[]>();
  for (const p of rows) codes.set(p.user_id, [...(codes.get(p.user_id) ?? []), categoryCode(p.specialization, p.grade)!]);
  // С фильтром по специализации — строка в разрезе этой категории; без фильтра — один раз (основная категория,
  // а если по фильтру грейда подошла только дополнительная — она)
  const pool = f.specialization ? rows : [...rows.reduce((m: Map<string, any>, p: any) => {
    const cur = m.get(p.user_id);
    if (!cur || (p.is_primary && !cur.is_primary)) m.set(p.user_id, p);
    return m;
  }, new Map()).values()];
  const groups = new Map<string, any[]>();
  for (const p of pool) groups.set(p.specialization, [...(groups.get(p.specialization) ?? []), p]);
  const key = (p: any) => `${p.user_id}:${p.specialization}`;   // сила считается в разрезе категории
  const strength = new Map<string, number>();
  for (const [spec, list] of groups) {
    const r = await engine("/category/rank", { specialization: spec, candidates: list.map((p: any) => ({ id: key(p), ratings: p.ratings, fsp: fspSummary(p.fsp_achievements ?? [], spec) })) });
    r.results.forEach((x: any) => strength.set(x.candidate_id, x.strength));
  }
  pool.sort((a: any, b: any) => (strength.get(key(b)) ?? 0) - (strength.get(key(a)) ?? 0));
  const off = f.offset ?? 0;
  const page = pool.slice(off, off + (f.limit ?? 30));
  const invited = new Map((await q(`SELECT candidate_id, status FROM invitations WHERE company_id = $1`, [comp.id])).map((x: any) => [x.candidate_id, x.status]));
  return {
    total: pool.length,
    results: await Promise.all(page.map(async (p: any) => ({
      strength: Math.round(strength.get(key(p)) ?? 0),
      candidate: { ...employerView(p, { contacts: await contactsVisible(comp.id, p.user_id) }), other_categories: (codes.get(p.user_id) ?? []).filter((c) => c !== categoryCode(p.specialization, p.grade)) },
      invitation_status: invited.get(p.user_id) ?? null,
    }))),
  };
});

route(router, B, {
  method: "get", path: "/candidates/:id", tag: "Работодатель", summary: "Карточка кандидата (контакты — только после принятия приглашения или отклика)", roles: [...ROLE],
  query: z.object({ need_id: z.string().uuid().optional() }),
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  // основная категория, а если она ещё не подтверждена — первая подтверждённая дополнительная
  let c = await one(`SELECT c.*, u.email FROM candidates c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1 AND c.grade IS NOT NULL`, [req.params.id])
    ?? await one(`SELECT v.*, u.email FROM candidate_category_view v JOIN users u ON u.id = v.user_id WHERE v.user_id = $1 ORDER BY v.grade_confirmed_at LIMIT 1`, [req.params.id]);
  if (!c) throw notFound("Кандидат");
  const visible = await contactsVisible(comp.id, c.user_id);
  let match = null;
  if (req.q.need_id) {
    const need = await one(`SELECT recipe FROM needs WHERE id = $1 AND company_id = $2`, [req.q.need_id, comp.id]);
    // если у кандидата есть категория в специализации потребности — показываем карточку в её разрезе
    const row = need ? await loadCategoryRow(c.user_id, need.recipe.specialization) : null;
    if (row) c = row;
    if (need) match = (await engine("/match", { recipe: need.recipe, candidates: [engineProfile(c)], filters: { specialization: c.specialization } })).results[0] ?? null;
  }
  const history = await q(`SELECT specialization, declared_grade, result, grade, created_at FROM grade_history WHERE candidate_id = $1 ORDER BY created_at DESC`, [c.user_id]);
  const tasks = await q(`SELECT t.title, t.kind, s.correct, s.submitted_at FROM task_submissions s JOIN tasks t ON t.id = s.task_id
                         WHERE s.candidate_id = $1 AND s.submitted_at IS NOT NULL ORDER BY s.submitted_at DESC LIMIT 10`, [c.user_id]);
  const inv = await q(`SELECT id, title, status, salary_from, salary_to, created_at FROM invitations WHERE company_id = $1 AND candidate_id = $2 ORDER BY created_at DESC`, [comp.id, c.user_id]);
  return { candidate: { ...employerView(c, { contacts: visible }), categories: await listCategories(c.user_id) }, match, grade_history: history, regular_tasks: tasks, invitations: inv };
});

// ---------- Приглашения (основная механика выхода на контакт) ----------
const InvitationBody = z.object({
  candidate_id: z.string().uuid(),
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(5000),
  salary_from: z.number().int().positive(),
  salary_to: z.number().int().positive(),
  contact_method: z.string().min(3).max(300),
  vacancy_id: z.string().uuid().optional(),
  need_id: z.string().uuid().optional(),
  source: z.enum(["selection", "search", "tasting"]).default("selection"),
  task_id: z.string().uuid().optional(),
}).refine((b) => b.salary_to >= b.salary_from, { message: "Верхняя граница зарплаты меньше нижней", path: ["salary_to"] }).openapi("InvitationCreate");

export async function createInvitation(userId: string, b: z.infer<typeof InvitationBody>) {
  const comp = await myCompany(userId);
  const t = await tickets(comp);
  if (t.left <= 0) throw new HttpError(429, `Лимит приглашений на неделю исчерпан (${t.limit}). Талон вернётся, когда кандидат ответит.`, "tickets");
  const cand = await one(`SELECT c.*, u.email FROM candidates c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1`, [b.candidate_id]);
  const hasCategory = cand && (cand.grade || (await one(`SELECT 1 FROM candidate_categories WHERE candidate_id = $1 LIMIT 1`, [cand.user_id])));
  if (!cand || !hasCategory) throw notFound("Кандидат");
  const dup = await one(`SELECT 1 FROM invitations WHERE company_id = $1 AND candidate_id = $2 AND status IN ('sent','viewed')`, [comp.id, b.candidate_id]);
  if (dup) throw new HttpError(409, "Этому кандидату уже отправлено приглашение — дождитесь ответа", "duplicate");
  let snapshot = null;
  if (b.need_id) {
    const need = await one(`SELECT recipe FROM needs WHERE id = $1 AND company_id = $2`, [b.need_id, comp.id]);
    const row = need ? (await loadCategoryRow(cand.user_id, need.recipe.specialization)) ?? cand : cand;
    if (need) snapshot = (await engine("/match", { recipe: need.recipe, candidates: [engineProfile(row)], filters: { specialization: row.specialization } })).results[0] ?? null;
  }
  const inv = await one(`INSERT INTO invitations(company_id, candidate_id, vacancy_id, need_id, task_id, source, title, description, salary_from, salary_to, contact_method, match_snapshot)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [comp.id, b.candidate_id, b.vacancy_id ?? null, b.need_id ?? null, b.task_id ?? null, b.source, b.title, b.description, b.salary_from, b.salary_to, b.contact_method, snapshot]);
  await sendMail(cand.email, `Приглашение от ${comp.name}: ${b.salary_from.toLocaleString("ru-RU")}–${b.salary_to.toLocaleString("ru-RU")} ₽`,
    layout(`${comp.name} приглашает вас`, `<p><b>${b.title}</b></p><p style="font-size:20px;font-weight:700;color:#520978">${b.salary_from.toLocaleString("ru-RU")} – ${b.salary_to.toLocaleString("ru-RU")} ₽</p>${button(`${config.publicUrl}/candidate/invitations`, "Открыть приглашение")}`));
  return inv;
}

route(router, B, {
  method: "post", path: "/invitations", tag: "Приглашения", summary: "Пригласить кандидата: описание, зарплата «от–до» (обязательно), способ связи", roles: [...ROLE],
  body: InvitationBody,
  description: "Вакансия не обязательна. Расходует «талон» (антиспам «Честного ценника»).",
}, async (req) => createInvitation(req.user!.id, req.body));

route(router, B, {
  method: "post", path: "/invitations/:id/outcome", tag: "Приглашения",
  summary: "Итог собеседования по принятому приглашению: наняли или не подошёл", roles: [...ROLE],
  body: z.object({ outcome: z.enum(["hired", "not_fit"]) }),
  description: "Сигнал для «Маринада»: голова «Подойдёт» ранжировщика учится на том, кого в итоге нанимают.",
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const inv = await one(`UPDATE invitations SET outcome = $3, outcome_at = now() WHERE id = $1 AND company_id = $2 AND status = 'accepted' RETURNING id, outcome`,
    [req.params.id, comp.id, req.body.outcome]);
  if (!inv) throw new HttpError(409, "Итог можно отметить только у принятого приглашения");
  void maybeRetrainRanker();
  return inv;
});

route(router, B, {
  method: "get", path: "/invitations", tag: "Приглашения", summary: "Мои приглашения и их статусы", roles: [...ROLE],
  query: z.object({ status: z.enum(["sent", "viewed", "accepted", "declined"]).optional() }),
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const rows = await q(`SELECT i.*, c.anon_code, c.full_name, c.specialization, c.grade, c.privacy, u.email, c.phone, c.telegram
    FROM invitations i JOIN candidates c ON c.user_id = i.candidate_id JOIN users u ON u.id = c.user_id
    WHERE i.company_id = $1 ${req.q.status ? "AND i.status = $2" : ""} ORDER BY i.created_at DESC`, req.q.status ? [comp.id, req.q.status] : [comp.id]);
  return rows.map((r: any) => {
    const open = r.status === "accepted";
    return {
      id: r.id, title: r.title, status: r.status, salary_from: r.salary_from, salary_to: r.salary_to, source: r.source, outcome: r.outcome,
      decline_reason: r.decline_reason, salary_honest: r.salary_honest, created_at: r.created_at, viewed_at: r.viewed_at, responded_at: r.responded_at,
      candidate: {
        id: r.candidate_id, display_name: open || r.privacy?.show_name ? r.full_name ?? `Кандидат #${r.anon_code}` : `Кандидат #${r.anon_code}`,
        category: categoryCode(r.specialization, r.grade),
        contacts: open ? { email: r.email, phone: r.phone, telegram: r.telegram, full_name: r.full_name } : null,
      },
    };
  });
});

route(router, B, { method: "get", path: "/stats", tag: "Работодатель", summary: "Воронка приглашений и причины отказов", roles: [...ROLE] }, async (req) => {
  const comp = await myCompany(req.user!.id);
  const [f] = await q(`SELECT count(*)::int AS sent,
      count(*) FILTER (WHERE status IN ('viewed','accepted','declined'))::int AS viewed,
      count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE status = 'declined')::int AS declined,
      count(*) FILTER (WHERE outcome = 'hired')::int AS hired
    FROM invitations WHERE company_id = $1`, [comp.id]);
  const reasons = await q(`SELECT decline_reason AS reason, count(*)::int AS n FROM invitations WHERE company_id = $1 AND status = 'declined' AND decline_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`, [comp.id]);
  return { funnel: f, decline_reasons: reasons, tickets: await tickets(comp), trust: comp.trust, honest_badge: comp.honest_badge };
});
