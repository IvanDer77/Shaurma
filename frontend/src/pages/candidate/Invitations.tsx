import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SpeakButton } from "../../a11y";
import { api } from "../../api";
import { ago, range } from "../../format";
import { useApi } from "../../hooks";
import { Empty, ErrorBox, Segmented, Skeleton, StatusPill, useToast } from "../../ui";

type Filter = "all" | "new" | "accepted" | "declined";

export default function Invitations() {
  const { data, reload, loading } = useApi<any>("/candidate/invitations");
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobile, setMobile] = useState(() => window.innerWidth < 760);
  const toast = useToast();
  useEffect(() => { const h = () => setMobile(window.innerWidth < 760); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  const items: any[] = data?.items ?? [];
  const list = items.filter((i) => filter === "all" || (filter === "new" ? i.status === "sent" || i.status === "viewed" : i.status === filter));
  const open = items.find((i) => i.id === openId) ?? (!mobile ? list[0] : undefined);
  const fresh = items.filter((i) => i.status === "sent").length;

  // открыли приглашение — для компании оно становится «просмотрено»
  useEffect(() => {
    if (open && open.status === "sent") api.post(`/candidate/invitations/${open.id}/view`).then(() => reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, open?.status]);

  const select = (id: string | null) => { setOpenId(id); setDeclining(false); setError(null); setParams(id ? { open: id } : {}, { replace: true }); };
  const act = async (path: string, body?: unknown, msg?: string) => {
    setError(null);
    try {
      await api.post(`/candidate/invitations/${open.id}/${path}`, body ?? {});
      await reload();
      if (msg) toast(msg);
      setDeclining(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading && !data) return <Skeleton h={420} />;
  if (!items.length) return <><h1 className="page-title">Приглашения</h1><Empty title="Здесь пока пусто">Когда компания выберет вас в подборке, приглашение с вилкой зарплаты появится здесь и на почте.</Empty></>;

  const showList = !mobile || !openId;
  const showDetail = !mobile || !!openId;
  return (
    <section style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0,1fr)" : "minmax(280px, 360px) minmax(0, 1fr)", border: "var(--rule)", background: "var(--white)", minHeight: 560 }}>
      {showList && (
        <div style={{ borderRight: mobile ? 0 : "var(--rule)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "18px 16px", borderBottom: "var(--rule)", display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h1 className="h2">Приглашения</h1><span className="small muted">{fresh} новых, {items.length} всего</span></div>
            <Segmented value={filter} onChange={setFilter} label="Фильтр" options={[{ id: "all", t: "Все" }, { id: "new", t: "Новые" }, { id: "accepted", t: "Принятые" }, { id: "declined", t: "Архив" }]} />
          </div>
          {list.map((o) => {
            const on = open?.id === o.id;
            return (
              <button key={o.id} onClick={() => select(o.id)} aria-current={on ? "true" : undefined}
                style={{ textAlign: "left", border: 0, borderBottom: "var(--hair)", padding: "16px", background: on ? "var(--blue)" : "transparent", color: on ? "#fff" : "var(--ink)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <span style={{ fontWeight: 700 }}>{o.company.name}</span>
                  <StatusPill status={o.status} onDark={on} />
                </span>
                <span className="small" style={{ color: on ? "#E3E0FF" : "var(--ink-2)" }}>{o.title}</span>
                <span className="money" style={{ fontSize: 14 }}>{range(o.salary_from, o.salary_to)}</span>
              </button>
            );
          })}
          {!list.length && <p className="small muted" style={{ padding: 16 }}>В этом статусе приглашений нет.</p>}
        </div>
      )}

      {showDetail && open && (
        <article style={{ padding: "clamp(20px, 3vw, 36px)", display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
          {mobile && <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => select(null)}>Все приглашения</button>}
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="col" style={{ gap: 6 }}>
              <span className="row" style={{ gap: 10 }}><span className="h2" style={{ fontFamily: "var(--sans)", fontSize: 21 }}>{open.company.name}</span>{open.company.honest_badge && <span className="honest">₽ честный ценник</span>}</span>
              <span style={{ fontSize: 16 }}>{open.title}{open.company.sphere ? <span className="muted">, {open.company.sphere}</span> : null}</span>
            </div>
            <StatusPill status={open.status} />
          </div>

          <div className="col" style={{ gap: 6 }}>
            <span className="money-xl">{range(open.salary_from, open.salary_to)}</span>
            <span className="small muted">в месяц до вычета налогов, {ago(open.created_at)}{open.source === "tasting" ? ", по вашему решению задачи" : ""}{open.vacancy ? `, вакансия «${open.vacancy.title}»` : ""}</span>
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.6, whiteSpace: "pre-wrap", maxWidth: 680 }}>{open.description}</p>

          {(open.skills?.length > 0 || open.why?.length > 0) && (
            <div className="col rule-top" style={{ gap: 12, paddingTop: 18, maxWidth: 620 }}>
              <span style={{ fontWeight: 700 }}>Почему вы</span>
              {open.skills?.length ? open.skills.map((s: any) => (
                <div key={s.title} style={{ display: "grid", gridTemplateColumns: "1fr 140px 44px", gap: 14, alignItems: "center", fontSize: 15 }}>
                  <span>{s.title}</span>
                  <span className="pbar"><div style={{ width: `${s.pct}%` }} /></span>
                  <span className="num" style={{ textAlign: "right", fontSize: 14 }}>{s.pct}%</span>
                </div>
              )) : open.why.map((w: string) => <span key={w} style={{ fontSize: 15 }}>— {w}</span>)}
            </div>
          )}

          <div className="row" style={{ gap: 6 }}><span className="muted">Связь:</span><b>{open.contact_method}</b></div>

          {(open.status === "sent" || open.status === "viewed") && !declining && (
            <div className="row">
              <button className="btn btn-primary btn-lg" onClick={() => act("accept", {}, `Принято. «${open.company.name}» видит ваши контакты`)}>Принять</button>
              <button className="btn btn-outline btn-lg" onClick={() => setDeclining(true)}>Отклонить</button>
              <SpeakButton text={`${open.company.name}. ${open.title}. Зарплата от ${open.salary_from} до ${open.salary_to} рублей. ${open.description}`} />
            </div>
          )}
          {declining && (
            <div className="col box" style={{ padding: 18, gap: 12 }}>
              <span style={{ fontWeight: 700 }}>Почему отказываете? Компания увидит только причину.</span>
              <div className="chips">{(data?.reasons ?? []).map((r: string) => <button key={r} className="chip sm" onClick={() => act("decline", { reason: r }, "Отклонено, причину передали")}>{r}</button>)}</div>
              <button className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setDeclining(false)}>Отмена</button>
            </div>
          )}
          {open.status === "accepted" && (
            <>
              <div className="note-ok note"><b>Приглашение принято.</b> Контакты открыты компании — ждите сообщения: {open.contact_method}.</div>
              {open.salary_honest === null ? (
                <div className="col box-dashed" style={{ padding: 18, gap: 12 }}>
                  <span style={{ fontWeight: 700 }}>«Ценник не врёт»: на собеседовании зарплата совпала с вилкой?</span>
                  <div className="row">
                    <button className="btn btn-outline btn-md" onClick={() => act("salary-check", { honest: true }, "Спасибо — репутация компании учтёт ответ")}>Да, совпала</button>
                    <button className="btn btn-outline btn-md" onClick={() => act("salary-check", { honest: false }, "Спасибо — компания потеряет бейдж «Честный ценник»")}>Нет, предложили меньше</button>
                  </div>
                </div>
              ) : <span className="small muted">Ваша оценка зарплаты: {open.salary_honest ? "совпала ✓" : "не совпала"}</span>}
            </>
          )}
          {open.status === "declined" && <span className="muted">Вы отклонили приглашение{open.decline_reason ? `: «${open.decline_reason}»` : ""}.</span>}
          {!open.company.honest_badge && <span className="small warn">Кандидаты сообщали, что зарплата на собеседовании была ниже вилки.</span>}
          <ErrorBox error={error} />
        </article>
      )}
    </section>
  );
}
