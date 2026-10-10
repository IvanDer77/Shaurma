import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { GRADE_TITLES, SPEC_TITLES, categoryCode } from "./candidate.js";

const fonts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
/** Палитра бренда «шаурматч_»: чернила, синий, соус, серые. */
const C = { ink: "#1B1C21", blue: "#402FFF", sauce: "#FF8A1F", muted: "#6B6C72", light: "#B4B5BA", track: "#E3E3E5" };

const INGREDIENT_TITLES: Record<string, string> = {};
export function setIngredientTitles(m: Record<string, { title: string }>) {
  for (const [k, v] of Object.entries(m)) INGREDIENT_TITLES[k] = v.title;
}

/** Стандартизированный PDF-профиль кандидата (требование ТЗ). */
export function profilePdf(c: any, history: any[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `шаурматч_ — паспорт навыков ${c.full_name ?? c.anon_code}` } });
    doc.registerFont("R", path.join(fonts, "Montserrat-Regular.ttf"));
    doc.registerFont("B", path.join(fonts, "Montserrat-Bold.ttf"));
    doc.registerFont("M", path.join(fonts, "JetBrainsMono-ExtraBold.ttf"));
    const chunks: Buffer[] = [];
    doc.on("data", (d) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.rect(0, 0, doc.page.width, 130).fill(C.ink);
    doc.fill("#fff").font("M").fontSize(13).text("шаурматч", 48, 34, { continued: true }).fillColor(C.sauce).text("_", { continued: true })
      .fillColor(C.light).font("R").fontSize(10).text("   паспорт навыков");
    doc.fillColor("#fff").font("M").fontSize(24).text(c.full_name ?? `Кандидат #${c.anon_code}`, 48, 58);
    const extra = (c.categories ?? []).filter((k: any) => !k.is_primary).map((k: any) => k.code);
    const cat = [categoryCode(c.specialization, c.grade), ...extra].filter(Boolean).join(", ") || null;
    doc.font("R").fontSize(11).fillColor(C.light).text(
      [c.specialization ? SPEC_TITLES[c.specialization] : "Специализация не выбрана",
       c.grade ? `грейд ${GRADE_TITLES[c.grade]} (подтверждён тестом)` : "грейд не подтверждён",
       cat ? `${extra.length ? "категории" : "категория"} ${cat}` : null].filter(Boolean).join(" · "), 48, 94);

    doc.fillColor(C.ink);
    let y = 160;
    const h = (t: string) => {
      doc.font("M").fontSize(12).fillColor(C.ink).text(t, 48, y);
      doc.moveTo(48, doc.y + 3).lineTo(547, doc.y + 3).lineWidth(1.2).strokeColor(C.ink).stroke();
      y = doc.y + 10;
      doc.fillColor(C.ink);
    };
    const line = (label: string, value?: string | null) => {
      if (!value) return;
      doc.font("B").fontSize(10).text(label, 48, y, { width: 150 });
      doc.font("R").fontSize(10).text(value, 200, y, { width: 340 });
      y = Math.max(doc.y, y + 14) + 4;
    };

    h("Контакты и условия");
    line("Email", c.email);
    line("Телефон", c.phone);
    line("Telegram", c.telegram ? `@${String(c.telegram).replace(/^@/, "")}` : null);
    line("Город", c.city);
    line("Формат", (c.formats ?? []).map((f: string) => ({ remote: "удалёнка", hybrid: "гибрид", office: "офис" })[f] ?? f).join(", "));
    line("Ожидания", c.salary_expect ? `от ${Number(c.salary_expect).toLocaleString("ru-RU")} ₽` : null);
    line("Опыт", c.experience_years ? `${c.experience_years} лет` : null);
    line("Стек", (c.stacks ?? []).join(", "));
    line("Софт-скиллы", (c.soft_skills ?? []).join(", "));
    y += 8;

    h("Подтверждённые ингредиенты (рейтинг Glicko-2, μ − 2·RD)");
    const ratings = Object.entries(c.ratings ?? {}) as [string, any][];
    ratings.sort((a, b) => b[1].r - 2 * b[1].rd - (a[1].r - 2 * a[1].rd));
    for (const [ing, r] of ratings.slice(0, 12)) {
      const cr = Math.max(0, r.r - 2 * r.rd);
      const w = Math.min(1, Math.max(0.03, (cr - 800) / 1200));
      doc.font("R").fontSize(10).fillColor(C.ink).text(INGREDIENT_TITLES[ing] ?? ing, 48, y, { width: 180 });
      doc.rect(230, y + 3, 240, 6).fill(C.track);
      doc.rect(230, y + 3, 240 * w, 6).fill(C.blue);
      doc.fillColor(C.ink).font("M").fontSize(10).text(String(Math.round(cr)), 486, y);
      y += 18;
    }
    if (!ratings.length) {
      doc.font("R").fontSize(10).text("Тест ещё не пройден.", 48, y);
      y += 18;
    }
    y += 8;

    h("Достижения ФСП");
    const ach = c.fsp_achievements ?? [];
    if (!ach.length) {
      doc.font("R").fontSize(10).text("Истории ФСП нет — квалификация подтверждена тестами платформы.", 48, y);
      y = doc.y + 8;
    }
    for (const a of ach.slice(0, 8)) {
      doc.font("B").fontSize(10).text(`${a.event} (${String(a.date).slice(0, 4)})`, 48, y, { width: 490 });
      y = doc.y + 2;
      doc.font("R").fontSize(9).fillColor(C.muted).text(
        [a.discipline_title, a.level_title, a.place ? `${a.place} место из ${a.participants}` : "участник", a.role, a.rank_title].filter(Boolean).join(" · "), 48, y, { width: 490 });
      doc.fillColor(C.ink);
      y = doc.y + 6;
    }
    y += 6;

    h("История тестирования");
    for (const g of history.slice(0, 6)) {
      doc.font("R").fontSize(9).text(
        `${new Date(g.created_at).toLocaleDateString("ru-RU")} — тест на ${GRADE_TITLES[g.declared_grade]}: ${g.result === "confirmed" ? "подтверждён" : "не подтверждён"}`, 48, y);
      y = doc.y + 3;
    }
    doc.font("R").fontSize(8).fillColor(C.muted).text(
      `Сформировано ${new Date().toLocaleString("ru-RU")} · категория присвоена по итогам опроса и адаптивного теста (метод «ШАУРМА»).`, 48, 790, { width: 500 });
    doc.end();
  });
}
