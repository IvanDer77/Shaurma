import { Router } from "express";
import { route, z } from "../api.js";
import { config } from "../config.js";
import { one, q, tx } from "../db.js";
import { engine } from "../engine.js";
import { HttpError, notFound } from "../errors.js";
import { GRADE_ORDER, GRADE_TITLES, SPEC_TITLES, categoryCode, computeVerifiedStacks, loadCandidate, upsertCategory } from "../services/candidate.js";
import { maybeCalibrate } from "../services/learning.js";

export const router = Router();
const B = "/candidate/tests";
const ROLE = ["candidate"] as const;

/** Задание для кандидата — без правильного ответа. */
function publicItem(it: any) {
  return {
    id: it.id, position: it.position, title: it.title, prompt: it.prompt, code: it.code, language: it.language,
    kind: it.kind, options: it.options, ingredients: it.ingredients, answered: it.answer_option != null,
  };
}

async function insertItem(c: any, sessionId: string, position: number, v: any) {
  return (await c.query(
    `INSERT INTO test_items(session_id, position, variant_id, template_id, ops, seed, b, ingredients, language, kind, title, prompt, code, options, correct_option, correct_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [sessionId, position, v.variant_id, v.template_id, v.ops, v.seed, v.b, v.ingredients, v.language, v.kind, v.template_title,
     v.prompt, v.code, JSON.stringify(v.options), v.correct_option, v.correct_label])).rows[0];
}

async function exposure(): Promise<Record<string, number>> {
  const rows = await q(`SELECT template_id, count(*)::int AS n FROM test_items WHERE shown_at > now() - interval '30 days' GROUP BY template_id`);
  return Object.fromEntries(rows.map((r: any) => [r.template_id, r.n]));
}

async function sessionState(sessionId: string, userId: string) {
  const s = await one(`SELECT * FROM test_sessions WHERE id = $1 AND candidate_id = $2`, [sessionId, userId]);
  if (!s) throw notFound("Сессия теста");
  const items = await q(`SELECT * FROM test_items WHERE session_id = $1 ORDER BY position`, [sessionId]);
  const current = items.find((i: any) => i.answer_option == null);
  const cat = (await engine("/catalog")).cat;
  return {
    id: s.id, status: s.status, specialization: s.specialization, specialization_title: SPEC_TITLES[s.specialization], declared_grade: s.declared_grade,
    declared_grade_title: GRADE_TITLES[s.declared_grade],
    progress: { answered: items.filter((i: any) => i.answer_option != null).length, min: cat.min_items, max: cat.max_items },
    current: s.status === "active" && current ? publicItem(current) : null,
    decision: s.decision, theta: s.theta, se: s.se, antileak: s.status === "finished" ? s.antileak : undefined,
    review: s.status === "finished"
      ? items.map((i: any) => ({ position: i.position, title: i.title, correct: i.correct, b: i.b, ingredients: i.ingredients }))
      : undefined,
  };
}

/** Можно ли начать тест на этот грейд в этой специализации (смена грейда — не чаще раза в 90 дней, у каждой категории свои). */
async function checkEligibility(c: any, spec: string, declared: string) {
  if (!c.specialization || !c.survey) throw new HttpError(409, "Сначала пройдите опрос по специализации", "survey_required");
  if (!c.consent_processing) throw new HttpError(409, "Нужно согласие на обработку персональных данных", "consent_required");
  if (spec !== c.specialization && !c.grade) {
    throw new HttpError(409, "Дополнительную категорию можно добавить после подтверждения основной", "primary_required");
  }
  const cat = await one(`SELECT grade, locked_until FROM candidate_categories WHERE candidate_id = $1 AND specialization = $2`, [c.user_id, spec]);
  const grade = cat?.grade ?? (spec === c.specialization ? c.grade : null);
  const lockedUntil = cat?.locked_until ?? (spec === c.specialization ? c.grade_locked_until : null);
  if (!grade) return; // первичная категоризация в этой специализации: можно сразу пересдать на уровень ниже
  if (declared === grade) throw new HttpError(409, "Этот грейд уже подтверждён", "same_grade");
  const last = await one(`SELECT decision, finished_at FROM test_sessions WHERE candidate_id = $1 AND specialization = $2 AND status = 'finished'
    ORDER BY finished_at DESC LIMIT 1`, [c.user_id, spec]);
  const offered = last?.decision?.upgrade_offer === declared && Date.now() - new Date(last.finished_at).getTime() < 7 * 864e5;
  if (offered) return; // уверенно сдавшему сразу предлагаем тест на повышение
  if (lockedUntil && new Date(lockedUntil) > new Date()) {
    throw new HttpError(409, `Сменить грейд можно не чаще раза в ${config.gradeCooldownDays} дней — следующая попытка с ${new Date(lockedUntil).toLocaleDateString("ru-RU")}`, "cooldown");
  }
}

route(router, B, {
  method: "post", path: "", tag: "Тестирование", summary: "Начать адаптивный тест на заявленный грейд", roles: [...ROLE],
  body: z.object({
    declared_grade: z.enum(["intern", "junior", "middle", "senior"]),
    specialization: z.enum(["backend", "frontend", "data"]).optional(),
  }),
  description: "Каждому кандидату — уникальные варианты (шаблон + мутации + обёртка) с заранее известной сложностью (LLTM). Правильный ответ получен исполнением кода. " +
    "specialization — тест в другой специализации: так добавляется дополнительная категория (после подтверждения основной).",
}, async (req) => {
  const c = await loadCandidate(req.user!.id);
  if (!c) throw notFound("Профиль");
  const active = await one(`SELECT id FROM test_sessions WHERE candidate_id = $1 AND status = 'active'`, [c.user_id]);
  if (active) return sessionState(active.id, c.user_id);
  const spec = req.body.specialization ?? c.specialization;
  await checkEligibility(c, spec, req.body.declared_grade);
  const step = await engine("/cat/next", { specialization: spec, declared_grade: req.body.declared_grade, responses: [], exposure: await exposure() });
  const sid = await tx(async (cl) => {
    const s = (await cl.query(`INSERT INTO test_sessions(candidate_id, specialization, declared_grade) VALUES ($1,$2,$3) RETURNING id`,
      [c.user_id, spec, req.body.declared_grade])).rows[0];
    await insertItem(cl, s.id, 1, step.variant);
    if (spec === c.specialization) await cl.query(`UPDATE candidates SET declared_grade = $2 WHERE user_id = $1`, [c.user_id, req.body.declared_grade]);
    return s.id;
  });
  return sessionState(sid, c.user_id);
});

route(router, B, { method: "get", path: "", tag: "Тестирование", summary: "Мои тестовые сессии", roles: [...ROLE] }, async (req) => {
  return q(`SELECT id, specialization, declared_grade, status, theta, se, decision, started_at, finished_at
            FROM test_sessions WHERE candidate_id = $1 ORDER BY started_at DESC`, [req.user!.id]);
});

route(router, B, { method: "get", path: "/:id", tag: "Тестирование", summary: "Состояние сессии и текущее задание", roles: [...ROLE] }, async (req) => {
  return sessionState(req.params.id as string, req.user!.id);
});

route(router, B, {
  method: "post", path: "/:id/answer", tag: "Тестирование", summary: "Ответить на текущее задание", roles: [...ROLE],
  body: z.object({ item_id: z.string().uuid(), option: z.string().max(2), seconds: z.number().min(0).max(3600).optional() }),
}, async (req) => {
  const uid = req.user!.id;
  const s = await one(`SELECT * FROM test_sessions WHERE id = $1 AND candidate_id = $2`, [req.params.id, uid]);
  if (!s) throw notFound("Сессия теста");
  if (s.status !== "active") throw new HttpError(409, "Тест уже завершён", "finished");
  const it = await one(`SELECT * FROM test_items WHERE id = $1 AND session_id = $2`, [req.body.item_id, s.id]);
  if (!it) throw notFound("Задание");
  if (it.answer_option != null) throw new HttpError(409, "На это задание уже есть ответ", "answered");
  const opt = (it.options as any[]).find((o) => o.id === req.body.option);
  if (!opt) throw new HttpError(400, "Нет такого варианта ответа");
  const correct = opt.id === it.correct_option;

  // «Фирменный соус»: ответ совпал с правильным ответом ЧУЖОГО варианта того же шаблона?
  let canary = null;
  if (!correct) {
    const other = await one(
      `SELECT ti.variant_id, ts.candidate_id FROM test_items ti JOIN test_sessions ts ON ts.id = ti.session_id
       WHERE ti.template_id = $1 AND ti.variant_id <> $2 AND ts.candidate_id <> $3 AND ti.correct_label = $4 LIMIT 1`,
      [it.template_id, it.variant_id, uid, opt.label]);
    if (other) canary = { type: "canary", source_variant: other.variant_id, message: "Ответ совпал с правильным ответом чужого варианта" };
  }
  const seconds = req.body.seconds ?? (Date.now() - new Date(it.shown_at).getTime()) / 1000;
  await q(`UPDATE test_items SET answer_option = $2, answer_label = $3, correct = $4, seconds = $5, canary = $6, answered_at = now() WHERE id = $1`,
    [it.id, opt.id, opt.label, correct, seconds, canary]);

  const items = await q(`SELECT * FROM test_items WHERE session_id = $1 ORDER BY position`, [s.id]);
  const responses = items.map((i: any) => ({ template_id: i.template_id, ops: i.ops, b: i.b, correct: i.correct, n_options: i.options.length }));
  const step = await engine("/cat/next", { specialization: s.specialization, declared_grade: s.declared_grade, responses, exposure: await exposure() });

  if (!step.done) {
    await tx((cl) => insertItem(cl, s.id, items.length + 1, step.variant));
    return sessionState(s.id, uid);
  }

  // Итог: решение по грейду, рейтинг на вертеле, антислив
  const d = step.decision;
  const report = await engine("/antileak/report", {
    theta: d.theta,
    items: items.map((i: any) => ({ b: i.b, correct: i.correct, n_options: i.options.length, seconds: i.seconds, canary: i.canary })),
  });
  const c = await loadCandidate(uid);
  const { ratings } = await engine("/ratings/apply", {
    ratings: c.ratings ?? {},
    results: items.map((i: any) => ({ b: i.b, ingredients: i.ingredients, correct: i.correct })),
  });
  await tx(async (cl) => {
    await cl.query(`UPDATE test_sessions SET status = 'finished', finished_at = now(), theta = $2, se = $3, decision = $4, antileak = $5 WHERE id = $1`,
      [s.id, d.theta, d.se, d, report]);
    await cl.query(`INSERT INTO grade_history(candidate_id, session_id, specialization, declared_grade, result, grade, theta) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uid, s.id, s.specialization, s.declared_grade, d.status, d.grade, d.theta]);
    const primary = s.specialization === c.specialization;
    if (d.status === "confirmed" && primary) {
      await cl.query(`UPDATE candidates SET grade = $2, grade_confirmed_at = now(), grade_locked_until = now() + interval '${config.gradeCooldownDays} days',
          theta = $3, ratings = $4, last_active_at = now() WHERE user_id = $1`, [uid, d.grade, d.theta, ratings]);
      await upsertCategory(cl, uid, s.specialization, d.grade, d.theta, true, config.gradeCooldownDays);
    } else if (d.status === "confirmed") {
      // дополнительная категория: основная не меняется, рейтинги ингредиентов общие
      await cl.query(`UPDATE candidates SET ratings = $2, last_active_at = now() WHERE user_id = $1`, [uid, ratings]);
      await upsertCategory(cl, uid, s.specialization, d.grade, d.theta, false, config.gradeCooldownDays);
    } else {
      await cl.query(`UPDATE candidates SET ratings = $2, last_active_at = now() WHERE user_id = $1`, [uid, ratings]);
    }
  });
  await computeVerifiedStacks(uid);
  const state = await sessionState(s.id, uid);
  void maybeCalibrate(); // «Маринад»: каждые N новых ответов тест перекалибровывается (в фоне)
  return { ...state, category: d.grade ? categoryCode(s.specialization, d.grade) : null };
});

route(router, B, { method: "post", path: "/:id/abandon", tag: "Тестирование", summary: "Прервать тест", roles: [...ROLE] }, async (req) => {
  await q(`UPDATE test_sessions SET status = 'abandoned', finished_at = now() WHERE id = $1 AND candidate_id = $2 AND status = 'active'`, [req.params.id, req.user!.id]);
  return { ok: true };
});

void GRADE_ORDER;
