import { useRef, useState } from "react";
import { api } from "../../api";
import { dateShort } from "../../format";
import { useApi } from "../../hooks";
import { CodeBlock, Drawer, Empty, ErrorBox, Skeleton, useToast } from "../../ui";

export default function Tasks() {
  const tasks = useApi<any[]>("/candidate/tasks");
  const dict = useApi<any>("/dict");
  const [cur, setCur] = useState<any>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [approach, setApproach] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const toast = useToast();

  const openTask = async (id: string) => {
    setError(null); setResult(null); setChoice(null); setApproach("");
    try {
      const v = await api.post(`/candidate/tasks/${id}/start`);
      setCur(v);
      t0.current = Date.now();
    } catch (e: any) { setError(e.message); }
  };
  const submit = async () => {
    try {
      const r = await api.post(`/candidate/tasks/${cur.task.id}/submit`, { option: choice, approach: approach || undefined, seconds: (Date.now() - t0.current) / 1000 });
      setResult(r);
      tasks.reload();
      toast(r.correct ? "Верно! Рейтинг по ингредиентам обновлён" : "Решение отправлено — рейтинг обновлён");
    } catch (e: any) { setError(e.message); }
  };

  const list = tasks.data ?? [];
  const open = list.filter((t) => !t.submitted_at);
  const done = list.filter((t) => t.submitted_at);
  const row = (t: any) => (
    <div key={t.id} className="ri" style={{ alignItems: "flex-start", gap: 24 }}>
      <div className="ri-main" style={{ gap: 6 }}>
        <span className="tag-line">
          {t.kind === "system" ? <span style={{ color: "var(--blue)", fontWeight: 700 }}>свежая начинка, только для вас</span>
            : <>{t.company_name}, слепая дегустация{t.offered_at && !t.submitted_at ? <b style={{ color: "var(--sauce-ink)" }}>, предложено вам</b> : null}</>}
          {" "}· до {dateShort(t.deadline)}
        </span>
        <span className="ri-title" style={{ fontSize: 18 }}>{t.title}</span>
        <span className="ri-sub" style={{ lineHeight: 1.5, maxWidth: 720 }}>{t.description}</span>
        <span className="vtag" style={{ marginTop: 2, whiteSpace: "normal" }}>{t.ingredients.map((i: string) => dict.data?.ingredients[i]?.title ?? i).join(", ")}</span>
      </div>
      {t.submitted_at
        ? <span className={t.correct ? "badge-ok" : "small muted"} style={{ whiteSpace: "nowrap", paddingTop: 4 }}>{t.correct ? "✓ решено верно" : "решение отправлено"}</span>
        : <button className={`btn btn-md ${t.kind === "system" ? "btn-primary" : "btn-dark"}`} onClick={() => openTask(t.id)}>Решить</button>}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div className="col" style={{ gap: 8 }}>
          <h1 className="page-title">Задачи</h1>
          <p className="page-sub">Раз в неделю — одна задача под вашу категорию. Сначала от компании, которая ищет людей («Слепая дегустация»: решение она видит без имени и может пригласить автора), иначе — «Свежая начинка» по навыку, который остыл или ещё не подтверждён. Вариант у каждого свой.</p>
        </div>
      </div>
      <ErrorBox error={!cur ? error : null} />
      {tasks.loading && !tasks.data ? <Skeleton h={200} /> : !list.length ? (
        <Empty title="Задач пока нет">Задачи появляются после подтверждения категории. Компании публикуют их регулярно — загляните позже.</Empty>
      ) : (
        <>
          <section className="col" style={{ gap: 10 }}>
            <h2 className="h3">Открытые <span className="muted">{open.length}</span></h2>
            {open.length ? <div className="rows">{open.map(row)}</div> : <p className="muted small">Всё решено. Следующая задача — через неделю.</p>}
          </section>
          {done.length > 0 && (
            <section className="col" style={{ gap: 10 }}>
              <h2 className="h3">Решённые <span className="muted">{done.length}</span></h2>
              <div className="rows">{done.map(row)}</div>
            </section>
          )}
        </>
      )}
      <Drawer open={!!cur} onClose={() => setCur(null)} title={cur?.task.title ?? ""} subtitle={cur?.task.kind === "system" ? "Свежая начинка, проверка запуском кода" : `Слепая дегустация, ${cur?.task.company_name ?? "компания"} увидит решение без имени`} width={720}
        footer={cur && !result && !cur.submitted ? <button className="btn btn-primary" style={{ flex: 1 }} disabled={!choice} onClick={submit}>Отправить решение</button> : undefined}>
        {cur && (
          <>
            <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.45 }}>{cur.prompt}</span>
            <CodeBlock code={cur.code} />
            <div className="answers" role="radiogroup" aria-label="Варианты ответа">
              {cur.options.map((o: any) => (
                <button key={o.id} role="radio" aria-checked={choice === o.id} className={`answer${result && o.id === result.correct_option ? " right" : ""}`} disabled={!!result || cur.submitted} onClick={() => setChoice(o.id)}>
                  <span className="key">{o.id}</span><span style={{ flex: 1 }}>{o.label}</span>
                </button>
              ))}
            </div>
            {cur.task.approach_question && !result && !cur.submitted && (
              <label className="field"><span className="label">{cur.task.approach_question}</span><textarea className="textarea" rows={4} value={approach} onChange={(e) => setApproach(e.target.value)} placeholder="Опишите подход в 2–5 предложениях (по желанию)" /></label>
            )}
            {result && <div className={`note ${result.correct ? "note-ok" : ""}`}>{result.correct ? "✓ Верно." : `Правильный ответ: ${result.correct_option}.`} {cur.task.kind === "system" ? "Рейтинг навыка обновлён — следующая «свежая начинка» через неделю." : "Компания увидит обезличенное решение и может пригласить вас."}</div>}
            {cur.submitted && !result && <div className="note">Решение уже отправлено.</div>}
            <ErrorBox error={error} />
          </>
        )}
      </Drawer>
    </>
  );
}
