import "server-only";
import { Pool } from "pg";
import type { QueryResultRow } from "pg";

/**
 * This app's own PostgreSQL database. The platform opens it and passes `DATABASE_URL`; the
 * published versions and the workspace preview get different databases.
 * Several copies of this app may run at once: keep data here, never in memory or local files.
 */
const holder = globalThis as unknown as { __appDb?: Pool };

export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("没有 DATABASE_URL：平台没有为这个应用开通数据库，或在本机开发时没有在 .env 里设置");
  holder.__appDb ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return holder.__appDb;
}

/** One statement with `$1…` parameters. */
export async function sql<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(text, params)).rows;
}

/**
 * Apply schema changes once each, in order, even when several copies start together.
 * Never edit a step that has run; add a new one.
 */
export async function migrate(steps: { id: string; sql: string }[]): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('app:migrate'))");
    await client.query("CREATE TABLE IF NOT EXISTS app_migrations (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM app_migrations")).rows.map((r) => r.id));
    for (const step of steps) {
      if (done.has(step.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(step.sql);
        await client.query("INSERT INTO app_migrations (id) VALUES ($1)", [step.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('app:migrate'))").catch(() => undefined);
    client.release();
  }
}
