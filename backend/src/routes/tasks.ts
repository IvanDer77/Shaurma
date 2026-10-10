import crypto from "node:crypto";
import { Router } from "express";
import { route, z } from "../api.js";
import { one, q } from "../db.js";
import { engine } from "../engine.js";
import { HttpError, notFound } from "../errors.js";
import { GRADE_TITLES, categoryCode, loadCandidate } from "../services/candidate.js";
import { ensurePracticeTask } from "../services/practice.js";
import { createInvitation, myCompany } from "./employer.js";

/**
 * «Слепая дегустация» — регулярные короткие задачи от работодателя (ТЗ, п. 2).
 * Задача собирается по рецепту компании; у каждого кандидата — свой уникальный вариант.
 * Работодатель видит обезличенные решения и приглашает автора, не зная, кто это.
 * Плюс «Свежая начинка» (kind = 'system'): система сама адресно предлагает кандидату задачу по «остывшему»
 * или слабому ингредиенту — см. services/practice.ts.
 */
export const router = Router();

route(router, "", {
  method: "post", path: "/employer/tasks", tag: "Регулярные задачи", summary: "Опубликовать задачу для категории по рецепту потребности", roles: ["employer"],
  body: z.object({
    need_id: z.string().uuid(),
    title: z.string().min(3).max(160),
    description: z.string().max(2000).default(""),
    approach_question: z.string().max(500).optional(),
    days: z.number().int().min(1).max(30).default(7),
  }),
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const need = await one(`SELECT * FROM needs WHERE id = $1 AND company_id = $2`, [req.body.need_id, comp.id]);
  if (!need) throw notFound("Потребность");
  const pick = await engine("/recipe/task", { recipe: need.recipe, seed: crypto.randomInt(1e9) });
  return one(`INSERT INTO tasks(company_id, need_id, title, description, specialization, grade, template_id, ops, b, ingredients, approach_question, deadline)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' days')::interval) RETURNING *`,
    [comp.id, need.id, req.body.title, req.body.description, need.recipe.specialization, need.recipe.grade, pick.template_id, pick.ops, pick.b,
     pick.ingredients, req.body.approach_question ?? null, String(req.body.days)]);
});

route(router, "", { method: "get", path: "/employer/tasks", tag: "Регулярные задачи", summary: "Мои задачи и число решений", roles: ["employer"] }, async (req) => {
  const comp = await myCompany(req.user!.id);
  return q(`SELECT t.*, (SELECT count(*)::int FROM task_submissions s WHERE s.task_id = t.id AND s.submitted_at IS NOT NULL) AS submissions
            FROM tasks t WHERE t.company_id = $1 ORDER BY t.created_at DESC`, [comp.id]);
});

route(router, "", {
  method: "get", path: "/employer/tasks/:id/submissions", tag: "Регулярные задачи",
  summary: "Обезличенные решения («окошко ларька»): без имени, с результатом и рейтингом", roles: ["employer"],
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const t = await one(`SELECT * FROM tasks WHERE id = $1 AND company_id = $2`, [req.params.id, comp.id]);
  if (!t) throw notFound("Задача");
  const rows = await q(`SELECT s.*, c.anon_code, c.specialization, c.grade, c.ratings, c.salary_expect,
      (SELECT count(*)::int FROM invitations i WHERE i.candidate_id = s.candidate_id AND i.status IN ('sent','viewed')) AS queue
    FROM task_submissions s JOIN candidates c ON c.user_id = s.candidate_id
    WHERE s.task_id = $1 AND s.submitted_at IS NOT NULL`, [t.id]);
  const invited = new Map((await q(`SELECT candidate_id, status FROM invitations WHERE company_id = $1 AND task_id = $2`, [comp.id, t.id])).map((x: any) => [x.candidate_id, x.status]));
  const items = rows.map((r: any) => {
    const ing = t.ingredients.map((i: string) => r.ratings?.[i]).filter(Boolean);
    const cr = ing.length ? ing.reduce((s: number, e: any) => s + e.r - 2 * e.rd, 0) / ing.length : 800;
    return {
      submission_id: r.id, label: `Решение #${r.anon_code}`, correct: r.correct, approach: r.approach, seconds: r.seconds,
      category: categoryCode(r.specialization, r.grade), grade_title: GRADE_TITLES[r.grade], rating: Math.round(cr),
      salary_expect: r.salary_expect, queue: r.queue, invitation_status: invited.get(r.candidate_id) ?? null, submitted_at: r.submitted_at,
    };
  });
  items.sort((a: any, b: any) => Number(b.correct) - Number(a.correct) || b.rating - a.rating);
  return { task: t, items };
});

route(router, "", {
  method: "post", path: "/employer/tasks/:id/submissions/:sid/invite", tag: "Регулярные задачи",
  summary: "Пригласить автора понравившегося решения, не зная, кто это", roles: ["employer"],
  body: z.object({ title: z.string().min(3), description: z.string().min(10), salary_from: z.number().int().positive(), salary_to: z.number().int().positive(), contact_method: z.string().min(3) }),
}, async (req) => {
  const comp = await myCompany(req.user!.id);
  const s = await one(`SELECT s.* FROM task_submissions s JOIN tasks t ON t.id = s.task_id WHERE s.id = $1 AND t.id = $2 AND t.company_id = $3`, [req.params.sid, req.params.id, comp.id]);
  if (!s) throw notFound("Решение");
  if (req.body.salary_to < req.body.salary_from) throw new HttpError(400, "Верхняя граница зарплаты меньше нижней");
  const t = await one(`SELECT need_id FROM tasks WHERE id = $1`, [req.params.id]);
  return createInvitation(req.user!.id, { ...req.body, candidate_id: s.candidate_id, source: "tasting", task_id: req.params.id as string, need_id: t?.need_id ?? undefined });
});

// ---------- Кандидат ----------
route(router, "", {
  method: "get", path: "/candidate/tasks", tag: "Регулярные задачи",
  summary: "Мои регулярные задачи: адресные от системы («Свежая начинка») и от работодателей для моей категории", roles: ["candidate"],
  description: "Если пора (не чаще раза в 7 дней), система сама создаёт адресную задачу по «остывшему» или слабому ингредиенту.",
}, async (req) => {
  const c = await loadCandidate(req.user!.id);
  if (!c?.grade) return [];
  await ensurePracticeTask(c.user_id).catch((e) => console.warn("Свежая начинка:", e.message));
  return q(`SELECT t.id, t.kind, t.title, t.description, t.approach_question, t.deadline, t.ingredients, t.reason, t.created_at, co.name AS company_name,
      s.submitted_at, s.correct, o.offered_at
    FROM tasks t LEFT JOIN companies co ON co.id = t.company_id
    LEFT JOIN task_submissions s ON s.task_id = t.id AND s.candidate_id = $1
    LEFT JOIN task_offers o ON o.task_id = t.id AND o.candidate_id = $1
    WHERE ((t.kind = 'employer' AND t.deadline > now()
            AND t.specialization IN (SELECT specialization FROM candidate_categories WHERE candidate_id = $1 UNION SELECT $2::text))
       OR (t.kind = 'system' AND t.candidate_id = $1 AND (t.deadline > now() OR s.submitted_at IS NOT NULL)))
    ORDER BY ((t.kind = 'system' OR o.offered_at IS NOT NULL) AND s.submitted_at IS NULL) DESC, t.created_at DESC LIMIT 30`, [c.user_id, c.specialization]);
});

route(router, "", { method: "post", path: "/candidate/tasks/:id/start", tag: "Регулярные задачи", summary: "Получить свой уникальный вариант задачи", roles: ["candidate"] }, async (req) => {
  const c = await loadCandidate(req.user!.id);
  const t = await one(`SELECT * FROM tasks WHERE id = $1 AND deadline > now()`, [req.params.id]);
  const myCats = (await q(`SELECT specialization FROM candidate_categories WHERE candidate_id = $1`, [req.user!.id])).map((r: any) => r.specialization);
  if (!t || !c?.grade || ![c.specialization, ...myCats].includes(t.specialization) || (t.kind === "system" && t.candidate_id !== c.user_id)) throw notFound("Задача");
  let s = await one(`SELECT * FROM task_submissions WHERE task_id = $1 AND candidate_id = $2`, [t.id, c.user_id]);
  if (!s) {
    const v = await engine("/variants", { template_id: t.template_id, ops: t.ops, seed: crypto.randomInt(1e9) });
    s = await one(`INSERT INTO task_submissions(task_id, candidate_id, variant_id, seed, prompt, code, language, options, correct_option, correct_label)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [t.id, c.user_id, v.variant_id, v.seed, v.prompt, v.code, v.language, JSON.stringify(v.options), v.correct_option, v.correct_label]);
  }
  return {
    id: s.id, task: { id: t.id, kind: t.kind, title: t.title, description: t.description, approach_question: t.approach_question, deadline: t.deadline },
    prompt: s.prompt, code: s.code, language: s.language, options: s.options, submitted: !!s.submitted_at, correct: s.submitted_at ? s.correct : undefined,
  };
});

route(router, "", {
  method: "post", path: "/candidate/tasks/:id/submit", tag: "Регулярные задачи", summary: "Отправить решение (и подход, если спрашивают)", roles: ["candidate"],
  body: z.object({ option: z.string().max(2), approach: z.string().max(3000).optional(), seconds: z.number().optional() }),
}, async (req) => {
  const c = await loadCandidate(req.user!.id);
  const t = await one(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
  const s = await one(`SELECT * FROM task_submissions WHERE task_id = $1 AND candidate_id = $2`, [req.params.id, req.user!.id]);
  if (!s || !t || !c) throw notFound("Решение");
  if (s.submitted_at) throw new HttpError(409, "Решение уже отправлено");
  if (new Date(t.deadline) < new Date()) throw new HttpError(409, "Срок задачи истёк");
  const opt = (s.options as any[]).find((o) => o.id === req.body.option);
  if (!opt) throw new HttpError(400, "Нет такого варианта ответа");
  const correct = opt.id === s.correct_option;
  let canary = null;
  if (!correct) {
    const other = await one(`SELECT variant_id FROM task_submissions WHERE task_id = $1 AND candidate_id <> $2 AND correct_label = $3 LIMIT 1`, [t.id, c.user_id, opt.label]);
    if (other) canary = { type: "canary", source_variant: other.variant_id };
  }
  // Регулярная задача — тоже «матч» на вертеле: профиль снова «горячий»
  const { ratings } = await engine("/ratings/apply", { ratings: c.ratings ?? {}, results: [{ b: t.b, ingredients: t.ingredients, correct }] });
  await q(`UPDATE task_submissions SET answer_option = $2, correct = $3, approach = $4, seconds = $5, canary = $6, submitted_at = now() WHERE id = $1`,
    [s.id, opt.id, correct, req.body.approach ?? null, req.body.seconds ?? null, canary]);
  await q(`UPDATE candidates SET ratings = $2, last_active_at = now() WHERE user_id = $1`, [c.user_id, ratings]);
  return { correct, correct_option: s.correct_option };
});
