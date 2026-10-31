/** App-declared actions (e.g. render a document from a confirmed result), run as a child process in a version's directory. */

import { spawn } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPath } from './paths.ts'

export interface AppAction {
  title: string
  command: string
  /** `{input}` and `{output}` are replaced with temp file paths. */
  args: string[]
  /** Dotted path into the task's working output that becomes the input file. */
  input: string
  /** File name of the produced artifact. */
  output: string
  /** Only offered once the task is confirmed. */
  requiresConfirmed?: boolean
}

/** What the use page needs to offer an app's actions. */
export function actionSummaries(raw: Record<string, unknown>) {
  return Object.fromEntries(Object.entries((raw.actions ?? {}) as Record<string, AppAction>).map(([k, a]) => [k, { title: a.title, requiresConfirmed: Boolean(a.requiresConfirmed) }]))
}

/**
 * Run one action on a task's working result.
 * @returns whether the output file was produced, its path and the command's report (parsed JSON when it printed JSON).
 */
export async function runAction(action: AppAction, working: unknown, cwd: string, outDir: string, artifactId: string): Promise<{ ok: boolean; outputFile: string; report: unknown }> {
  await mkdir(outDir, { recursive: true })
  const inputFile = join(outDir, `${artifactId}.input.json`)
  const outputFile = join(outDir, `${artifactId}-${action.output}`)
  await writeFile(inputFile, JSON.stringify(getPath(working, action.input) ?? null))
  const args = action.args.map((a) => a.replace('{input}', inputFile).replace('{output}', outputFile))
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(action.command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (c: Buffer) => (out += c.toString()))
    child.stderr.on('data', (c: Buffer) => (err = (err + c.toString()).slice(-4000)))
    child.on('error', (e) => done({ code: null, stdout: out, stderr: e.message }))
    child.on('close', (c) => done({ code: c, stdout: out, stderr: err }))
  })
  let report: unknown = stdout.trim()
  try {
    report = JSON.parse(stdout)
  } catch {
    // plain text
  }
  const ok =
    code === 0 &&
    (await stat(outputFile).then(
      () => true,
      () => false,
    ))
  return { ok, outputFile, report: ok ? report : { error: stderr.trim().split('\n').slice(-3).join('\n') || `退出码 ${code}`, stdout: report } }
}
