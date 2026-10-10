import { useNavigate } from "react-router-dom";
import { SpeakButton } from "../../a11y";
import { useApi } from "../../hooks";
import { Skeleton } from "../../ui";

/** Плотность ячейки → оттенок синего бренда; на тёмных ячейках текст белый. */
const scale = (n: number, max: number) => {
  const r = max ? n / max : 0;
  const mix = Math.round(14 + r * 86);
  return [`color-mix(in srgb, var(--blue) ${mix}%, #fff)`, r >= 0.45 ? "#fff" : "var(--ink)"];
};
const GRADE_SHORT: Record<string, string> = { intern: "INT", junior: "JUN", middle: "MID", senior: "SEN" };

export default function Market() {
  const { data } = useApi<any[]>("/employer/market");
  const navigate = useNavigate();
  if (!data) return <Skeleton h={360} />;
  const cells = data.flatMap((r) => r.cells.map((c: any) => ({ ...c, spec: r.specialization, title: r.title })));
  const max = Math.max(1, ...cells.map((c) => c.n));
  const total = cells.reduce((s, c) => s + c.n, 0);
  const top = [...cells].sort((a, b) => b.n - a.n)[0];
  const rare = [...cells].filter((c) => c.grade === "senior").sort((a, b) => a.n - b.n)[0];
  const words = `Всего ${total} кандидатов с подтверждённой категорией. Больше всего — ${top.title}, ${top.grade_title}: ${top.n} человек. Меньше всего сеньоров в направлении ${rare.title}: ${rare.n}${rare.median_salary ? `, медиана ожиданий ${Math.round(rare.median_salary / 1000)} тысяч рублей` : ""}.`;
  const open = (c: any) => navigate(`/employer/candidates?specialization=${c.spec}&grade=${c.grade}`);

  return (
    <>
      <div>
        <h1 className="page-title">Карта рынка</h1>
        <p className="page-sub">{total} человек с подтверждённой категорией и что они хотят. Нажмите на ячейку — откроем банк кандидатов этой категории.</p>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="heat-table" style={{ minWidth: 640 }}>
          <thead><tr><th style={{ width: "16%" }} />{data[0].cells.map((c: any) => <th key={c.grade} className="mono" title={c.grade_title}>{GRADE_SHORT[c.grade] ?? c.grade_title}</th>)}</tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.specialization}>
                <th style={{ textAlign: "left" }}><span className="code" style={{ fontSize: 16 }}>{r.code}</span><span className="small muted" style={{ display: "block", fontFamily: "var(--sans)", fontWeight: 500 }}>{r.title}</span></th>
                {r.cells.map((c: any) => {
                  const [bg, fg] = scale(c.n, max);
                  return (
                    <td key={c.grade} style={{ padding: 0 }}>
                      <button onClick={() => open({ ...c, spec: r.specialization })} aria-label={`${r.title} ${c.grade_title}: ${c.n} кандидатов`}
                        style={{ width: "100%", minHeight: 116, background: bg, color: fg, border: 0, padding: "14px 14px", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ font: "800 32px/1 var(--mono)", letterSpacing: "-.04em" }}>{c.n}</span>
                        <span className="mono" style={{ fontSize: 12 }}>{c.median_salary ? `${Math.round(c.median_salary / 1000)}к ₽` : "—"}</span>
                        <span style={{ fontSize: 12 }}>ФСП {c.n ? Math.round(((c.with_fsp ?? 0) / c.n) * 100) : 0}%</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small" style={{ color: "var(--ink-2)" }}>В ячейке: число кандидатов, медиана ожиданий в тысячах рублей и доля участников с достижениями ФСП. Чем темнее — тем больше людей.</p>
      <section className="col rule-top" style={{ gap: 10, paddingTop: 18, maxWidth: 760 }}>
        <h2 className="h3">Карта словами</h2>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-2)" }}>{words}</p>
        <div><SpeakButton text={words} /></div>
      </section>
    </>
  );
}
