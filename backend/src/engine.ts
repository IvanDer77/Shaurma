import { config } from "./config.js";
import { HttpError } from "./errors.js";

/** Клиент ШАУРМА-движка (Python/FastAPI). Движок без состояния: данные хранит backend. */
export async function engine<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(config.engineUrl + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `Движок ШАУРМА: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function engineUpload<T = any>(path: string, file: Buffer, filename: string): Promise<T> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: "application/pdf" }), filename);
  const res = await fetch(config.engineUrl + path, { method: "POST", body: form });
  if (!res.ok) throw new HttpError(422, `Не удалось разобрать файл: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

let catalogCache: any = null;
export async function catalog() {
  if (!catalogCache) catalogCache = await engine("/catalog");
  return catalogCache;
}
