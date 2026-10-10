export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (!res.ok) {
    let data: any = {};
    try { data = await res.json(); } catch { /* пусто */ }
    const detail = data.details?.[0]?.message;
    throw new ApiError(res.status, detail ? `${data.message}: ${detail}` : data.message ?? `Ошибка ${res.status}`, data.error, data.details);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>("POST", p, b),
  put: <T = any>(p: string, b: unknown) => request<T>("PUT", p, b),
  del: <T = any>(p: string) => request<T>("DELETE", p),
  upload: <T = any>(p: string, f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    return request<T>("POST", p, fd, true);
  },
};

export const qs = (o: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) s.set(k, Array.isArray(v) ? v.join(",") : String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};
