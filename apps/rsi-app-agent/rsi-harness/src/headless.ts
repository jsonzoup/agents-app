/**
 * Executor over `dsh --profile headless --json -`: one subprocess per task, cwd at the
 * materialised release. A per-run `--patch` overlay points harness skill discovery at the
 * release's skill directories and mounts the release's `.mcp.json` servers, so the agent
 * sees exactly that release. Credentials stay in the environment; the prompt carries only the task.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Executor, RunRequest, RunResult } from '../../rsi-kernel/src/index.ts'
import { confinedCommand } from './confine.ts'
import type { Confinement } from './confine.ts'
import { extractJson, parseHeadless } from './trace.ts'

export interface HeadlessOptions {
  command?: string
  /** Full argument list; the task is written to stdin. The release patch is passed before it as `--patch <file>`. */
  args?: string[]
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** Deployment hook, e.g. turn relative material paths into absolute ones. */
  prepareInput?: (input: unknown, request: RunRequest) => unknown
  /** What one run may see and change on disk; when given and the host cannot confine, the run fails. */
  confine?: (request: RunRequest, input: unknown) => Confinement
}

export const HEADLESS_ARGS = ['--profile', 'headless', '--json', '-']

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  /** Per tool call; the harness default is one minute. */
  timeoutMs?: number
}

/** `${NAME}` becomes an env lookup at harness boot; any other value is passed literally. */
function envValue(value: string): string {
  const ref = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)
  return ref ? `!!js process.env.${ref[1]}` : JSON.stringify(value)
}

function yamlMap(map: Record<string, string>, indent: string): string[] {
  return Object.entries(map).map(([key, value]) => `${indent}${JSON.stringify(key)}: ${envValue(value)}`)
}

export interface AgentPatch {
  /** Directories whose child folders are skills (`<dir>/<skill>/SKILL.md`). */
  skillDirs: string[]
  /** MCP servers, each mounted as one `dsh-mcp-client` plugin. */
  servers?: Record<string, McpServerConfig>
  /** Working directory for stdio servers. */
  cwd: string
}

/**
 * Cordis patch that equips a harness agent: skill directories become `skill-filesystem`
 * custom roots and each MCP server becomes a `dsh-mcp-client` plugin instance. Secrets must be
 * written as `${ENV_NAME}`; they are resolved by the harness, never inlined.
 */
export function agentPatch({ skillDirs, servers = {}, cwd }: AgentPatch): string {
  const lines = ['- id: skill-filesystem', '  config:', `    customSkillDirs: ${JSON.stringify([...new Set(skillDirs)])}`]
  const entries = Object.entries(servers)
  if (entries.length) {
    lines.push('- insert:')
    for (const [serverName, server] of entries) {
      lines.push(`    - id: ${JSON.stringify(`rsi-mcp-${serverName}`)}`, "      name: '@deepseek-ai/dsh-mcp-client'", '      config:')
      lines.push(`        serverName: ${JSON.stringify(serverName)}`)
      if (server.timeoutMs) lines.push(`        toolCallTimeoutMs: ${Math.round(server.timeoutMs)}`)
      if (server.url) {
        lines.push('        transport: streamable-http', `        url: ${JSON.stringify(server.url)}`)
        if (server.headers) lines.push('        headers:', ...yamlMap(server.headers, '          '))
      } else {
        lines.push('        transport: stdio', `        command: ${JSON.stringify(server.command ?? '')}`)
        lines.push(`        args: ${JSON.stringify(server.args ?? [])}`, `        cwd: ${JSON.stringify(cwd)}`)
        if (server.env) lines.push('        env:', ...yamlMap(server.env, '          '))
      }
    }
  }
  return `${lines.join('\n')}\n`
}

/** The patch that makes one release visible to the harness: its skills and its `.mcp.json` servers. */
export function releasePatch(request: RunRequest): string {
  const { app, dir } = request
  const mcpPath = app.agent.mcp ? join(dir, app.agent.mcp) : null
  const servers: Record<string, McpServerConfig> =
    mcpPath && existsSync(mcpPath) ? (JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers ?? {}) : {}
  return agentPatch({ skillDirs: app.agent.skills.map((skill) => dirname(join(dir, skill))), servers, cwd: dir })
}

/** The task text handed to the agent. Generic: names files and the output contract, never domain rules. */
export function taskPrompt(request: RunRequest, input: unknown): string {
  const { app, instructions } = request
  return [
    `你在执行应用「${app.title}」的一个任务。`,
    `先读 ${instructions.join('、')}，再用技能 \`${app.agent.entry}\` 完成任务。`,
    '',
    '任务输入：',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    `结束时在回答最后给出一个 \`\`\`json 代码块：{"status": ${app.task.statuses.map((s) => `"${s}"`).join(' | ')}, "output": <符合 ${app.task.output} 的对象>}。代码块之外不要再放 JSON。`,
  ].join('\n')
}

/** Turn stop reasons that mean the agent used up its budget. */
const BUDGET_STOP = /max|limit|budget|length|turns|tokens/i

export function headlessExecutor(options: HeadlessOptions = {}): Executor {
  const command = options.command ?? 'dsh'
  const args = options.args ?? HEADLESS_ARGS
  const timeoutMs = options.timeoutMs ?? 30 * 60_000
  return {
    name: 'harness-headless',
    run(request: RunRequest): Promise<RunResult> {
      const input = options.prepareInput ? options.prepareInput(request.input, request) : request.input
      const started = Date.now()
      const confined = options.confine ? confinedCommand(options.confine(request, input)) : null
      if (options.confine && !confined) {
        const note = '这台机器不能隔离智能体进程，按配置不执行'
        return Promise.resolve({ status: 'failed', output: null, trace: [], ms: 0, executor: 'harness-headless', note, error: note })
      }
      const patchDir = mkdtempSync(join(tmpdir(), 'rsi-patch-'))
      const patchFile = join(patchDir, 'release.cordis.yml')
      writeFileSync(patchFile, releasePatch(request))
      // Launcher flags must precede the app's own: the patch goes right after `--profile <name>`.
      const profileAt = args.indexOf('--profile')
      const at = profileAt >= 0 ? profileAt + 2 : args.length
      const argv = [...args.slice(0, at), '--patch', patchFile, ...args.slice(at)]
      return new Promise((resolve) => {
        const env = { ...(options.env ?? process.env), ...confined?.env }
        const child = confined
          ? spawn(confined.command, [...confined.args, command, ...argv], { cwd: request.dir, env, stdio: ['pipe', 'pipe', 'pipe'] })
          : spawn(command, argv, { cwd: request.dir, env, stdio: ['pipe', 'pipe', 'pipe'] })
        const lines: { line: string; at: number }[] = []
        let stderr = ''
        createInterface({ input: child.stdout }).on('line', (line) => lines.push({ line, at: Date.now() }))
        child.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-4000)
        })
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, timeoutMs)
        const finish = (code: number | null, error?: Error) => {
          clearTimeout(timer)
          rmSync(patchDir, { recursive: true, force: true })
          const parsed = parseHeadless(lines)
          const base = { trace: parsed.trace, ms: Date.now() - started, executor: 'harness-headless', session: parsed.sessionId ?? undefined }
          if (error || code !== 0 || parsed.final === null) {
            const why = error?.message ?? (timedOut ? `超过 ${Math.round(timeoutMs / 60_000)} 分钟没有完成` : parsed.stopped ? `轮次结束原因：${parsed.stopped}` : `退出码 ${code}`)
            const note = `${why}${stderr ? `；${stderr.trim().split('\n').pop()}` : ''}`
            // Running out of time, turns or tokens is the agent's failure; a process or model service that died is not.
            const agents = timedOut || (parsed.stopped !== null && BUDGET_STOP.test(parsed.stopped))
            resolve({ ...base, status: 'failed', output: null, note, ...(agents ? {} : { error: note }) })
            return
          }
          try {
            const answer = extractJson(parsed.final) as { status?: unknown; output?: unknown }
            const status = typeof answer.status === 'string' && request.app.task.statuses.includes(answer.status) ? answer.status : 'failed'
            resolve({ ...base, status, output: answer.output ?? null, note: status === 'failed' ? `状态不在 ${request.app.task.statuses.join('/')} 内` : undefined })
          } catch (e) {
            resolve({ ...base, status: 'failed', output: null, note: `最终回答里没有可解析的 JSON：${(e as Error).message}` })
          }
        }
        child.on('error', (e) => finish(null, e))
        child.on('close', (code) => finish(code))
        child.stdin.end(taskPrompt(request, input))
      })
    },
  }
}
