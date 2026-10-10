import { Router } from "express";
import { route, z } from "../api.js";
import { one, q } from "../db.js";
import { HttpError, notFound } from "../errors.js";
import { GRADE_TITLES, SPEC_TITLES, categoryCode, employerView } from "../services/candidate.js";
import { myCompany } from "./employer.js";

export const router = Router();
const Grade = z.enum(["intern", "junior", "middle", "senior"]);
const Spec = z.enum(["backend", "frontend", "data"]);
const Format = z.enum(["remote", "hybrid", "office"]);

const VacancyBody = z.object({
  title: z.string().min(3).max(160), description: z.string().min(20).max(8000),
  specialization: Spec, grade: Grade, stacks: z.array(z.string()).default([]), formats: z.array(Format).min(1).default(["remote"]),
  city: z.string().max(80).nullish(), salary_from: z.number().int().positive(), salary_to: z.number().int().positive(),
  need_id: z.string().uuid().nullish(),
}).refine((b) => b.salary_to >= b.salary_from, { message: "Верхняя граница зарплаты меньше нижней", path: ["salary_to"] }).openapi("VacancyCreate");

function vdto(v: any) {
  return { ...v, specialization_title: SPEC_TITLES[v.specialization], grade_title: GRADE_TITLES[v.grade], category: categoryCode(v.specialization, v.grade) };
}

// ---------- Публичный список (кандидат может откликнуться сам — дополнительный сценарий) ----------
route(router, "", {
  method: "get", path: "/vacancies", tag: "Вакансии", summary: "Опубликованные вакансии",
  query: z.object({ specialization: Spec.optional(), grade: Grade.optional(), q: z.string().optional() }),
}, async (req) => {
  const p: any[] = [];
  let sql = `SELECT v.*, co.name AS company_name, co.honest_badge FROM vacancies v JOIN companies co ON co.id = v.company_id WHERE v.status = 'published'`;
  if (req.q.specialization) { p.push(req.q.specialization); sql += ` AND v.specialization = $${p.length}`; }
  if (req.q.grade) { p.push(req.q.grade); sql += ` AND v.grade = $${p.length}`; }
  if (req.q.q) { p.push(`%${req.q.q}%`); sql += ` AND (v.title ILIKE $${p.length} OR v.description ILIKE $${p.length})`; }
  const rows = await q(`${sql} ORDER BY v.created_at DESC LIMIT 100`, p);
  const mine = req.user?.role === "candidate"
    ? new Map((await q(`SELECT vacancy_id, status FROM applications WHERE candidate_id = $1`, [req.user.id])).map((a: any) => [a.vacancy_id, a.status]))
    : new Map();
  return rows.map((v: any) => ({ ...vdto(v), my_application: mine.get(v.id) ?? null }));
});

route(router, "", { method: "get", path: "/vacancies/:id", tag: "Вакансии", summary: "Вакансия" }, async (req) => {
  const v = await one(`SELECT v.*, co.name AS company_name, co.description AS company_description, co.honest_badge FROM vacancies v JOIN companies co ON co.id = v.company_id WHERE v.id = $1`, [req.params.id]);
  if (!v) throw notFound("Вакансия");
  return vdto(v);
});

route(router, "", {
  method: "post", path: "/vacancies/:id/apply", tag: "Вакансии", summary: "Откликнуться на вакансию (контакты раскрываются этой компании)", roles: ["candidate"],
  body: z.object({ note: z.string().max(2000).optional() }),
}, async (req) => {
  const v = await one(`SELECT * FROM vacancies WHERE id = $1 AND status = 'published'`, [req.params.id]);
  if (!v) throw notFound("Вакансия");
  const c = await one(`SELECT grade, consent_processing FROM candidates WHERE user_id = $1`, [req.user!.id]);
  if (!c?.consent_processing) throw new HttpError(409, "Нужно согласие на обработку персональных данных", "consent_required");
  const a = await one(`INSERT INTO applications(vacancy_id, candidate_id, note) VALUES ($1,$2,$3) ON CONFLICT (vacancy_id, candidate_id) DO NOTHING RETURNING *`,
    [v.id, req.user!.id, req.body.note ?? null]);
  if (!a) throw new HttpError(409, "Вы уже откликнулись на эту вакансию");
  return a;
});

route(router, "", { method: "get", path: "/candidate/applications", tag: "Вакансии", summary: "Мои отклики и их статусы", roles: ["candidate"] }, async (req) => {
  return q(`SELECT a.*, v.title, v.salary_from, v.salary_to, v.specialization, v.grade, co.name AS company_name
            FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN companies co ON co.id = v.company_id
            WHERE a.candidate_id = $1 ORDER BY a.created_at DESC`, [req.user!.id]);
});

// ---------- Работодатель: публикация и отклики ----------
route(router, "", { method: "get", path: "/employer/vacancies", tag: "Вакансии", summary: "Мои вакансии", roles: ["employer"] }, async (req) => {
  const comp = await myCompany(req.user!.id);
  const rows = await q(`SELECT v.*, (SELECT count(*)::int FROM applications a WHERE a.vacancy_id = v.id) AS applications,
      (SELECT count(*)::int FROM applications a WHERE a.vacancy_id = v.id AND a.status = 'sent') AS new_applications
    FROM vacancies v WHERE v.company_id = $1 ORDER BY v.created_at DESC`, [comp.id]);
  return rows.map(vdto);
});

route(router, "", { method: "post", path: "/employer/vacancies", tag: "Вакансии", summary: "Опубликовать вакансию (зарплата «от–до» обязательна)", roles: ["employer"], body: VacancyBody }, async (req) => {
  const comp = await myCompany(req.user!.id);
  const b = req.body;
  return vdto(await one(`INSERT INTO vacancies(company_id, need_id, title, description, specialization, grade, stacks, formats, city, salary_from, salary_to)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [comp.id, b.need_id ?? null, b.title, b.description, b.specialization, b.grade, b.stacks, b.formats, b.city ?? null, b.salary_from, b.salary_to]));
});

route(router, "", {
  method: "put", path: "/employer/vacancies/:id", tag: "Вакансии", summary: "Редактировать или закрыть вакансию", roles: ["employer"],
  body: z.object({
    title: z.string().min(3).max(160), description: z.string().min(20).max(8000), stacks: z.array(z.string()), formats: z.array(Format).min(1),
    city: z.string().max(80).nullish(), salary_from: z.number().int().positive(), salary_to: z.number().int().positive(), status: z.enum(["published", "closed"]),
  }).partial(),
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const fields = Object.entries(req.body).filter(([, v]) => v !== undefined);
  const v = await one(`UPDATE vacancies SET ${fields.map(([k], i) => `${k} = $${i + 3}`).join(", ") || "status = status"} WHERE id = $1 AND company_id = $2 RETURNING *`,
    [req.params.id, comp.id, ...fields.map(([, x]) => x)]);
  if (!v) throw notFound("Вакансия");
  if (v.salary_to < v.salary_from) throw new HttpError(400, "Верхняя граница зарплаты меньше нижней");
  return vdto(v);
});

route(router, "", { method: "get", path: "/employer/vacancies/:id/applications", tag: "Вакансии", summary: "Отклики на вакансию (контакты откликнувшихся открыты)", roles: ["employer"] }, async (req) => {
  const comp = await myCompany(req.user!.id);
  const rows = await q(`SELECT a.id AS application_id, a.status AS application_status, a.note, a.created_at AS applied_at, c.*, u.email
    FROM applications a JOIN vacancies v ON v.id = a.vacancy_id JOIN candidates c ON c.user_id = a.candidate_id JOIN users u ON u.id = c.user_id
    WHERE v.id = $1 AND v.company_id = $2 ORDER BY a.created_at DESC`, [req.params.id, comp.id]);
  return rows.map((r: any) => ({ id: r.application_id, status: r.application_status, note: r.note, created_at: r.applied_at, candidate: employerView(r, { contacts: true }) }));
});

for (const action of ["view", "accept", "decline"] as const) {
  route(router, "", {
    method: "post", path: `/employer/applications/:id/${action}`, tag: "Вакансии",
    summary: { view: "Отметить отклик просмотренным", accept: "Принять отклик", decline: "Отклонить отклик" }[action], roles: ["employer"],
  }, async (req) => {
    const comp = await myCompany(req.user!.id);
    const status = { view: "viewed", accept: "accepted", decline: "declined" }[action];
    const a = await one(`UPDATE applications a SET status = $3,
        viewed_at = COALESCE(viewed_at, now()), responded_at = CASE WHEN $3 IN ('accepted','declined') THEN now() ELSE responded_at END
      FROM vacancies v WHERE a.id = $1 AND v.id = a.vacancy_id AND v.company_id = $2 RETURNING a.*`, [req.params.id, comp.id, status]);
    if (!a) throw notFound("Отклик");
    return a;
  });
}
