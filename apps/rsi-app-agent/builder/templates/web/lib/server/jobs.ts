import "server-only";

/**
 * This app's background workers, started once per running copy (see `instrumentation.ts`).
 * Register them with `work` from `./queue`, e.g.
 *
 *   work<{ id: string }>("reports", async ({ id }) => { … });
 *
 * and queue jobs from a route with `enqueue("reports", { id })`.
 */
export function startWorkers(): void {}
