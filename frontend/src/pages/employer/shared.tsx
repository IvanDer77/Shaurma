import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../api";
import { date, FORMAT_TITLES, GRADE_TITLES, range, rub, SPEC_TITLES } from "../../format";
import { useApi } from "../../hooks";
import { Avatar, avatarBg, Drawer, ErrorBox, Field, MatchRing, MoneyInput, Spinner, StackLine, StatusPill, useToast } from "../../ui";
import { PixelCode } from "../candidate/Dashboard";
import { FspList, IngredientBars } from "../candidate/Passport";

/** Названия статусов со стороны компании. */
export const EMPLOYER_STATUS: Record<string, string> = { sent: "отправлено", viewed: "просмотрено", accepted: "принято", declined: "отклонено" };

/** Строка кандидата в подборке и банке: категория, подтверждённый стек, ФСП, ожидания, шанс принятия, совпадение. */
export function CandidateRow({ c, match, why, onOpen, onInvite, strength, invitation, accept }: {
  c: any; match?: number; why?: string[]; onOpen: () => void; onInvite: () => void; strength?: number; invitation?: string | null; accept?: number;
}) {
  const verified: string[] = c.verified_stacks ?? [];
  const stacks: string[] = Array.from(new Set([...verified, ...(c.stacks ?? [])])).slice(0, 6);
  const anon = /^Кандидат #/.test(c.display_name ?? "");
  return (
    <div className="cand-row">
      <button onClick={onOpen} aria-label={`Открыть: ${c.display_name}`} style={{ border: 0, padding: 0, background: "none", cursor: "pointer", display: "flex" }}>
        {anon
          ? <span style={{ width: 52, height: 52, background: "var(--deep)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 14px var(--mono)" }}>#{String(c.display_name).replace(/\D/g, "").slice(-2) || "?"}</span>
          : <Avatar name={c.display_name} size={52} bg={avatarBg(c.id)} />}
      </button>
      <div className="col" style={{ gap: 5, minWidth: 0 }}>
        <div className="row" style={{ gap: "4px 10px" }}>
          <button onClick={onOpen} style={{ border: 0, background: "none", padding: 0, font: "700 17px var(--sans)", color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>{c.display_name}</button>
          <span className="code" style={{ fontSize: 13 }}>{c.category}</span>
          {(c.other_categories ?? []).map((k: string) => <span key={k} className="code" style={{ fontSize: 12, color: "var(--ink-3)" }} title="Ещё одна категория, подтверждённая тестом">+{k}</span>)}
          <span className="small muted">{[c.city, (c.formats ?? []).map((f: string) => FORMAT_TITLES[f]?.toLowerCase()).join(", ")].filter(Boolean).join(", ")}</span>
        </div>
        <div className="row" style={{ gap: "2px 10px" }}>
          {stacks.map((t) => <span key={t} className={`vtag${verified.includes(t) ? " v" : ""}`} title={verified.includes(t) ? "Подтверждено заданиями теста" : "Со слов кандидата"}>{verified.includes(t) ? "✓" : ""}{t}</span>)}
          {c.fsp?.count > 0 && <span className="fsp">ФСП × {c.fsp.count}</span>}
        </div>
        {why && why.length > 0 && <span className="small" style={{ color: "var(--ink-2)", lineHeight: 1.45 }}>{why.slice(0, 2).join(", ")}</span>}
      </div>
      <div className="cand-right">
        <div className="col" style={{ alignItems: "flex-end", gap: 3 }}>
          <span className="money" style={{ fontSize: 15, whiteSpace: "nowrap" }}>{c.salary_expect ? `от ${rub(c.salary_expect)}` : "ожидания скрыты"}</span>
          {accept != null && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: accept >= 0.5 ? "var(--green)" : "var(--sauce-ink)" }} title="Оценка «Маринада»: шанс, что кандидат примет приглашение с вашей вилкой">примет ≈{Math.round(accept * 100)}%</span>}
          {strength != null && <span className="mono small muted">сила {strength}</span>}
        </div>
        {match != null && <MatchRing value={match} size={54} />}
        <div style={{ minWidth: 118, display: "flex", justifyContent: "flex-end" }}>
          {invitation ? <StatusPill status={invitation} titles={EMPLOYER_STATUS} /> : <button className="btn btn-primary btn-md" onClick={onInvite}>Пригласить</button>}
        </div>
      </div>
    </div>
  );
}

const Block = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <section className="col rule-top" style={{ gap: 12, paddingTop: 16 }}><h3 className="h3">{title}</h3>{children}</section>
);

/** Карточка кандидата: профиль без контактов до согласия + совпадение с потребностью. */
export function CandidateDrawer({ id, needId, onClose, onInvite }: { id: string | null; needId?: string; onClose: () => void; onInvite: (c: any) => void }) {
  const card = useApi<any>(id ? `/employer/candidates/${id}${needId ? `?need_id=${needId}` : ""}` : null, [id, needId]);
  const dict = useApi<any>("/dict");
  const c = card.data?.candidate;
  const m = card.data?.match;
  const spec = dict.data?.specializations.find((s: any) => s.id === c?.specialization);
  const warn = (w: string) => w.startsWith("Не подтверждено") || w.startsWith("Ожидания");
  return (
    <Drawer open={!!id} onClose={onClose} title={c?.display_name ?? "Кандидат"} subtitle={c ? `${c.specialization_title}, ${c.grade_title}` : undefined} width={720}
      footer={c && !c.contacts_visible ? <button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={() => onInvite(c)}>Пригласить с зарплатой</button> : undefined}>
      {!c || !dict.data ? <Spinner /> : (
        <>
          <div className="tiles" style={{ gridTemplateColumns: m ? "1.3fr 1fr 0.8fr" : "1.3fr 1fr" }}>
            <div className="col" style={{ gap: 8 }}>
              <span className="tile-label">категория</span>
              <PixelCode code={c.category} size="40px" />
              {(c.categories ?? []).length > 1 && <span className="tile-sub">ещё: {c.categories.filter((k: any) => k.code !== c.category).map((k: any) => k.code).join(", ")}</span>}
            </div>
            <div className="col" style={{ gap: 8 }}><span className="tile-label">ожидания</span><span className="money" style={{ fontSize: 20 }}>{c.salary_expect ? `от ${rub(c.salary_expect)}` : "скрыты"}</span></div>
            {m && <div className="col" style={{ gap: 8 }}><span className="tile-label">совпадение</span><span style={{ font: "400 40px/1 var(--pixel)", color: "var(--blue)" }}>{Math.round(m.match_percent)}</span></div>}
          </div>

          {m && (
            <Block title="Почему подходит">
              <div className="col" style={{ gap: 6 }}>
                {m.why.map((w: string) => <span key={w} style={{ fontSize: 14, lineHeight: 1.45 }}><b style={{ color: warn(w) ? "var(--sauce-ink)" : "var(--green)" }}>{warn(w) ? "! " : "✓ "}</b>{w}</span>)}
              </div>
            </Block>
          )}

          {c.contacts_visible
            ? <div className="note note-ok"><b>Контакты открыты:</b> {[c.contacts.full_name, c.contacts.email, c.contacts.phone, c.contacts.telegram].filter(Boolean).join(", ")}</div>
            : <div className="note">Контакты откроются, когда кандидат примет ваше приглашение или сам откликнется на вакансию.</div>}

          <Block title="Ингредиенты">
            <IngredientBars ratings={c.ratings} ingredients={spec?.ingredients ?? Object.keys(c.ratings)} dict={dict.data} compact />
          </Block>

          {((c.verified_stacks ?? []).length > 0 || (c.stacks ?? []).length > 0) && (
            <Block title="Стек">
              <StackLine stacks={c.stacks} verified={c.verified_stacks} />
              <span className="small muted">✓ — подтверждено заданиями теста, остальное — со слов кандидата.{c.experience_years != null ? ` Опыт: ${c.experience_years} лет.` : ""}{(c.soft_skills ?? []).length ? ` ${(c.soft_skills ?? []).join(", ")}.` : ""}</span>
            </Block>
          )}

          {(c.experience ?? []).length > 0 && (
            <Block title="Опыт из резюме">
              <div className="rows hair">
                {c.experience.map((e: any, i: number) => <div key={i} className="ri"><span className="mono small" style={{ width: 118, flexShrink: 0 }}>{e.period}</span><span><b>{e.title ?? "—"}</b>{e.company ? `, ${e.company}` : ""}</span></div>)}
              </div>
              <span className="small muted">Справочно: категорию и место в выдаче определяет только тест.</span>
            </Block>
          )}

          <Block title={<span className="row" style={{ gap: 8 }}><img src="/brand/fsp-star-black.svg" alt="" width={18} height={17} />Достижения ФСП</span>}>
            <FspList achievements={c.fsp.achievements} />
          </Block>

          <Block title="Тесты и задачи">
            <div className="rows hair">
              {card.data.grade_history.map((h: any, i: number) => (
                <div key={i} className="ri" style={{ fontSize: 14 }}>
                  <span className="ri-main">{date(h.created_at)}, тест на {GRADE_TITLES[h.declared_grade]}{h.specialization && h.specialization !== c.specialization ? `, ${SPEC_TITLES[h.specialization]}` : ""}</span>
                  {h.result === "confirmed" ? <span className="badge-ok">✓ подтверждён</span> : <span className="small muted">не подтверждён</span>}
                </div>
              ))}
              {card.data.regular_tasks.map((t: any, i: number) => (
                <div key={`t${i}`} className="ri" style={{ fontSize: 14 }}>
                  <span className="ri-main">{date(t.submitted_at)}, {t.kind === "system" ? "свежая начинка" : "задача"} «{t.title}»</span>
                  {t.correct ? <span className="badge-ok">✓ верно</span> : <span className="small muted">неверно</span>}
                </div>
              ))}
            </div>
          </Block>

          {card.data.invitations.length > 0 && (
            <Block title="Ваши приглашения">
              <div className="rows hair">
                {card.data.invitations.map((i: any) => <div key={i.id} className="ri"><span className="ri-main" style={{ fontSize: 14 }}>{i.title}, <span className="money" style={{ fontSize: 14 }}>{range(i.salary_from, i.salary_to)}</span></span><StatusPill status={i.status} titles={EMPLOYER_STATUS} /></div>)}
              </div>
            </Block>
          )}
        </>
      )}
    </Drawer>
  );
}

/** Конструктор приглашения: описание, вилка «от–до» (обязательно), способ связи, предпросмотр. */
export function InviteDrawer({ candidate, need, vacancyId, source = "selection", onClose, onSent, submitPath }: {
  candidate: any | null; need?: any; vacancyId?: string; source?: "selection" | "search" | "tasting"; onClose: () => void; onSent: () => void; submitPath?: string;
}) {
  const company = useApi<any>("/employer/company");
  const vacancies = useApi<any[]>("/employer/vacancies");
  const toast = useToast();
  const [vac, setVac] = useState(vacancyId ?? "");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [contact, setContact] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!candidate) return;
    const r = need?.recipe;
    setTitle(need?.title ?? "");
    setDesc(need?.text ?? "");
    setFrom(r?.salary_from ?? null);
    setTo(r?.salary_to ?? null);
    setError(null);
  }, [candidate, need]);
  useEffect(() => {
    const c = company.data;
    if (c && !contact) setContact(c.contact_telegram ? `Telegram ${c.contact_telegram}` : c.contact_email ? `Email ${c.contact_email}` : "");
  }, [company.data, contact]);
  useEffect(() => {
    const v = vacancies.data?.find((x) => x.id === vac);
    if (v) { setTitle(v.title); setDesc(v.description); setFrom(v.salary_from); setTo(v.salary_to); }
  }, [vac, vacancies.data]);

  const median = candidate?.salary_expect;
  const hint = !from || !to ? "Вилка «от–до» обязательна: кандидат видит условия до начала общения."
    : to < from ? "Верхняя граница меньше нижней."
    : median && to < median ? `Ожидания кандидата — от ${rub(median)}. Ваш максимум ниже — велик шанс отказа с причиной «мало денег».`
    : median ? `Ожидания кандидата — от ${rub(median)}. Вилка их покрывает.` : "Ожидания кандидата скрыты.";
  const bad = !!(from && to && to < from) || (median && to && to < median);

  const send = async () => {
    setError(null); setBusy(true);
    try {
      const body = { candidate_id: candidate.id, title, description: desc, salary_from: from, salary_to: to, contact_method: contact, vacancy_id: vac || undefined, need_id: need?.id, source };
      await api.post(submitPath ?? "/employer/invitations", submitPath ? { title, description: desc, salary_from: from, salary_to: to, contact_method: contact } : body);
      toast("Приглашение отправлено");
      onSent();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Drawer open={!!candidate} onClose={onClose} title="Приглашение" subtitle={`для: ${candidate?.display_name ?? candidate?.label ?? ""}`} width={580}
      footer={<><button className="btn btn-outline btn-lg" onClick={onClose}>Отмена</button><button className="btn btn-primary btn-lg" style={{ flex: 1 }} onClick={send} disabled={busy || !from || !to || !title || desc.length < 10 || contact.length < 3}>{busy ? <><span className="spin" />Отправляю…</> : "Отправить приглашение"}</button></>}>
      {candidate && (
        <>
          {!submitPath && (
            <Field label="Вакансия (необязательно)">
              <select className="select" value={vac} onChange={(e) => setVac(e.target.value)}>
                <option value="">Без привязки к вакансии</option>
                {(vacancies.data ?? []).filter((v) => v.status === "published").map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            </Field>
          )}
          <Field label="Должность / суть предложения"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Зарплата, ₽ в месяц — обязательно</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}><MoneyInput value={from} onChange={setFrom} aria-label="Зарплата от" placeholder="от" /><MoneyInput value={to} onChange={setTo} aria-label="Зарплата до" placeholder="до" /></div>
            <div className={`note${bad ? " note-warn" : ""}`} style={{ fontSize: 13 }}>{hint}</div>
          </div>
          <Field label="Описание предложения"><textarea className="textarea" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Чем занимается команда, задачи, формат, этапы" /></Field>
          <Field label="Способ связи" hint="Увидит кандидат; ваши контакты для него открыты сразу"><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
          <div className="col" style={{ gap: 10 }}>
            <span className="label">Так приглашение увидит кандидат</span>
            <div className="col" style={{ padding: 20, gap: 8, background: "var(--white)", border: "var(--rule)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}><span style={{ fontSize: 15, fontWeight: 700 }}>{company.data?.name}</span><StatusPill status="sent" /></div>
              <span style={{ fontSize: 14 }}>{title || "…"}</span>
              <span className="money-xl" style={{ fontSize: 26 }}>{from && to ? range(from, to) : "— ₽"}</span>
              <span className="small muted">Связь: {contact || "—"}</span>
            </div>
          </div>
          {company.data && <span className="small muted">Талонов на этой неделе: {company.data.tickets.left} из {company.data.tickets.limit}. Талон вернётся, когда кандидат ответит.</span>}
          <ErrorBox error={error} />
        </>
      )}
    </Drawer>
  );
}
