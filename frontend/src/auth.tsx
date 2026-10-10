import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface Me {
  id: string;
  email: string;
  role: "candidate" | "employer" | "admin";
  email_verified: boolean;
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ me: null, loading: true, refresh: async () => null, logout: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: Me | null }>("/auth/me");
      setMe(r.user);
      return r.user;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setMe(null);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
