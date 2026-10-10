import { Link, Navigate } from "react-router-dom";
import { range } from "../../format";
import { useApi } from "../../hooks";
import { Skeleton, StatusPill } from "../../ui";

/** Пиксельный код категории: «BE • SEN». В TDAText нет «·», поэтому точка — отдельный элемент. */
export function PixelCode({ code, color = "var(--blue)", dot, size }: { code?: string | null; color?: string; dot?: string; size?: string }) {
  const [a, b] = (code ?? "?").split("·");
  return (
    <span className="code-xl" style={{ color, fontSize: size, display: "inline-flex", alignItems: "center", gap: ".22em" }} aria-label={code ?? "категории нет"}>
      {a}{b && <><span aria-hidden style={{ width: ".16em", height: ".16em", borderRadius: "50%", background: dot ?? color, flexShrink: 0 }} />{b}</>}
    </span>
  );
}

export default function Dashboard() {
  const prof = useApi<any>("/candidate/profile");
  const inv = useApi<any>("/candidate/invitations");
  const market = useApi<any>("/candidate/market");
  const tasks = useApi<any[]>("/candidate/tasks");
  const p = prof.data;
  if (prof.loading && !p) return <Skeleton h={260} />;
  if (p && !p.onboarding.survey) return <Navigate to="/candidate/onboarding" replace />;
  const items: any[] = inv.data?.items ?? [];
  const m = market.data;
  const open = (tasks.data ?? []).filter((t) => !t.submitted_at);
  const firstName = p?.full_name?.split(" ")[0];
  const extra = (p?.categories ?? []).filter((c: any) => !c.is_primary).map((c: any) => c.code);
  const newInv = items.find((i) => i.status === "sent");

  type Next = { tag: string; tagColor: string; title: string; sub: string; to: string; cta: string; primary?: boolean };
  const next: Next[] = [];
  if (!p?.grade) next.push({ tag: p?.grade_status === "not_confirmed" ? `грейд ${p.last_test?.declared_grade_title} не подтверждён` : "первый шаг", tagColor: "var(--sauce-ink)", title: p?.grade_status === "not_confirmed" ? "Пройдите тест на уровень ниже" : "Пройдите тест на грейд", sub: "Без категории компании вас не видят. 8–18 заданий, около 20 минут.", to: "/candidate/test", cta: "Пройти тест", primary: true });
  if (open[0]) next.push({ tag: open[0].kind === "system" ? "✦ от шаурматча, только вам" : `${open[0].company_name} предлагает вам`, tagColor: open[0].kind === "system" ? "var(--sauce-ink)" : "var(--blue)", title: open[0].title, sub: open[0].kind === "system" ? open[0].reason?.text ?? open[0].description : "Слепая дегустация: компания увидит решение без имени", to: "/candidate/tasks", cta: "Решить", primary: !!p?.grade });
  if (newInv) next.push({ tag: "новое приглашение", tagColor: "var(--blue)", title: `${newInv.company.name} — ${newInv.title}`, sub: range(newInv.salary_from, newInv.salary_to), to: `/candidate/invitations?open=${newInv.id}`, cta: "Открыть" });
  if (p?.grade && extra.length === 0) next.push({ tag: "вторая категория", tagColor: "var(--ink-2)", title: "Работаете на стыке направлений?", sub: "Подтвердите вторую специализацию отдельным тестом — у неё свои 90 дней.", to: "/candidate/test", cta: "Пройти тест" });
  if (p && !p.consent_publish) next.push({ tag: "приватность", tagColor: "var(--ink-2)", title: "Разрешите показ профиля в подборках", sub: "Сейчас компании вас не видят. Контакты всё равно откроются только после вашего «да».", to: "/candidate/settings", cta: "Настроить" });
  if (p && !p.fsp?.id) next.push({ tag: "ФСП", tagColor: "var(--ink-2)", title: "Свяжите профиль с ID участника ФСП", sub: "Достижения соревнований поднимут вас внутри категории. Нет истории — это не штраф.", to: "/candidate/settings", cta: "Связать" });

  return (
    <>
      <section className="tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }} aria-label="Ваша категория">
        <div style={{ gridColumn: "span 2", minWidth: 0, gap: 14 }}>
          <span className="tile-label">{firstName ? `${firstName}, ваша категория` : "Ваша категория"}</span>
          {p?.category ? <PixelCode code={p.category} size="clamp(48px, 6.4vw, 92px)" /> : <span className="code-xl" style={{ color: "var(--violet)", fontSize: "clamp(48px, 6.4vw, 92px)" }}>?</span>}
          <span style={{ fontSize: 14 }}>
            {p?.category
              ? [p.industry ?? "ИТ", p.specialization_title, p.grade_title, extra.length ? `ещё ${extra.join(", ")}` : null, p.fsp?.count ? `ФСП × ${p.fsp.count}` : null].filter(Boolean).join(", ")
              : p?.grade_status === "not_confirmed" ? `Грейд ${p.last_test?.declared_grade_title} пока не подтверждён — это не понижение` : "Категории пока нет — её даёт тест"}
          </span>
        </div>
        <div><span className="tile-label">место в категории</span><span className="tile-num">{m?.position ? <>#{m.position}<span style={{ fontSize: 22, color: "#9B9C9E" }}> /{m.peers}</span></> : "—"}</span></div>
        <div><span className="tile-label">сила профиля</span><span className="tile-num">{m?.strength ?? "—"}</span><span className="tile-sub">тесты + ФСП</span></div>
        <div><span className="tile-label">компаний ищут</span><span className="tile-num" style={{ color: "var(--violet)" }}>{m?.companies_searching ?? "—"}</span><span className="tile-sub">{m?.category ?? ""}</span></div>
      </section>

      <div className="split">
        <section className="col" style={{ gap: 14 }}>
          <h2 className="h2">Что дальше</h2>
          <div className="rows">
            {next.slice(0, 4).map((n) => (
              <div key={n.title} className="ri">
                <div className="ri-main">
                  <span style={{ fontSize: 13, fontWeight: 600, color: n.tagColor }}>{n.tag}</span>
                  <span className="ri-title">{n.title}</span>
                  <span className={n.sub.includes("₽") ? "money" : "ri-sub"} style={n.sub.includes("₽") ? { fontSize: 14, fontWeight: 500 } : undefined}>{n.sub}</span>
                </div>
                <Link to={n.to} className={`btn btn-md ${n.primary ? "btn-primary" : "btn-outline"}`}>{n.cta}</Link>
              </div>
            ))}
            {!next.length && <div className="ri"><span className="ri-sub">Всё сделано. Приглашения придут сюда и на почту.</span></div>}
          </div>
        </section>

        <section className="col" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 className="h2">Приглашения</h2><Link to="/candidate/invitations" style={{ fontWeight: 600, fontSize: 14 }}>все</Link></div>
          <div className="rows">
            {items.slice(0, 4).map((o) => (
              <Link key={o.id} to={`/candidate/invitations?open=${o.id}`} className="ri" style={{ color: "var(--ink)", textDecoration: "none" }}>
                <div className="ri-main"><span className="ri-title">{o.company.name}<span className="muted" style={{ fontWeight: 400 }}> — {o.title}</span></span><span className="money" style={{ fontSize: 14, fontWeight: 500 }}>{range(o.salary_from, o.salary_to)}</span></div>
                <StatusPill status={o.status} />
              </Link>
            ))}
            {!items.length && <div className="ri"><span className="ri-sub">{p?.grade ? "Пока тихо. Компании видят вас в подборках — приглашения появятся здесь." : "Пройдите тест — и вы появитесь в подборках компаний."}</span></div>}
          </div>
        </section>
      </div>
    </>
  );
}
