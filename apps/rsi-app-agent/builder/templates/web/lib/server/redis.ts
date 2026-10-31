import "server-only";
import Redis from "ioredis";

/**
 * This app's Redis: cache, counters, short-lived state shared by every running copy. The
 * platform passes `REDIS_URL` and `REDIS_PREFIX`; the app's user can only touch keys under the
 * prefix, which this client adds by itself.
 */
const holder = globalThis as unknown as { __appRedis?: Redis };

export function redis(): Redis {
  if (!process.env.REDIS_URL) throw new Error("没有 REDIS_URL：平台没有为这个应用开通 Redis，或在本机开发时没有在 .env 里设置");
  holder.__appRedis ??= new Redis(process.env.REDIS_URL, { keyPrefix: process.env.REDIS_PREFIX ?? "", maxRetriesPerRequest: 3 });
  return holder.__appRedis;
}

/** A value cached for `seconds`, computed once across all copies of the app. */
export async function cached<T>(key: string, seconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await redis().get(`cache:${key}`);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await compute();
  await redis().set(`cache:${key}`, JSON.stringify(value), "EX", seconds);
  return value;
}
