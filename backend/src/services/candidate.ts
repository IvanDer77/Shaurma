import { one, q } from "../db.js";

export const GRADE_TITLES: Record<string, string> = { intern: "Intern", junior: "Junior", middle: "Middle", senior: "Senior" };
export const GRADE_CODES: Record<string, string> = { intern: "INT", junior: "JUN", middle: "MID", senior: "SEN" };
export const SPEC_CODES: Record<string, string> = { backend: "BE", frontend: "FE", data: "DS" };
export const SPEC_TITLES: Record<string, string> = { backend: "Backend-разработка", frontend: "Frontend-разработка", data: "Data / ML" };
export const GRADE_ORDER = ["intern", "junior", "middle", "senior"];

export function categoryCode(spec?: string | null, grade?: string | null) {
  if (!spec || !grade) return null;
  return `${SPEC_CODES[spec]}·${GRADE_CODES[grade]}`;
}

/** Достижения ФСП, которые относятся к специализации (для бонуса и объяснения). */
const RELEVANT_DISCIPLINES: Record<string, string[]> = {
  backend: ["product", "algorithmic", "security"],
  frontend: ["product"],
  data: ["algorithmic", "product"],
};

export function fspSummary(achievements: any[], spec?: string | null) {
  const rel = achievements.filter((a) => !spec || RELEVANT_DISCIPLINES[spec]?.includes(a.discipline));
  return { count: achievements.length, relevant: rel.length, prizes: achievements.filter((a) => a.place && a.place <= 3).length };
}

/** Профиль в формате ШАУРМА-движка. */
export function engineProfile(c: any) {
  return {
    id: c.user_id,
    specialization: c.specialization,
    grade: c.grade,
    ratings: c.ratings ?? {},
    stacks: c.stacks ?? [],
    formats: c.formats ?? [],
    salary_expect: c.salary_expect,
    fsp: fspSummary(c.fsp_achievements ?? [], c.specialization),
    grade_confirmed_days: c.grade_confirmed_at ? Math.floor((Date.now() - new Date(c.grade_confirmed_at).getTime()) / 864e5) : null,
    last_active_days: c.last_active_at ? Math.floor((Date.now() - new Date(c.last_active_at).getTime()) / 864e5) : null,
  };
}

/** Все подтверждённые категории кандидата (основная первой). */
export async function listCategories(userId: string) {
  const rows = await q(`SELECT * FROM candidate_categories WHERE candidate_id = $1 ORDER BY is_primary DESC, confirmed_at`, [userId]);
  return rows.map((r: any) => ({
    specialization: r.specialization, specialization_title: SPEC_TITLES[r.specialization], grade: r.grade, grade_title: GRADE_TITLES[r.grade],
    code: categoryCode(r.specialization, r.grade), is_primary: r.is_primary, confirmed_at: r.confirmed_at, locked_until: r.locked_until,
    change_available: !r.locked_until || new Date(r.locked_until) <= new Date(),
  }));
}

/** Профиль кандидата «в разрезе» конкретной категории (для подбора по другой его специализации). */
export async function loadCategoryRow(userId: string, specialization: string) {
  return one(`SELECT v.*, u.email FROM candidate_category_view v JOIN users u ON u.id = v.user_id WHERE v.user_id = $1 AND v.specialization = $2`, [userId, specialization]);
}

/** Записать подтверждённую тестом категорию (cl — клиент транзакции). */
export async function upsertCategory(cl: { query: (s: string, p: unknown[]) => Promise<unknown> }, userId: string, spec: string, grade: string,
  theta: number | null, primary: boolean, cooldownDays: number) {
  await cl.query(`INSERT INTO candidate_categories (candidate_id, specialization, grade, theta, confirmed_at, locked_until, is_primary)
      VALUES ($1, $2, $3, $4, now(), now() + ($5 || ' days')::interval, $6)
    ON CONFLICT (candidate_id, specialization) DO UPDATE SET grade = EXCLUDED.grade, theta = EXCLUDED.theta, confirmed_at = now(),
      locked_until = EXCLUDED.locked_until, is_primary = candidate_categories.is_primary OR EXCLUDED.is_primary`,
    [userId, spec, grade, theta, String(cooldownDays), primary]);
}

const LANG_STACK: Record<string, string> = { python: "Python", javascript: "JavaScript", sql: "SQL" };
const GRADE_FLOOR_B: Record<string, number> = { intern: -2.5, junior: -1.0, middle: 0.0, senior: 1.0 };

/** Стек, подтверждённый тестом: решены ≥ 2 задания на языке со сложностью не ниже уровня подтверждённого грейда.
 *  (Простая доля верных ответов не годится: адаптивный тест держит её около 60% у всех.) */
export async function computeVerifiedStacks(userId: string) {
  const cats = await q(`SELECT grade FROM candidate_categories WHERE candidate_id = $1`, [userId]);
  if (!cats.length) return [];
  const floor = Math.min(...cats.map((c: any) => GRADE_FLOOR_B[c.grade] ?? 0)) - 0.5;
  const rows = await q(`SELECT ti.language, count(*) FILTER (WHERE ti.correct AND ti.b >= $2)::int AS solved
    FROM test_items ti JOIN test_sessions ts ON ts.id = ti.session_id WHERE ts.candidate_id = $1 GROUP BY ti.language`, [userId, floor]);
  const stacks = rows.filter((r: any) => r.solved >= 2 && LANG_STACK[r.language]).map((r: any) => LANG_STACK[r.language]);
  await q(`UPDATE candidates SET verified_stacks = $2 WHERE user_id = $1`, [userId, stacks]);
  return stacks;
}

export async function loadCandidate(userId: string) {
  return one(`SELECT c.*, u.email FROM candidates c JOIN users u ON u.id = c.user_id WHERE c.user_id = $1`, [userId]);
}

/** Раскрыты ли контакты кандидата компании: принято приглашение или кандидат сам откликнулся. */
export async function contactsVisible(companyId: string, candidateId: string) {
  const r = await one(
    `SELECT 1 AS ok FROM invitations WHERE company_id = $1 AND candidate_id = $2 AND status = 'accepted'
     UNION SELECT 1 FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE v.company_id = $1 AND a.candidate_id = $2
     LIMIT 1`,
    [companyId, candidateId],
  );
  return !!r;
}

/** Карточка кандидата для работодателя: без контактов до согласия, имя — по настройкам приватности. */
export function employerView(c: any, opts: { contacts: boolean }) {
  const privacy = c.privacy ?? {};
  const showName = opts.contacts || privacy.show_name;
  return {
    id: c.user_id,
    display_name: showName && c.full_name ? c.full_name : `Кандидат #${c.anon_code}`,
    anon_code: c.anon_code,
    specialization: c.specialization,
    specialization_title: c.specialization ? SPEC_TITLES[c.specialization] : null,
    grade: c.grade,
    grade_title: c.grade ? GRADE_TITLES[c.grade] : null,
    category: categoryCode(c.specialization, c.grade),
    grade_confirmed_at: c.grade_confirmed_at,
    stacks: c.stacks,
    verified_stacks: c.verified_stacks ?? [],   // стек, подтверждённый решёнными заданиями теста
    formats: c.formats,
    city: privacy.show_city === false && !opts.contacts ? null : c.city,
    salary_expect: privacy.show_salary === false && !opts.contacts ? null : c.salary_expect,
    experience_years: c.experience_years,
    // места работы и должности из резюме: видны, если кандидат не скрыл опыт (ответ организаторов VS.4)
    experience: privacy.show_experience === false && !opts.contacts ? null : (c.resume_parsed?.experience ?? []),
    roles: privacy.show_experience === false && !opts.contacts ? null : (c.resume_parsed?.roles ?? []),
    soft_skills: c.soft_skills,
    about: c.about,
    ratings: c.ratings,
    fsp: { linked: !!c.fsp_id, achievements: c.fsp_achievements ?? [], ...fspSummary(c.fsp_achievements ?? [], c.specialization) },
    last_active_at: c.last_active_at,
    contacts_visible: opts.contacts,
    contacts: opts.contacts ? { email: c.email, phone: c.phone, telegram: c.telegram, full_name: c.full_name } : null,
  };
}

export async function touch(userId: string) {
  await q(`UPDATE candidates SET last_active_at = now() WHERE user_id = $1`, [userId]);
}
