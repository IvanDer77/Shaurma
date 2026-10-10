import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { openapiDocument } from "./api.js";
import { authOptional } from "./auth.js";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { router as auth } from "./routes/auth.js";
import { router as candidate } from "./routes/candidate.js";
import { router as dict } from "./routes/dict.js";
import { router as employer } from "./routes/employer.js";
import { router as invitations } from "./routes/invitations.js";
import { router as learning } from "./routes/learning.js";
import { router as tasks } from "./routes/tasks.js";
import { router as tests } from "./routes/tests.js";
import { router as vacancies } from "./routes/vacancies.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.publicUrl, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(authOptional);

  const api = Router();
  // Защита от перебора паролей и спама письмами — только на чувствительных методах
  const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited", message: "Слишком много попыток, подождите минуту" } });
  api.use(["/auth/login", "/auth/register", "/auth/resend", "/auth/verify"], authLimiter);
  // Публичная витрина языковой модели: без входа, поэтому с ограничением частоты
  api.use("/public/learning/recipe", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "rate_limited", message: "Слишком много запросов, подождите минуту" } }));
  for (const r of [auth, dict, candidate, tests, invitations, employer, vacancies, tasks, learning]) api.use(r);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/openapi.json", (_req, res) => res.json(openapiDocument()));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: "/api/openapi.json" }, customSiteTitle: "шаурматч_ API" }));
  app.use("/api/v1", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found", message: "Метод не найден" }));
  app.use(errorHandler);
  return app;
}
