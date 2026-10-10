/**
 * Демо-данные: синтетические кандидаты (прошли ту же механику ШАУРМА), компании, потребности,
 * вакансии, регулярная задача и приглашения. Запуск: npm run seed [-- --reset]
 * Демо-аккаунты (пароль shaurma2026):
 *   alexey@shaurmatch.demo   — кандидат BE·SEN, история ФСП (FSP-2025-0001), есть приглашения
 *   maria@shaurmatch.demo    — кандидат FE·MID без истории ФСП
 *   new@shaurmatch.demo      — новый кандидат (пройти путь с нуля)
 *   employer@shaurmatch.demo — работодатель «ТехноЛаб»
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, q, one } from "./db.js";
import { engine } from "./engine.js";
import { migrate } from "./migrate.js";
import { engineProfile, loadCategoryRow } from "./services/candidate.js";
import { fspParticipant } from "./services/fsp.js";

const PASSWORD = "shaurma2026";
const N = Number(process.env.SEED_CANDIDATES ?? 360);
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const anon = () => String(1000 + crypto.randomInt(9000)) + crypto.randomBytes(1).toString("hex").toUpperCase();

async function user(email: string, role: string, password: string | null) {
  const hash = password ? await bcrypt.hash(password, 10) : null;
  return (await one(`INSERT INTO users(email, password_hash, role, email_verified) VALUES ($1,$2,$3,true) RETURNING id`, [email, hash, role]))!.id as string;
}

async function candidate(userId: string, p: any, extra: Record<string, unknown> = {}) {
  const row = { anon_code: anon(), consent_processing: true, consent_publish: true, consent_at: daysAgo(p.days_since_active ?? 10), ...p, ...extra };
  const cols = ["anon_code", "full_name", "city", "about", "specialization", "stacks", "formats", "salary_expect", "experience_years", "soft_skills",
    "survey", "declared_grade", "grade", "grade_confirmed_at", "grade_locked_until", "theta", "ratings", "fsp_id", "fsp_linked_at", "fsp_achievements",
    "consent_processing", "consent_publish", "consent_at", "last_active_at", "synthetic", "phone", "telegram", "privacy", "verified_stacks", "resume_parsed"];
  const present = cols.filter((c) => (row as any)[c] !== undefined);
  await q(`INSERT INTO candidates(user_id, ${present.join(", ")}) VALUES ($1, ${present.map((_, i) => `$${i + 2}`).join(", ")})`,
    [userId, ...present.map((c) => {
      const v = (row as any)[c];
      return c === "fsp_achievements" || ((c === "privacy" || c === "resume_parsed") && typeof v === "object") ? JSON.stringify(v) : v;
    })]);
  if (row.survey) await q(`INSERT INTO survey_history(candidate_id, survey, created_at) VALUES ($1, $2, COALESCE($3, now()))`, [userId, row.survey, row.consent_at ?? null]);
  if (row.grade && row.specialization) {
    await q(`INSERT INTO candidate_categories(candidate_id, specialization, grade, theta, confirmed_at, locked_until, is_primary) VALUES ($1,$2,$3,$4,COALESCE($5, now()),$6,true)`,
      [userId, row.specialization, row.grade, row.theta ?? null, row.grade_confirmed_at ?? null, row.grade_locked_until ?? null]);
  }
  for (const sc of (p.secondary ?? []) as any[]) {
    await q(`INSERT INTO candidate_categories(candidate_id, specialization, grade, theta, confirmed_at, locked_until, is_primary) VALUES ($1,$2,$3,$4,now() - interval '20 days', now() + interval '70 days', false)`,
      [userId, sc.specialization, sc.grade, sc.theta]);
    await q(`INSERT INTO grade_history(candidate_id, specialization, declared_grade, result, grade, theta, created_at) VALUES ($1,$2,$3,'confirmed',$3,$4, now() - interval '20 days')`,
      [userId, sc.specialization, sc.grade, sc.theta]);
  }
}

async function withFsp(p: any) {
  if (!p.fsp_id) return { ratings: p.ratings, achievements: [] };
  const part = await fspParticipant(p.fsp_id).catch(() => null);
  if (!part) return { ratings: p.ratings, achievements: [] };
  const { ratings } = await engine("/ratings/apply", { ratings: p.ratings, achievements: part.achievements });
  return { ratings, achievements: part.achievements };
}

export async function seedDemo() {
  await migrate();
  const reset = process.argv.includes("--reset");
  if (await one(`SELECT 1 FROM users WHERE email = 'employer@shaurmatch.demo'`)) {
    if (!reset) { console.log("Демо-данные уже загружены (используйте --reset для пересоздания)"); return; }
  }
  if (reset) await q(`TRUNCATE users, candidates, companies, needs, vacancies, invitations, applications, tasks, task_submissions, test_sessions, test_items, grade_history, model_versions, learning_state CASCADE`);

  console.log(`Генерация ${N} синтетических кандидатов через движок ШАУРМА…`);
  const { candidates: popl } = await engine(`/demo/population?n=${N}&seed=2026`);
  const ids: { id: string; p: any }[] = [];
  for (const [i, p] of popl.entries()) {
    const uid = await user(`synthetic${i + 1}@shaurmatch.demo`, "candidate", null);
    const { ratings, achievements } = await withFsp(p);
    const confirmed = Math.min(p.days_since_active + 20, 200);
    await candidate(uid, {
      ...p, ratings, fsp_achievements: achievements, fsp_linked_at: p.fsp_id ? daysAgo(confirmed) : null,
      survey: { industry: "ИТ", specialization: p.specialization, stacks: p.stacks, declared_grade: p.declared_grade },
      grade_confirmed_at: daysAgo(confirmed), grade_locked_until: daysAgo(confirmed - 90),
      last_active_at: daysAgo(p.days_since_active), synthetic: true,
      telegram: `@${p.full_name.split(" ")[1].toLowerCase().replace(/[^a-z]/g, "") || "dev"}${i}`, phone: `+7 9${String(10 + (i % 89)).padStart(2, "0")} ${String(100 + i).slice(-3)}-${String(10 + (i % 90))}-${String(20 + (i % 70))}`,
      // по умолчанию имя и опыт видны (VS.4); каждый пятый предпочёл анонимность — это тоже работает
      privacy: { show_name: i % 5 !== 0, show_city: true, show_salary: true, show_experience: true, searchable: true },
    });
    delete p.days_since_active; delete p.attempts;
    ids.push({ id: uid, p });
  }

  // ---------- Демо-кандидаты ----------
  const seniorBe = popl.find((p: any) => p.specialization === "backend" && p.grade === "senior") ?? popl[0];
  const alexey = await user("alexey@shaurmatch.demo", "candidate", PASSWORD);
  const alexFsp = await withFsp({ fsp_id: "FSP-2025-0001", ratings: seniorBe.ratings });
  await candidate(alexey, {
    full_name: "Алексей Смирнов", city: "Москва", about: "Бэкенд платёжных сервисов: Python, FastAPI, Kafka. Капитан команды NullPointer на соревнованиях ФСП.",
    verified_stacks: ["Python", "SQL"],
    resume_parsed: { roles: ["Senior Python-разработчик", "Backend-разработчик"], experience: [
      { period: "2022 — н. в.", company: "Платёжный сервис (финтех)", title: "Senior Python-разработчик" },
      { period: "2019 — 2022", company: "Маркетплейс электроники", title: "Backend-разработчик" }] },
    specialization: "backend", stacks: ["Python", "Go", "PostgreSQL", "Kafka", "Docker"], formats: ["remote", "hybrid"], salary_expect: 320000,
    experience_years: 6, soft_skills: ["Наставничество", "Работа в команде", "Ответственность"],
    survey: { industry: "ИТ", specialization: "backend", stacks: ["Python", "Go", "PostgreSQL", "Kafka"], declared_grade: "senior" },
    declared_grade: "senior", grade: "senior", grade_confirmed_at: daysAgo(40), grade_locked_until: daysAgo(-50), theta: 1.42,
    ratings: alexFsp.ratings, fsp_id: "FSP-2025-0001", fsp_linked_at: daysAgo(40), fsp_achievements: alexFsp.achievements,
    secondary: [{ specialization: "data", grade: "middle", theta: 0.62 }], // вторая категория DS·MID (тест 20 дней назад)
    last_active_at: daysAgo(1), phone: "+7 916 555-12-34", telegram: "@asmirnov_dev",
  });
  await q(`INSERT INTO grade_history(candidate_id, specialization, declared_grade, result, grade, theta, created_at) VALUES ($1,'backend','senior','confirmed','senior',1.42,$2)`, [alexey, daysAgo(40)]);

  const midFe = popl.find((p: any) => p.specialization === "frontend" && p.grade === "middle") ?? popl[1];
  const maria = await user("maria@shaurmatch.demo", "candidate", PASSWORD);
  await candidate(maria, {
    full_name: "Мария Ковалёва", city: "Санкт-Петербург", about: "Фронтенд B2B-продуктов: React, TypeScript, дизайн-системы и доступность.",
    verified_stacks: ["JavaScript"],
    resume_parsed: { roles: ["Frontend-разработчик"], experience: [
      { period: "2023 — н. в.", company: "B2B SaaS для логистики", title: "Frontend-разработчик" },
      { period: "2022 — 2023", company: "Веб-студия", title: "Junior frontend-разработчик" }] },
    specialization: "frontend", stacks: ["React", "TypeScript", "Vue"], formats: ["remote"], salary_expect: 220000, experience_years: 3.5,
    soft_skills: ["Коммуникабельность", "Внимательность к деталям"],
    survey: { industry: "ИТ", specialization: "frontend", stacks: ["React", "TypeScript"], declared_grade: "middle" },
    declared_grade: "middle", grade: "middle", grade_confirmed_at: daysAgo(12), grade_locked_until: daysAgo(-78), theta: 0.55,
    ratings: midFe.ratings, last_active_at: daysAgo(2), phone: "+7 921 444-56-78", telegram: "@mkovaleva",
  });
  await q(`INSERT INTO grade_history(candidate_id, specialization, declared_grade, result, grade, theta, created_at) VALUES
    ($1,'frontend','senior','not_confirmed',NULL,0.48,$2), ($1,'frontend','middle','confirmed','middle',0.55,$3)`, [maria, daysAgo(13), daysAgo(12)]);

  const fresh = await user("new@shaurmatch.demo", "candidate", PASSWORD);
  await q(`INSERT INTO candidates(user_id, anon_code) VALUES ($1,$2)`, [fresh, anon()]);

  // ---------- Компании ----------
  const emp = await user("employer@shaurmatch.demo", "employer", PASSWORD);
  const tl = (await one(`INSERT INTO companies(owner_id, name, sphere, description, website, contact_email, contact_telegram)
    VALUES ($1,'ТехноЛаб','Финтех, платёжные сервисы','Вымышленная компания для демонстрации. Делаем платёжную инфраструктуру для маркетплейсов.','https://technolab.example','hr@technolab.example','@technolab_hr') RETURNING id`, [emp]))!.id;
  const others = [];
  for (const [name, sphere] of [["Облачные решения", "Облачная инфраструктура"], ["ДатаПульс", "Аналитика данных"], ["ГородЛаб", "Цифровые сервисы города"], ["Ритейл Тек", "E-commerce"]]) {
    const o = await user(`${crypto.randomBytes(4).toString("hex")}@company.demo`, "employer", null);
    others.push((await one(`INSERT INTO companies(owner_id, name, sphere, description) VALUES ($1,$2,$3,'Вымышленная компания для демонстрации.') RETURNING id`, [o, name, sphere]))!.id);
  }

  const needText1 = "Ищем Senior backend-разработчика в платёжный сервис. Highload, Kafka, PostgreSQL, микросервисы на Go и Python, идемпотентная обработка платежей. Удалёнка или гибрид, 350-450 тыс.";
  const needText2 = "Нужен Middle frontend-разработчик на React и TypeScript: дашборды, таблицы с фильтрацией, real-time обновления через websocket. Удалёнка, 220-300 тыс.";
  const needText3 = "Data-аналитик уровня Middle: SQL, оконные функции, витрины в ClickHouse, метрики антифрод-моделей. Гибрид, 200-260 тыс.";
  const needs: any[] = [];
  for (const [cid, title, text] of [[tl, "Senior backend в платёжный сервис", needText1], [tl, "Middle frontend для дашбордов", needText2], [others[1], "Middle data-аналитик", needText3]]) {
    const recipe = await engine("/recipe/parse", { text });
    needs.push(await one(`INSERT INTO needs(company_id, title, text, recipe) VALUES ($1,$2,$3,$4) RETURNING *`, [cid, title, text, recipe]));
  }

  const vac = [
    [tl, needs[0].id, "Senior backend-разработчик (платежи)", needText1, "backend", "senior", ["Go", "Python", "Kafka", "PostgreSQL"], ["remote", "hybrid"], 350000, 450000],
    [tl, needs[1].id, "Frontend-разработчик (React)", needText2, "frontend", "middle", ["React", "TypeScript"], ["remote"], 220000, 300000],
    [others[0], null, "Backend-разработчик (Python)", "Сервисы облачной платформы: API, очереди, мониторинг. Команда 8 человек.", "backend", "middle", ["Python", "PostgreSQL"], ["hybrid"], 230000, 300000],
    [others[1], needs[2].id, "Аналитик данных", needText3, "data", "middle", ["SQL", "ClickHouse"], ["hybrid"], 200000, 260000],
    [others[2], null, "Junior frontend-разработчик", "Интерфейсы городских сервисов, наставник в команде, обучение.", "frontend", "junior", ["Vue", "TypeScript"], ["office", "hybrid"], 110000, 150000],
    [others[3], null, "Стажёр-аналитик", "Стажировка в команде данных: SQL, отчёты, A/B-тесты.", "data", "intern", ["SQL", "pandas"], ["office"], 60000, 80000],
  ];
  const vacIds = [];
  for (const v of vac) {
    vacIds.push((await one(`INSERT INTO vacancies(company_id, need_id, title, description, specialization, grade, stacks, formats, salary_from, salary_to, city)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Москва') RETURNING id`, v))!.id);
  }

  // ---------- Регулярная задача «Слепая дегустация» ----------
  const pick = await engine("/recipe/task", { recipe: needs[0].recipe, seed: 7 });
  const task = await one(`INSERT INTO tasks(company_id, need_id, title, description, specialization, grade, template_id, ops, b, ingredients, approach_question, deadline)
    VALUES ($1,$2,'Повторная доставка платежей','Короткая задача от команды платежей ТехноЛаб: разберитесь, что произойдёт при повторной доставке события.','backend','senior',$3,$4,$5,$6,
    'Как бы вы сделали обработку платежей идемпотентной в Kafka-консьюмере?', now() + interval '10 days') RETURNING *`,
    [tl, needs[0].id, pick.template_id, pick.ops, pick.b, pick.ingredients]);
  const backenders = ids.filter((x) => x.p.specialization === "backend" && ["middle", "senior"].includes(x.p.grade)).slice(0, 28);
  const approaches = ["Ключ идемпотентности = id события, хранить обработанные в таблице с уникальным индексом в той же транзакции, что и списание.",
    "Outbox + дедупликация по event_id, коммит оффсета после фиксации результата.", "Повторно обрабатывать, но проверять статус платежа перед списанием.",
    "Exactly-once в Kafka транзакциях + upsert по ключу платежа.", ""];
  for (const [i, b] of backenders.entries()) {
    const v = await engine("/variants", { template_id: task.template_id, ops: task.ops, seed: 1000 + i });
    const theta = b.p.theta;
    const correct = Math.random() < 0.25 + 0.75 / (1 + Math.exp(-1.7 * (theta - task.b)));
    const answer = correct ? v.correct_option : v.options.find((o: any) => o.id !== v.correct_option).id;
    await q(`INSERT INTO task_submissions(task_id, candidate_id, variant_id, seed, prompt, code, language, options, correct_option, correct_label, answer_option, correct, approach, seconds, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - ($15 || ' hours')::interval)`,
      [task.id, b.id, v.variant_id, v.seed, v.prompt, v.code, v.language, JSON.stringify(v.options), v.correct_option, v.correct_label, answer, correct,
       approaches[i % approaches.length] || null, 40 + Math.random() * 200, String(1 + i * 3)]);
  }

  // ---------- Приглашения ----------
  const reasons = ["Мало денег", "Не тот стек", "Не тот формат работы", "Уже нашёл работу"];
  const inv = async (company: string, cand: string, title: string, from: number, to: number, status: string, days: number, extra: any = {}) =>
    q(`INSERT INTO invitations(company_id, candidate_id, title, description, salary_from, salary_to, contact_method, status, created_at, viewed_at, responded_at, decline_reason, source, vacancy_id, need_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [company, cand, title, extra.description ?? "Команда из 8 инженеров, продуктовая разработка, современный стек. Обсудим детали на созвоне.", from, to,
       extra.contact ?? "Telegram @hr_team или созвон в удобное время", status, daysAgo(days),
       status !== "sent" ? daysAgo(days - 0.5) : null, ["accepted", "declined"].includes(status) ? daysAgo(days - 1) : null,
       status === "declined" ? extra.reason ?? reasons[Math.floor(Math.random() * reasons.length)] : null, extra.source ?? "selection", extra.vacancy ?? null, extra.need ?? null]);
  await inv(tl, alexey, "Senior backend-разработчик в платёжный сервис", 350000, 420000, "sent", 0.2,
    { description: "Платёжная инфраструктура для маркетплейсов: Go/Python, Kafka, PostgreSQL. Вы в подборке по ингредиентам «идемпотентность» и «конкурентность» — оба подтверждены. Гибрид, 2 дня в офисе.", contact: "Telegram @technolab_hr", vacancy: vacIds[0], need: needs[0].id });
  await inv(others[0], alexey, "Tech Lead backend-команды", 380000, 460000, "viewed", 2);
  await inv(others[3], alexey, "Backend-разработчик (Python)", 260000, 300000, "declined", 9, { reason: "Мало денег" });
  await inv(tl, maria, "Frontend-разработчик (React)", 230000, 280000, "sent", 1, { vacancy: vacIds[1], need: needs[1].id });
  // Снимок совпадения для приглашений по потребности — как при живой отправке: блок «Почему вы» у кандидата
  for (const r of await q(`SELECT i.id, i.candidate_id, n.recipe FROM invitations i JOIN needs n ON n.id = i.need_id WHERE i.match_snapshot IS NULL`)) {
    const cand = await one(`SELECT * FROM candidates WHERE user_id = $1`, [r.candidate_id]);
    const row = (await loadCategoryRow(r.candidate_id, r.recipe.specialization)) ?? cand;
    const snap = (await engine("/match", { recipe: r.recipe, candidates: [engineProfile(row)], filters: { specialization: row.specialization } })).results[0] ?? null;
    if (snap) await q(`UPDATE invitations SET match_snapshot = $2 WHERE id = $1`, [r.id, snap]);
  }
  // Исходы приглашений — по правдоподобной модели поведения (вилка против ожиданий, формат, переквалификация),
  // у принятых — итог собеседования (подтвердился ли уровень). На этих данных «Маринад» дообучает ранжировщик при старте.
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const GRADE_FLOOR: Record<string, number> = { intern: -1.8, junior: -1.0, middle: 0.0, senior: 1.0 };
  let rnd = 20261005;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 120; i++) {
    const c = ids[(i * 7) % ids.length];
    const comp = i % 3 === 0 ? tl : others[i % others.length];
    if (comp === tl && i % 2 === 0) continue;
    const base = [80000, 150000, 240000, 340000][["intern", "junior", "middle", "senior"].indexOf(c.p.grade)];
    const from = Math.round((base * (0.8 + 0.45 * rand())) / 5000) * 5000;
    const to = Math.round((from * 1.25) / 5000) * 5000;
    const r = Math.log(to / (c.p.salary_expect || base));
    const pAccept = sig(0.6 + 4 * Math.min(r, 0) + 0.8 * Math.min(Math.max(r, 0), 0.3) - (c.p.formats?.includes("office") ? 0 : 0.6 * (i % 2)));
    const pending = rand() < 0.25;
    const status = pending ? (rand() < 0.5 ? "sent" : "viewed") : rand() < pAccept ? "accepted" : "declined";
    await inv(comp, c.id, "Приглашение в команду", from, to, status, 1 + (i % 25),
      status === "declined" && r < -0.1 ? { reason: "Мало денег" } : {});
    if (status === "accepted" && rand() < 0.7) {
      const hired = rand() < sig(3 * ((c.p.theta ?? 0) - GRADE_FLOOR[c.p.grade]) - 0.5);
      await q(`UPDATE invitations SET outcome = $3, outcome_at = now() WHERE company_id = $1 AND candidate_id = $2 AND status = 'accepted'`,
        [comp, c.id, hired ? "hired" : "not_fit"]);
    }
  }
  // Отклики на вакансии
  for (const c of ids.filter((x) => x.p.specialization === "frontend").slice(0, 4)) {
    await q(`INSERT INTO applications(vacancy_id, candidate_id, note) VALUES ($1,$2,'Интересна задача с дашбордами, готов к созвону.') ON CONFLICT DO NOTHING`, [vacIds[1], c.id]);
  }
  console.log(`Готово: ${ids.length} синтетических кандидатов, демо-аккаунты *@shaurmatch.demo / ${PASSWORD}`);
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  seedDemo().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
}
