import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export type Role = "candidate" | "employer" | "admin";
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = "proof_token";

export function issueToken(res: Response, user: AuthUser) {
  const token = jwt.sign(user, config.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.publicUrl.startsWith("https"), maxAge: 7 * 864e5 });
  return token;
}

export function clearToken(res: Response) {
  res.clearCookie(COOKIE);
}

/** Читает JWT из httpOnly-cookie или заголовка Authorization: Bearer. */
export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = req.cookies?.[COOKIE] ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (token) {
    try {
      const p = jwt.verify(token, config.jwtSecret) as AuthUser;
      req.user = { id: p.id, email: p.email, role: p.role };
    } catch {
      /* просроченный токен — как аноним */
    }
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Нужно войти", "unauthorized"));
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, "Недостаточно прав", "forbidden"));
    next();
  };
}
