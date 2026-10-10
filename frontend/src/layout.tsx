import { useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useA11y } from "./a11y";
import { useAuth } from "./auth";
import { useApi } from "./hooks";
import { Avatar, Drawer, Logo, Spinner } from "./ui";

interface NavItem { to: string; t: string; short?: string; badge?: number | null; end?: boolean; mobile?: boolean }

function Shell({ home, nav, who, tickets }: { home: string; nav: NavItem[]; who: { name: string; short: string; bg?: string }; tickets?: { left: number; limit: number } | null }) {
  const { logout } = useAuth();
  const { open: openA11y } = useA11y();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const exit = async () => { await logout(); navigate("/"); };
  const mobileNav = nav.filter((n) => n.mobile).slice(0, 4);
  return (
    <div className="app">
      <a href="#main" className="sr-only">Перейти к содержимому</a>
      <header className="topnav">
        <div className="topnav-in">
          <Logo to={home} />
          <nav className="tnav" aria-label="Разделы">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
                {n.t}{n.badge ? <span className="count" aria-label={`новых: ${n.badge}`}>{n.badge}</span> : null}
              </NavLink>
            ))}
          </nav>
          <div className="who">
            {tickets && <span className="tickets" title="Талоны приглашений на неделю: талон возвращается, когда кандидат ответит">талоны {tickets.left}/{tickets.limit}</span>}
            <Avatar name={who.name} size={32} bg={who.bg} />
            <span className="name" style={{ fontWeight: 600 }}>{who.short}</span>
            <button className="linkbtn hide-mobile" onClick={openA11y}>Доступность</button>
            <button className="linkbtn hide-mobile" onClick={exit}>Выйти</button>
          </div>
        </div>
      </header>
      <main className="page" id="main">
        <Outlet />
      </main>
      <nav className="mtab" aria-label="Разделы">
        {mobileNav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.short ?? n.t}{n.badge ? <span className="count">{n.badge}</span> : null}
          </NavLink>
        ))}
        <a href="#menu" onClick={(e) => { e.preventDefault(); setMenu(true); }}>Ещё</a>
      </nav>
      <Drawer open={menu} onClose={() => setMenu(false)} title="Меню" width={420}>
        <div className="rows">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="ri" onClick={() => setMenu(false)} style={{ color: "var(--ink)", fontWeight: 600, textDecoration: "none" }}>
              <span className="ri-main">{n.t}</span>{n.badge ? <span className="count">{n.badge}</span> : null}
            </NavLink>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-outline btn-md" onClick={() => { setMenu(false); openA11y(); }}>Доступность</button>
          <button className="btn btn-ghost btn-md" onClick={exit}>Выйти</button>
        </div>
      </Drawer>
    </div>
  );
}

export function RequireRole({ role, children }: { role: "candidate" | "employer"; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to={`/?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (me.role !== role) return <Navigate to={me.role === "employer" ? "/employer" : "/candidate"} replace />;
  return <>{children}</>;
}

export function CandidateShell() {
  const prof = useApi<any>("/candidate/profile");
  const inv = useApi<any>("/candidate/invitations");
  const tasks = useApi<any[]>("/candidate/tasks");
  const newInv = inv.data?.items?.filter((i: any) => i.status === "sent").length ?? 0;
  const openTasks = tasks.data?.filter((t: any) => !t.submitted_at).length ?? 0;
  const p = prof.data;
  const name = p?.full_name || p?.email || "Кандидат";
  return (
    <Shell
      home="/candidate"
      who={{ name, short: p?.full_name ? p.full_name.split(" ")[0] : "Вы" }}
      nav={[
        { to: "/candidate", t: "Главная", end: true, mobile: true },
        { to: "/candidate/invitations", t: "Приглашения", short: "Приглаш.", badge: newInv || null, mobile: true },
        { to: "/candidate/test", t: "Тест на грейд", short: "Тест", mobile: true },
        { to: "/candidate/passport", t: "Паспорт" },
        { to: "/candidate/tasks", t: "Задачи", badge: openTasks || null, mobile: true },
        { to: "/candidate/vacancies", t: "Вакансии" },
        { to: "/candidate/settings", t: "Настройки" },
      ]}
    />
  );
}

export function EmployerShell() {
  const company = useApi<any>("/employer/company");
  const c = company.data;
  return (
    <Shell
      home="/employer"
      who={{ name: c?.name ?? "Компания", short: c?.name ?? "Компания", bg: "#0A006B" }}
      tickets={c?.tickets}
      nav={[
        { to: "/employer", t: "Подбор", end: true, mobile: true },
        { to: "/employer/candidates", t: "Банк", short: "Банк", mobile: true },
        { to: "/employer/invitations", t: "Приглашения", short: "Приглаш.", mobile: true },
        { to: "/employer/tasks", t: "Дегустация", mobile: true },
        { to: "/employer/vacancies", t: "Вакансии" },
        { to: "/employer/market", t: "Рынок" },
        { to: "/employer/company", t: "Компания" },
      ]}
    />
  );
}

/** Публичные страницы «Метод» и «Маринад»: та же шапка, что в кабинетах, без навигации по разделам. */
export function PublicShell({ children }: { children: ReactNode }) {
  const { open: openA11y } = useA11y();
  const { me } = useAuth();
  const home = me ? (me.role === "employer" ? "/employer" : "/candidate") : "/";
  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-in">
          <Logo to={home} />
          <nav className="tnav" aria-label="Разделы">
            <NavLink to="/method">Метод</NavLink>
            <NavLink to="/marinade">Маринад</NavLink>
            <a href="/api/docs">API</a>
            <a href="/brand/brandbook.html">Брендбук</a>
          </nav>
          <div className="who">
            <button className="linkbtn" onClick={openA11y}>Доступность</button>
            <NavLink to={home} className="btn btn-dark btn-sm">{me ? "В кабинет" : "Войти"}</NavLink>
          </div>
        </div>
      </header>
      <main id="main" className="page">{children}</main>
    </div>
  );
}
