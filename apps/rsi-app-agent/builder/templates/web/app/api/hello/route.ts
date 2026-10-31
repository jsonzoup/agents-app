import { caller } from "@/lib/caller";

/**
 * A server route of this app, at `<basePath>/api/hello`. Server code runs with this app's `.env`
 * and the resources the platform opened for it (see `lib/server/`), and learns who is calling
 * from the platform.
 */
export async function GET(req: Request) {
  const who = caller(req.headers);
  return Response.json({
    app: process.env.NEXT_PUBLIC_RSI_APP ?? null,
    version: process.env.NEXT_PUBLIC_RSI_VERSION ?? null,
    user: who?.name ?? null,
    resources: { database: Boolean(process.env.DATABASE_URL), redis: Boolean(process.env.REDIS_URL), queue: Boolean(process.env.QUEUE_PREFIX), storage: Boolean(process.env.S3_BUCKET) },
  });
}
