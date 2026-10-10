const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  databaseUrl: env.DATABASE_URL ?? "postgres://proof:proof@localhost:5433/proof",
  engineUrl: env.ENGINE_URL ?? "http://localhost:8001",
  fspUrl: env.FSP_URL ?? "http://localhost:8002",
  jwtSecret: env.JWT_SECRET ?? "dev-secret-change-me",
  publicUrl: env.PUBLIC_URL ?? "http://localhost:5173",
  smtp: env.SMTP_HOST
    ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 1025), user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM ?? "шаурматч_ <no-reply@shaurmatch.local>" }
    : null,
  // Демо-режим: ссылка подтверждения email возвращается в ответе (для проверки жюри без почты)
  demoMode: (env.DEMO_MODE ?? "true") === "true",
  keycloak: env.KEYCLOAK_ISSUER
    ? { issuer: env.KEYCLOAK_ISSUER, clientId: env.KEYCLOAK_CLIENT_ID ?? "proof", clientSecret: env.KEYCLOAK_CLIENT_SECRET ?? "", publicIssuer: env.KEYCLOAK_PUBLIC_ISSUER ?? env.KEYCLOAK_ISSUER }
    : null,
  gradeCooldownDays: 90,
};
