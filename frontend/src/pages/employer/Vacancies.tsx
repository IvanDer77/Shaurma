import { useState } from "react";
import { api } from "../../api";
import { ago, FORMAT_TITLES, GRADE_TITLES, SPEC_TITLES, range } from "../../format";
import { useApi } from "../../hooks";
import { Drawer, Empty, ErrorBox, Field, MoneyInput, Skeleton, StatusPill, useToast } from "../../ui";
import { CandidateDrawer, EMPLOYER_STATUS } from "./shared";

const EMPTY = { title: "", description: "", specialization: "backend", grade: "middle", stacksStr: "", formats: ["remote"], city: "", salary_from: null as number | null, salary_to: null as number | null };

export default function Vacancies() {
  const list = useApi<any[]>("/employer/vacancies");
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [appsFor, setAppsFor] = useState<any>(null);
  const apps = useApi<any[]>(appsFor ? `/employer/vacancies/${appsFor.id}/applications` : null, [appsFor?.id]);
  const [openCand, setOpenCand] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const body = { title: edit.title, description: edit.description, stacks: edit.stacksStr.split(",").map((s: string) => s.trim()).filter(Boolean), formats: edit.formats, city: edit.city || null, salary_from: edit.salary_from, salary_to: edit.salary_to };
    try {
      if (edit.id) await api.put(`/employer/vacancies/${edit.id}`, body);
      else await api.post("/employer/vacancies", { ...body, specialization: edit.specialization, grade: edit.grade });
      setEdit(null); list.reload(); toast("Вакансия сохранена");
    } catch (e: any) { setError(e.message); }
  };
  const actApp = async (id: string, a: string) => { await api.post(`/employer/applications/${id}/${a}`); apps.reload(); list.reload(); };
  const toggleStatus = async (v: any) => { await api.put(`/employer/vacancies/${v.id}`, { status: v.status === "published" ? "closed" : "published" }); list.reload(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Вакансии</h1>
          <p className="page-sub">Дополнительный сценарий: кандидаты без приглашений откликаются сами, и их контакты сразу открыты вам. Вилка «от–до» обязательна.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => setEdit({ ...EMPTY })}>+ Новая вакансия</button>
      </div>
      {list.loading && !list.data ? <Skeleton h={200} /> : !list.data?.length ? <Empty title="Вакансий пока нет">Опубликуйте первую — её увидят кандидаты в разделе «Вакансии».</Empty> : (
        <div className="rows">
          {list.data.map((v) => (
            <div key={v.id} className="ri" style={{ opacity: v.status === "closed" ? 0.55 : 1, alignItems: "center", flexWrap: "wrap" }}>
              <div className="ri-main" style={{ gap: 5, minWidth: 260 }}>
                <span className="row" style={{ gap: 8 }}><span className="ri-title" style={{ fontWeight: 700 }}>{v.title}</span><span className="code" style={{ fontSize: 13 }}>{v.category}</span>{v.status === "closed" && <span className="small muted">закрыта</span>}</span>
                <span className="ri-sub">{[v.formats.map((f: string) => FORMAT_TITLES[f]?.toLowerCase()).join(", "), v.city, v.stacks.slice(0, 4).join(", "), ago(v.created_at)].filter(Boolean).join(", ")}</span>
                <span className="money" style={{ fontSize: 18 }}>{range(v.salary_from, v.salary_to)}</span>
              </div>
              <div className="row" style={{ gap: 14, justifyContent: "flex-end" }}>
                <button className="linkbtn" onClick={() => setEdit({ ...v, stacksStr: v.stacks.join(", "), city: v.city ?? "" })}>Изменить</button>
                <button className="linkbtn" onClick={() => toggleStatus(v)}>{v.status === "published" ? "Закрыть" : "Открыть"}</button>
                <button className={`btn btn-md ${v.new_applications ? "btn-dark" : "btn-outline"}`} onClick={() => setAppsFor(v)}>Отклики {v.applications}{v.new_applications ? ` (+${v.new_applications})` : ""}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Редактировать вакансию" : "Новая вакансия"} width={600}
        footer={<button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={save}>{edit?.id ? "Сохранить" : "Опубликовать"}</button>}>
        {edit && (
          <>
            <Field label="Название"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            {!edit.id && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Специализация"><select className="select" value={edit.specialization} onChange={(e) => setEdit({ ...edit, specialization: e.target.value })}>{Object.entries(SPEC_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select></Field>
                <Field label="Грейд"><select className="select" value={edit.grade} onChange={(e) => setEdit({ ...edit, grade: e.target.value })}>{Object.entries(GRADE_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select></Field>
              </div>
            )}
            <div className="col" style={{ gap: 8 }}><span className="label">Зарплата «от–до», ₽ в месяц — обязательно</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}><MoneyInput value={edit.salary_from} onChange={(v) => setEdit({ ...edit, salary_from: v })} aria-label="от" placeholder="от" /><MoneyInput value={edit.salary_to} onChange={(v) => setEdit({ ...edit, salary_to: v })} aria-label="до" placeholder="до" /></div>
            </div>
            <Field label="Описание"><textarea className="textarea" rows={6} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Стек — через запятую"><input className="input" value={edit.stacksStr} onChange={(e) => setEdit({ ...edit, stacksStr: e.target.value })} /></Field>
            <Field label="Город"><input className="input" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
            <span className="label">Формат</span>
            <div className="chips">{Object.entries(FORMAT_TITLES).map(([id, t]) => <button key={id} className="chip" aria-pressed={edit.formats.includes(id)} onClick={() => setEdit({ ...edit, formats: edit.formats.includes(id) ? edit.formats.filter((x: string) => x !== id) : [...edit.formats, id] })}>{t}</button>)}</div>
            <ErrorBox error={error} />
          </>
        )}
      </Drawer>
      <Drawer open={!!appsFor} onClose={() => setAppsFor(null)} title={appsFor?.title ?? ""} subtitle="Отклики" width={640}>
        {!apps.data ? <Skeleton h={160} /> : !apps.data.length ? <Empty title="Откликов пока нет" /> : (
          <div className="rows">
            {apps.data.map((a) => (
              <div key={a.id} className="ri" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row" style={{ gap: 8 }}>
                    <button onClick={() => setOpenCand(a.candidate.id)} style={{ border: 0, background: "none", padding: 0, font: "700 16px var(--sans)", cursor: "pointer", color: "var(--ink)" }}>{a.candidate.display_name}</button>
                    <span className="code" style={{ fontSize: 12 }}>{a.candidate.category}</span>
                  </span>
                  <StatusPill status={a.status} titles={EMPLOYER_STATUS} />
                </div>
                <span className="mono" style={{ fontSize: 13, color: "var(--green)", fontWeight: 600 }}>{[a.candidate.contacts?.email, a.candidate.contacts?.telegram].filter(Boolean).join(", ")}</span>
                {a.note && <p style={{ fontSize: 14, lineHeight: 1.5, borderLeft: "3px solid var(--blue)", paddingLeft: 12, margin: 0 }}>{a.note}</p>}
                {(a.status === "sent" || a.status === "viewed") && (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => actApp(a.id, "accept")}>Принять отклик</button>
                    {a.status === "sent" && <button className="btn btn-outline btn-sm" onClick={() => actApp(a.id, "view")}>Отметить просмотренным</button>}
                    <button className="linkbtn" onClick={() => actApp(a.id, "decline")}>Отклонить</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Drawer>
      <CandidateDrawer id={openCand} onClose={() => setOpenCand(null)} onInvite={() => setOpenCand(null)} />
    </>
  );
}
