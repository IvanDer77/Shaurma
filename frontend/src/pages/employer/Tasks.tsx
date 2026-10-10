import { useState } from "react";
import { api } from "../../api";
import { dateShort, GRADE_TITLES, rub } from "../../format";
import { useApi } from "../../hooks";
import { Drawer, Empty, ErrorBox, Field, Skeleton, StatusPill, useToast } from "../../ui";
import { EMPLOYER_STATUS, InviteDrawer } from "./shared";

export default function Tasks() {
  const tasks = useApi<any[]>("/employer/tasks");
  const needs = useApi<any[]>("/employer/needs");
  const dict = useApi<any>("/dict");
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ need_id: "", title: "", description: "", approach_question: "", days: 7 });
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const subs = useApi<any>(openTask ? `/employer/tasks/${openTask}/submissions` : null, [openTask]);
  const [inviting, setInviting] = useState<any>(null);

  const create = async () => {
    setError(null);
    try {
      await api.post("/employer/tasks", { ...form, approach_question: form.approach_question || undefined });
      setCreating(false); tasks.reload(); toast("Задача опубликована для категории");
    } catch (e: any) { setError(e.message); }
  };
  const need = needs.data?.find((n) => n.id === subs.data?.task.need_id);

  const SPEC = { backend: "BE", frontend: "FE", data: "DS" } as Record<string, string>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Слепая<br />дегустация</h1>
          <p className="page-sub">Публикуете короткую задачу для категории — видите решения без имён. У каждого кандидата свой вариант, собранный по рецепту вашей потребности. Имя откроется, когда пригласите автора.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => { setCreating(true); setForm({ ...form, need_id: needs.data?.[0]?.id ?? "" }); }}>+ Новая задача</button>
      </div>
      {tasks.loading && !tasks.data ? <Skeleton h={200} /> : !tasks.data?.length ? <Empty title="Задач пока нет">Опубликуйте первую — кандидаты получат её на неделе, а вы — свежий сигнал о навыках.</Empty> : (
        <div className="rows">
          {tasks.data.map((t) => (
            <div key={t.id} className="ri">
              <div className="ri-main">
                <span className="ri-title" style={{ fontWeight: 700 }}>{t.title} <span className="code" style={{ fontSize: 12, marginLeft: 6 }}>{SPEC[t.specialization]}·{t.grade ? GRADE_TITLES[t.grade].slice(0, 3).toUpperCase() : "ALL"}</span></span>
                <span className="ri-sub">{t.ingredients.map((i: string) => dict.data?.ingredients[i]?.title ?? i).join(", ")}, до {dateShort(t.deadline)}</span>
              </div>
              <button className="btn btn-outline btn-md" onClick={() => setOpenTask(t.id)}>Решения {t.submissions}</button>
            </div>
          ))}
        </div>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title="Новая регулярная задача" width={560}
        footer={<button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={create} disabled={!form.need_id || form.title.length < 3}>Опубликовать</button>}>
        <Field label="По какой потребности собрать задачу" hint="Шаблон и мутации подбираются под ингредиенты рецепта и грейд">
          <select className="select" value={form.need_id} onChange={(e) => setForm({ ...form, need_id: e.target.value })}>
            <option value="">—</option>{(needs.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        </Field>
        <Field label="Название"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Повторная доставка событий" /></Field>
        <Field label="Описание для кандидатов"><textarea className="textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Вопрос «предложите подход» (необязательно)"><input className="input" value={form.approach_question} onChange={(e) => setForm({ ...form, approach_question: e.target.value })} placeholder="Как бы вы сделали обработку идемпотентной?" /></Field>
        <Field label="Срок, дней"><input className="input" type="number" min={1} max={30} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} /></Field>
        <ErrorBox error={error} />
      </Drawer>

      <Drawer open={!!openTask} onClose={() => setOpenTask(null)} title={subs.data?.task.title ?? "Решения"} subtitle="Решения без имён, имя откроется после приглашения" width={760}>
        {!subs.data ? <Skeleton h={200} /> : !subs.data.items.length ? <Empty title="Решений пока нет">Кандидаты получают задачу в течение недели.</Empty> : (
          <div className="rows">
            {subs.data.items.map((s: any) => (
              <div key={s.submission_id} className="ri" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row" style={{ gap: 10 }}><b>{s.label}</b><span className="code" style={{ fontSize: 12 }}>{s.category}</span>{s.correct ? <span className="badge-ok">✓ верно</span> : <span className="small muted">неверно</span>}</span>
                  <span className="mono small muted">рейтинг {s.rating}, {Math.round(s.seconds ?? 0)} с</span>
                </div>
                {s.approach && <p style={{ fontSize: 14, lineHeight: 1.55, borderLeft: "3px solid var(--blue)", paddingLeft: 12, margin: 0 }}>{s.approach}</p>}
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small muted">{s.salary_expect ? `ожидания от ${rub(s.salary_expect)}` : "ожидания скрыты"}{s.queue ? `, других приглашений у кандидата: ${s.queue}` : ""}</span>
                  {s.invitation_status ? <StatusPill status={s.invitation_status} titles={EMPLOYER_STATUS} /> : <button className="btn btn-primary btn-sm" onClick={() => setInviting(s)}>Пригласить автора</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
      <InviteDrawer candidate={inviting} need={need} source="tasting" submitPath={inviting ? `/employer/tasks/${openTask}/submissions/${inviting.submission_id}/invite` : undefined}
        onClose={() => setInviting(null)} onSent={() => { setInviting(null); subs.reload(); }} />
    </>
  );
}
