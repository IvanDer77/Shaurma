import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { STATUS_TITLES, initials } from "../format";

/* ---------- Логотип ---------- */
export const BRAND = "шаурматч";
export function Logo({ to = "/", onDark, sub }: { to?: string; onDark?: boolean; sub?: string }) {
  return (
    <Link to={to} className={`brand${onDark ? " on-dark" : ""}`} aria-label={BRAND}>
      {BRAND}<span className="cur" aria-hidden>_</span>
      {sub && <span style={{ font: "500 12px var(--sans)", marginLeft: 10, color: onDark ? "#B4B5BA" : "var(--ink-2)", letterSpacing: 0 }}>{sub}</span>}
    </Link>
  );
}

/* ---------- Заголовок страницы ---------- */
export function PageHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}><h1 className="page-title">{title}</h1>{sub && <p className="page-sub">{sub}</p>}</div>
      {right && <div className="row">{right}</div>}
    </div>
  );
}

export const SectionHead = ({ children, right }: { children: ReactNode; violet?: boolean; right?: ReactNode }) => (
  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 className="h2">{children}</h2>{right}</div>
);

/* ---------- Кольцо совпадения: 100·P(подойдёт) ---------- */
export function MatchRing({ value, size = 52, label }: { value: number; size?: number; label?: string; gradient?: boolean; stroke?: number }) {
  const sw = size > 70 ? 6 : 4;
  const r = size / 2 - sw;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }} role="img" aria-label={label ?? `Совпадение ${Math.round(v)} из 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-200)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--blue)" strokeWidth={sw}
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .5s ease-out" }} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", font: `${size > 70 ? "400" : "700"} ${Math.round(size / (size > 70 ? 2.6 : 3.4))}px ${size > 70 ? "var(--pixel)" : "var(--mono)"}` }}>{Math.round(v)}</span>
    </div>
  );
}

/* ---------- Бейджи ---------- */
export const CodePill = ({ code, light }: { code?: string | null; light?: boolean; lg?: boolean }) =>
  code ? <span className="code" style={light ? { color: "#fff" } : undefined}>{code}</span> : null;

export const FspBadge = ({ count, onDark }: { count?: number; onDark?: boolean }) => (
  <span className="fsp" style={onDark ? { color: "#fff" } : undefined} title="Подтверждено данными Федерации спортивного программирования">
    <img src={onDark ? "/brand/fsp-star-white.svg" : "/brand/fsp-star-black.svg"} alt="" />ФСП{count ? ` × ${count}` : ""}
  </span>
);

export const StatusPill = ({ status, onDark, titles }: { status: string; onDark?: boolean; titles?: Record<string, string> }) =>
  <span className={`st st-${status}`} style={onDark ? { color: "#fff" } : undefined}>{((titles ?? STATUS_TITLES)[status] ?? status).toLowerCase()}</span>;

export const Tag = ({ children }: { children: ReactNode }) => <span className="tag">{children}</span>;

/** Стек: «✓Python» — подтверждён заданиями теста, «Go» — со слов кандидата. */
export function StackLine({ stacks = [], verified = [] }: { stacks?: string[]; verified?: string[] }) {
  const all = [...verified.filter((v) => !stacks.includes(v)), ...stacks];
  if (!all.length) return null;
  return (
    <span className="row" style={{ gap: 10, rowGap: 2 }}>
      {all.map((s) => verified.includes(s)
        ? <span key={s} className="vtag v" title="Подтверждено заданиями теста">✓{s}</span>
        : <span key={s} className="vtag" title="Со слов кандидата">{s}</span>)}
    </span>
  );
}

const AV = ["#402FFF", "#0A006B", "#8C82FF", "#2B1BE0", "#5B4FE0", "#EC1D35"];
export const avatarBg = (id: string) => AV[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AV.length];
export function Avatar({ name, size = 48, bg = "#402FFF" }: { name?: string | null; size?: number; bg?: string; square?: boolean }) {
  return <span className="ava" style={{ width: size, height: size, background: bg, fontSize: Math.max(13, Math.round(size / 2.8)) }} aria-hidden>{initials(name)}</span>;
}

/** Место в соревновании ФСП — крупной пиксельной цифрой. */
export function Medal({ place }: { place?: number | null }) {
  return <span style={{ width: 40, flexShrink: 0, font: "400 32px/1 var(--pixel)", color: place && place <= 3 ? "var(--ink)" : "var(--ink-3)" }} aria-label={place ? `${place} место` : "участник"}>{place ?? "—"}</span>;
}

/** Цветовой код дисциплин из брендбука ФСП: цвет — только маркер, текст в основном цвете. */
export const DISCIPLINE_COLORS: Record<string, string> = { product: "#8C3BFF", algorithmic: "#402FFF", uav: "#1FB5A8", robotics: "#F5C400", security: "#0E7A3E" };

/** Рейтинг ингредиента: сплошная часть — подтверждённый уровень (μ − 2·RD), светлая — неопределённость. */
export function IngredientBar({ name, conf, unc, value, cold }: { name: ReactNode; conf: number; unc: number; value?: number | null; cold?: boolean }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{name}{cold && <span title="Навык остыл: давно не было практики" style={{ color: "var(--blue)", marginLeft: 6 }}>❄</span>}</span>
        <span className="num" style={{ fontSize: 14 }}>{value ?? "—"}</span>
      </div>
      <div className="ibar" aria-hidden>
        <div className="c" style={{ width: `${conf}%` }} />
        <div className="u" style={{ left: `${conf}%`, width: `${Math.min(unc, 100 - conf)}%` }} />
      </div>
    </div>
  );
}

/* ---------- Каркасные блоки (оставлены для «Метода» и «Маринада») ---------- */
export function HeroCard({ children, style, className = "" }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <div className={`hero ${className}`} style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16, ...style }}>{children}</div>;
}

/* ---------- Состояния ---------- */
export function Spinner({ label = "Загрузка…" }: { label?: string }) {
  return <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--ink-2)", padding: 24 }}><div className="spinner" />{label}</div>;
}
export function Skeleton({ h = 120, style }: { h?: number; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height: h, ...style }} aria-hidden />;
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden>[ ]</span>
      <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
      {children && <span className="muted" style={{ fontSize: 14, maxWidth: 480 }}>{children}</span>}
      {action}
    </div>
  );
}
export const ErrorBox = ({ error }: { error?: string | null }) => (error ? <div className="alert alert-error" role="alert">{error}</div> : null);

/* ---------- Элементы форм ---------- */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="track"><span className="knob" /></span>{label}
    </button>
  );
}
/** Строка настроек: подпись слева, переключатель справа. */
export function SwitchRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={typeof label === "string" ? label : undefined} className="switch" onClick={() => onChange(!checked)}>
        <span className="track"><span className="knob" /></span>
      </button>
    </div>
  );
}
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="check" onClick={() => onChange(!checked)}>
      <span className="box">{checked ? "✓" : ""}</span><span>{label}</span>
    </button>
  );
}
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; t: string }[]; label?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>{o.t}</button>)}
    </div>
  );
}
export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; t: string; count?: number }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>
          {o.t}{o.count !== undefined && <span className="mono" style={{ marginLeft: 8, opacity: .7 }}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return <label className="field"><span className="label">{label}</span>{children}{error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</label>;
}
/** Поле суммы в рублях с разделителями разрядов. */
export function MoneyInput({ value, onChange, ...rest }: { value: number | null | undefined; onChange: (v: number | null) => void; "aria-label"?: string; placeholder?: string }) {
  return (
    <input className="input mono" inputMode="numeric" value={value ? value.toLocaleString("ru-RU") : ""} placeholder={rest.placeholder ?? "250 000"} aria-label={rest["aria-label"]}
      onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); onChange(n || null); }} />
  );
}

/* ---------- Выдвижная панель / окно ---------- */
export function Drawer({ open, onClose, title, subtitle, children, footer, width }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, 100vw)` } : undefined}>
        <div className="drawer-head">
          <div className="col" style={{ gap: 1, minWidth: 0 }}>{subtitle && <span className="drawer-sub">{subtitle}</span>}<span className="drawer-title">{title}</span></div>
          <button className="xbtn" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
}
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return <><div className="overlay" onClick={onClose} /><div className="modal" role="dialog" aria-modal="true">{children}</div></>;
}

/* ---------- Тосты ---------- */
type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(text: string, action?: Toast["action"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((text: string, action?: Toast["action"]) => {
    const id = Date.now();
    setToast({ id, text, action });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className="toast" role="status" aria-live="polite">{toast.text}{toast.action && <button className="btn btn-xs btn-white" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Код задания ---------- */
export function CodeBlock({ code, highlight }: { code: string; highlight?: number }) {
  return (
    <pre className="code-block" tabIndex={0} aria-label="Код задания">
      {code.split("\n").map((l, i) => <span key={i} className="ln" style={highlight === i + 1 ? { background: "rgba(255,138,31,.25)" } : undefined}>{l || " "}</span>)}
    </pre>
  );
}
