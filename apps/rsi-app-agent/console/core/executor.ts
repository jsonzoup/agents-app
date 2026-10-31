/**
 * The console's executor: every app task runs on the harness. The name stays stable per
 * process so the kernel's score cache stays valid.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Executor, RunRequest } from '../../rsi-kernel/src/index.ts'
import { HEADLESS_ARGS, canConfine, headlessExecutor } from '../../rsi-harness/src/index.ts'
import type { Confinement, HarnessCommand } from '../../rsi-harness/src/index.ts'

export interface ExecutorStatus {
  /** Whether tasks can run at all. */
  available: boolean
  note: string
}

export interface HarnessStatus {
  available: boolean
  command: HarnessCommand | null
  note: string
}

/**
 * Where the harness CLI is: `RSI_DSH_COMMAND` (command line, split on spaces), else the CLI
 * built in the enclosing harness checkout (`<workspace>/deepseek-harness/apps/cli/lib/bin.js`). The harness reads
 * its own model credentials; none pass through the platform.
 */
export function findHarness(env: NodeJS.ProcessEnv, platform: string): HarnessStatus {
  if (env.RSI_DSH_COMMAND?.trim()) {
    const [command, ...args] = env.RSI_DSH_COMMAND.trim().split(/\s+/)
    return { available: true, command: { command, args }, note: `harness：${env.RSI_DSH_COMMAND.trim()}` }
  }
  const bin = resolve(platform, '../../deepseek-harness/apps/cli/lib/bin.js')
  if (existsSync(bin)) return { available: true, command: { command: env.RSI_DSH_NODE ?? process.execPath, args: [bin] }, note: 'harness：本仓库构建的 dsh（apps/cli）' }
  return { available: false, command: null, note: '没有找到 harness：在独立目录准备兼容的 Harness CLI 并设置 RSI_DSH_COMMAND；不要修改只读子模块' }
}

/** Files an input names under `root` (absolute paths, as `prepareInput` leaves them). */
function filesIn(value: unknown, root: string): string[] {
  if (typeof value === 'string') return isAbsolute(value) && !relative(root, value).startsWith('..') && existsSync(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap((v) => filesIn(v, root))
  if (value && typeof value === 'object') return Object.values(value).flatMap((v) => filesIn(v, root))
  return []
}

/**
 * What one run may touch: nothing in the home (other versions, evaluation sets, platform
 * state) except its own version directory and the materials its input names; in the user's
 * home it writes only there and in the tool caches the harness and the skills' runtimes use.
 */
export function runConfinement(home: string, request: RunRequest, input: unknown): Confinement {
  const user = homedir()
  return {
    hide: [home],
    read: filesIn(input, home),
    readOnly: [user],
    write: [request.dir, join(user, '.dsh'), join(user, '.cache'), join(user, '.local'), join(user, 'Library/Caches')],
  }
}

/**
 * Executor for app tasks: the harness when found; otherwise every run fails and says why.
 * Runs are confined to their version and materials when the host can confine processes.
 * @param prepareInput - turns home-relative material paths into paths the agent can open.
 */
export function chooseExecutor(harness: HarnessStatus, home: string, prepareInput: (input: unknown) => unknown): { executor: Executor; status: ExecutorStatus } {
  if (harness.command) {
    const confined = canConfine()
    return {
      executor: headlessExecutor({
        command: harness.command.command,
        args: [...(harness.command.args ?? []), ...HEADLESS_ARGS],
        prepareInput,
        ...(confined ? { confine: (request: RunRequest, input: unknown) => runConfinement(home, request, input) } : {}),
      }),
      status: {
        available: true,
        note: `通过 harness 执行：${harness.note.replace(/^harness：/, '')}；${confined ? '智能体只能读到所跑版本和本次材料' : '这台机器不能隔离智能体进程，它能读到 home 里的评测数据'}`,
      },
    }
  }
  return {
    executor: {
      name: 'none',
      run: async () => ({ status: 'failed', output: null, trace: [{ kind: 'note', name: '没有可用的执行器', ok: false, ms: 0 }], ms: 0, executor: 'none', note: harness.note, error: '没有可用的执行器' }),
    },
    status: { available: false, note: harness.note },
  }
}
