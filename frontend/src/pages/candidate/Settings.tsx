import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { date } from "../../format";
import { useApi } from "../../hooks";
import { Check, ErrorBox, Field, MoneyInput, Skeleton, SwitchRow, useToast } from "../../ui";

export default function Settings() {
  const prof = useApi<any>("/candidate/profile");
  const dict = useApi<any>("/dict");
  const [f, setF] = useState<any>(null);
  const [fspId, setFspId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (prof.data && !f) setF({ ...prof.data, soft: (prof.data.soft_skills ?? []).join(", "), stacksStr: (prof.data.stacks ?? []).join(", ") });
  }, [prof.data, f]);
  if (!f || !dict.data) return <Skeleton h={400} />;
  const p = prof.data;

  const save = async () => {
    setError(null); setBusy(true);
    try {
      await api.put("/candidate/profile", {
        full_name: f.full_name || null, phone: f.phone || null, telegram: f.telegram || null, city: f.city || null, about: f.about || null,
        salary_expect: f.salary_expect || null, formats: f.formats, experience_years: f.experience_years === "" || f.experience_years == null ? null : Number(f.experience_years),
        soft_skills: f.soft.split(",").map((s: string) => s.trim()).filter(Boolean), stacks: f.stacksStr.split(",").map((s: string) => s.trim()).filter(Boolean),
      });
      await api.put("/candidate/privacy", { privacy: f.privacy, consent_processing: f.consent_processing, consent_publish: f.consent_publish });
      await prof.reload();
      toast("Сохранено");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const setPriv = (k: string, v: boolean) => setF({ ...f, privacy: { ...f.privacy, [k]: v } });
  const linkFsp = async () => {
    setError(null);
    try { await api.post("/candidate/fsp/link", { fsp_id: fspId.trim() }); await prof.reload(); toast("Профиль связан с ФСП — рейтинг обновлён"); } catch (e: any) { setError(e.message); }
  };
  const unlinkFsp = async () => { await api.del("/candidate/fsp/link"); await prof.reload(); };
  const uploadResume = async (file: File) => {
    setError(null);
    try { const r = await api.upload("/candidate/resume", file); toast(`Резюме разобрано: ${r.parsed.stacks?.length ?? 0} технологий, мест работы: ${r.parsed.experience?.length ?? 0}`); setF(null); await prof.reload(); } catch (e: any) { setError(e.message); }
  };

  const priv: [string, string][] = [
    ["show_name", "Показывать имя (иначе «Кандидат #код»)"],
    ["show_experience", "Показывать места работы и должности"],
    ["show_city", "Показывать город"],
    ["show_salary", "Показывать ожидания по зарплате"],
    ["searchable", "Участвовать в подборках и поиске"],
  ];

  return (
    <>
      <h1 className="page-title">Настройки</h1>
      <ErrorBox error={error} />
      <div className="split" style={{ gap: 56 }}>
        <section className="col" style={{ gap: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h3">Профиль</h2>
            <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && uploadResume(e.target.files[0])} />
            <button className="btn btn-outline btn-md" onClick={() => fileRef.current?.click()}>Загрузить PDF-резюме</button>
          </div>
          <Field label="ФИО"><input className="input" value={f.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></Field>
          <Field label="Email" hint="Логин. Сменить можно через поддержку."><input className="input" value={p.email ?? ""} readOnly style={{ color: "var(--ink-2)" }} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 18 }}>
            <Field label="Телефон"><input className="input" type="tel" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Telegram"><input className="input" value={f.telegram ?? ""} onChange={(e) => set("telegram", e.target.value)} placeholder="@username" /></Field>
            <Field label="Город"><input className="input" value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="Опыт, лет"><input className="input" inputMode="decimal" value={f.experience_years ?? ""} onChange={(e) => set("experience_years", e.target.value)} /></Field>
          </div>
          <Field label="Ожидания, от ₽ в месяц"><MoneyInput value={f.salary_expect} onChange={(v) => set("salary_expect", v)} /></Field>
          <Field label="Стек — через запятую"><input className="input" value={f.stacksStr} onChange={(e) => set("stacksStr", e.target.value)} /></Field>
          <Field label="Софт-скиллы — через запятую"><input className="input" value={f.soft} onChange={(e) => set("soft", e.target.value)} /></Field>
          <Field label="О себе"><textarea className="textarea" rows={3} value={f.about ?? ""} onChange={(e) => set("about", e.target.value)} /></Field>
          <div className="col" style={{ gap: 10 }}>
            <span className="label">Формат</span>
            <div className="chips">{dict.data.formats.map((x: any) => <button key={x.id} className="chip" aria-pressed={f.formats.includes(x.id)} onClick={() => set("formats", f.formats.includes(x.id) ? f.formats.filter((y: string) => y !== x.id) : [...f.formats, x.id])}>{x.title}</button>)}</div>
          </div>
          <span className="small muted">Резюме заполняет поля, но категорию не меняет — её определяет только тест.</span>
          <button className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start" }} onClick={save} disabled={busy}>{busy ? <><span className="spin" />Сохраняю…</> : "Сохранить"}</button>
        </section>

        <section className="col" style={{ gap: 36 }}>
          <div className="col" style={{ gap: 10 }}>
            <h2 className="h3">Приватность</h2>
            <div style={{ borderTop: "var(--hair)" }}>
              {priv.map(([k, t]) => <SwitchRow key={k} checked={f.privacy[k] !== false} onChange={(v) => setPriv(k, v)} label={t} />)}
            </div>
            <span className="small muted">Email, телефон и Telegram компания увидит только после того, как вы примете её приглашение или откликнетесь сами.</span>
          </div>

          <div className="col" style={{ gap: 12 }}>
            <h2 className="h3">Согласия 152-ФЗ</h2>
            <Check checked={f.consent_processing} onChange={(v) => set("consent_processing", v)} label="Обработка персональных данных" />
            <Check checked={f.consent_publish} onChange={(v) => set("consent_publish", v)} label="Публикация профиля в подборках — без контактов, с учётом приватности" />
            {p.consent_at && <span className="small muted">Последнее изменение — {date(p.consent_at)}. Изменения вступят в силу после «Сохранить».</span>}
          </div>

          <div className="col" style={{ background: "var(--blue-soft)", color: "var(--ink)", padding: 22, gap: 14 }}>
            <span className="h3 row" style={{ gap: 8 }}><img src="/brand/fsp-star-black.svg" alt="" width={20} height={19} />ID участника ФСП</span>
            {p.fsp.id ? (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 17 }}>{p.fsp.id} связан</span>
                  <button className="linkbtn" onClick={unlinkFsp}>Отвязать</button>
                </div>
                <span className="small" style={{ color: "var(--ink-2)" }}>Связан {date(p.fsp.linked_at)}, результатов: {p.fsp.achievements.length}. Подробности — в паспорте навыков.</span>
              </>
            ) : (
              <>
                <div className="row" style={{ gap: 12 }}>
                  <input className="input sm mono" style={{ maxWidth: 240, fontSize: 16 }} placeholder="FSP-2025-0001" value={fspId} onChange={(e) => setFspId(e.target.value)} aria-label="ID ФСП" />
                  <button className="btn btn-primary btn-md" onClick={linkFsp} disabled={fspId.trim().length < 3}>Связать</button>
                </div>
                <span className="small" style={{ color: "var(--ink-2)" }}>Демо-ID: FSP-2025-0001 или FSP-000001…FSP-005000. Без ФСП позиция в выдаче не страдает.</span>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
