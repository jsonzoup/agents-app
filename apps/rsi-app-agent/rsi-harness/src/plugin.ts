/**
 * Cordis plugin that installs rsi-kernel into a harness profile and provides it as the
 * `rsi` service. The kernel stays harness-free; this file is the only place the two meet
 * at runtime.
 *
 * Port → harness mapping:
 * - Executor → `dsh --profile headless --json` subprocess per task (headless.ts).
 * - Judge → the app's judge MCP server over stdio, started by the kernel, never mounted
 *   into an agent's tool list.
 * - Store → files under `storeDir`.
 * - Release approvals (owner / engineer) are human decisions in the evolution UI, not
 *   harness tool approvals.
 */

import { FsAppSource, FsStore, RsiKernel, mcpJudge, systemClock } from '../../rsi-kernel/src/index.ts'
import type { Learner } from '../../rsi-kernel/src/index.ts'
import { headlessExecutor } from './headless.ts'
import type { HeadlessOptions } from './headless.ts'

/** The slice of a Cordis context this plugin uses. */
export interface PluginContext {
  provide(name: string, value: unknown): void
}

export interface Config {
  storeDir: string
  /** App directories to install, each with `code/` and `evals/`. */
  apps: string[]
  headless?: HeadlessOptions
  learners?: Learner[]
}

export const name = 'rsi'
export const inject: string[] = []

export async function apply(ctx: PluginContext, config: Config): Promise<RsiKernel> {
  const kernel = new RsiKernel({
    store: new FsStore(config.storeDir),
    clock: systemClock,
    executor: headlessExecutor(config.headless),
    judge: (app, v) => mcpJudge(app.source.evals.root, v.command, v.args),
    learners: config.learners,
  })
  for (const root of config.apps) await kernel.install(new FsAppSource(root))
  ctx.provide('rsi', kernel)
  return kernel
}
