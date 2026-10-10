import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = (what = "Объект") => new HttpError(404, `${what} не найден`, "not_found");

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_error", message: "Проверьте поля формы", details: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code ?? "error", message: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "internal", message: "Внутренняя ошибка сервера" });
}
