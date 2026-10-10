import { Link } from "react-router-dom";
import { Logo } from "../../ui";

export default function NotFound() {
  return (
    <div className="app">
      <header className="topnav" style={{ position: "static" }}><div className="topnav-in"><Logo /></div></header>
      <main className="page page-narrow" style={{ gap: 20 }}>
        <span style={{ font: "400 clamp(96px, 18vw, 180px)/.9 var(--pixel)", color: "var(--blue)" }}>404</span>
        <h1 className="page-title">Такой шаурмы нет в меню</h1>
        <p className="page-sub" style={{ marginTop: 0 }}>Страница не найдена или переехала.</p>
        <Link to="/" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>На главную</Link>
      </main>
    </div>
  );
}
