import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { A11yButton } from "../../a11y";
import { api } from "../../api";
import { SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { Check, ErrorBox, Field, Logo, MoneyInput, Spinner } from "../../ui";
import { GRADES } from "./Test";

/** Путь по ТЗ: согласия → опрос → (резюме и ФСП — по желанию) → самовыбор грейда → тест. */
const STEPS = ["Согласия", "Опрос", "Резюме и ФСП", "Грейд"];
const EXTRA_STACKS = ["PostgreSQL", "Docker", "Kafka", "Redis", "Kubernetes", "TypeScript", "SQL"];

export default function Onboarding() {
  const dict = useApi<any>("/dict");
  const prof = useApi<any>("/candidate/profile");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [spec, setSpec] = useState<string>("backend");
  const [stacks, setStacks] = useState<string[]>([]);
  const [grade, setGrade] = useState("middle");
  const [years, setYears] = useState<number | "">("");
  const [salary, setSalary] = useState<number | null>(null);
  const [city, setCity] = useState("");
  const [formats, setFormats] = useState<string[]>(["remote"]);
  const [anon, setAnon] = useState(true);
  const [consent, setConsent] = useState(false);
  const [publish, setPublish] = useState(true);
  const [parsed, setParsed] = useState<any>(null);
  const [fspId, setFspId] = useState("");
  const [fspMsg, setFspMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inited = useRef(false);

  useEffect(() => {
    const p = prof.data;
    if (!p || inited.current) return;
    inited.current = true;
    if (p.specialization) setSpec(p.specialization);
    if (p.stacks?.length) setStacks(p.stacks);
    if (p.declared_grade) setGrade(p.declared_grade);
    if (p.experience_years != null) setYears(p.experience_years);
    if (p.salary_expect) setSalary(p.salary_expect);
    if (p.city) setCity(p.city);
    if (p.formats?.length) setFormats(p.formats);
    if (p.fsp?.id) setFspId(p.fsp.id);
    if (p.privacy?.show_name === true) setAnon(false);
    setConsent(!!p.consent_processing);
    if (p.grade) navigate("/candidate", { replace: true });
  }, [prof.data, navigate]);

  if (!dict.data || !prof.data) return <Spinner />;
  const specs = dict.data.specializations;
  const curSpec = specs.find((s: any) => s.id === spec);
  const allStacks = Array.from(new Set([...(curSpec?.stacks ?? []), ...EXTRA_STACKS, ...stacks]));
  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const blocked = step === 0 ? !consent : step === 1 ? !stacks.length || !formats.length : false;
  const blockedWhy = step === 0 ? "Отметьте согласие на обработку данных" : step === 1 ? (!stacks.length ? "Выберите хотя бы одну технологию" : "Выберите формат работы") : "";

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const next = () => run(async () => {
    if (step === 0) await api.put("/candidate/privacy", { consent_processing: consent, consent_publish: publish, privacy: { show_name: !anon, searchable: publish } });
    setStep(step + 1);
    window.scrollTo(0, 0);
  });

  const startTest = () => run(async () => {
    await api.post("/candidate/survey", {
      industry: "ИТ", specialization: spec, stacks, declared_grade: grade, formats,
      experience_years: years === "" ? undefined : Number(years), salary_expect: salary ?? undefined, city: city || undefined,
    });
    navigate("/candidate/test?start=" + grade);
  });

  const uploadResume = (f: File) => run(async () => {
    const r = await api.upload("/candidate/resume", f);
    setParsed(r.parsed);
    if (r.parsed.stacks?.length) setStacks(Array.from(new Set([...stacks, ...r.parsed.stacks])));
    if (r.parsed.experience_years && years === "") setYears(r.parsed.experience_years);
  });

  const linkFsp = () => run(async () => {
    setFspMsg(null);
    const r = await api.post("/candidate/fsp/link", { fsp_id: fspId.trim() });
    setFspMsg(r.fsp.achievements.length ? `Найдено результатов: ${r.fsp.achievements.length}` : "ID привязан. Результатов пока нет — это не влияет на выдачу.");
  });

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-in">
          <Logo to="/candidate" />
          <span className="small muted hide-mobile" style={{ marginLeft: 8 }}>Анкета кандидата</span>
          <div className="row" style={{ marginLeft: "auto", gap: 18 }}>
            <A11yButton compact />
            <Link to="/candidate" className="linkbtn" style={{ whiteSpace: "nowrap" }}>Сохранить и выйти</Link>
          </div>
        </div>
      </header>

      <main className="page page-narrow" style={{ gap: 32 }}>
        <ol aria-label="Шаги анкеты" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 4, listStyle: "none", padding: 0, margin: 0 }}>
          {STEPS.map((t, i) => (
            <li key={t} aria-current={i === step ? "step" : undefined} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ height: 6, background: i <= step ? "var(--blue)" : "var(--gray-200)" }} />
              <span style={{ fontSize: 13, fontWeight: i === step ? 700 : 500, color: i <= step ? "var(--ink)" : "var(--ink-3)" }}>{t}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="col" style={{ gap: 24 }}>
            <h1 className="page-title">Две галочки<br />и поехали</h1>
            <div className="rows">
              <div className="ri" style={{ alignItems: "flex-start" }}>
                <Check checked={consent} onChange={setConsent} label={<span className="col" style={{ gap: 4 }}><span><b>Обработка персональных данных</b> <span className="muted">— обязательно</span></span><span className="small muted">Нужна, чтобы провести тест и хранить результат (152-ФЗ). Пароли храним только в виде хеша.</span></span>} />
              </div>
              <div className="ri" style={{ alignItems: "flex-start" }}>
                <Check checked={publish} onChange={setPublish} label={<span className="col" style={{ gap: 4 }}><span><b>Публикация профиля в подборках</b> <span className="muted">— по желанию</span></span><span className="small muted">Компании увидят категорию и навыки. Контакты — только после вашего согласия.</span></span>} />
              </div>
            </div>
            <div className="col" style={{ gap: 10 }}>
              <span className="label">Как показывать вас компаниям</span>
              <div className="opts" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                <button aria-pressed={anon} onClick={() => setAnon(true)}><b>Без имени</b><span className="small" style={{ opacity: .85 }}>«Кандидат #{prof.data.anon_code}». Имя откроется после принятия приглашения.</span></button>
                <button aria-pressed={!anon} onClick={() => setAnon(false)}><b>С именем</b><span className="small" style={{ opacity: .85 }}>Имя видно в подборках. Контакты — всё равно после согласия.</span></button>
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="col" style={{ gap: 28 }}>
            <div>
              <h1 className="page-title">Чем вы занимаетесь?</h1>
              <p className="page-sub">Отрасль — ИТ. Специализация и стек нужны, чтобы собрать тест; категорию определит только он.</p>
            </div>
            <div className="opts" role="group" aria-label="Специализация" style={{ gridTemplateColumns: `repeat(${Math.min(specs.length, 4)},minmax(0,1fr))` }}>
              {specs.map((s: any) => (
                <button key={s.id} aria-pressed={spec === s.id} onClick={() => setSpec(s.id)}>
                  <span className="big">{s.code}</span><b style={{ fontSize: 15 }}>{s.title}</b>
                </button>
              ))}
            </div>
            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}><span className="label">Стек</span><span className="small muted">выбрано: {stacks.length}</span></div>
              <div className="chips">{allStacks.map((t) => <button key={t} className="chip" aria-pressed={stacks.includes(t)} onClick={() => toggle(stacks, t, setStacks)}>{t}</button>)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 24 }}>
              <Field label="Хочу от, ₽ в месяц"><MoneyInput value={salary} onChange={setSalary} /></Field>
              <Field label="Опыт в ИТ, лет"><input className="input" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value === "" ? "" : Number(e.target.value.replace(",", ".")) || 0)} /></Field>
              <Field label="Город"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" /></Field>
            </div>
            <div className="col" style={{ gap: 10 }}>
              <span className="label">Формат работы — можно несколько</span>
              <div className="chips">{dict.data.formats.map((f: any) => <button key={f.id} className="chip" aria-pressed={formats.includes(f.id)} onClick={() => toggle(formats, f.id, setFormats)}>{f.title}</button>)}</div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="col" style={{ gap: 24 }}>
            <div>
              <h1 className="page-title">Резюме и ФСП</h1>
              <p className="page-sub">Оба шага необязательны. Резюме заполнит профиль, результаты соревнований ФСП усилят его в выдаче. Без истории ФСП вы ничего не теряете.</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 20 }}>
              <div className="box-dashed col" style={{ padding: 22, gap: 12 }}>
                <span className="h3">PDF-резюме</span>
                <span className="small muted">Распознаем стек, опыт и должности. Контакты до модели не доходят — маскируем их заранее.</span>
                <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && uploadResume(e.target.files[0])} />
                <button className="btn btn-outline btn-md" style={{ alignSelf: "flex-start" }} onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <><span className="spin" />Разбираю…</> : parsed ? "Загрузить другое" : "Выбрать файл"}</button>
              </div>
              <div className="col" style={{ padding: 22, gap: 12, background: "var(--blue-soft)", color: "var(--ink)" }}>
                <span className="h3 row" style={{ gap: 8 }}><img src="/brand/fsp-star-black.svg" alt="" width={20} height={19} />ID участника ФСП</span>
                <input className="input sm mono" style={{ fontSize: 16 }} value={fspId} onChange={(e) => setFspId(e.target.value)} placeholder="FSP-2025-0001" aria-label="ID участника ФСП" />
                <button className="btn btn-primary btn-md" style={{ alignSelf: "flex-start" }} onClick={linkFsp} disabled={busy || fspId.trim().length < 3}>Найти мои результаты</button>
                <span className="small" style={{ color: fspMsg ? "var(--green)" : "var(--ink-2)" }}>{fspMsg ?? "Нет истории ФСП? Профиль подтвердят тесты платформы — без штрафа."}</span>
              </div>
            </div>
            {parsed && (
              <div className="col rule-top" style={{ gap: 14, paddingTop: 20 }}>
                <span className="h3">Что нашлось в резюме</span>
                <div className="chips">
                  {(parsed.stacks ?? []).map((s: string) => <span key={s} className="chip sm" aria-pressed>{s}</span>)}
                  {(parsed.soft_skills ?? []).map((s: string) => <span key={s} className="chip sm">{s}</span>)}
                </div>
                {(parsed.experience ?? []).length > 0 && (
                  <div className="rows hair">
                    {parsed.experience.map((e: any, i: number) => <div key={i} className="ri"><span className="mono small" style={{ width: 118, flexShrink: 0 }}>{e.period}</span><span><b>{e.title ?? "—"}</b>{e.company ? `, ${e.company}` : ""}</span></div>)}
                  </div>
                )}
                {parsed.ml_hints && (
                  <div className="row" style={{ gap: 12, fontSize: 14 }}>
                    <span>По тексту похоже на <b>{SPEC_TITLES[parsed.ml_hints.specialization]}</b>{parsed.ml_hints.skills?.length ? <>; заметны: {parsed.ml_hints.skills.map((s: any) => s.title.toLowerCase()).join(", ")}</> : null}.</span>
                    {parsed.ml_hints.specialization !== spec && <button className="btn btn-outline btn-xs" onClick={() => setSpec(parsed.ml_hints.specialization)}>Выбрать {SPEC_TITLES[parsed.ml_hints.specialization]}</button>}
                  </div>
                )}
                <span className="small muted">Технологии добавлены в опрос. Резюме — только подсказка: категорию определяет тест.</span>
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="col" style={{ gap: 24 }}>
            <div>
              <h1 className="page-title">На какой грейд тест?</h1>
              <p className="page-sub">Выберите уровень, на котором вы себя видите. Тест подстроится под ответы: 8–18 коротких заданий, у каждого кандидата свои варианты.</p>
            </div>
            <div className="opts" role="group" aria-label="Грейд" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
              {GRADES.map(([id, title, num, desc]) => (
                <button key={id} aria-pressed={grade === id} onClick={() => setGrade(id)} style={{ minHeight: 150 }}>
                  <span className="big">{num}</span><b style={{ fontSize: 16 }}>{title}</b><span className="small" style={{ opacity: .85 }}>{desc}</span>
                </button>
              ))}
            </div>
            <div className="rows hair">
              <div className="ri small">Не прошли — сразу можно сдать тест на уровень ниже. Это не понижение.</div>
              <div className="ri small">Сдали уверенно — предложим тест на уровень выше.</div>
              <div className="ri small">Подтверждённый грейд меняется не чаще раза в 90 дней.</div>
            </div>
          </section>
        )}

        <ErrorBox error={error} />
        <div className="row rule-top" style={{ justifyContent: "space-between", paddingTop: 20 }}>
          {step > 0 ? <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Назад</button> : <span />}
          <div className="row" style={{ gap: 14 }}>
            {blocked && <span className="small muted">{blockedWhy}</span>}
            {step < 3
              ? <button className="btn btn-primary btn-lg" onClick={next} disabled={busy || blocked}>Дальше</button>
              : <button className="btn btn-primary btn-lg" onClick={startTest} disabled={busy}>{busy ? <><span className="spin" />Готовлю тест…</> : `Начать тест на ${GRADES.find((g) => g[0] === grade)?.[1]}`}</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
