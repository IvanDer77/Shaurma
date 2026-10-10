import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { date, FORMAT_TITLES, GRADE_TITLES, rub, SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { Avatar, DISCIPLINE_COLORS, IngredientBar, Medal, Skeleton, StackLine, Switch } from "../../ui";

export { DISCIPLINE_COLORS };

/** Шкала рейтинга Glicko: 800…2300 → 0…100% */
const pos = (r: number) => Math.max(0, Math.min(100, ((r - 800) / 1500) * 100));

/** Ингредиенты: сплошная часть — подтверждённый уровень μ − 2·RD, светлая — неопределённость (2·RD). */
export function IngredientBars({ ratings, ingredients, dict, compact }: { ratings: Record<string, any>; ingredients: string[]; dict: any; compact?: boolean }) {
  const rows = ingredients.map((id) => ({ id, title: dict.ingredients[id]?.title ?? id, e: ratings?.[id] }));
  rows.sort((a, b) => (b.e ? b.e.r - 2 * b.e.rd : -1e9) - (a.e ? a.e.r - 2 * a.e.rd : -1e9));
  return (
    <div className="col" style={{ gap: compact ? 12 : 16 }}>
      {rows.map(({ id, title, e }) => {
        const cold = !!e?.updated_at && (Date.now() - new Date(e.updated_at).getTime()) / 864e5 > 60;
        const conf = e ? pos(e.r - 2 * e.rd) : 0;
        const unc = e ? pos(e.r) - conf : 0;
        return <IngredientBar key={id} name={title} conf={conf} unc={unc} value={e ? Math.round(e.r) : null} cold={cold} />;
      })}
      {!compact && <span className="small muted">❄ — навык остыл: давно не было практики. Регулярные задачи снова «разогревают» рейтинг.</span>}
    </div>
  );
}

/** Достижения ФСП: место крупной цифрой, цветной маркер дисциплины. Пустая история — нейтральный текст, без штрафа. */
export function FspList({ achievements }: { achievements: any[] }) {
  if (!achievements?.length) return <p className="muted" style={{ fontSize: 14 }}>Истории ФСП нет — квалификацию подтверждают тесты платформы. На позицию в выдаче это не влияет.</p>;
  return (
    <div className="rows">
      {achievements.map((a, i) => (
        <div key={i} className="ri" style={{ alignItems: "flex-start", padding: "14px 0" }}>
          <Medal place={a.place} />
          <div className="ri-main" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{a.event}</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
              <i className="mark" aria-hidden style={{ background: DISCIPLINE_COLORS[a.discipline] ?? "var(--gray-400)", display: "inline-block", marginRight: 7, verticalAlign: "1px" }} />
              {[a.discipline_title, a.level_title, a.place ? `${a.place} место из ${a.participants}` : "участник", a.role, a.rank_title, a.team ? `команда ${a.team}` : null].filter(Boolean).join(", ")}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Passport() {
  const prof = useApi<any>("/candidate/profile");
  const dict = useApi<any>("/dict");
  const history = useApi<any[]>("/candidate/grade-history");
  const [asEmployer, setAsEmployer] = useState(false);
  const p = prof.data;
  if (!p || !dict.data) return <Skeleton h={360} />;
  const spec = dict.data.specializations.find((s: any) => s.id === p.specialization);
  const hideName = asEmployer && p.privacy?.show_name === false;
  const displayName = hideName ? `Кандидат #${p.anon_code}` : p.full_name ?? `Кандидат #${p.anon_code}`;
  const codes = (p.categories ?? []).map((c: any) => c.code);
  const experience = asEmployer && p.privacy?.show_experience === false ? [] : p.resume_parsed?.experience ?? [];

  const downloadPdf = async () => {
    const blob = await api.get<Blob>("/candidate/profile/pdf");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shaurmatch-profile-${p.anon_code}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Паспорт навыков</h1>
        <div className="row" style={{ gap: 16 }}>
          <Switch checked={asEmployer} onChange={setAsEmployer} label="Как видит компания" />
          <button className="btn btn-outline btn-md" onClick={downloadPdf}>Скачать PDF</button>
        </div>
      </div>
      {asEmployer && <div className="note">Так компания видит профиль в подборке. Email, телефон и Telegram откроются ей только после того, как вы примете приглашение или откликнетесь сами.</div>}

      <section className="row" style={{ borderTop: "var(--rule)", borderBottom: "var(--rule)", padding: "20px 0", gap: 20, alignItems: "center" }}>
        <Avatar name={displayName} size={72} />
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 220 }}>
          <span style={{ fontSize: 21, fontWeight: 700 }}>{displayName}</span>
          <span className="code" style={{ fontSize: 15 }}>{codes.length ? codes.join(" + ") : p.grade_status === "not_confirmed" ? `грейд ${p.last_test?.declared_grade_title} не подтверждён` : "категория ещё не присвоена"}</span>
          <span className="small muted">{[(!asEmployer || p.privacy?.show_city !== false) ? p.city : null, (p.formats ?? []).map((f: string) => FORMAT_TITLES[f]?.toLowerCase()).join(" или "), p.grade ? `грейд подтверждён ${date(p.grade_confirmed_at)}` : null].filter(Boolean).join(", ")}</span>
        </div>
        {(!asEmployer || p.privacy?.show_salary !== false) && (
          <div className="col" style={{ gap: 2, alignItems: "flex-end" }}><span className="small">хочу</span><span className="money" style={{ fontSize: 20 }}>{p.salary_expect ? `от ${rub(p.salary_expect)}` : "—"}</span></div>
        )}
      </section>

      <div className="split">
        <section className="col" style={{ gap: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h3">Ингредиенты <span className="muted" style={{ fontWeight: 500 }}>{spec?.title}</span></h2>
            <span className="row small" style={{ gap: 12 }}><span className="row" style={{ gap: 5 }}><i className="mark" style={{ background: "var(--blue)" }} />подтверждено</span><span className="row" style={{ gap: 5 }}><i className="mark" style={{ background: "var(--blue-tint)" }} />пока неясно</span></span>
          </div>
          <IngredientBars ratings={p.ratings} ingredients={spec?.ingredients ?? Object.keys(p.ratings)} dict={dict.data} />
        </section>

        <section className="col" style={{ gap: 26 }}>
          <div className="col" style={{ gap: 8 }}>
            <h2 className="h3 row" style={{ gap: 8 }}><img src="/brand/fsp-star-black.svg" alt="" width={20} height={19} />Достижения ФСП</h2>
            <FspList achievements={p.fsp.achievements} />
            {!p.fsp.id && !asEmployer && <Link to="/candidate/settings" style={{ fontWeight: 600, fontSize: 14 }}>Связать ID участника ФСП</Link>}
          </div>

          <div className="col" style={{ gap: 8 }}>
            <h2 className="h3">Подтверждено тестом</h2>
            {(p.verified_stacks ?? []).length || (p.stacks ?? []).length
              ? <StackLine stacks={p.stacks} verified={p.verified_stacks} />
              : <span className="muted small">Появится после теста.</span>}
            <span className="small muted">✓ — решено не меньше двух заданий на этом языке уровня вашего грейда. Остальное — со слов.</span>
          </div>

          {experience.length > 0 && (
            <div className="col" style={{ gap: 8 }}>
              <h2 className="h3">Опыт из резюме</h2>
              <div className="rows hair">
                {experience.map((e: any, i: number) => (
                  <div key={i} className="ri"><span className="mono small" style={{ width: 118, flexShrink: 0 }}>{e.period}</span><span><b>{e.title ?? "—"}</b>{e.company ? `, ${e.company}` : ""}</span></div>
                ))}
              </div>
            </div>
          )}

          {p.about && !asEmployer && <div className="col" style={{ gap: 8 }}><h2 className="h3">О себе</h2><p style={{ lineHeight: 1.6 }}>{p.about}</p></div>}

          <div className="col" style={{ gap: 8 }}>
            <h2 className="h3">Опрос и тесты</h2>
            <div className="rows hair">
              {(history.data ?? []).map((h) => (
                <div key={h.id} className="ri">
                  <span className="ri-main" style={{ fontSize: 14 }}>{date(h.created_at)}, тест на {GRADE_TITLES[h.declared_grade]}{h.specialization && h.specialization !== p.specialization ? `, ${SPEC_TITLES[h.specialization]}` : ""}</span>
                  {h.result === "confirmed" ? <span className="badge-ok">✓ подтверждён</span> : <span className="small muted">не подтверждён</span>}
                </div>
              ))}
              {!history.data?.length && <div className="ri"><span className="small muted">Тестов пока не было. <Link to="/candidate/test">Пройти тест</Link></span></div>}
            </div>
            {(p.survey_history ?? []).length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, padding: "6px 0" }}>История опроса ({p.survey_history.length})</summary>
                {p.survey_history.map((s: any, i: number) => (
                  <div key={i} className="small" style={{ padding: "4px 0" }}>{date(s.created_at)}, {s.survey.industry ?? "ИТ"}, {SPEC_TITLES[s.survey.specialization] ?? s.survey.specialization}, заявлен {GRADE_TITLES[s.survey.declared_grade]}, {(s.survey.stacks ?? []).join(", ")}</div>
                ))}
              </details>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
