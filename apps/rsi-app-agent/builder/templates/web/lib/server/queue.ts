import "server-only";
import { hostname } from "node:os";
import Redis from "ioredis";

/**
 * Background work for this app on Redis Streams: `enqueue` from a route, `work` in
 * `lib/server/jobs.ts`. Each job goes to one running copy of the app; a job whose copy stopped
 * is picked up by another after `staleMs`, so handlers must be safe to run twice (check
 * whether the work is already done before doing it).
 */
const prefix = () => process.env.QUEUE_PREFIX ?? `${process.env.REDIS_PREFIX ?? ""}queue:`;

function connect(): Redis {
  if (!process.env.REDIS_URL) throw new Error("没有 REDIS_URL：平台没有为这个应用开通队列");
  return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
}

const holder = globalThis as unknown as { __appQueue?: Redis };

export async function enqueue(queue: string, payload: unknown): Promise<string> {
  holder.__appQueue ??= connect();
  return (await holder.__appQueue.xadd(`${prefix()}${queue}`, "MAXLEN", "~", "10000", "*", "payload", JSON.stringify(payload))) as string;
}

export interface WorkOptions {
  /** Jobs handled at once by this copy. */
  concurrency?: number;
  /** A job not finished after this long is given to another copy. */
  staleMs?: number;
}

/** Handle jobs of one queue until the process ends. */
export function work<T>(queue: string, handler: (payload: T, job: { id: string; retried: boolean }) => Promise<void>, options: WorkOptions = {}): void {
  const stream = `${prefix()}${queue}`;
  const group = "workers";
  const consumer = `${hostname()}-${process.pid}`;
  const concurrency = options.concurrency ?? 2;
  const staleMs = options.staleMs ?? 5 * 60_000;
  const reader = connect();
  const control = connect();
  const active = new Map<string, Promise<void>>();

  const run = (id: string, fields: string[], retried: boolean) => {
    const raw = fields[fields.indexOf("payload") + 1] ?? "null";
    const p = handler(JSON.parse(raw) as T, { id, retried })
      .catch((error) => console.error(`[queue ${queue}] ${id} 失败：`, error))
      .finally(async () => {
        active.delete(id);
        await control.xack(stream, group, id);
        await control.xdel(stream, id);
      });
    active.set(id, p);
  };

  void (async () => {
    await control.xgroup("CREATE", stream, group, "$", "MKSTREAM").catch((e: Error) => {
      if (!/BUSYGROUP/.test(e.message)) throw e;
    });
    setInterval(() => {
      const ids = [...active.keys()];
      if (ids.length) void control.xclaim(stream, group, consumer, 0, ...ids, "JUSTID");
    }, Math.min(15_000, staleMs / 4)).unref();
    setInterval(async () => {
      if (active.size >= concurrency) return;
      const reply = (await control.xautoclaim(stream, group, consumer, staleMs, "0-0", "COUNT", concurrency - active.size)) as [string, [string, string[]][]];
      for (const [id, fields] of reply[1] ?? []) if (id && fields && !active.has(id)) run(id, fields, true);
    }, staleMs / 2).unref();
    for (;;) {
      if (active.size >= concurrency) {
        await Promise.race(active.values());
        continue;
      }
      const reply = (await reader.xreadgroup("GROUP", group, consumer, "COUNT", 1, "BLOCK", 5000, "STREAMS", stream, ">")) as [string, [string, string[]][]][] | null;
      for (const [, entries] of reply ?? []) for (const [id, fields] of entries) run(id, fields, false);
    }
  })().catch((error) => console.error(`[queue ${queue}] 停止：`, error));
}
