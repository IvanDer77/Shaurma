export const rub = (n?: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString("ru-RU")} ₽`);
export const rubShort = (n?: number | null) => (n == null ? "—" : n >= 1000 ? `${Math.round(n / 1000)}к` : String(n));
export const range = (a: number, b: number) => `${a.toLocaleString("ru-RU")} – ${b.toLocaleString("ru-RU")} ₽`;
export const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const dateShort = (s?: string | null) => (s ? new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—");
export const ago = (s?: string | null) => {
  if (!s) return "—";
  const d = (Date.now() - new Date(s).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} мин назад`;
  if (d < 86400) return `${Math.round(d / 3600)} ч назад`;
  const days = Math.round(d / 86400);
  return days === 1 ? "вчера" : `${days} дн. назад`;
};
export const initials = (name?: string | null) => {
  const n = name ?? "?";
  const anon = /^(?:Кандидат|Решение) #(\w+)/.exec(n);
  if (anon) return anon[1].slice(0, 2);
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
};
export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const FORMAT_TITLES: Record<string, string> = { remote: "Удалёнка", hybrid: "Гибрид", office: "Офис" };
export const STATUS_TITLES: Record<string, string> = { sent: "Новое", viewed: "Просмотрено", accepted: "Принято", declined: "Отклонено" };
export const GRADE_TITLES: Record<string, string> = { intern: "Intern", junior: "Junior", middle: "Middle", senior: "Senior" };
export const SPEC_TITLES: Record<string, string> = { backend: "Backend-разработка", frontend: "Frontend-разработка", data: "Data / ML" };
