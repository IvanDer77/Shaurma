import { useState } from "react";
import { api, qs } from "../../api";
import { ago, FORMAT_TITLES, range } from "../../format";
import { useApi } from "../../hooks";
import { Drawer, Empty, ErrorBox, Field, Skeleton, StatusPill, Tabs, useToast } from "../../ui";

export default function Vacancies() {
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [spec, setSpec] = useState("");
  const [grade, setGrade] = useState("");
  const [q, setQ] = useState("");
  const dict = useApi<any>("/dict");
  const list = useApi<any[]>(`/vacancies${qs({ specialization: spec, grade, q })}`, [spec, grade, q]);
  const mine = useApi<any[]>("/candidate/applications");
  const [open, setOpen] = useState<any>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const apply = async () => {
    setError(null);
    try {
      await api.post(`/vacancies/${open.id}/apply`, { note: note || undefined });
      toast("Отклик отправлен — компания увидит ваши контакты");
      setOpen(null); setNote(""); list.reload(); mine.reload();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <div>
        <h1 className="page-title">Вакансии</h1>
        <p className="page-sub">Пока приглашений нет, можно проявить инициативу. В каждой вакансии указана вилка зарплаты. Откликаясь, вы открываете компании контакты.</p>
      </div>
      <Tabs value={tab} onChange={setTab} options={[{ id: "all", t: "Все вакансии", count: list.data?.length }, { id: "mine", t: "Мои отклики", count: mine.data?.length }]} />
      {tab === "all" ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input className="input boxed" style={{ flex: 1, minWidth: 0 }} placeholder="Поиск: должность или текст вакансии" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
            <select className="select boxed" value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="Специализация">
              <option value="">Все направления</option>
              {(dict.data?.specializations ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <select className="select boxed hide-mobile" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Грейд">
              <option value="">Любой грейд</option>
              {(dict.data?.grades ?? []).map((g: any) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          {list.loading && !list.data ? <Skeleton h={200} /> : !list.data?.length ? <Empty title="Вакансий не найдено">Попробуйте убрать фильтры или изменить запрос.</Empty> : (
            <div className="rows">
              {list.data.map((v) => (
                <div key={v.id} className="ri" style={{ alignItems: "center", gap: 20 }}>
                  <button className="ri-main" onClick={() => setOpen(v)} style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: "inherit", gap: 5 }}>
                    <span className="row" style={{ gap: 8 }}><span className="ri-title" style={{ fontWeight: 700 }}>{v.title}</span><span className="code" style={{ fontSize: 13 }}>{v.category}</span>{!v.honest_badge && <span className="small warn">зарплата бывала ниже вилки</span>}</span>
                    <span className="ri-sub">{[v.company_name, v.formats.map((f: string) => FORMAT_TITLES[f]?.toLowerCase()).join(", "), v.stacks.slice(0, 4).join(", ")].filter(Boolean).join(", ")}</span>
                    <span className="money" style={{ fontSize: 20 }}>{range(v.salary_from, v.salary_to)}</span>
                  </button>
                  <div className="col" style={{ alignItems: "flex-end", gap: 6 }}>
                    {v.my_application ? <StatusPill status={v.my_application} titles={{ sent: "отклик отправлен" }} /> : <button className="btn btn-primary btn-md" onClick={() => setOpen(v)}>Откликнуться</button>}
                    <span className="small muted">{ago(v.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : !mine.data?.length ? <Empty title="Откликов пока нет">Откликнитесь на вакансию — статус появится здесь.</Empty> : (
        <div className="rows">
          {mine.data.map((a) => (
            <div key={a.id} className="ri">
              <div className="ri-main"><span className="ri-title">{a.title}</span><span className="ri-sub">{a.company_name}, {ago(a.created_at)}</span></div>
              <span className="money hide-mobile" style={{ fontSize: 16 }}>{range(a.salary_from, a.salary_to)}</span>
              <StatusPill status={a.status} titles={{ sent: "отправлен" }} />
            </div>
          ))}
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `${open.company_name}, ${open.category}` : ""}
        footer={open && !open.my_application ? <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={apply}>Откликнуться</button> : undefined}>
        {open && (
          <>
            <div className="col" style={{ gap: 4 }}>
              <span className="money-xl" style={{ fontSize: 30 }}>{range(open.salary_from, open.salary_to)}</span>
              {open.honest_badge && <span className="honest" style={{ alignSelf: "flex-start" }}>₽ честный ценник</span>}
              <span className="small muted">в месяц до вычета налогов, {open.formats.map((f: string) => FORMAT_TITLES[f]?.toLowerCase()).join(", ")}</span>
            </div>
            <span style={{ fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{open.description}</span>
            {open.stacks?.length > 0 && <div className="chips">{open.stacks.map((s: string) => <span key={s} className="chip sm">{s}</span>)}</div>}
            {open.my_application ? <div className="note">Вы уже откликнулись. Статус: <StatusPill status={open.my_application} /></div> : (
              <>
                <Field label="Сопроводительное сообщение — по желанию"><textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Чем вам интересна задача" /></Field>
                <div className="note">Откликаясь, вы открываете компании свои контакты и паспорт навыков.</div>
              </>
            )}
            <ErrorBox error={error} />
          </>
        )}
      </Drawer>
    </>
  );
}
