import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { A11yProvider } from "./a11y";
import { AuthProvider } from "./auth";
import { CandidateShell, EmployerShell, RequireRole } from "./layout";
import "./styles.css";
import { ToastProvider } from "./ui";

import CDashboard from "./pages/candidate/Dashboard";
import CInvitations from "./pages/candidate/Invitations";
import COnboarding from "./pages/candidate/Onboarding";
import CPassport from "./pages/candidate/Passport";
import CSettings from "./pages/candidate/Settings";
import CTasks from "./pages/candidate/Tasks";
import CTest from "./pages/candidate/Test";
import CVacancies from "./pages/candidate/Vacancies";
import ECandidates from "./pages/employer/Candidates";
import ECompany from "./pages/employer/Company";
import EInvitations from "./pages/employer/Invitations";
import EMarket from "./pages/employer/Market";
import ESelection from "./pages/employer/Selection";
import ETasks from "./pages/employer/Tasks";
import EVacancies from "./pages/employer/Vacancies";
import Login from "./pages/public/Login";
import Marinade from "./pages/public/Marinade";
import Method from "./pages/public/Method";
import NotFound from "./pages/public/NotFound";
import Verify from "./pages/public/Verify";

/** Старые ссылки (/login?next=…, из писем) ведут на вход, который теперь стартовая страница. */
function ToLogin() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <A11yProvider>
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/login" element={<ToLogin />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/method" element={<Method />} />
              <Route path="/marinade" element={<Marinade />} />
              <Route path="/candidate/onboarding" element={<RequireRole role="candidate"><COnboarding /></RequireRole>} />
              <Route path="/candidate" element={<RequireRole role="candidate"><CandidateShell /></RequireRole>}>
                <Route index element={<CDashboard />} />
                <Route path="invitations" element={<CInvitations />} />
                <Route path="passport" element={<CPassport />} />
                <Route path="tasks" element={<CTasks />} />
                <Route path="test" element={<CTest />} />
                <Route path="vacancies" element={<CVacancies />} />
                <Route path="settings" element={<CSettings />} />
              </Route>
              <Route path="/employer" element={<RequireRole role="employer"><EmployerShell /></RequireRole>}>
                <Route index element={<ESelection />} />
                <Route path="market" element={<EMarket />} />
                <Route path="candidates" element={<ECandidates />} />
                <Route path="invitations" element={<EInvitations />} />
                <Route path="tasks" element={<ETasks />} />
                <Route path="vacancies" element={<EVacancies />} />
                <Route path="company" element={<ECompany />} />
              </Route>
              <Route path="/vacancies" element={<Navigate to="/candidate/vacancies" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </A11yProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
