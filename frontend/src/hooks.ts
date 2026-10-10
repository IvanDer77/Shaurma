import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Загрузка данных с API: { data, error, loading, reload, setData }. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((nv: T) => {
    setV(nv);
    try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* приватный режим */ }
  }, [key]);
  return [v, set];
}
