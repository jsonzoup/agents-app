/**
 * Local adapters that need no model: app tests as a child process, and clocks.
 */

import { spawn } from 'node:child_process'
import type { AppTests, Clock } from '../ports.ts'

/**
 * App tests as a command run in the app's evaluation tree; exit code 0 passes.
 * The candidate's code directory is passed as `RSI_APP_CODE`.
 * @param command - executable, e.g. `node`.
 * @param args - arguments, e.g. `['--test', 'tests/']`.
 */
export function commandAppTests(command: string, args: string[]): AppTests {
  return {
    run: (code, evals) =>
      new Promise((resolve) => {
        const child = spawn(command, args, { cwd: evals, env: { ...process.env, RSI_APP_CODE: code }, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        child.stdout.on('data', (c: Buffer) => (out = (out + c.toString()).slice(-2000)))
        child.stderr.on('data', (c: Buffer) => (out = (out + c.toString()).slice(-2000)))
        child.on('error', (e) => resolve({ ok: false, detail: e.message }))
        child.on('exit', (code) => resolve({ ok: code === 0, detail: code === 0 ? `${command} ${args.join(' ')} 通过` : out.trim() || `退出码 ${code}` }))
      }),
  }
}

export const systemClock: Clock = { now: () => new Date().toISOString() }

/**
 * Deterministic clock for tests: starts at `start`, advances one minute per call.
 */
export function steppingClock(start: string): Clock {
  let t = Date.parse(start)
  return {
    now: () => {
      const iso = new Date(t).toISOString()
      t += 60_000
      return iso
    },
  }
}
