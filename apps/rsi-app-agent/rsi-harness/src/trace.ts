/**
 * Normalise harness run records into kernel trace steps. Pure functions; no harness import.
 *
 * Two sources: the `dsh --profile headless --json` stream (what a subprocess executor sees)
 * and durable SessionEvents `{type, time, data}` (what an in-process plugin reads back).
 */

import type { TraceStep } from '../../rsi-kernel/src/index.ts'

export type HeadlessEvent =
  | { type: 'session'; sessionId: string; cwd: string }
  | { type: 'status'; phase: 'turn_start' | 'step_start' | 'step_end' | 'turn_end'; turn: number; step?: number; reason?: string | { kind: string } }
  | { type: 'thinking' | 'text'; text: string }
  | { type: 'tool_call'; callId: string; tool: string; input: unknown }
  | { type: 'tool_result'; callId: string; status: 'error' | 'completed'; result: unknown }
  | { type: 'final'; text: string }

export interface HeadlessRun {
  sessionId: string | null
  trace: TraceStep[]
  final: string | null
  /** Turn end reason when the run did not finish normally. */
  stopped: string | null
}

const SKILL_TOOL = /(^|__)skill$/i

/**
 * Why a turn ended when it did not complete normally; null when it completed.
 * The reason arrives as a string or as `{kind}` depending on the harness version.
 */
export function turnStopReason(reason: string | { kind: string } | undefined): string | null {
  const kind = typeof reason === 'string' ? reason : reason?.kind
  return !kind || kind === 'completed' || kind === 'end_turn' ? null : kind
}

/** Kind of a tool call as the kernel sees it: skills and MCP servers are named apart from plain tools. */
export function toolStep(tool: string, input: unknown): Pick<TraceStep, 'kind' | 'name'> {
  if (SKILL_TOOL.test(tool) && input && typeof input === 'object' && typeof (input as { name?: unknown }).name === 'string') {
    return { kind: 'skill', name: (input as { name: string }).name }
  }
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool)
  if (mcp) return { kind: 'tool', name: `${mcp[1]}.${mcp[2]}` }
  return { kind: 'tool', name: tool }
}

function summarize(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Parse newline-delimited headless output. Lines that are not JSON are ignored; arrival times
 * (milliseconds, same clock) give tool durations when available.
 */
export function parseHeadless(lines: Iterable<{ line: string; at?: number }>): HeadlessRun {
  const run: HeadlessRun = { sessionId: null, trace: [], final: null, stopped: null }
  const open = new Map<string, { index: number; at: number | undefined }>()
  let stepStart: number | undefined
  let step = 0
  for (const { line, at } of lines) {
    let event: HeadlessEvent
    try {
      event = JSON.parse(line) as HeadlessEvent
    } catch {
      continue
    }
    switch (event.type) {
      case 'session':
        run.sessionId = event.sessionId
        break
      case 'status':
        if (event.phase === 'step_start') stepStart = at
        if (event.phase === 'step_end') {
          step += 1
          run.trace.push({ kind: 'model', name: `第 ${step} 步`, ok: true, ms: at !== undefined && stepStart !== undefined ? at - stepStart : 0 })
        }
        if (event.phase === 'turn_end') run.stopped = turnStopReason(event.reason) ?? run.stopped
        break
      case 'tool_call':
        open.set(event.callId, { index: run.trace.length, at })
        run.trace.push({ ...toolStep(event.tool, event.input), ok: true, ms: 0, detail: summarize(event.input) })
        break
      case 'tool_result': {
        const call = open.get(event.callId)
        if (!call) break
        const step = run.trace[call.index]
        step.ok = event.status === 'completed'
        if (at !== undefined && call.at !== undefined) step.ms = at - call.at
        if (!step.ok) step.detail = summarize(event.result)
        open.delete(event.callId)
        break
      }
      case 'final':
        run.final = event.text
        break
    }
  }
  return run
}

export interface SessionEventRecord {
  type: string
  time: number
  data: Record<string, unknown>
}

/** Trace from durable SessionEvents: model steps from `step/start`→`assistant/message`, tools from `tool/call`→`tool/result`. */
export function traceFromSessionEvents(events: Iterable<SessionEventRecord>): TraceStep[] {
  const trace: TraceStep[] = []
  const calls = new Map<string, number>()
  let stepStart: { at: number; turn: unknown; step: unknown } | null = null
  for (const event of events) {
    const d = event.data
    if (event.type === 'step/start') stepStart = { at: event.time, turn: d.turn, step: d.step }
    else if (event.type === 'assistant/message' && stepStart && stepStart.turn === d.turn && stepStart.step === d.step) {
      trace.push({ kind: 'model', name: `轮 ${String(d.turn)} 步 ${String(d.step)}`, ok: true, ms: Math.max(0, event.time - stepStart.at) })
      stepStart = null
    } else if (event.type === 'tool/call') {
      let input: unknown = d.arguments
      try {
        input = JSON.parse(String(d.arguments))
      } catch {}
      calls.set(String(d.callId), trace.length)
      trace.push({ ...toolStep(String(d.name), input), ok: true, ms: event.time, detail: summarize(input) })
    } else if (event.type === 'tool/result') {
      const callId = (d.message as { source?: { callId?: string } } | undefined)?.source?.callId
      const index = callId === undefined ? undefined : calls.get(callId)
      if (index === undefined) continue
      const step = trace[index]
      step.ms = Math.max(0, event.time - step.ms)
      if (d.error !== undefined) {
        step.ok = false
        step.detail = summarize(d.error)
      }
      calls.delete(callId!)
    }
  }
  for (const index of calls.values()) {
    trace[index].ok = false
    trace[index].ms = 0
    trace[index].detail = '没有结果（轮次被取消或失败）'
  }
  return trace
}

/** The last fenced ```json block in a final answer, or the whole answer if it parses. */
export function extractJson(text: string): unknown {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  const candidate = blocks.length > 0 ? blocks[blocks.length - 1][1] : text
  return JSON.parse(candidate)
}
