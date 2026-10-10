import { useState } from "react";
import { api } from "../../api";
import { ago, range } from "../../format";
import { useApi } from "../../hooks";
import { Empty, Segmented, Skeleton, StatusPill, useToast } from "../../ui";
import { CandidateDrawer, EMPLOYER_STATUS } from "./shared";

const COLS: [string, string, string][] = [
  ["sent", "отправлено", "var(--blue)"],
  ["viewed", "просмотрено", "var(--violet)"],
  ["accepted", "принято", "var(--green)"],
  ["declined", "отклонено", "var(--gray-400)"],
];

export default function Invitations() {
  const inv = useApi<any[]>("/employer/invitations");
  const stats = useApi<any>("/employer/stats");
  const [view, setView] = useState<"board" | "list">("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();
  const f = stats.data?.funnel;
  const mark = async (id: string, outcome: "hired" | "not_fit") => {
    await api.post(`/employer/invitations/${id}/outcome`, { outcome });
    toast(outcome === "hired" ? "Отмечено: наняли. «Маринад» учтёт это в подборе" : "Отмечено: не подошёл. «Маринад» учтёт это в подборе");
    inv.reload(); stats.reload();
  };
  const items = inv.data ?? [];
  const pct = (v: number) => (f?.sent ? `${Math.round((v / f.sent) * 100)}%` : "—");

  const card = (i: any) => (
    <div key={i.id} style={{ background: "var(--white)", border: "var(--rule)" }}>
      <button onClick={() => setOpenId(i.candidate.id)} className="col" style={{ width: "100%", padding: 14, gap: 6, textAlign: "left", border: 0, background: "none", cursor: "pointer", color: "var(--ink)" }}>
        <span className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}><b style={{ fontSize: 15 }}>{i.candidate.display_name}</b><span className="code" style={{ fontSize: 12 }}>{i.candidate.category}</span></span>
        <span className="small" style={{ color: "var(--ink-2)" }}>{i.title}</span>
        <span className="money" style={{ fontSize: 13 }}>{range(i.salary_from, i.salary_to)}</span>
        {i.candidate.contacts && <span className="mono" style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, wordBreak: "break-all" }}>{[i.candidate.contacts.telegram, i.candidate.contacts.email].filter(Boolean).join(", ")}</span>}
        {i.decline_reason && <span className="small">причина: {i.decline_reason}</span>}
        {i.salary_honest === false && <span className="small warn">кандидат: зарплата не совпала с вилкой</span>}
        <span className="small muted">{ago(i.created_at)}{i.source === "tasting" ? ", из дегустации" : i.source === "search" ? ", из банка" : ""}</span>
        {i.outcome && <span className={i.outcome === "hired" ? "badge-ok" : "small muted"}>{i.outcome === "hired" ? "✓ наняли" : "не подошёл"}</span>}
      </button>
      {i.status === "accepted" && !i.outcome && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 12px 12px" }} title="Итог собеседования учит подбор («Маринад»)">
          <button className="btn btn-green btn-sm" onClick={() => mark(i.id, "hired")}>Наняли</button>
          <button className="btn btn-outline btn-sm" onClick={() => mark(i.id, "not_fit")}>Не подошёл</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Приглашения</h1>
          <p className="page-sub">Контакты кандидата открываются, когда он принимает приглашение. Талон за приглашение возвращается после ответа.</p>
        </div>
        <Segmented value={view} onChange={setView} options={[{ id: "board", t: "Воронка" }, { id: "list", t: "Список" }]} label="Вид" />
      </div>

      {f && (
        <div className="tiles">
          {([["отправлено", f.sent, "var(--blue)"], ["просмотрено", f.viewed, "var(--violet)"], ["принято", f.accepted, "var(--green)"], ["наняли", f.hired ?? 0, "var(--sauce)"]] as const).map(([t, v, c]) => (
            <div key={t}><span className="tile-label">{t}</span><span className="tile-num" style={{ color: c }}>{v}</span><span className="tile-sub">{pct(v)}</span></div>
          ))}
          <div>
            <span className="tile-label">почему отказывают</span>
            <div className="col" style={{ gap: 4 }}>
              {stats.data.decline_reasons.length ? stats.data.decline_reasons.slice(0, 3).map((r: any) => <span key={r.reason} style={{ fontSize: 14, fontWeight: 600 }}>{r.reason} <span className="mono">{r.n}</span></span>) : <span className="small muted">отказов пока нет</span>}
            </div>
          </div>
        </div>
      )}

      {inv.loading && !inv.data ? <Skeleton h={300} /> : !items.length ? <Empty title="Приглашений пока нет">Откройте «Подбор», выберите кандидата и отправьте приглашение с вилкой зарплаты.</Empty> : view === "board" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(230px,1fr))", gap: 16, overflowX: "auto", paddingBottom: 8 }}>
          {COLS.map(([s, t, c]) => {
            const col = items.filter((i) => i.status === s);
            return (
              <div key={s} className="col" style={{ gap: 10, minWidth: 230 }}>
                <div className="row" style={{ justifyContent: "space-between", paddingBottom: 8, borderBottom: `3px solid ${c}` }}><b style={{ fontSize: 15 }}>{t}</b><span className="num">{col.length}</span></div>
                {col.map(card)}
                {!col.length && <span className="small muted" style={{ padding: "6px 0" }}>пусто</span>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rows">
          {items.map((i) => (
            <button key={i.id} className="ri" onClick={() => setOpenId(i.candidate.id)} style={{ width: "100%", background: "none", border: 0, borderBottom: "var(--rule)", cursor: "pointer", textAlign: "left", color: "var(--ink)" }}>
              <div className="ri-main"><span className="ri-title">{i.candidate.display_name} <span className="code" style={{ fontSize: 12 }}>{i.candidate.category}</span></span><span className="ri-sub">{i.title}, {ago(i.created_at)}</span></div>
              <span className="money hide-mobile" style={{ fontSize: 15 }}>{range(i.salary_from, i.salary_to)}</span>
              <StatusPill status={i.status} titles={EMPLOYER_STATUS} />
            </button>
          ))}
        </div>
      )}
      <CandidateDrawer id={openId} onClose={() => setOpenId(null)} onInvite={() => setOpenId(null)} />
    </>
  );
}
