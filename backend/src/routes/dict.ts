import { Router } from "express";
import { route, z } from "../api.js";
import { q } from "../db.js";
import { catalog } from "../engine.js";
import { GRADE_ORDER, GRADE_TITLES, SPEC_CODES, SPEC_TITLES } from "../services/candidate.js";

export const router = Router();

route(router, "", {
  method: "get", path: "/dict", tag: "Справочники", summary: "Специализации, грейды, ингредиенты, стек, параметры теста",
}, async () => {
  const cat = await catalog();
  return {
    specializations: Object.entries(cat.specializations).map(([id, s]: any) => ({ id, title: s.title, code: s.code, stacks: s.stacks, ingredients: s.ingredients })),
    grades: GRADE_ORDER.map((id) => ({ id, title: GRADE_TITLES[id] })),
    ingredients: cat.ingredients,
    formats: [{ id: "remote", title: "Удалёнка" }, { id: "hybrid", title: "Гибрид" }, { id: "office", title: "Офис" }],
    test: cat.cat,
    templates_count: cat.templates.length,
    variants_per_seed: cat.templates.reduce((s: number, t: any) => s + t.variants_per_seed, 0),
  };
});

route(router, "", {
  method: "get", path: "/public/stats", tag: "Публичное", summary: "Счётчики для лендинга",
  response: z.object({ candidates: z.number(), confirmed: z.number(), companies: z.number(), invitations: z.number(), fsp_linked: z.number(), accepted: z.number() }),
}, async () => {
  const [r] = await q(`SELECT
    (SELECT count(*) FROM candidates)::int AS candidates,
    (SELECT count(*) FROM candidates WHERE grade IS NOT NULL)::int AS confirmed,
    (SELECT count(*) FROM companies)::int AS companies,
    (SELECT count(*) FROM invitations)::int AS invitations,
    (SELECT count(*) FROM candidates WHERE fsp_id IS NOT NULL)::int AS fsp_linked,
    (SELECT count(*) FROM invitations WHERE status = 'accepted')::int AS accepted`);
  return r;
});

route(router, "", {
  method: "get", path: "/public/market", tag: "Публичное", summary: "Открытая карта рынка: кандидаты и медианные ожидания по категориям",
}, async () => {
  const rows = await q(`SELECT specialization, grade, count(*)::int AS n,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_expect)::int AS median_salary,
      count(*) FILTER (WHERE fsp_id IS NOT NULL)::int AS with_fsp
    FROM candidate_category_view WHERE grade IS NOT NULL AND (privacy->>'searchable')::boolean IS NOT FALSE
    GROUP BY specialization, grade`);
  return {
    rows: Object.keys(SPEC_TITLES).map((s) => ({
      specialization: s, title: SPEC_TITLES[s], code: SPEC_CODES[s],
      cells: GRADE_ORDER.map((g) => {
        const r = rows.find((x: any) => x.specialization === s && x.grade === g);
        return { grade: g, grade_title: GRADE_TITLES[g], n: r?.n ?? 0, median_salary: r?.median_salary ?? null, with_fsp: r?.with_fsp ?? 0 };
      }),
    })),
  };
});
