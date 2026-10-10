// Мок реестра ФСП. Реальный API в рамках хакатона не предоставляется (ТЗ, п. 4),
// поэтому структура данных предложена командой — см. docs/ИНТЕГРАЦИЯ ФСП.md.
import express from "express";

const DISCIPLINES = {
  algorithmic: "Алгоритмическое программирование",
  product: "Продуктовое программирование",
  security: "Программирование систем информационной безопасности",
  robotics: "Программирование робототехники",
  uav: "Программирование беспилотных авиационных систем",
};
const LEVELS = {
  city: "Городской", regional: "Региональный", federal_district: "Окружной",
  national: "Всероссийский", international: "Международный",
};
const EVENTS = [
  { name: "Чемпионат России по спортивному программированию", level: "national" },
  { name: "Кубок России по спортивному программированию", level: "national" },
  { name: "Чемпионат Москвы по спортивному программированию", level: "regional" },
  { name: "Первенство ЦФО по спортивному программированию", level: "federal_district" },
  { name: "Всероссийские соревнования «Кибер-Кубок»", level: "national" },
  { name: "Городской турнир «Код Москвы»", level: "city" },
  { name: "Международный турнир «Цифровой рубеж»", level: "international" },
];
const ROLES = ["капитан, backend", "backend", "frontend", "ML / данные", "алгоритмист", "full-stack", "аналитик"];
const RANKS = ["3 спортивный разряд", "2 спортивный разряд", "1 спортивный разряд", "КМС", "МС"];
const FIRST_M = ["Алексей", "Иван", "Дмитрий", "Сергей", "Никита", "Артём", "Егор", "Павел"];
const FIRST_F = ["Мария", "Анна", "Екатерина", "Ольга", "Полина", "Дарья", "Софья", "Вера"];
const LAST = ["Смирнов", "Ковалёв", "Иванов", "Петров", "Соколов", "Морозов", "Волков", "Лебедев", "Новиков", "Фёдоров"];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function makeParticipant(n) {
  const r = rng(n * 7919 + 17);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const female = r() < 0.4;
  const last = pick(LAST);
  const full_name = `${pick(female ? FIRST_F : FIRST_M)} ${female ? last + "а" : last}`;
  const count = 1 + Math.floor(r() * 4);
  const team = `${pick(["Null", "Byte", "Stack", "Lambda", "Async", "Root"])}${pick(["Pointer", "Force", "Squad", "Crew", "Masters"])}`;
  const achievements = Array.from({ length: count }, (_, i) => {
    const ev = pick(EVENTS);
    const discipline = pick(Object.keys(DISCIPLINES));
    const participants = 30 + Math.floor(r() * 300);
    const place = r() < 0.25 ? 1 + Math.floor(r() * 3) : Math.floor(r() * participants) + 1;
    const year = 2022 + Math.floor(r() * 4);
    return {
      event: `${ev.name} ${year}`,
      date: `${year}-${String(3 + Math.floor(r() * 8)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
      discipline, discipline_title: DISCIPLINES[discipline],
      level: ev.level, level_title: LEVELS[ev.level],
      place, participants,
      team: discipline === "algorithmic" && r() < 0.5 ? null : team,
      role: pick(ROLES),
      rank_title: place <= 3 ? pick(RANKS.slice(2)) : r() < 0.4 ? pick(RANKS.slice(0, 3)) : null,
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { fsp_id: `FSP-${String(n).padStart(6, "0")}`, full_name, email: null, region: "Москва", achievements };
}

// Демо-участники с известной историей (используются в сценарии показа)
const DEMO = {
  "FSP-2025-0001": {
    fsp_id: "FSP-2025-0001", full_name: "Алексей Смирнов", email: "candidate@shaurmatch.demo", region: "Москва",
    achievements: [
      { event: "Чемпионат России по спортивному программированию 2025", date: "2025-11-20", discipline: "product", discipline_title: DISCIPLINES.product,
        level: "national", level_title: LEVELS.national, place: 2, participants: 148, team: "NullPointer", role: "капитан, backend", rank_title: "КМС" },
      { event: "Чемпионат Москвы по спортивному программированию 2024", date: "2024-10-12", discipline: "product", discipline_title: DISCIPLINES.product,
        level: "regional", level_title: LEVELS.regional, place: 1, participants: 96, team: "NullPointer", role: "backend", rank_title: "1 спортивный разряд" },
      { event: "Кубок России по спортивному программированию 2024", date: "2024-05-18", discipline: "algorithmic", discipline_title: DISCIPLINES.algorithmic,
        level: "national", level_title: LEVELS.national, place: 27, participants: 310, team: null, role: "алгоритмист", rank_title: null },
    ],
  },
};

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/v1/disciplines", (_req, res) => res.json(Object.entries(DISCIPLINES).map(([id, title]) => ({ id, title }))));
app.get("/api/v1/levels", (_req, res) => res.json(Object.entries(LEVELS).map(([id, title]) => ({ id, title }))));
app.get("/api/v1/participants/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  if (DEMO[id]) return res.json(DEMO[id]);
  const m = /^FSP-(\d{6})$/.exec(id);
  const n = m ? Number(m[1]) : NaN;
  if (!m || n < 1 || n > 5000) return res.status(404).json({ error: "not_found" });
  res.json(makeParticipant(n));
});
app.get("/api/v1/participants", (req, res) => {
  const email = String(req.query.email ?? "").toLowerCase();
  const found = Object.values(DEMO).filter((p) => p.email === email);
  res.json(found);
});

const port = Number(process.env.PORT ?? 8002);
app.listen(port, () => console.log(`FSP mock: http://localhost:${port}`));
