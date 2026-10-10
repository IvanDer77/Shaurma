import { Router } from "express";
import { route, z } from "../api.js";
import { q } from "../db.js";
import { engine } from "../engine.js";
import { counters, driftReport } from "../services/learning.js";

export const router = Router();

let cache: { at: number; data: any } | null = null;

route(router, "", {
  method: "get", path: "/public/learning", tag: "Маринад",
  summary: "Как платформа учится: активные модели, накопленные сигналы, детектор «чёрствого лаваша», журнал версий",
  description: "Публичный паспорт моделей — прозрачность для кандидатов и работодателей. Кэш 30 секунд.",
}, async () => {
  if (cache && Date.now() - cache.at < 30_000) return cache.data;
  const [status, signals, drift, versions, state] = await Promise.all([
    engine("/learn/status"),
    counters(),
    driftReport().catch(() => null),
    q(`SELECT kind, version, activated, reason, n_examples, created_at FROM model_versions ORDER BY created_at DESC LIMIT 12`),
    q(`SELECT kind, last_count, last_run_at FROM learning_state`),
  ]);
  const data = {
    status, signals, versions, state: Object.fromEntries(state.map((r: any) => [r.kind, r])),
    drift: drift && { n_items: drift.n_items, h: drift.h, alarms: drift.alarms, watch: drift.watch, top: drift.keys.slice(0, 6) },
    thresholds: { calibrate_every: Number(process.env.CALIBRATE_EVERY ?? 300), ranker_every: Number(process.env.RANKER_EVERY ?? 20) },
  };
  cache = { at: Date.now(), data };
  return data;
});

route(router, "", {
  method: "post", path: "/public/learning/recipe", tag: "Маринад",
  summary: "Попробуйте сами: разбор текста потребности словарём правил и собственной моделью платформы",
  body: z.object({ text: z.string().min(10).max(3000) }),
}, async (req) => engine("/learn/recipe-compare", { text: req.body.text }));

let titlesCache: any = null;
route(router, "", { method: "get", path: "/public/learning/titles", tag: "Маринад", summary: "Названия шаблонов и начинок" }, async () => {
  titlesCache ??= await engine("/learn/titles");
  return titlesCache;
});
