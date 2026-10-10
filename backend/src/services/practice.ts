/**
 * «Свежая начинка» — система периодически и адресно предлагает кандидату регулярную задачу (ТЗ, п. 2).
 *
 * Не чаще раза в PRACTICE_EVERY_DAYS дней, только кандидату с подтверждённой категорией и без открытой
 * системной задачи. Ингредиент выбирает движок: «остывший», ещё не проверенный или самый слабый.
 * Задача создаётся при заходе кандидата в «Регулярные задачи» и периодическим обходом (с письмом).
 * Оценка — автоматическая: уникальный вариант, эталон получен исполнением кода; результат — «матч» на вертеле.
 */
import { config } from "../config.js";
import { one, q } from "../db.js";
import { engine } from "../engine.js";
import { button, layout, sendMail } from "../mail.js";

export const PRACTICE_EVERY_DAYS = Number(process.env.PRACTICE_EVERY_DAYS ?? 7);
const DEADLINE_DAYS = 7;

/** Еженедельное адресное предложение (ТЗ: «система периодически предлагает кандидату задачу от работодателя»):
 *  1) открытая задача работодателя в категориях кандидата, которую он ещё не видел в предложениях и не решал;
 *  2) если таких нет — «Свежая начинка» от платформы по остывшему или слабому ингредиенту.
 *  Не чаще раза в PRACTICE_EVERY_DAYS дней и не пока висит нерешённая системная задача. */
export async function ensurePracticeTask(candidateId: string, opts: { notify?: boolean } = {}) {
  const c = await one(`SELECT c.*, u.email FROM candidates c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1`, [candidateId]);
  if (!c?.grade || !c.specialization) return null;
  const recent = await one(`SELECT 1 FROM tasks WHERE kind = 'system' AND candidate_id = $1
      AND (created_at > now() - ($2 || ' days')::interval OR (deadline > now() AND NOT EXISTS
        (SELECT 1 FROM task_submissions s WHERE s.task_id = tasks.id AND s.submitted_at IS NOT NULL)))
    UNION ALL SELECT 1 FROM task_offers WHERE candidate_id = $1 AND offered_at > now() - ($2 || ' days')::interval LIMIT 1`,
    [candidateId, String(PRACTICE_EVERY_DAYS)]);
  if (recent) return null;
  const employerTask = await one(`SELECT t.*, co.name AS company_name FROM tasks t JOIN companies co ON co.id = t.company_id
    WHERE t.kind = 'employer' AND t.deadline > now()
      AND t.specialization IN (SELECT specialization FROM candidate_categories WHERE candidate_id = $1 UNION SELECT $2::text)
      AND NOT EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = t.id AND s.candidate_id = $1)
      AND NOT EXISTS (SELECT 1 FROM task_offers o WHERE o.task_id = t.id AND o.candidate_id = $1)
    ORDER BY t.created_at DESC LIMIT 1`, [candidateId, c.specialization]);
  if (employerTask) {
    await q(`INSERT INTO task_offers(task_id, candidate_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [employerTask.id, candidateId]);
    if (opts.notify && !c.synthetic && c.email) {
      await sendMail(c.email, `шаурматч_: ${employerTask.company_name} предлагает вам задачу`,
        layout("Задача от компании", `<p><b>${employerTask.company_name}</b>: «${employerTask.title}».</p><p>Решите её или предложите подход — компания видит решение без имени и может пригласить автора. У вас будет свой уникальный вариант.</p>${button(`${config.publicUrl}/candidate/tasks`, "Открыть задачу")}`))
        .catch(() => undefined);
    }
    return { ...employerTask, offered: true };
  }
  const used = (await q(`SELECT DISTINCT template_id FROM tasks WHERE kind = 'system' AND candidate_id = $1`, [candidateId])).map((r: any) => r.template_id);
  const p = await engine("/practice/pick", { specialization: c.specialization, grade: c.grade, theta: c.theta, ratings: c.ratings ?? {}, exclude_templates: used });
  const task = await one(`INSERT INTO tasks(kind, candidate_id, title, description, specialization, grade, template_id, ops, b, ingredients, reason, deadline)
      VALUES ('system', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + ($11 || ' days')::interval) RETURNING *`,
    [candidateId, `Свежая начинка: ${p.ingredient_title}`, p.reason, c.specialization, c.grade, p.template_id, p.ops, p.b, p.ingredients,
     { ingredient: p.ingredient, ingredient_title: p.ingredient_title, kind: p.reason_kind, text: p.reason }, String(DEADLINE_DAYS)]);
  if (opts.notify && !c.synthetic && c.email) {
    await sendMail(c.email, `шаурматч_: свежая задача — ${p.ingredient_title}`,
      layout("Задача только для вас", `<p>${p.reason}.</p><p>Короткая задача на 3–5 минут обновит рейтинг ингредиента, и работодатели снова увидят ваш профиль «горячим».</p>${button(`${config.publicUrl}/candidate/tasks`, "Решить задачу")}`))
      .catch(() => undefined);
  }
  return task;
}

/** Периодический обход: активным за последние 60 дней кандидатам, кому пора, — задача и письмо. */
export async function practiceSweep(limit = 200) {
  const rows = await q(`SELECT user_id FROM candidates c WHERE grade IS NOT NULL AND NOT synthetic AND last_active_at > now() - interval '60 days'
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.kind = 'system' AND t.candidate_id = c.user_id AND t.created_at > now() - ($1 || ' days')::interval)
      AND NOT EXISTS (SELECT 1 FROM task_offers o WHERE o.candidate_id = c.user_id AND o.offered_at > now() - ($1 || ' days')::interval)
    LIMIT $2`, [String(PRACTICE_EVERY_DAYS), limit]);
  let created = 0;
  for (const r of rows) {
    try { if (await ensurePracticeTask(r.user_id, { notify: true })) created++; } catch (e: any) { console.warn("Свежая начинка:", e.message); }
  }
  return created;
}

export function startPracticeScheduler() {
  const run = () => practiceSweep().then((n) => n && console.log(`Свежая начинка: предложено задач — ${n}`)).catch(() => undefined);
  setTimeout(run, 30_000);
  setInterval(run, 6 * 3600_000).unref();
}
