import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocal } from "./hooks";
import { Drawer, Switch } from "./ui";

/** Профиль доступности «Без границ»: предпочтения, а не диагнозы. Хранится в браузере. */
export interface A11yPrefs {
  scale: 1 | 1.5 | 2;
  scheme: "default" | "contrast" | "dark" | "blue";
  calm: boolean;
  dyslexia: boolean;
  spacing: boolean;
  speak: boolean;
}
const DEFAULT: A11yPrefs = { scale: 1, scheme: "default", calm: false, dyslexia: false, spacing: false, speak: false };

const Ctx = createContext<{ prefs: A11yPrefs; set: (p: Partial<A11yPrefs>) => void; open: () => void; speak: (t: string) => void }>({
  prefs: DEFAULT, set: () => {}, open: () => {}, speak: () => {},
});

const PRESETS: { id: string; t: string; d: string; p: Partial<A11yPrefs> }[] = [
  { id: "low-vision", t: "Слабое зрение", d: "Шрифт 150%, высокий контраст", p: { scale: 1.5, scheme: "contrast" } },
  { id: "blind", t: "Озвучивание", d: "Кнопка «Озвучить» у текстов, крупный шрифт", p: { speak: true, scale: 1.5 } },
  { id: "calm", t: "Спокойный режим", d: "Без анимаций и пульсаций", p: { calm: true } },
  { id: "dyslexia", t: "Дислексия", d: "Увеличенные интервалы между буквами и строками", p: { dyslexia: true, spacing: true } },
];

export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useLocal<A11yPrefs>("proof-a11y", DEFAULT);
  const [panel, setPanel] = useState(false);
  useEffect(() => {
    const h = document.documentElement;
    h.style.setProperty("--fs", String(prefs.scale));
    for (const s of ["contrast", "dark", "blue"]) h.classList.toggle(`a11y-${s}`, prefs.scheme === s);
    h.classList.toggle("a11y-calm", prefs.calm);
    h.classList.toggle("a11y-dyslexia", prefs.dyslexia);
    h.classList.toggle("a11y-spacing", prefs.spacing);
  }, [prefs]);
  const set = (p: Partial<A11yPrefs>) => setPrefs({ ...prefs, ...p });
  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    window.speechSynthesis.speak(u);
  };
  return (
    <Ctx.Provider value={{ prefs, set, open: () => setPanel(true), speak }}>
      {children}
      <Drawer open={panel} onClose={() => setPanel(false)} title="Доступность" subtitle="Портал без границ" width={480}>
        <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>Настройки сохраняются в этом браузере. Мы не спрашиваем о здоровье — только как вам удобнее.</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {PRESETS.map((p) => (
            <button key={p.id} className="choice" onClick={() => set(p.p)}><span style={{ fontWeight: 700 }}>{p.t}</span><span className="muted" style={{ fontSize: 12 }}>{p.d}</span></button>
          ))}
        </div>
        <div className="field"><span className="label">Размер шрифта</span>
          <div className="seg" role="tablist">{([1, 1.5, 2] as const).map((s) => <button key={s} role="tab" aria-selected={prefs.scale === s} onClick={() => set({ scale: s })}>{s * 100}%</button>)}</div>
        </div>
        <div className="field"><span className="label">Цветовая схема (ГОСТ Р 52872-2019)</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {([["default", "Обычная", "#fff", "#1C1D22"], ["contrast", "Высокий контраст", "#fff", "#000"], ["dark", "Белое на чёрном", "#000", "#fff"], ["blue", "Синее на голубом", "#9DD1FF", "#063462"]] as const).map(([id, t, bg, fg]) => (
              <button key={id} className="choice" aria-pressed={prefs.scheme === id} onClick={() => set({ scheme: id })} style={{ background: bg, color: fg, padding: 14 }}><span style={{ fontWeight: 700 }}>{t}</span></button>
            ))}
          </div>
        </div>
        <Switch checked={prefs.calm} onChange={(v) => set({ calm: v })} label="Без анимаций («Спокойный режим»)" />
        <Switch checked={prefs.dyslexia} onChange={(v) => set({ dyslexia: v, spacing: v })} label="Увеличенные интервалы (дислексия)" />
        <Switch checked={prefs.speak} onChange={(v) => set({ speak: v })} label="Показывать кнопки «Озвучить»" />
        <button className="btn btn-md btn-ghost" onClick={() => setPrefs(DEFAULT)}>Сбросить настройки</button>
      </Drawer>
    </Ctx.Provider>
  );
}

export const useA11y = () => useContext(Ctx);

export function A11yButton({ onDark, compact }: { onDark?: boolean; compact?: boolean }) {
  const { open } = useA11y();
  if (compact) {
    return <button className="linkbtn" style={onDark ? { color: "#D9D9D9" } : undefined} onClick={open}>Доступность</button>;
  }
  return <button className={`a11y-btn${onDark ? " on-dark" : ""}`} onClick={open}><span className="ic">♿︎</span>Доступность</button>;
}

export function SpeakButton({ text }: { text: string }) {
  const { prefs, speak } = useA11y();
  if (!prefs.speak && !("speechSynthesis" in window)) return null;
  return <button className="btn btn-outline btn-md" onClick={() => speak(text)}>▶ Озвучить</button>;
}
