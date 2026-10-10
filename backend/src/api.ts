import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { requireRole, type Role } from "./auth.js";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "cookieAuth", { type: "apiKey", in: "cookie", name: "proof_token" });
registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });

const ErrorSchema = registry.register(
  "Error",
  z.object({ error: z.string(), message: z.string() }).openapi({ example: { error: "not_found", message: "Объект не найден" } }),
);

type Method = "get" | "post" | "put" | "patch" | "delete";
interface RouteSpec<B extends z.ZodTypeAny, Q extends z.ZodTypeAny> {
  method: Method;
  path: string; // в стиле express: /candidates/:id
  summary: string;
  tag: string;
  roles?: Role[] | "any"; // undefined — публичный метод
  body?: B;
  query?: Q;
  response?: z.ZodTypeAny;
  description?: string;
  multipart?: boolean;
  binary?: string; // content-type бинарного ответа (например application/pdf)
  middleware?: RequestHandler[]; // например, приём файла (multer)
}

/**
 * Регистрирует маршрут в Express и в спецификации OpenAPI одновременно:
 * документация не может разойтись с кодом.
 */
export function route<B extends z.ZodTypeAny = z.ZodTypeAny, Q extends z.ZodTypeAny = z.ZodTypeAny>(
  router: Router,
  basePath: string,
  spec: RouteSpec<B, Q>,
  handler: (req: Request & { body: z.infer<B>; q: z.infer<Q> }, res: Response) => Promise<unknown>,
) {
  const fullPath = basePath + spec.path;
  const params = [...fullPath.matchAll(/:(\w+)/g)].map((m) => m[1]);
  registry.registerPath({
    method: spec.method,
    path: fullPath.replace(/:(\w+)/g, "{$1}"),
    summary: spec.summary,
    description: spec.description,
    tags: [spec.tag],
    security: spec.roles ? [{ cookieAuth: [] }, { bearerAuth: [] }] : undefined,
    request: {
      params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) : undefined,
      query: spec.query as any,
      body: spec.multipart
        ? { content: { "multipart/form-data": { schema: z.object({ file: z.string().openapi({ type: "string", format: "binary" }) }) } } }
        : spec.body
          ? { content: { "application/json": { schema: spec.body } } }
          : undefined,
    },
    responses: {
      200: spec.binary
        ? { description: "Файл", content: { [spec.binary]: { schema: z.string().openapi({ type: "string", format: "binary" }) } } }
        : { description: "Успех", content: spec.response ? { "application/json": { schema: spec.response } } : undefined },
      400: { description: "Ошибка валидации", content: { "application/json": { schema: ErrorSchema } } },
      ...(spec.roles ? { 401: { description: "Не авторизован", content: { "application/json": { schema: ErrorSchema } } }, 403: { description: "Нет прав", content: { "application/json": { schema: ErrorSchema } } } } : {}),
      404: { description: "Не найдено", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  const guards = spec.roles ? [requireRole(...(spec.roles === "any" ? [] : spec.roles))] : [];
  router[spec.method](fullPath, ...guards, ...(spec.middleware ?? []), async (req: any, res: Response, next: any) => {
    try {
      if (spec.body && !spec.multipart) req.body = spec.body.parse(req.body ?? {});
      req.q = spec.query ? spec.query.parse(req.query) : {};
      const data = await handler(req, res);
      if (!res.headersSent) res.json(data ?? { ok: true });
    } catch (e) {
      next(e);
    }
  });
}

export function openapiDocument() {
  const gen = new OpenApiGeneratorV3(registry.definitions);
  return gen.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "шаурматч_ API",
      version: "1.0.0",
      description:
        "REST API платформы обратного ИТ-найма «шаурматч_» (хакатон ЛЦТ 2026, спецтрек ФСП). " +
        "Механика тестирования и подбора — метод «ШАУРМА». Аутентификация: httpOnly-cookie `proof_token` или `Authorization: Bearer`.",
    },
    servers: [{ url: "/api/v1" }],
  });
}

export { z };
