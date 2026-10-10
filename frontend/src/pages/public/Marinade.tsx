import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { GRADE_TITLES, SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { PublicShell } from "../../layout";
import { SectionHead, Spinner } from "../../ui";

/* Цвета серий: «до» — серый, «Маринад» — синий бренда, третья серия — соус. */
const BASE = "#9B9C9E";
const LEARN = "#402FFF";
const THIRD = "#FF8A1F";
const KIND_TITLES: Record<string, string> = { calibration: "Калибровка теста", ranker: "Подбор", textmodel: "Язык", drift: "Детектор" };
const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const fmt = (v: number, d = 0) => v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------------------------------------------------------------- маленькие графики на SVG */
type Series = { name: string; color: string; values: (number | null)[]; dashed?: boolean };

function LineChart({ series, upto, yMax, yFmt, height = 220, label }: { series: Series[]; upto: number; yMax: number; yFmt: (v: number) => string; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560, H = height, L = 44, R = 12, T = 12, B = 28;
  const n = series[0].values.length;
  const x = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const ticks = [0, yMax / 2, yMax];
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line-2)" strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--faint)" fontFamily="var(--mono)">{yFmt(t)}</text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={i + 1 <= upto ? "var(--muted)" : "var(--line-3)"} fontFamily="var(--mono)">{i + 1}</text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-3)" strokeWidth={1} />}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null || (!s.dashed && i + 1 > upto) ? null : [x(i), y(v)] as const)).filter(Boolean) as [number, number][];
          return (
            <g key={s.name}>
              <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "6 5" : undefined} strokeLinejoin="round" />
              {!s.dashed && pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r={i === pts.length - 1 ? 5 : 3.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />)}
            </g>
          );
        })}
        {Array.from({ length: n }, (_, i) => (
          <rect key={i} x={x(i) - (W - L - R) / (n - 1) / 2} y={T} width={(W - L - R) / (n - 1)} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (
        <div className="mar-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>Месяц {hover + 1}</b>
          {series.map((s) => s.values[hover] != null && (s.dashed || hover + 1 <= upto) ? (
            <span key={s.name} className="row" style={{ gap: 6 }}><i style={{ background: s.color }} />{s.name}: <b className="mono">{yFmt(s.values[hover]!)}</b></span>
          ) : null)}
        </div>
      )}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="row" style={{ gap: 16, fontSize: 12 }}>
      {items.map((i) => (
        <span key={i.name} className="row" style={{ gap: 6 }}>
          <svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" stroke={i.color} strokeWidth="2" strokeDasharray={i.dashed ? "5 4" : undefined} /></svg>
          <span className="muted">{i.name}</span>
        </span>
      ))}
    </div>
  );
}

function CusumChart({ d }: { d: any }) {
  const W = 560, H = 210, L = 36, R = 12, T = 12, B = 30;
  const win = (trace: number[], ts: number[]) => {
    const k0 = ts.findIndex((t) => t > d.viral_start_ts);
    return trace.map((s, i) => [i - k0, s] as const).filter(([i]) => i >= -200 && i <= 400);
  };
  const v = win(d.trace, d.trace_ts), c = win(d.control_trace, d.control_ts);
  const yMax = Math.max(d.h * 1.6, ...v.map(([, s]) => s)) * 1.05;
  const x = (i: number) => L + ((i + 200) / 600) * (W - L - R);
  const y = (s: number) => T + (1 - s / yMax) * (H - T - B);
  const n = d.detected?.responses_since_viral;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`CUSUM: тревога через ${n} ответов после разбора`}>
      <line x1={L} x2={W - R} y1={y(d.h)} y2={y(d.h)} stroke="var(--ink)" strokeDasharray="5 4" />
      <text x={L + 4} y={y(d.h) - 6} fontSize={11} fill="var(--ink)">порог тревоги</text>
      <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} stroke="var(--line-3)" strokeDasharray="2 3" />
      <text x={x(0) - 6} y={T + 12} fontSize={11} fill="var(--muted)" textAnchor="end">разбор завирусился</text>
      <polyline points={c.map(([i, s]) => `${x(i)},${y(s)}`).join(" ")} fill="none" stroke={BASE} strokeWidth={1.5} />
      <polyline points={v.map(([i, s]) => `${x(i)},${y(s)}`).join(" ")} fill="none" stroke={LEARN} strokeWidth={2} />
      {n != null && (
        <g>
          <circle cx={x(n)} cy={y(d.h)} r={6} fill={LEARN} stroke="var(--card)" strokeWidth={2} />
          <text x={x(n) + 10} y={y(d.h) + 22} fontSize={12} fontWeight={700} fill="var(--ink)">тревога через {n} ответов</text>
        </g>
      )}
      {[-200, 0, 200, 400].map((t) => <text key={t} x={x(t)} y={H - 10} fontSize={11} textAnchor="middle" fill="var(--faint)" fontFamily="var(--mono)">{t > 0 ? `+${t}` : t}</text>)}
    </svg>
  );
}

function EtaScatter({ points, mode, titles }: { points: any[]; mode: "expert" | "learned"; titles: Record<string, string> }) {
  const [hover, setHover] = useState<any>(null);
  const W = 520, H = 400, P = 44;
  const all = points.flatMap((p) => [p.truth, p.expert, p.learned]);
  const lo = Math.min(...all) - 0.1, hi = Math.max(...all) + 0.1;
  const s = (v: number) => (v - lo) / (hi - lo);
  const X = (v: number) => P + s(v) * (W - P - 12), Y = (v: number) => H - P - s(v) * (H - P - 12);
  const col = mode === "expert" ? BASE : LEARN;
  const err = Math.sqrt(points.reduce((a, p) => a + (p[mode] - p.truth) ** 2, 0) / points.length);
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Сложность начинок: ${mode === "expert" ? "эксперт" : "Маринад"} против истины, ошибка ${err.toFixed(2)}`}>
        <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="var(--line-3)" strokeDasharray="5 4" />
        <text x={X(hi) - 4} y={Y(hi) + 16} fontSize={11} fill="var(--faint)" textAnchor="end">идеально</text>
        <text x={W / 2} y={H - 8} fontSize={12} fill="var(--muted)" textAnchor="middle">истинная сложность начинки (логиты)</text>
        <text x={14} y={H / 2} fontSize={12} fill="var(--muted)" textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>оценка</text>
        {points.map((p) => (
          <circle key={p.key} r={hover?.key === p.key ? 8 : 6} fill={col} stroke="var(--card)" strokeWidth={2} cx={0} cy={0}
            style={{ transform: `translate(${X(p.truth)}px, ${Y(p[mode])}px)`, transition: reduceMotion ? undefined : "transform .9s cubic-bezier(.2,.8,.2,1), fill .4s" }}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      <div className="mar-badge" style={{ color: col }}>ошибка {err.toFixed(2)}</div>
      {hover && (
        <div className="mar-tip" style={{ left: `${(X(hover.truth) / W) * 100}%`, top: `${(Y(hover[mode]) / H) * 100}%` }}>
          <b>{titles[hover.key] ?? hover.key}</b>
          <span>эксперт: <b className="mono">{hover.expert.toFixed(2)}</b></span>
          <span>Маринад: <b className="mono">{hover.learned.toFixed(2)}</b></span>
          <span>истина: <b className="mono">{hover.truth.toFixed(2)}</b>, ответов {hover.n}</span>
        </div>
      )}
    </div>
  );
}

function WeightBars({ rows, title }: { rows: any[]; title: string }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.weight)), 0.01);
  return (
    <div className="card card-soft" style={{ gap: 10 }}>
      <span style={{ fontWeight: 700 }}>{title}</span>
      {[...rows].sort((a, b) => b.weight - a.weight).map((r) => (
        <div key={r.feature} style={{ display: "grid", gridTemplateColumns: "minmax(150px,1fr) 1fr", gap: 10, alignItems: "center", fontSize: 13 }}>
          <span>{r.title}</span>
          <div style={{ display: "flex", height: 14 }}>
            <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{r.weight < 0 && <div style={{ width: `${(Math.abs(r.weight) / max) * 100}%`, background: BASE, borderRadius: "4px 0 0 4px" }} />}</div>
            <div style={{ width: 1, background: "var(--ink)" }} />
            <div style={{ flex: 1 }}>{r.weight > 0 && <div style={{ width: `${(r.weight / max) * 100}%`, height: "100%", background: LEARN, borderRadius: "0 4px 4px 0" }} />}</div>
          </div>
        </div>
      ))}
      <span className="muted" style={{ fontSize: 12 }}>Влево — снижает шанс, вправо — повышает. Веса открыты: модель — JSON-файл в репозитории.</span>
    </div>
  );
}

function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: "light" }) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <span style={{ font: "800 clamp(30px,4vw,44px) var(--mono)", color: tone === "light" ? "#fff" : "var(--accent)", lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 13, lineHeight: 1.4, opacity: tone === "light" ? 0.9 : 1 }} className={tone === "light" ? "" : "muted"}>{label}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- «попробуйте сами» */
const TRY_EXAMPLE = "Ищем бэкендера в эквайринг: при повторных запросах от банка-партнёра случаются двойные списания, иногда одно и то же событие обрабатывается параллельно двумя воркерами. Go, PostgreSQL, опыт от 3 лет.";

function RecipeView({ r, title, color, dict }: { r: any; title: string; color: string; dict: any }) {
  const ings = Object.entries(r.ingredients as Record<string, number>).slice(0, 5);
  const max = Math.max(...ings.map(([, w]) => w));
  return (
    <div className="card card-soft" style={{ gap: 10, flex: "1 1 280px", borderTop: `4px solid ${color}` }}>
      <span style={{ fontWeight: 700 }}>{title}</span>
      <span className="muted" style={{ fontSize: 13 }}>{SPEC_TITLES[r.specialization]}, {GRADE_TITLES[r.grade]}</span>
      {ings.map(([id, w]) => (
        <div key={id} className="col" style={{ gap: 3 }}>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>{dict?.ingredients?.[id]?.title ?? id}</span>
            {r.evidence?.[id]?.[0] && <span className="muted" style={{ fontSize: 12 }}>«{r.evidence[id][0]}»</span>}
          </div>
          <div style={{ height: 6, background: "var(--bg-soft)", borderRadius: 4 }}><div style={{ width: `${(w / max) * 100}%`, height: "100%", background: color, borderRadius: 4 }} /></div>
        </div>
      ))}
    </div>
  );
}

function TryIt() {
  const dict = useApi<any>("/dict");
  const [text, setText] = useState(TRY_EXAMPLE);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await api.post("/public/learning/recipe", { text })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ gap: 14 }}>
      <span className="eyebrow">Попробуйте сами</span>
      <span className="muted" style={{ fontSize: 14 }}>Напишите потребность своими словами — сравните словарь правил и собственную модель шаурматч_. Внешние нейросети не используются.</span>
      <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст потребности" />
      <div className="row"><button className="btn btn-md btn-primary" onClick={run} disabled={busy || text.length < 10}>{busy ? "Разбираю…" : "Разобрать"}</button>{err && <span style={{ color: "var(--danger)", fontSize: 13 }}>{err}</span>}</div>
      {res && (
        <div className="row" style={{ gap: 16, alignItems: "stretch" }}>
          <RecipeView r={res.rules} title="Словарь правил" color={BASE} dict={dict.data} />
          <RecipeView r={res.model} title={res.model.source === "proof-model" ? "Модель шаурматч_" : "Модель не загружена — правила"} color={LEARN} dict={dict.data} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- страница */
export default function Marinade() {
  const [m, setM] = useState<any>(null);
  const live = useApi<any>("/public/learning");
  const titles = useApi<any>("/public/learning/titles");
  const [month, setMonth] = useState(reduceMotion ? 12 : 1);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<"expert" | "learned">("expert");
  const playerRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { fetch("/training/metrics.json").then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null)); }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setMonth((x) => { if (x >= 12) { setPlaying(false); return 12; } return x + 1; }), 1100);
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => {
    if (!m || reduceMotion || !playerRef.current) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !started.current) { started.current = true; setMonth(1); setPlaying(true); } }, { threshold: 0.4 });
    io.observe(playerRef.current);
    return () => io.disconnect();
  }, [m]);
  useEffect(() => {
    if (reduceMotion) { setMode("learned"); return; }
    const t = setInterval(() => setMode((v) => (v === "expert" ? "learned" : "expert")), 3200);
    return () => clearInterval(t);
  }, []);

  const mon = m?.monthly ?? [];
  const row = mon[month - 1];
  const cf = m?.counterfactual;
  const d = m?.drift;
  const hand = cf?.matching?.hand;
  const errSeries = useMemo<Series[]>(() => !mon.length ? [] : [
    { name: "сложность начинок η", color: LEARN, values: mon.map((r: any) => (100 * r.rmse_learned.eta) / r.rmse_expert.eta) },
    { name: "сложность шаблонов", color: THIRD, values: mon.map((r: any) => (100 * r.rmse_learned.b0) / r.rmse_expert.b0) },
    { name: "дискриминация", color: BASE, values: mon.map((r: any) => (100 * r.rmse_learned.a) / r.rmse_expert.a) },
  ], [mon]);
  const opTitles: Record<string, string> = useMemo(() => {
    const t = titles.data;
    if (!t) return {};
    return Object.fromEntries(Object.entries(t.ops as Record<string, string>).map(([k, v]) => [k, `${t.templates[k.split(":")[0]]}: ${v.toLowerCase()}`]));
  }, [titles.data]);
  const viralTitle = d?.viral_key ? opTitles[d.viral_key] ?? d.viral_key : "";

  const st = live.data?.status;
  const sig = live.data?.signals;
  const calState = live.data?.state?.calibration;
  const every = live.data?.thresholds?.calibrate_every ?? 300;
  const sinceCal = sig ? sig.answers - (calState?.last_count ?? 0) : 0;
  const rankerCard = st?.ranker ?? m?.ranker;

  return (
    <PublicShell>
      <div>
        <span className="eyebrow">Платформа, которая учится</span>
        <h1 className="page-title" style={{ marginTop: 8 }}>Маринад</h1>
        <p className="page-sub" style={{ fontSize: 18, color: "var(--ink)" }}>Шаурма вкуснее, чем дольше маринуется. Подбор точнее, чем больше им пользуются.</p>
        <p className="page-sub">Три собственные модели доучиваются на том, что люди и так делают в продукте: отвечают на задания, правят рецепт, принимают приглашения. Без разметчиков, без внешних нейросетей, с открытыми весами.</p>
      </div>
      {cf && (
        <div className="tiles">
          <div><span className="tile-label">незаслуженно завышенных грейдов</span><span className="tile-num">−{Math.round((1 - cf.grade.learned.overestimated / cf.grade.expert.overestimated) * 100)}%</span></div>
          <div><span className="tile-label">наймов на одно приглашение</span><span className="tile-num" style={{ color: "var(--violet)" }}>+{Math.round((cf.matching.learned.hires_per_10 / cf.matching.hand.hires_per_10 - 1) * 100)}%</span></div>
          <div><span className="tile-label">приглашений принимают</span><span className="tile-num" style={{ color: "var(--green)" }}>{Math.round(cf.matching.learned.acceptance * 100)}%</span><span className="tile-sub">было {Math.round(cf.matching.hand.acceptance * 100)}%</span></div>
          {d?.detected && <div><span className="tile-label">ответов до тревоги детектора</span><span className="tile-num" style={{ color: "var(--sauce)" }}>{d.detected.responses_since_viral}</span><span className="tile-sub">«утёкший» приём пойман</span></div>}
        </div>
      )}
      <div className="col" style={{ gap: 48 }}>
        <SectionHead>Петля обучения</SectionHead>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 20 }}>
          {[
            ["01", "Кандидат отвечает на задание", "Маринад сложности", "Сложность каждой начинки и шаблона и их различающая сила выводятся из ответов (LLTM + 3PL, MML-EM). Пока данных мало, параметры держатся у экспертных значений."],
            ["02", "Работодатель правит рецепт ползунками", "Маринад заказа", "Каждая правка — размеченный пример «текст и навыки». Своя модель на символьных n-граммах понимает «двойные списания», которых нет в словаре."],
            ["03", "Кандидат принимает или отклоняет, работодатель отмечает найм", "Маринад подбора", "Две головы: «подойдёт» и «примет». Выдача — по вероятности найма, а не только по навыкам: сильный кандидат, которому не подходит вилка, — пустой талон."],
          ].map(([n, a, t, dsc]) => (
            <div key={n} className="card-outline" style={{ padding: 26, gap: 10 }}>
              <span className="big-num" style={{ fontSize: 40 }}>{n}</span>
              <span className="eyebrow" style={{ fontSize: 11 }}>{a}</span>
              <span style={{ fontSize: 20, fontWeight: 700 }}>{t}</span>
              <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--muted-2)" }}>{dsc}</span>
            </div>
          ))}
        </div>

        {!m ? <Spinner label="Загружаю симуляцию…" /> : (
          <>
            <SectionHead violet right={<span className="muted" style={{ fontSize: 13 }}>синтетический мир с известной истиной</span>}>Год жизни платформы в перемотке</SectionHead>
            <div ref={playerRef} className="card" style={{ gap: 20 }}>
              <div className="row" style={{ gap: 14 }}>
                <button className="btn btn-md btn-primary" onClick={() => { if (month >= 12) setMonth(1); setPlaying(!playing); }} aria-label={playing ? "Пауза" : "Запустить год"}>{playing ? "❚❚ Пауза" : month >= 12 ? "↺ Ещё раз" : "▶ Запустить год"}</button>
                <input type="range" min={1} max={12} value={month} onChange={(e) => { setPlaying(false); setMonth(Number(e.target.value)); }} aria-label="Месяц" style={{ flex: 1, minWidth: 160, accentColor: LEARN }} />
                <span className="mono" style={{ fontWeight: 800, fontSize: 18, minWidth: 110 }}>месяц {month}/12</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 16 }}>
                <Stat value={fmt(row.candidates)} label="кандидатов прошли тест" />
                <Stat value={fmt(row.responses)} label="ответов накоплено — на них учится тест" />
                <Stat value={`${Math.round((100 * row.rmse_learned.eta) / row.rmse_expert.eta)}%`} label="осталось от ошибки эксперта в сложности начинок" />
                <Stat value={fmt(row.hires_per_10, 1)} label={`наймов на 10 приглашений (формула: ${fmt(hand.hires_per_10, 1)})`} />
                <Stat value={`${Math.round(row.acceptance * 100)}%`} label={`приглашений принимают (формула: ${Math.round(hand.acceptance * 100)}%)`} />
              </div>
              {d?.viral_month && month >= d.viral_month && d.detected && (
                <div className="mar-event" role="status">
                  <span className="pill" style={{ background: LEARN, color: "#fff" }}>Месяц {d.viral_month}</span>
                  <span>Завирусился разбор начинки <b>«{viralTitle}»</b>: 70% новых кандидатов знают трюк. Детектор «чёрствого лаваша» поднял тревогу через <b>{d.detected.responses_since_viral} ответов</b>, история начинки обнулилась, тест выучил её новую сложность ({d.viral_eta?.by_month?.at(-1)?.learned?.toFixed(2)} вместо {d.viral_eta?.expert?.toFixed(2)}).</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 24 }}>
                <div className="col" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>Сколько осталось от ошибки эксперта, %</span>
                  <Legend items={errSeries} />
                  <LineChart series={errSeries} upto={month} yMax={100} yFmt={(v) => `${Math.round(v)}%`} label="Остаток ошибки эксперта по месяцам" />
                </div>
                <div className="col" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>Наймов на 10 приглашений</span>
                  <Legend items={[{ name: "Маринад", color: LEARN }, { name: "ручная формула", color: BASE, dashed: true }]} />
                  <LineChart series={[{ name: "Маринад", color: LEARN, values: mon.map((r: any) => r.hires_per_10) }, { name: "ручная формула", color: BASE, dashed: true, values: mon.map(() => hand.hires_per_10) }]}
                    upto={month} yMax={Math.ceil(Math.max(...mon.map((r: any) => r.hires_per_10)) + 0.5)} yFmt={(v) => fmt(v, 1)} label="Наймов на 10 приглашений по месяцам" />
                </div>
              </div>
              {d?.detected && month >= d.viral_month && (
                <div className="col" style={{ gap: 8, maxWidth: 760 }}>
                  <span style={{ fontWeight: 700 }}>Детектор «чёрствого лаваша»: CUSUM по ответам на начинку</span>
                  <Legend items={[{ name: "начинка с вирусным разбором", color: LEARN }, { name: "обычная начинка", color: BASE }]} />
                  <CusumChart d={d} />
                </div>
              )}
            </div>

            <SectionHead>До и после на одних и тех же людях</SectionHead>
            <span className="muted" style={{ fontSize: 14, marginTop: -28 }}>2000 новых кандидатов проходят тест дважды на одних и тех же случайных числах; 150 вакансий ранжируются формулой и обученным подбором.</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
              {[
                ["Завышенных грейдов", `${fmt(cf.grade.expert.overestimated * 100, 1)}%`, `${fmt(cf.grade.learned.overestimated * 100, 1)}%`],
                ["Грейд определён точно", `${fmt(cf.grade.expert.exact * 100, 1)}%`, `${fmt(cf.grade.learned.exact * 100, 1)}%`],
                ["Наймов на 10 приглашений", fmt(cf.matching.hand.hires_per_10, 2), fmt(cf.matching.learned.hires_per_10, 2)],
                ["Приглашений принято", `${Math.round(cf.matching.hand.acceptance * 100)}%`, `${Math.round(cf.matching.learned.acceptance * 100)}%`],
              ].map(([t, a, b]) => (
                <div key={t} className="card card-soft" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t}</span>
                  <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--faint)", textDecoration: "line-through" }}>{a}</span>
                                        <span className="mono" style={{ fontSize: 32, fontWeight: 800, color: "var(--accent)" }}>{b}</span>
                  </div>
                </div>
              ))}
            </div>

            <SectionHead violet>Эксперт ошибался — ответы людей поправили</SectionHead>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 24, alignItems: "center" }}>
              <div className="card" style={{ gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700 }}>Сложность {m.calibration.eta_points.length} начинок</span>
                  <div className="seg" role="tablist" aria-label="Чьи оценки">
                    <button role="tab" aria-selected={mode === "expert"} onClick={() => setMode("expert")}>Эксперт</button>
                    <button role="tab" aria-selected={mode === "learned"} onClick={() => setMode("learned")}>Маринад</button>
                  </div>
                </div>
                <EtaScatter points={m.calibration.eta_points} mode={mode} titles={opTitles} />
              </div>
              <div className="col" style={{ gap: 16 }}>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>Эксперт оценил, насколько каждая начинка усложняет задание, «на глаз». В мире симуляции он ошибся так же, как ошибаются эксперты в психометрической литературе: корреляция с истиной <b>{m.calibration.eta_points && corr(m.calibration.eta_points, "expert").toFixed(2)}</b>.</p>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>После года ответов «Маринад» восстановил сложности с корреляцией <b style={{ color: "var(--accent)" }}>{corr(m.calibration.eta_points, "learned").toFixed(2)}</b>. Точки на графике сами переезжают с экспертных позиций на выученные — наведите на любую, чтобы увидеть начинку.</p>
                <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>Защита от порчи: новая версия калибровки включается, только если на 20% отложенных кандидатов объясняет ответы лучше текущей. Каждая версия пишется в журнал, откат — одна команда.</p>
              </div>
            </div>

            <SectionHead>Своя языковая модель вместо словаря</SectionHead>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
              {[["Специализация", "specialization"], ["Грейд", "grade"], ["Заказанные навыки в топ-3", "ingredients_hit3"]].map(([t, k]) => (
                <div key={k} className="card card-soft" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{t}</span>
                  <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--faint)" }}>{Math.round(m.language.rules[k] * 100)}%</span>
                                        <span className="mono" style={{ fontSize: 32, fontWeight: 800, color: "var(--accent)" }}>{Math.round(m.language.model[k] * 100)}%</span>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>словарь, затем своя модель</span>
                </div>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 13, marginTop: -28 }}>Проверка — на {m.language.eval_size} описаниях потребностей, написанных вручную отдельно от обучающего корпуса ({fmt(m.language.corpus_size)} сгенерированных текстов; парсить чужие вакансии ТЗ запрещает).</span>
            {st?.textmodel?.learned_words && (
              <div className="card card-soft" style={{ gap: 10 }}>
                <span style={{ fontWeight: 700 }}>Слова, которые модель связала с навыками сама</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
                  {Object.entries(st.textmodel.learned_words as Record<string, string[]>).map(([ing, words]) => (
                    <div key={ing} className="col" style={{ gap: 6 }}>
                      <span className="eyebrow" style={{ fontSize: 11 }}>{ingTitle(ing)}</span>
                      <div className="row" style={{ gap: 6 }}>{words.map((w) => <span key={w} className="tag">{w}</span>)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <TryIt />

            {rankerCard && (
              <>
                <SectionHead violet>Чему научился подбор</SectionHead>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20 }}>
                  <WeightBars rows={rankerCard.fit} title="«Подойдёт»: что ведёт к найму" />
                  <WeightBars rows={rankerCard.accept} title="«Примет»: что ведёт к «да»" />
                </div>
              </>
            )}
          </>
        )}

        <SectionHead right={<span className="muted" style={{ fontSize: 13 }}>данные этой установки, обновляются в реальном времени</span>}>Живой маринад</SectionHead>
        {live.loading && !live.data ? <Spinner /> : !live.data ? <span className="muted">Паспорт моделей недоступен.</span> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 20 }}>
            <div className="card" style={{ gap: 14 }}>
              <span style={{ fontWeight: 700 }}>Накоплено сигналов</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Stat value={fmt(sig.answers)} label="ответов на задания" />
                <Stat value={fmt(sig.invitation_answers)} label="ответов на приглашения" />
                <Stat value={fmt(sig.interview_outcomes)} label="итогов собеседований" />
                <Stat value={fmt(sig.recipe_edits)} label="правок рецептов" />
              </div>
              <div className="col" style={{ gap: 6 }}>
                <span style={{ fontSize: 13 }}>До следующей перекалибровки теста: <b className="mono">{Math.max(0, every - sinceCal)}</b> ответов</span>
                <div style={{ height: 8, background: "var(--bg-soft)", borderRadius: 6 }}><div style={{ width: `${Math.min(100, (sinceCal / every) * 100)}%`, height: "100%", background: LEARN, borderRadius: 6, transition: "width .6s" }} /></div>
                <span className="muted" style={{ fontSize: 12 }}>Пройдите тест — и ваш ответ тоже попадёт в маринад.</span>
              </div>
            </div>
            <div className="card" style={{ gap: 12 }}>
              <span style={{ fontWeight: 700 }}>Активные модели</span>
              {[
                ["Калибровка теста", st?.calibration ? `${st.calibration.version}, ${fmt(st.calibration.n_responses)} ответов` : "экспертные параметры (ждём данных)"],
                ["Подбор", st?.ranker ? `${st.ranker.version ?? "тёплый старт"}, ${st.ranker.source === "live" ? "дообучен на ваших данных" : "из симуляции"}` : "ручная формула"],
                ["Язык", st?.textmodel ? `${st.textmodel.version}, ${st.textmodel.source === "live" ? "с правками работодателей" : "базовая"}` : "словарь правил"],
              ].map(([t, v]) => (
                <div key={t} className="row" style={{ justifyContent: "space-between", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line-2)", paddingBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>{t}</span><span className="mono muted" style={{ fontSize: 12, textAlign: "right" }}>{v}</span>
                </div>
              ))}
              <span style={{ fontWeight: 700, marginTop: 6 }}>Журнал версий</span>
              {live.data.versions.length ? live.data.versions.slice(0, 6).map((v: any, i: number) => (
                <div key={i} className="row" style={{ gap: 8, fontSize: 12 }}>
                  <span className={v.activated ? "badge-ok" : "badge-warn"}>{v.activated ? "включена" : "отклонена"}</span>
                  <span style={{ fontWeight: 600 }}>{KIND_TITLES[v.kind] ?? v.kind}</span>
                  <span className="muted">{v.n_examples} прим., {new Date(v.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              )) : <span className="muted" style={{ fontSize: 13 }}>Пока пусто.</span>}
            </div>
            <div className="card" style={{ gap: 12 }}>
              <span style={{ fontWeight: 700 }}>Детектор «чёрствого лаваша»</span>
              {!live.data.drift?.top?.length ? <span className="muted" style={{ fontSize: 13 }}>Ответов пока мало: детектор начинает следить за начинкой после 150 ответов на неё.</span> : live.data.drift.top.map((k: any) => (
                <div key={k.key} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                  <span style={{ minWidth: 0 }}>{k.title}<span className="muted">, {k.n} отв.</span></span>
                  <span className={k.status === "alarm" ? "status status-sent" : k.status === "watch" ? "badge-warn" : "badge-ok"}>{{ alarm: "тревога", watch: "наблюдаем", warmup: "разогрев", ok: "норма" }[k.status as string]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}><b>Честно о границах.</b> «Год жизни» — симуляция: мир синтетический, поэтому абсолютные цифры зависят от допущений о поведении людей; проверен механизм, а не величина эффекта на реальном рынке. Калибровка теста в продукте учится только на живых ответах — в образ она не запекается. Код: <span className="mono">engine/app/learn/</span>, симуляция: <span className="mono">engine/training/marinate.py</span>, отчёт: <span className="mono">docs/training/report.md</span>.</p>
        </div>
        <div className="row"><Link to="/?mode=register" className="btn btn-lg btn-primary">Пройти тест</Link><Link to="/method" className="btn btn-lg btn-outline">Метод «ШАУРМА»</Link></div>
      </div>
    </PublicShell>
  );
}

function corr(pts: any[], key: string) {
  const xs = pts.map((p) => p.truth), ys = pts.map((p) => p[key]);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

const ING_T: Record<string, string> = { idempotency: "Идемпотентность", concurrency: "Конкурентность", sql_window: "Оконные функции", ml_metrics: "Метрики моделей", js_async: "Event loop и промисы", code_reading: "Чтение чужого кода" };
const ingTitle = (k: string) => ING_T[k] ?? k;
