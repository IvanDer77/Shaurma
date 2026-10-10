import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useApi } from "../../hooks";
import { ErrorBox, Field, Skeleton, useToast } from "../../ui";

export default function Company() {
  const c = useApi<any>("/employer/company");
  const [f, setF] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const toast = useToast();
  useEffect(() => { if (c.data && !f) setF(c.data); }, [c.data, f]);
  if (!f) return <Skeleton h={300} />;
  const save = async () => {
    setError(null);
    try {
      await api.put("/employer/company", { name: f.name, sphere: f.sphere || null, description: f.description || null, website: f.website || null, contact_email: f.contact_email || null, contact_phone: f.contact_phone || null, contact_telegram: f.contact_telegram || null });
      await c.reload(); toast("Профиль компании сохранён");
    } catch (e: any) { setError(e.message); }
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const t = c.data.tickets;
  return (
    <>
      <h1 className="page-title">Компания</h1>
      {params.get("welcome") && <div className="note note-ok">Email подтверждён. Заполните профиль — кандидаты видят его в приглашениях. Затем опишите потребность в разделе «Подбор».</div>}
      <ErrorBox error={error} />
      <div className="split" style={{ gap: 56 }}>
        <section className="col" style={{ gap: 18 }}>
          <h2 className="h3">Профиль</h2>
          <Field label="Название"><input className="input" value={f.name ?? ""} onChange={set("name")} /></Field>
          <Field label="Направление деятельности"><input className="input" value={f.sphere ?? ""} onChange={set("sphere")} placeholder="Финтех, e-commerce…" /></Field>
          <Field label="Сайт"><input className="input" value={f.website ?? ""} onChange={set("website")} placeholder="https://" /></Field>
          <Field label="Описание организации"><textarea className="textarea" rows={4} value={f.description ?? ""} onChange={set("description")} /></Field>
          <h2 className="h3" style={{ marginTop: 10 }}>Контакты для кандидатов</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 18 }}>
            <Field label="Email"><input className="input" type="email" value={f.contact_email ?? ""} onChange={set("contact_email")} /></Field>
            <Field label="Телефон"><input className="input" type="tel" value={f.contact_phone ?? ""} onChange={set("contact_phone")} /></Field>
            <Field label="Telegram"><input className="input" value={f.contact_telegram ?? ""} onChange={set("contact_telegram")} placeholder="@company_hr" /></Field>
          </div>
          <button className="btn btn-primary btn-lg" style={{ alignSelf: "flex-start" }} onClick={save}>Сохранить</button>
        </section>

        <section className="col" style={{ gap: 28 }}>
          <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div><span className="tile-label">талоны на неделю</span><span className="tile-num">{t.left}<span style={{ fontSize: 20, color: "#9B9C9E" }}> /{t.limit}</span></span><span className="tile-sub">вернётся, когда кандидат ответит</span></div>
            <div><span className="tile-label">репутация</span><span className="tile-num" style={{ color: "var(--violet)" }}>{c.data.trust}</span><span className="tile-sub">лимит растёт вместе с ней</span></div>
          </div>
          <div className="col" style={{ gap: 10 }}>
            <h2 className="h3">«Честный ценник»</h2>
            {c.data.honest_badge ? <span className="honest" style={{ alignSelf: "flex-start" }}>₽ честный ценник</span> : <span className="note note-warn">Бейдж снят: кандидаты сообщали, что зарплата на собеседовании была ниже вилки.</span>}
            <p className="small" style={{ color: "var(--ink-2)", lineHeight: 1.6 }}>После собеседования кандидат отвечает, совпала ли зарплата с вилкой из приглашения. Бейдж видят все кандидаты. Талоны ограничивают массовые рассылки и фиктивные вакансии.</p>
          </div>
        </section>
      </div>
    </>
  );
}
