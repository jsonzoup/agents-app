import { promises as fs } from "node:fs";
import path from "node:path";
import type { Db, Task } from "./types";

export const DATA_DIR = path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
export const PAGE_DIR = path.join(DATA_DIR, "pages");
const DB_PATH = path.join(DATA_DIR, "db.json");

let queue: Promise<unknown> = Promise.resolve();

/** 简单串行化，避免并发写坏 JSON。 */
export function withLock<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export async function readDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Db;
    if (!parsed.tasks) parsed.tasks = [];
    if (!parsed.pending) parsed.pending = [];
    return parsed;
  } catch {
    const empty: Db = { version: 1, seq: 0, tasks: [], pending: [] };
    return empty;
  }
}

export async function writeDb(db: Db): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

export async function updateDb<T>(work: (db: Db) => Promise<T> | T): Promise<T> {
  return withLock(async () => {
    const db = await readDb();
    const result = await work(db);
    await writeDb(db);
    return result;
  });
}

export async function getTask(id: string): Promise<Task | undefined> {
  const db = await readDb();
  return db.tasks.find((t) => t.id === id);
}

export const nowIso = () =>
  new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(" ", "T") + "+08:00";

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureDirs(): Promise<void> {
  await Promise.all(
    [DATA_DIR, UPLOAD_DIR, EXPORT_DIR, PAGE_DIR, path.join(UPLOAD_DIR, "_pending")].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  );
}
