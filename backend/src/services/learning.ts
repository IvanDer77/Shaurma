/**
 * «Маринад» — платформа учится на собственных данных.
 *
 *  ответы на тест            → перекалибровка сложностей (каждые CALIBRATE_EVERY новых ответов)
 *  те же ответы по времени   → детектор «чёрствого лаваша» (начинка внезапно стала легче)
 *  ответы на приглашения     → дообучение ранжировщика «Подойдёт × Примет» (каждые RANKER_EVERY)
 *  правка рецепта ползунками → переобучение модели «текст → рецепт»
 *
 * Обучение считает движок (он без состояния, модели — в docker-томе), backend собирает данные из БД,
 * решает, когда пора, и ведёт журнал версий model_versions. Всё асинхронно: пользователь не ждёт.
 */
import { q, one } from "../db.js";
import { catalog, engine } from "../engine.js";
import { engineProfile } from "./candidate.js";

const CALIBRATE_EVERY = Number(process.env.CALIBRATE_EVERY ?? 300);
const RANKER_EVERY = Number(process.env.RANKER_EVERY ?? 20);
const running = new Set<string>();

async function state(kind: string) {
  return (await one(`INSERT INTO learning_state(kind) VALUES ($1) ON CONFLICT (kind) DO UPDATE SET kind = EXCLUDED.kind RETURNING *`, [kind]))!;
}

async function journal(kind: string, r: any, n: number) {
  await q(`INSERT INTO model_versions(kind, version, activated, reason, n_examples, metrics) VALUES ($1,$2,$3,$4,$5,$6)`,
    [kind, r.version ?? null, !!r.activated, r.reason ?? null, n, r]);
}

/** Запуск задачи не чаще одного экземпляра; ошибки обучения не роняют API. */
function once(kind: string, fn: () => Promise<void>) {
  if (running.has(kind)) return Promise.resolve();
  running.add(kind);
  return fn().catch((e) => console.warn(`Маринад/${kind}:`, e.message)).finally(() => running.delete(kind));
}

async function answeredItems() {
  return q(`SELECT ti.template_id, ti.ops, ti.correct, ti.b, ti.ingredients, jsonb_array_length(ti.options) AS n_options,
                   ts.candidate_id AS person, ts.theta, extract(epoch FROM ti.answered_at)::float AS ts
            FROM test_items ti JOIN test_sessions ts ON ts.id = ti.session_id
            WHERE ti.correct IS NOT NULL ORDER BY ti.answered_at`);
}

export async function counters() {
  const [r] = await q(`SELECT
      (SELECT count(*) FROM test_items WHERE correct IS NOT NULL)::int AS answers,
      (SELECT count(DISTINCT session_id) FROM test_items WHERE correct IS NOT NULL)::int AS sessions,
      (SELECT count(*) FROM invitations WHERE status IN ('accepted','declined'))::int AS invitation_answers,
      (SELECT count(*) FROM invitations WHERE outcome IS NOT NULL)::int AS interview_outcomes,
      (SELECT count(*) FROM needs WHERE updated_at > created_at + interval '1 second')::int AS recipe_edits`);
  return r;
}

// ---------------------------------------------------------------- калибровка + детектор
export function maybeCalibrate(force = false) {
  return once("calibration", async () => {
    const st = await state("calibration");
    const items = await answeredItems();
    if (!force && items.length - st.last_count < CALIBRATE_EVERY) return;
    // сначала детектор: тревога «обнуляет историю» начинки, чтобы калибровка выучила её новую сложность
    const resetKeys = { ...(st.reset_keys ?? {}) };
    const drift = await engine("/learn/drift", { items: items.filter((i: any) => i.theta != null), reset_keys: resetKeys });
    for (const a of drift.alarms ?? []) if (a.kind === "op" && !resetKeys[a.key]) resetKeys[a.key] = a.alarm_ts;
    if (drift.alarms?.length) await journal("drift", { activated: true, version: `drift-${Date.now()}`, alarms: drift.alarms }, items.length);
    const r = await engine("/learn/calibrate", { responses: items, reset_keys: resetKeys, min_responses: Math.min(CALIBRATE_EVERY, 300) });
    await journal("calibration", r, items.length);
    await q(`UPDATE learning_state SET last_count = $2, last_run_at = now(), reset_keys = $3 WHERE kind = $1`, [st.kind, items.length, resetKeys]);
  });
}

export async function driftReport() {
  const items = await answeredItems();
  const st = await state("calibration");
  return engine("/learn/drift", { items: items.filter((i: any) => i.theta != null), reset_keys: st.reset_keys ?? {} });
}

// ---------------------------------------------------------------- ранжировщик
async function fallbackRecipe(c: any, inv: any) {
  if (inv.recipe) return inv.recipe;
  const cat = await catalog();
  const spec = inv.v_spec ?? c.specialization;
  const ings: string[] = cat.specializations[spec]?.ingredients ?? [];
  return {
    specialization: spec, grade: inv.v_grade ?? c.grade, stacks: inv.v_stacks ?? [], formats: inv.v_formats ?? [],
    ingredients: Object.fromEntries(ings.map((i) => [i, 1 / ings.length])),
  };
}

export function maybeRetrainRanker(force = false) {
  return once("ranker", async () => {
    const st = await state("ranker");
    const rows = await q(`SELECT i.status, i.outcome, i.salary_from, i.salary_to, co.trust, n.recipe,
        v.specialization AS v_spec, v.grade AS v_grade, v.stacks AS v_stacks, v.formats AS v_formats, c.*
      FROM invitations i JOIN candidates c ON c.user_id = i.candidate_id JOIN companies co ON co.id = i.company_id
      LEFT JOIN needs n ON n.id = i.need_id LEFT JOIN vacancies v ON v.id = i.vacancy_id
      WHERE i.status IN ('accepted','declined') AND c.grade IS NOT NULL`);
    if (!force && rows.length - st.last_count < RANKER_EVERY) return;
    const invitations = [];
    for (const r of rows) {
      const recipe = await fallbackRecipe(r, r);
      invitations.push({
        candidate: { ...engineProfile(r), last_active_days: Math.floor((Date.now() - new Date(r.last_active_at).getTime()) / 864e5) },
        recipe, offer: { salary_from: r.salary_from, salary_to: r.salary_to, trust: r.trust, formats: recipe.formats },
        accepted: r.status === "accepted", hired: r.outcome ? r.outcome === "hired" : null,
      });
    }
    const res = await engine("/learn/ranker", { invitations });
    await journal("ranker", res, invitations.length);
    await q(`UPDATE learning_state SET last_count = $2, last_run_at = now() WHERE kind = $1`, [st.kind, rows.length]);
  });
}

// ---------------------------------------------------------------- модель «текст → рецепт»
export function retrainTextModel() {
  return once("textmodel", async () => {
    const edits = await q(`SELECT text, recipe FROM needs WHERE updated_at > created_at + interval '1 second'`);
    if (!edits.length) return;
    const res = await engine("/learn/textmodel", { examples: edits });
    await journal("textmodel", res, edits.length);
    await q(`INSERT INTO learning_state(kind, last_count, last_run_at) VALUES ('textmodel', $1, now())
             ON CONFLICT (kind) DO UPDATE SET last_count = $1, last_run_at = now()`, [edits.length]);
  });
}

/** При старте: догоняем всё, что накопилось (например, после сида). */
export async function startupLearning() {
  await maybeRetrainRanker();
  await maybeCalibrate();
}
