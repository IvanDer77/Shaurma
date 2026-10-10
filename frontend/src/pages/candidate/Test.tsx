import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { date, GRADE_TITLES, SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { CodeBlock, ErrorBox, PageHead, Spinner } from "../../ui";
import { PixelCode } from "./Dashboard";

/** Грейды: номер для пиксельной цифры и короткое описание уровня. */
export const GRADES: [string, string, string, string][] = [
  ["intern", "Intern", "0", "Учусь на реальных задачах"],
  ["junior", "Junior", "1", "Делаю задачи по описанию"],
  ["middle", "Middle", "2", "Веду фичу от задачи до прода"],
  ["senior", "Senior", "3", "Проектирую, отвечаю за надёжность"],
];

export default function Test() {
  const [params, setParams] = useSearchParams();
  const prof = useApi<any>("/candidate/profile");
  const dict = useApi<any>("/dict");
  const sessions = useApi<any[]>("/candidate/tests");
  const [session, setSession] = useState<any>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extraSpec, setExtraSpec] = useState<string>("");
  const shownAt = useRef(Date.now());
  const started = useRef(false);
  const navigate = useNavigate();

  const start = async (grade: string, specialization?: string) => {
    setError(null);
    setBusy(true);
    try {
      const s = await api.post("/candidate/tests", { declared_grade: grade, specialization });
      setSession(s);
      setChoice(null);
      shownAt.current = Date.now();
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const g = params.get("start");
    if (g && !started.current) {
      started.current = true;
      setParams({}, { replace: true });
      start(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session || !sessions.data) return;
    const active = sessions.data.find((s) => s.status === "active");
    if (active) api.get(`/candidate/tests/${active.id}`).then(setSession);
  }, [sessions.data, session]);

  const answer = async () => {
    if (!choice || !session?.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.post(`/candidate/tests/${session.id}/answer`, { item_id: session.current.id, option: choice, seconds: (Date.now() - shownAt.current) / 1000 });
      setSession(s);
      setChoice(null);
      shownAt.current = Date.now();
      window.scrollTo({ top: 0 });
      if (s.status === "finished") { prof.reload(); sessions.reload(); }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // клавиши 1–4 выбирают вариант, Enter — ответ
  useEffect(() => {
    if (session?.status !== "active" || !session.current) return;
    const opts = session.current.options as { id: string }[];
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= opts.length) setChoice(opts[n - 1].id);
      if (e.key === "Enter" && choice) answer();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, choice, busy]);

  if (!prof.data || !dict.data) return <Spinner />;
  const p = prof.data;
  if (!p.onboarding.survey) {
    return (
      <>
        <PageHead title="Тест на грейд" sub="Сначала короткий опрос: специализация, стек и предполагаемый грейд." />
        <Link to="/candidate/onboarding" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Пройти опрос</Link>
      </>
    );
  }

  // ---------- Прохождение ----------
  if (session?.status === "active" && session.current) {
    const it = session.current;
    const pr = session.progress;
    const ingr = it.ingredients.map((i: string) => dict.data.ingredients[i]?.title ?? i);
    return (
      <div className="col" style={{ gap: 22, maxWidth: 860 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="h3">Тест на {session.declared_grade_title}, {session.specialization_title ?? p.specialization_title}</span>
            <span className="small muted">минимум {pr.min}, максимум {pr.max} — тест остановится, когда оценка станет точной</span>
          </div>
          <span style={{ font: "400 44px/1 var(--pixel)" }}>{pr.answered + 1}<span style={{ fontSize: 18, color: "var(--ink-2)" }}> /{pr.min}+</span></span>
        </div>
        <div className="ticks" aria-label={`Отвечено ${pr.answered} из минимум ${pr.min}`}>
          {Array.from({ length: Math.max(pr.min, pr.answered + 1) }, (_, i) => <span key={i} className={i < pr.answered ? "on" : ""} />)}
        </div>
        <span className="tag-line">{[it.kind === "bug" ? "найди дефект" : "что выведет код", it.language, ...ingr].join(", ")}</span>
        <h1 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.45 }}>{it.prompt}</h1>
        <CodeBlock code={it.code} />
        <div className="answers" role="radiogroup" aria-label="Варианты ответа">
          {it.options.map((o: any) => (
            <button key={o.id} role="radio" aria-checked={choice === o.id} className="answer" onClick={() => setChoice(o.id)}>
              <span className="key">{o.id}</span><span style={{ flex: 1 }}>{o.label}</span>
            </button>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="col" style={{ gap: 4 }}>
            <button className="btn btn-primary btn-lg" disabled={!choice || busy} onClick={answer}>{busy ? <><span className="spin" />Проверяю…</> : "Ответить"}</button>
            <span className="why">{!choice ? "Выберите вариант — клавиши 1–4" : "Вариант уникален для вас, ответ проверяется запуском кода"}</span>
          </div>
          <button className="linkbtn" onClick={async () => { await api.post(`/candidate/tests/${session.id}/abandon`); setSession(null); sessions.reload(); }}>Прервать тест</button>
        </div>
      </div>
    );
  }

  // ---------- Итог ----------
  if (session?.status === "finished") {
    const d = session.decision;
    const ok = d.status === "confirmed";
    const right = (session.review ?? []).filter((r: any) => r.correct).length;
    return (
      <div className="col" style={{ gap: 26, maxWidth: 860 }}>
        {ok ? (
          <div className="tiles" style={{ gridTemplateColumns: "1fr" }}>
            <div style={{ gap: 16 }}>
              <span className="tile-label">Грейд подтверждён, {session.specialization_title}, {GRADE_TITLES[d.grade]}</span>
              <PixelCode code={session.category ?? p.category} size="clamp(64px, 12vw, 132px)" />
              <span style={{ fontSize: 15, lineHeight: 1.55, maxWidth: 560 }}>Тест подтвердил уровень с вероятностью {Math.round(d.p_declared * 100)}% по {d.n_items} заданиям. Компании уже видят вас в этой категории.</span>
            </div>
          </div>
        ) : (
          <div className="col" style={{ gap: 12 }}>
            <h1 className="page-title">Пока не подтверждается.<br /><span style={{ color: "var(--blue)" }}>Это не понижение.</span></h1>
            <p style={{ fontSize: 16 }}>Уровень {GRADE_TITLES[d.declared_grade]} по {d.n_items} заданиям не подтвердился. Можно сразу пройти тест на уровень ниже — грейд не понижается принудительно.</p>
          </div>
        )}
        <div className="row">
          {ok && d.upgrade_offer && <button className="btn btn-primary btn-lg" onClick={() => start(d.upgrade_offer, session.specialization)} disabled={busy}>Вы справились уверенно — тест на {GRADE_TITLES[d.upgrade_offer]}</button>}
          {!ok && d.retake_lower && <button className="btn btn-primary btn-lg" onClick={() => start(d.retake_lower, session.specialization)} disabled={busy}>Пройти тест на {GRADE_TITLES[d.retake_lower]}</button>}
          <button className="btn btn-outline btn-lg" onClick={() => navigate("/candidate")}>В кабинет</button>
        </div>
        <ErrorBox error={error} />
        {session.antileak?.suspicious && <div className="note">В ответах есть нетипичные совпадения. Это не бан: компания может попросить коротко объяснить решение.</div>}
        <div className="col" style={{ gap: 10 }}>
          <span className="h3">Разбор: {right} из {session.review?.length ?? 0}</span>
          <div className="rows">
            {session.review?.map((r: any) => (
              <div key={r.position} className="ri" style={{ padding: "11px 0", gap: 20 }}>
                <span style={{ width: 18, fontWeight: 700, color: r.correct ? "var(--green)" : "var(--ink-3)" }}>{r.correct ? "✓" : "×"}</span>
                <span className="mono small" style={{ width: 36, color: "var(--ink-2)" }}>№{r.position}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{r.title}</span>
                <span className="tag-line hide-mobile">{r.ingredients.map((i: string) => dict.data.ingredients[i]?.title ?? i).join(", ")}</span>
              </div>
            ))}
          </div>
          <span className="small muted">Результаты обновили рейтинг каждого навыка (Glicko-2).</span>
        </div>
      </div>
    );
  }

  // ---------- Старт ----------
  const locked = p.grade && !p.grade_change_available;
  const cats: any[] = p.categories ?? [];
  const others = Object.keys(SPEC_TITLES).filter((s) => s !== p.specialization);
  const spec2 = extraSpec || others[0];
  const cur2 = cats.find((c) => c.specialization === spec2);
  return (
    <>
      <PageHead title="Тест на грейд" sub={<>{p.specialization_title}, {p.category ? <>сейчас <span className="code">{p.category}</span></> : "категория ещё не присвоена"}</>} />
      {locked && <div className="note" style={{ alignSelf: "flex-start" }}>Грейд подтверждён {date(p.grade_confirmed_at)}. Сменить можно с {date(p.grade_locked_until)} — раз в 90 дней.</div>}
      {p.grade_status === "not_confirmed" && !p.grade && <div className="note note-warn" style={{ alignSelf: "flex-start" }}>Грейд {p.last_test?.declared_grade_title} не подтверждён. Это не понижение: попробуйте уровень ниже или вернитесь к этому позже.</div>}
      <div className="opts" style={{ gridTemplateColumns: "repeat(4, 1fr)", background: "transparent" }} role="group" aria-label="Выберите грейд">
        {GRADES.map(([id, t, n, desc]) => {
          const isCur = p.grade === id;
          const off = busy || isCur || !!locked;
          return (
            <div key={id} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, borderLeft: id === "intern" ? 0 : "var(--rule)", background: isCur ? "var(--blue)" : "transparent", color: isCur ? "#fff" : "var(--ink)" }} className="grade-col">
              <span style={{ font: "400 44px/1 var(--pixel)" }}>{n}</span>
              <span style={{ font: "700 18px var(--mono)" }}>{t}</span>
              <span style={{ fontSize: 14, minHeight: 42 }}>{desc}{p.declared_grade === id && !isCur ? <span className="sauce">, заявлен</span> : null}</span>
              <button className={`btn btn-md ${isCur ? "btn-outline" : "btn-outline"}`} style={isCur ? { borderColor: "#fff", color: "#fff" } : undefined} disabled={off} onClick={() => start(id)} title={isCur ? "Уже подтверждён" : locked ? `Сменить грейд можно с ${date(p.grade_locked_until)}` : undefined}>
                {isCur ? "подтверждён" : "начать тест"}
              </button>
            </div>
          );
        })}
      </div>
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginTop: -14 }}>8–18 заданий, тест подстраивается под ответы. Вариант у каждого свой — подглядеть негде. Клавиши 1–4 и Enter. <Link to="/method">Как устроен тест</Link></p>

      {p.grade && (
        <section className="col rule-top" style={{ gap: 14, paddingTop: 22 }}>
          <h2 className="h2">Дополнительная категория</h2>
          <p className="muted" style={{ maxWidth: 680 }}>Работаете на стыке направлений? Подтвердите вторую специализацию отдельным тестом — компании увидят вас в обеих подборках. Рейтинги навыков общие, у каждой категории свои 90 дней.</p>
          <div className="chips">
            {others.map((s) => {
              const c = cats.find((x) => x.specialization === s);
              return <button key={s} className="chip" aria-pressed={spec2 === s} onClick={() => setExtraSpec(s)}>{SPEC_TITLES[s]}{c ? `, ${c.code}` : ""}</button>;
            })}
          </div>
          {cur2 && !cur2.change_available && <div className="note" style={{ alignSelf: "flex-start" }}>Категория {cur2.code} подтверждена {date(cur2.confirmed_at)}. Сменить грейд в ней можно с {date(cur2.locked_until)}.</div>}
          <div className="row">
            {GRADES.map(([id, t]) => {
              const isCur = cur2?.grade === id;
              const off = busy || isCur || (cur2 && !cur2.change_available);
              return <button key={id} className="btn btn-outline btn-md" disabled={!!off} onClick={() => start(id, spec2)}>{t}{isCur ? ", подтверждён" : ""}</button>;
            })}
          </div>
        </section>
      )}

      {sessions.data && sessions.data.some((s) => s.status === "finished") && (
        <section className="col" style={{ gap: 10 }}>
          <h2 className="h2">История попыток</h2>
          <div className="rows hair">
            {sessions.data.filter((s) => s.status === "finished").map((s) => (
              <div key={s.id} className="ri">
                <span className="ri-main">{date(s.finished_at)}, тест на {GRADE_TITLES[s.declared_grade]}{s.specialization !== p.specialization ? `, ${SPEC_TITLES[s.specialization]}` : ""}</span>
                {s.decision?.status === "confirmed" ? <span className="badge-ok">✓ подтверждён</span> : <span className="small muted">не подтверждён</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
