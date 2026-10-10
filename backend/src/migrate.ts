import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function migrate() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/CREATE TABLE schema_migrations[^;]*;/, "");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`migration applied: ${file}`);
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end());
}
