import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useA11y } from "../../a11y";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { useApi } from "../../hooks";
import { ErrorBox, Logo, Spinner } from "../../ui";
import { PixelCode } from "../candidate/Dashboard";

/** Демо-аккаунты для жюри: вход в один клик (пароль у всех shaurma2026). */
const DEMO = [
  { email: "alexey@shaurmatch.demo", name: "Алексей Смирнов", note: "Кандидат с историей ФСП", a: "BE", b: "SEN" },
  { email: "maria@shaurmatch.demo", name: "Мария Ковалёва", note: "Кандидат без истории ФСП", a: "FE", b: "MID" },
  { email: "new@shaurmatch.demo", name: "Новый кандидат", note: "Путь с нуля: опрос, грейд и тест", a: "?", b: "" },
  { email: "employer@shaurmatch.demo", name: "ТехноЛаб", note: "Работодатель: подбор и приглашения", a: "HR", b: "" },
];
const DEMO_PASSWORD = "shaurma2026";

export default function Login() {
  const [params] = useSearchParams();
  const { me, loading, refresh } = useAuth();
  const { open: openA11y } = useA11y();
  const navigate = useNavigate();
  const providers = useApi<any>("/auth/providers");
  const [mode, setMode] = useState<"login" | "register">(params.get("mode") === "register" ? "register" : "login");
  const [role, setRole] = useState<"candidate" | "employer">(params.get("role") === "employer" ? "employer" : "candidate");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; url?: string } | null>(null);
  useEffect(() => setError(null), [mode]);

  if (loading) return <Spinner />;
  if (me) return <Navigate to={params.get("next") ?? (me.role === "employer" ? "/employer" : "/candidate")} replace />;

  const isReg = mode === "register";
  const passShort = password.length > 0 && password.length < 8;
  const why = !email ? "Введите email" : isReg && password.length < 8 ? "Пароль короче 8 символов" : !password ? "Введите пароль" : "";

  const enter = async (em: string, pw: string, key: string) => {
    setError(null);
    setBusy(key);
    try {
      const r = await api.post("/auth/login", { email: em, password: pw });
      await refresh();
      navigate(params.get("next") ?? (r.role === "employer" ? "/employer" : "/candidate"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (why) return;
    if (!isReg) return enter(email, password, "form");
    setError(null);
    setBusy("form");
    try {
      const r = await api.post("/auth/register", { email, password, role, ...(role === "employer" ? { company_name: company || undefined } : {}) });
      setSent({ email, url: r.verify_url });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app">
      <header className="topnav" style={{ position: "static" }}>
        <div className="topnav-in" style={{ maxWidth: "none" }}>
          <Logo />
          <span className="who" style={{ gap: 20 }}>
            <span className="hide-mobile">ИТ-найм наоборот</span>
            <button className="linkbtn" onClick={openA11y}>Доступность</button>
          </span>
        </div>
      </header>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))" }}>
        {/* ---------- форма ---------- */}
        <section style={{ padding: "clamp(36px, 7vw, 80px) 24px", display: "flex", justifyContent: "center" }}>
          {sent ? (
            <div className="col" style={{ width: "100%", maxWidth: 440, gap: 20 }}>
              <h1 className="page-title">Проверьте почту</h1>
              <p style={{ fontSize: 16, lineHeight: 1.55 }}>Отправили ссылку на <b>{sent.email}</b>. Откройте её — и попадёте в кабинет. Письмо идёт до пары минут; загляните в «Спам».</p>
              {sent.url && (
                <div className="note col" style={{ gap: 10 }}>
                  <span>Демо-режим: подтвердите адрес без почты.</span>
                  <a className="btn btn-primary" href={sent.url.replace(/^https?:\/\/[^/]+/, "")}>Подтвердить сейчас</a>
                </div>
              )}
              <div className="row">
                <button className="btn btn-outline btn-md" onClick={() => api.post("/auth/resend", { email: sent.email }).then((r) => setSent({ email: sent.email, url: r.verify_url ?? sent.url }))}>Отправить письмо ещё раз</button>
                <button className="linkbtn" onClick={() => { setSent(null); setMode("login"); }}>Ко входу</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="col" style={{ width: "100%", maxWidth: 440, gap: 22 }} noValidate>
              <h1 className="page-title">{isReg ? "Регистрация" : "Вход"}</h1>
              <div className="seg" role="radiogroup" aria-label="Кто вы" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                {([["candidate", "Кандидат"], ["employer", "Компания"]] as const).map(([id, t]) => (
                  <button key={id} type="button" role="radio" aria-checked={role === id} aria-selected={role === id} onClick={() => setRole(id)} style={{ height: 46, fontSize: 15 }}>{t}</button>
                ))}
              </div>
              <label className="field">
                <span className="label">Email</span>
                <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@mail.ru" />
              </label>
              <label className="field">
                <span className="label">Пароль</span>
                <input className="input" type="password" autoComplete={isReg ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={isReg ? "минимум 8 символов" : ""} aria-invalid={isReg && passShort} style={isReg && passShort ? { borderBottomColor: "var(--sauce)" } : undefined} />
                {isReg && <span className="hint" style={passShort ? { color: "var(--sauce-ink)" } : undefined}>{passShort ? `Ещё ${8 - password.length} ${8 - password.length === 1 ? "символ" : "символа"}` : "Минимум 8 символов"}</span>}
              </label>
              {isReg && role === "employer" && (
                <label className="field"><span className="label">Название компании</span><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ООО «Ромашка»" /></label>
              )}
              <ErrorBox error={error} />
              <div className="col" style={{ gap: 6 }}>
                <button className="btn btn-primary btn-lg btn-block" disabled={!!why || busy === "form"} aria-describedby="why">
                  {busy === "form" ? <><span className="spin" />{isReg ? "Регистрирую…" : "Вхожу…"}</> : isReg ? "Зарегистрироваться" : "Войти"}
                </button>
                <span id="why" className="why" aria-live="polite">{why && (email || password) ? why : ""}</span>
              </div>
              {providers.data?.keycloak && (
                <a className="btn btn-dark btn-lg btn-block" href={`${providers.data.keycloak_login_url}?role=${role}`}>
                  <img src="/brand/fsp-star-white.svg" alt="" width={22} height={21} />Войти через ФСП ID
                </a>
              )}
              <button type="button" className="linkbtn" style={{ color: "var(--blue)", fontWeight: 600, alignSelf: "flex-start" }} onClick={() => setMode(isReg ? "login" : "register")}>
                {isReg ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
              </button>
              {isReg && <p className="small muted">Согласие на обработку персональных данных спросим отдельно — перед тестом.</p>}
            </form>
          )}
        </section>

        {/* ---------- быстрый вход в демо-аккаунты ---------- */}
        <aside className="grid-blue" style={{ color: "#fff", padding: "clamp(36px, 7vw, 80px) clamp(24px, 6vw, 100px)", display: "flex", flexDirection: "column", gap: 28 }}>
          <div className="col" style={{ gap: 0 }}>
            <h2 className="h3" style={{ color: "#fff", fontSize: 20, paddingBottom: 18, borderBottom: "1px solid rgba(255,255,255,.35)" }}>Быстрый вход</h2>
            {DEMO.map((d) => (
              <button key={d.email} type="button" onClick={() => enter(d.email, DEMO_PASSWORD, d.email)} disabled={!!busy} className="demo-row">
                <span className="col" style={{ gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 17 }}>{busy === d.email ? "Вхожу…" : d.name}</span>
                  <span style={{ fontSize: 14, color: "#E3E0FF" }}>{d.note}</span>
                </span>
                <PixelCode code={d.b ? `${d.a}·${d.b}` : d.a} color="#fff" size="clamp(28px, 3.2vw, 40px)" />
              </button>
            ))}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 16, fontSize: 14 }}>
            <div className="row" style={{ gap: 22 }}>
              <Link to="/method" className="aside-link">Как устроен тест</Link>
              <Link to="/marinade" className="aside-link">Как учится платформа</Link>
              <a href="/api/docs" className="aside-link">API</a>
              <a href="/brand/brandbook.html" className="aside-link">Брендбук</a>
            </div>
            <span style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#E3E0FF", lineHeight: 1.45 }}><img src="/brand/fsp-star-white.svg" alt="" width={20} height={19} style={{ flexShrink: 0, marginTop: 1 }} />Платформа для экосистемы ФСП. Данные защищены по 152‑ФЗ</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
