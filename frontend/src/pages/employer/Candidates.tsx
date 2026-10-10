import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { qs } from "../../api";
import { GRADE_TITLES, SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { Empty, Skeleton } from "../../ui";
import { CandidateDrawer, CandidateRow, InviteDrawer } from "./shared";

export default function Candidates() {
  const [params, setParams] = useSearchParams();
  const spec = params.get("specialization") ?? "";
  const grade = params.get("grade") ?? "";
  const [fsp, setFsp] = useState(false);
  const [stack, setStack] = useState("");
  const [limit, setLimit] = useState(30);
  const list = useApi<any>(`/employer/candidates${qs({ specialization: spec, grade, fsp_only: fsp ? "true" : undefined, stack, limit })}`, [spec, grade, fsp, stack, limit]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState<any>(null);
  const setP = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n); };

  const title = spec ? `${SPEC_TITLES[spec]}${grade ? `, ${GRADE_TITLES[grade]}` : ""}` : "Банк кандидатов";
  return (
    <>
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{list.data ? <b className="mono" style={{ color: "var(--ink)" }}>{list.data.total} кандидатов</b> : "…"}, внутри категории — по силе подтверждённого профиля: тесты и ФСП, рейтинг μ − 2·RD. Без истории ФСП позиция не снижается.</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <select className="select boxed" value={spec} onChange={(e) => setP("specialization", e.target.value)} aria-label="Специализация">
          <option value="">Все специализации</option>{Object.entries(SPEC_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <select className="select boxed" value={grade} onChange={(e) => setP("grade", e.target.value)} aria-label="Грейд">
          <option value="">Все грейды</option>{Object.entries(GRADE_TITLES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
        </select>
        <input className="input boxed" style={{ width: 220 }} placeholder="Стек, например Python" value={stack} onChange={(e) => setStack(e.target.value)} aria-label="Стек" />
        <button className="chip" style={{ height: 46 }} aria-pressed={fsp} onClick={() => setFsp(!fsp)}>только ФСП</button>
      </div>
      {list.loading && !list.data ? <Skeleton h={300} /> : !list.data?.results.length ? <Empty title="Никого не нашлось">Измените фильтры.</Empty> : (
        <div className="rule-top">
          {list.data.results.map((r: any) => (
            <CandidateRow key={`${r.candidate.id}-${r.candidate.category}`} c={r.candidate} strength={r.strength} invitation={r.invitation_status} onOpen={() => setOpenId(r.candidate.id)} onInvite={() => setInviting(r.candidate)} />
          ))}
          {list.data.total > limit && <button className="btn btn-md btn-outline btn-block" style={{ marginTop: 16 }} onClick={() => setLimit(limit + 30)}>Показать ещё {list.data.total - limit}</button>}
        </div>
      )}
      <CandidateDrawer id={openId} onClose={() => setOpenId(null)} onInvite={(c) => { setOpenId(null); setInviting(c); }} />
      <InviteDrawer candidate={inviting} source="search" onClose={() => setInviting(null)} onSent={() => { setInviting(null); list.reload(); }} />
    </>
  );
}
