/** Runs once when this copy of the app's server starts: starts its background workers when it has a queue. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.REDIS_URL) return;
  const { startWorkers } = await import("./lib/server/jobs");
  startWorkers();
}
