/**
 * Minimal MCP stdio server for app-side tools (judges, local helpers). Any MCP SDK works
 * equally; apps copy this file into their evaluation tree so they need no dependencies.
 */

import { createInterface } from 'node:readline'

export interface ServedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /** Returns `structuredContent`; a thrown error becomes `isError: true`. */
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

/**
 * Serve tools over stdin/stdout until stdin closes.
 * @param info - server name and version reported on initialize.
 * @param tools - tools to expose.
 */
export function serveMcpStdio(info: { name: string; version: string }, tools: ServedTool[]): void {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const write = (message: unknown): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  }
  const rl = createInterface({ input: process.stdin })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    const message = JSON.parse(line) as { id?: number | string; method: string; params?: Record<string, unknown> }
    if (message.id === undefined) return
    const reply = (result: unknown): void => write({ jsonrpc: '2.0', id: message.id, result })
    switch (message.method) {
      case 'initialize':
        reply({ protocolVersion: String(message.params?.protocolVersion ?? '2025-06-18'), capabilities: { tools: {} }, serverInfo: info })
        return
      case 'ping':
        reply({})
        return
      case 'tools/list':
        reply({ tools: tools.map(({ handler: _handler, ...descriptor }) => descriptor) })
        return
      case 'tools/call': {
        const tool = byName.get(String(message.params?.name))
        if (!tool) {
          write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `未知工具 ${String(message.params?.name)}` } })
          return
        }
        try {
          const structured = await tool.handler((message.params?.arguments ?? {}) as Record<string, unknown>)
          reply({ content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured })
        } catch (error) {
          reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true })
        }
        return
      }
      default:
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `不支持 ${message.method}` } })
    }
  })
}
