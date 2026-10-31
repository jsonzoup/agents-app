/**
 * One conversational turn with a harness agent: `dsh --profile headless --json` in a working
 * directory, equipped by a Cordis patch, continuing an earlier session when given its id.
 * Events stream to the caller as they arrive, so a UI can show the agent working.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { turnStopReason } from './trace.ts'
import type { HeadlessEvent } from './trace.ts'

export interface HarnessCommand {
  command: string
  /** Arguments before the profile, e.g. the CLI entry script when `command` is node. */
  args?: string[]
}

export interface TurnOptions {
  harness: HarnessCommand
  cwd: string
  /** Cordis patch text (see `agentPatch`). */
  patch: string
  /** Session to continue; omitted for the first turn. */
  sessionId?: string | null
  prompt: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  onEvent(event: HeadlessEvent | { type: 'error'; message: string }): void
}

export interface TurnResult {
  ok: boolean
  sessionId: string | null
  final: string | null
  /** Turn-end reason when it did not complete, or the failure. */
  error: string | null
}

export interface TurnHandle {
  done: Promise<TurnResult>
  cancel(): void
}

export function headlessTurn(options: TurnOptions): TurnHandle {
  const patchDir = mkdtempSync(join(tmpdir(), 'rsi-turn-'))
  const patchFile = join(patchDir, 'agent.cordis.yml')
  writeFileSync(patchFile, options.patch)
  // Launcher flags (--profile, --patch) must precede the app's own flags.
  const argv = [
    ...(options.harness.args ?? []),
    '--profile',
    'headless',
    '--patch',
    patchFile,
    '--json',
    ...(options.sessionId ? ['--session-id', options.sessionId] : []),
    '-',
  ]
  const child = spawn(options.harness.command, argv, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  let sessionId = options.sessionId ?? null
  let final: string | null = null
  let stopped: string | null = null
  let stderr = ''
  let cancelled = false
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event: HeadlessEvent | { type: 'error'; message: string }
    try {
      event = JSON.parse(line)
    } catch {
      return
    }
    if (event.type === 'session') sessionId = event.sessionId
    if (event.type === 'final') final = event.text
    if (event.type === 'status' && event.phase === 'turn_end') stopped = turnStopReason(event.reason) ?? stopped
    options.onEvent(event)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000)
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? 30 * 60_000)
  const done = new Promise<TurnResult>((resolve) => {
    const finish = (code: number | null, error?: Error) => {
      clearTimeout(timer)
      rmSync(patchDir, { recursive: true, force: true })
      const lastErr = stderr.trim().split('\n').filter(Boolean).pop()
      const why = cancelled ? '已取消' : error?.message ?? stopped ?? (code !== 0 ? `退出码 ${code}${lastErr ? `：${lastErr}` : ''}` : null)
      resolve({ ok: !why && final !== null, sessionId, final, error: why ?? (final === null ? '没有最终回答' : null) })
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code))
  })
  child.stdin.end(options.prompt)
  return {
    done,
    cancel() {
      cancelled = true
      child.kill('SIGTERM')
    },
  }
}
