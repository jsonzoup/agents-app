/**
 * Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0): initialize, tools/list, tools/call.
 * Used for the app judge, which is an MCP server visible only to the kernel.
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { EvalCase, FieldCheck } from '../domain/evaluation.ts'
import type { Judge, RunResult } from '../ports.ts'

export interface CallToolResult {
  content: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
  annotations?: Record<string, unknown>
}

const PROTOCOL_VERSION = '2025-06-18'

export class McpStdioClient {
  readonly #command: string
  readonly #args: string[]
  readonly #cwd: string
  #child: ChildProcessWithoutNullStreams | null = null
  #nextId = 1
  #buffer = ''
  #stderr = ''
  readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor(command: string, args: string[], cwd: string) {
    this.#command = command
    this.#args = args
    this.#cwd = cwd
  }

  async start(): Promise<void> {
    const child = spawn(this.#command, this.#args, { cwd: this.#cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.#child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#onData(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-4000)
    })
    child.on('exit', (code) => {
      for (const { reject } of this.#pending.values()) reject(new Error(`MCP 服务退出（${code}）：${this.#stderr}`))
      this.#pending.clear()
    })
    await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'rsi-kernel', version: '0.1.0' } })
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request('tools/list', {})) as { tools: McpTool[] }
    return result.tools
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    return (await this.request('tools/call', { name, arguments: args })) as CallToolResult
  }

  async close(): Promise<void> {
    const child = this.#child
    if (!child) return
    this.#child = null
    child.stdin.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  #send(message: unknown): void {
    if (!this.#child) throw new Error('MCP 客户端未启动')
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #onData(chunk: string): void {
    this.#buffer += chunk
    for (;;) {
      const nl = this.#buffer.indexOf('\n')
      if (nl === -1) return
      const line = this.#buffer.slice(0, nl).trim()
      this.#buffer = this.#buffer.slice(nl + 1)
      if (!line) continue
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (message.id === undefined) continue
      const pending = this.#pending.get(message.id)
      if (!pending) continue
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    }
  }
}

/**
 * Judge backed by the app's MCP server. Expects tools `score({case, run}) → {checks}` and
 * `check({run}) → {violations}` returning `structuredContent`.
 * @param root - the app's evaluation tree (outside every release, so a candidate cannot change its judge).
 */
export function mcpJudge(root: string, command: string, args: string[]): Judge {
  const client = new McpStdioClient(command, args, root)
  let started: Promise<void> | null = null
  const ready = (): Promise<void> => (started ??= client.start())
  const call = async (tool: string, payload: unknown): Promise<unknown> => {
    await ready()
    const result = await client.callTool(tool, payload)
    if (result.isError) throw new Error(`裁判 ${tool} 失败：${result.content.map((c) => c.text ?? '').join('')}`)
    return result.structuredContent
  }
  return {
    async score(testCase: EvalCase, run: RunResult): Promise<FieldCheck[]> {
      return ((await call('score', { case: testCase, run: { status: run.status, output: run.output } })) as { checks: FieldCheck[] }).checks
    },
    async check(run: RunResult): Promise<string[]> {
      return ((await call('check', { run: { status: run.status, output: run.output } })) as { violations: string[] }).violations
    },
    async close(): Promise<void> {
      if (started) await client.close()
    },
  }
}
