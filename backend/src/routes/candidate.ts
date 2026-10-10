import { Router } from "express";
import multer from "multer";
import { route, z } from "../api.js";
import { config } from "../config.js";
import { one, q } from "../db.js";
import { engine, engineUpload } from "../engine.js";
import { HttpError, notFound } from "../errors.js";
import { GRADE_TITLES, SPEC_TITLES, categoryCode, fspSummary, listCategories, loadCandidate, touch } from "../services/candidate.js";
import { fspParticipant } from "../services/fsp.js";
import { profilePdf } from "../services/pdf.js";

export const router = Router();
const B = "/candidate";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const ROLE = ["candidate"] as const;

const Grade = z.enum(["intern", "junior", "middle", "senior"]);
const Spec = z.enum(["backend", "frontend", "data"]);
const Format = z.enum(["remote", "hybrid", "office"]);

export function candidateDto(c: any) {
  const lockedUntil = c.grade_locked_until ? new Date(c.grade_locked_until) : null;
  return {
    id: c.user_id,
    email: c.email,
    anon_code: c.anon_code,
    full_name: c.full_name, phone: c.phone, telegram: c.telegram, city: c.city, about: c.about,
    specialization: c.specialization,
    specialization_title: c.specialization ? SPEC_TITLES[c.specialization] : null,
    stacks: c.stacks, verified_stacks: c.verified_stacks ?? [], formats: c.formats, salary_expect: c.salary_expect,
    experience_years: c.experience_years, soft_skills: c.soft_skills,
    survey: c.survey,
    industry: c.survey?.industry ?? "ИТ",
    survey_history: c.survey_history ?? [],
    declared_grade: c.declared_grade,
    declared_grade_title: c.declared_grade ? GRADE_TITLES[c.declared_grade] : null,
    grade: c.grade,
    grade_title: c.grade ? GRADE_TITLES[c.grade] : null,
    // «официально» грейд присваивается только по тесту; не сдавший видит явный статус (ответ организаторов FTT.4)
    grade_status: c.grade ? "confirmed" : c.last_result?.result === "not_confirmed" ? "not_confirmed" : "not_tested",
    last_test: c.last_result ? { declared_grade: c.last_result.declared_grade, declared_grade_title: GRADE_TITLES[c.last_result.declared_grade], at: c.last_result.created_at } : null,
    category: categoryCode(c.specialization, c.grade),
    categories: c.categories ?? [],   // все подтверждённые тестом категории: основная + дополнительные
    grade_confirmed_at: c.grade_confirmed_at,
    grade_locked_until: c.grade_locked_until,
    grade_change_available: !lockedUntil || lockedUntil <= new Date(),
    theta: c.theta,
    ratings: c.ratings,
    fsp: { id: c.fsp_id, linked_at: c.fsp_linked_at, achievements: c.fsp_achievements ?? [], ...fspSummary(c.fsp_achievements ?? [], c.specialization) },
    resume_parsed: c.resume_parsed,
    privacy: c.privacy,
    consent_processing: c.consent_processing,
    consent_publish: c.consent_publish,
    consent_at: c.consent_at,
    last_active_at: c.last_active_at,
    onboarding: {
      survey: !!c.specialization && !!c.survey,
      consents: !!c.consent_processing,
      tested: !!c.grade,
    },
  };
}

async function me(userId: string) {
  const c = await loadCandidate(userId);
  if (!c) throw notFound("Профиль кандидата");
  c.categories = await listCategories(userId);
  c.survey_history = await q(`SELECT survey, created_at FROM survey_history WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 10`, [userId]);
  c.last_result = await one(`SELECT result, declared_grade, created_at FROM grade_history WHERE candidate_id = $1 AND specialization = $2
    ORDER BY created_at DESC LIMIT 1`, [userId, c.specialization]);
  return c;
}

route(router, B, { method: "get", path: "/profile", tag: "Кандидат", summary: "Мой профиль", roles: [...ROLE] }, async (req) => {
  await touch(req.user!.id);
  return candidateDto(await me(req.user!.id));
});

route(router, B, {
  method: "put", path: "/profile", tag: "Кандидат", summary: "Заполнить или обновить профиль вручную", roles: [...ROLE],
  body: z.object({
    full_name: z.string().max(120).nullish(), phone: z.string().max(40).nullish(), telegram: z.string().max(64).nullish(),
    city: z.string().max(80).nullish(), about: z.string().max(2000).nullish(),
    stacks: z.array(z.string().max(40)).max(30).optional(), formats: z.array(Format).optional(),
    salary_expect: z.number().int().positive().max(5_000_000).nullish(),
    experience_years: z.number().min(0).max(60).nullish(), soft_skills: z.array(z.string().max(60)).max(20).optional(),
  }),
}, async (req) => {
  const b = req.body;
  const fields = Object.entries(b).filter(([, v]) => v !== undefined);
  if (fields.length) {
    const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    await q(`UPDATE candidates SET ${sets}, last_active_at = now() WHERE user_id = $1`, [req.user!.id, ...fields.map(([, v]) => v)]);
  }
  return candidateDto(await me(req.user!.id));
});

route(router, B, {
  method: "post", path: "/resume", tag: "Кандидат", summary: "Загрузка PDF-резюме с автораспознаванием (ФИО, контакты, стек, грейд, роли, стаж, софт-скиллы)",
  roles: [...ROLE], multipart: true, middleware: [upload.single("file")],
  description: "Распознанные данные предзаполняют профиль и опрос. Категорию резюме не определяет — только тест (требование ТЗ).",
}, async (req) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, "Прикрепите PDF-файл резюме");
  const parsed = await engineUpload("/resume/parse-pdf", file.buffer, file.originalname);
  const c = await me(req.user!.id);
  await q(`UPDATE candidates SET resume_parsed = $2,
      full_name = COALESCE(full_name, $3), phone = COALESCE(phone, $4), telegram = COALESCE(telegram, $5),
      stacks = CASE WHEN cardinality(stacks) = 0 THEN $6 ELSE stacks END,
      experience_years = COALESCE(experience_years, $7),
      soft_skills = CASE WHEN cardinality(soft_skills) = 0 THEN $8 ELSE soft_skills END
    WHERE user_id = $1`,
    [c.user_id, parsed, parsed.full_name, parsed.phone, parsed.telegram, parsed.stacks ?? [], parsed.experience_years, parsed.soft_skills ?? []]);
  return { parsed, profile: candidateDto(await me(req.user!.id)) };
});
route(router, B, {
  method: "post", path: "/survey", tag: "Кандидат", summary: "Опрос по отрасли и специализации + выбор предполагаемого грейда", roles: [...ROLE],
  body: z.object({
    industry: z.string().default("ИТ"),
    specialization: Spec,
    stacks: z.array(z.string()).min(1, "Выберите хотя бы одну технологию"),
    declared_grade: Grade,
    experience_years: z.number().min(0).max(60).optional(),
    team_role: z.string().optional(),
    formats: z.array(Format).min(1).optional(),
    salary_expect: z.number().int().positive().optional(),
    city: z.string().optional(),
  }),
}, async (req) => {
  const c = await me(req.user!.id);
  const b = req.body;
  if (c.specialization && c.specialization !== b.specialization) {
    // Смена основной специализации: прежняя категория остаётся (дополнительной), грейд в новой — только если он
    // уже подтверждён тестом. Грейд из другой специализации не переносится (категория — только по тесту, ТЗ).
    const target = await one(`SELECT * FROM candidate_categories WHERE candidate_id = $1 AND specialization = $2`, [c.user_id, b.specialization]);
    await q(`UPDATE candidate_categories SET is_primary = (specialization = $2) WHERE candidate_id = $1`, [c.user_id, b.specialization]);
    await q(`UPDATE candidates SET grade = $2, theta = $3, grade_confirmed_at = $4, grade_locked_until = $5 WHERE user_id = $1`,
      [c.user_id, target?.grade ?? null, target?.theta ?? null, target?.confirmed_at ?? null, target?.locked_until ?? null]);
  }
  await q(`UPDATE candidates SET survey = $2, specialization = $3, stacks = $4, declared_grade = $5,
      experience_years = COALESCE($6, experience_years), formats = COALESCE($7, formats),
      salary_expect = COALESCE($8, salary_expect), city = COALESCE($9, city), last_active_at = now()
    WHERE user_id = $1`,
    [c.user_id, b, b.specialization, b.stacks, b.declared_grade, b.experience_years ?? null, b.formats ?? null, b.salary_expect ?? null, b.city ?? null]);
  await q(`INSERT INTO survey_history(candidate_id, survey) VALUES ($1, $2)`, [c.user_id, b]);
  return candidateDto(await me(req.user!.id));
});

route(router, B, {
  method: "put", path: "/privacy", tag: "Кандидат", summary: "Приватность и согласия (152-ФЗ)", roles: [...ROLE],
  body: z.object({
    privacy: z.object({ show_name: z.boolean(), show_city: z.boolean(), show_salary: z.boolean(), show_experience: z.boolean(), searchable: z.boolean() }).partial().optional(),
    consent_processing: z.boolean().optional(),
    consent_publish: z.boolean().optional(),
  }),
}, async (req) => {
  const c = await me(req.user!.id);
  const privacy = { ...(c.privacy ?? {}), ...(req.body.privacy ?? {}) };
  await q(`UPDATE candidates SET privacy = $2,
      consent_processing = COALESCE($3, consent_processing), consent_publish = COALESCE($4, consent_publish),
      consent_at = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL THEN now() ELSE consent_at END
    WHERE user_id = $1`, [c.user_id, privacy, req.body.consent_processing ?? null, req.body.consent_publish ?? null]);
  return candidateDto(await me(req.user!.id));
});

route(router, B, {
  method: "post", path: "/fsp/link", tag: "Кандидат", summary: "Связать профиль с ID участника ФСП и подтянуть достижения", roles: [...ROLE],
  body: z.object({ fsp_id: z.string().min(3).max(40) }),
  description: "Достижения ФСП засчитываются как внешние подтверждённые «матчи» по ингредиентам дисциплины (рейтинг Glicko-2).",
}, async (req) => {
  const c = await me(req.user!.id);
  const p = await fspParticipant(req.body.fsp_id.trim());
  if (!p) throw new HttpError(404, "Участник с таким ID в реестре ФСП не найден", "fsp_not_found");
  const taken = await one(`SELECT 1 FROM candidates WHERE fsp_id = $1 AND user_id <> $2`, [p.fsp_id, c.user_id]);
  if (taken) throw new HttpError(409, "Этот ID ФСП уже привязан к другому профилю", "fsp_taken");
  const { ratings } = await engine("/ratings/apply", { ratings: c.ratings ?? {}, achievements: p.achievements });
  await q(`UPDATE candidates SET fsp_id = $2, fsp_linked_at = now(), fsp_achievements = $3, ratings = $4,
      full_name = COALESCE(full_name, $5) WHERE user_id = $1`,
    [c.user_id, p.fsp_id, JSON.stringify(p.achievements), ratings, p.full_name]);
  return candidateDto(await me(req.user!.id));
});

route(router, B, { method: "delete", path: "/fsp/link", tag: "Кандидат", summary: "Отвязать ID ФСП", roles: [...ROLE] }, async (req) => {
  await q(`UPDATE candidates SET fsp_id = NULL, fsp_linked_at = NULL, fsp_achievements = '[]' WHERE user_id = $1`, [req.user!.id]);
  return candidateDto(await me(req.user!.id));
});

route(router, B, {
  method: "get", path: "/profile/pdf", tag: "Кандидат", summary: "Стандартизированный PDF-профиль (паспорт навыков)", roles: [...ROLE], binary: "application/pdf",
}, async (req, res) => {
  const c = await me(req.user!.id);
  const history = await q(`SELECT * FROM grade_history WHERE candidate_id = $1 ORDER BY created_at DESC`, [c.user_id]);
  const pdf = await profilePdf(c, history);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="shaurmatch-profile-${c.anon_code}.pdf"`);
  res.end(pdf);
});

route(router, B, { method: "get", path: "/grade-history", tag: "Кандидат", summary: "История опроса и тестов на грейд", roles: [...ROLE] }, async (req) => {
  return q(`SELECT gh.*, ts.theta AS session_theta, ts.se FROM grade_history gh LEFT JOIN test_sessions ts ON ts.id = gh.session_id
            WHERE gh.candidate_id = $1 ORDER BY gh.created_at DESC`, [req.user!.id]);
});

route(router, B, { method: "get", path: "/market", tag: "Кандидат", summary: "Моя категория на рынке: сколько компаний ищут, медиана, моё место", roles: [...ROLE] }, async (req) => {
  const c = await me(req.user!.id);
  if (!c.grade) return { category: null };
  const peers = await q(`SELECT user_id, ratings, fsp_achievements, salary_expect FROM candidates WHERE specialization = $1 AND grade = $2`, [c.specialization, c.grade]);
  const ranked = await engine("/category/rank", {
    specialization: c.specialization,
    candidates: peers.map((p: any) => ({ id: p.user_id, ratings: p.ratings, fsp: fspSummary(p.fsp_achievements ?? [], c.specialization) })),
  });
  const pos = ranked.results.findIndex((r: any) => r.candidate_id === c.user_id) + 1;
  const sal = peers.map((p: any) => p.salary_expect).filter(Boolean).sort((a: number, b: number) => a - b);
  const companies = await one(`SELECT count(DISTINCT company_id)::int AS n FROM needs WHERE recipe->>'specialization' = $1`, [c.specialization]);
  const views = await one(`SELECT count(*)::int AS n FROM invitations WHERE candidate_id = $1`, [c.user_id]);
  return {
    category: categoryCode(c.specialization, c.grade),
    peers: peers.length,
    position: pos,
    percentile: peers.length ? Math.round((1 - (pos - 1) / peers.length) * 100) : null,
    strength: pos > 0 ? Math.round(ranked.results[pos - 1].strength) : null,   // сила подтверждённого профиля (тесты + ФСП)
    median_salary: sal.length ? sal[Math.floor(sal.length / 2)] : null,
    companies_searching: companies?.n ?? 0,
    invitations_total: views?.n ?? 0,
  };
});

void config;
