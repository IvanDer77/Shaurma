import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth";
import { ErrorBox, Logo, Spinner } from "../../ui";

export default function Verify() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    api.post("/auth/verify", { token: params.get("token") ?? "" })
      .then(async (me) => { await refresh(); navigate(me.role === "employer" ? "/employer/company?welcome=1" : "/candidate/onboarding", { replace: true }); })
      .catch((e) => setError(e.message));
  }, [params, navigate, refresh]);
  return (
    <div className="app">
      <header className="topnav" style={{ position: "static" }}><div className="topnav-in"><Logo /></div></header>
      <main className="page page-narrow" style={{ maxWidth: 560 }}>
        <h1 className="page-title">Подтверждение email</h1>
        {error ? <><ErrorBox error={error} /><Link to="/" className="btn btn-outline" style={{ alignSelf: "flex-start" }}>Ко входу</Link></> : <Spinner label="Подтверждаем адрес…" />}
      </main>
    </div>
  );
}
