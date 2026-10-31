/**
 * Standard declarative rules for evaluation cases (`case.json` → `rules`): the scoring every
 * app can declare without a program. Pure and industry-agnostic; app-specific scoring stays in validators.
 *
 * Every rule reads one value from the run, `{status, output}`, by a path:
 * - `status`, `output.title`, `output.rows[0].price`
 * - `output.header[field=weight].value`: the first array element whose `field` is `weight`
 */

import type { FieldCheck } from './evaluation.ts'

export const RULE_OPS = ['equals', 'number', 'oneOf', 'contains', 'matches', 'count', 'present', 'absent'] as const
export type RuleOp = (typeof RULE_OPS)[number]

export interface Rule {
  path: string
  op: RuleOp
  /** `equals`, `contains`: the value; `number`: the expected number; `count`: the exact length. */
  value?: unknown
  /** `oneOf`. */
  values?: unknown[]
  /** `number`: allowed absolute difference. */
  tolerance?: number
  /** `number`: allowed difference as a share of the expected value, e.g. 0.01 for 1%. */
  relative?: number
  /** `matches`: a regular expression. */
  pattern?: string
  /** `count`: bounds on an array's length. */
  min?: number
  max?: number
  /** Name shown in reports instead of the path. */
  label?: string
}

const OP_LABEL: Record<RuleOp, string> = {
  equals: '等于',
  number: '数值',
  oneOf: '取值之一',
  contains: '包含',
  matches: '匹配',
  count: '个数',
  present: '非空',
  absent: '为空',
}

type Segment = { key: string } | { index: number } | { where: string; equals: string }

/**
 * Parse a rule path.
 * @throws Error when the path is malformed.
 */
export function parseRulePath(path: string): Segment[] {
  const out: Segment[] = []
  const re = /([^.[\]]+)|\[(\d+)\]|\[([^=\]]+)=([^\]]*)\]|(\.)/gy
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(path))) {
    last = re.lastIndex
    if (m[1] !== undefined) out.push({ key: m[1] })
    else if (m[2] !== undefined) out.push({ index: Number(m[2]) })
    else if (m[3] !== undefined) out.push({ where: m[3].trim(), equals: m[4].trim() })
  }
  if (last !== path.length || out.length === 0 || !('key' in out[0])) throw new Error(`路径 ${path} 写法不对`)
  return out
}

/** Read a value by rule path; `undefined` when any step is missing. */
export function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const s of parseRulePath(path)) {
    if (cur === null || cur === undefined) return undefined
    if ('key' in s) cur = typeof cur === 'object' ? (cur as Record<string, unknown>)[s.key] : undefined
    else if ('index' in s) cur = Array.isArray(cur) ? cur[s.index] : undefined
    else cur = Array.isArray(cur) ? cur.find((x) => x && typeof x === 'object' && text((x as Record<string, unknown>)[s.where]) === s.equals) : undefined
  }
  return cur
}

function text(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = text(v).replace(/,/g, '').trim()
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * Problems with one rule, for loading and checking a case.
 * @returns human-readable problems; empty when the rule is valid.
 */
export function ruleProblems(rule: unknown, where: string): string[] {
  if (!rule || typeof rule !== 'object') return [`${where} 不是对象`]
  const r = rule as Rule
  const out: string[] = []
  if (typeof r.path !== 'string' || !r.path) out.push(`${where} 缺少 path`)
  else {
    try {
      parseRulePath(r.path)
    } catch (error) {
      out.push(`${where}：${(error as Error).message}`)
    }
  }
  if (!RULE_OPS.includes(r.op)) out.push(`${where} 的 op 只能是 ${RULE_OPS.join('、')}`)
  if ((r.op === 'equals' || r.op === 'contains') && r.value === undefined) out.push(`${where}（${r.op}）缺少 value`)
  if (r.op === 'number' && num(r.value) === null) out.push(`${where}（number）的 value 不是数字`)
  if (r.op === 'oneOf' && (!Array.isArray(r.values) || r.values.length === 0)) out.push(`${where}（oneOf）缺少 values`)
  if (r.op === 'matches') {
    try {
      new RegExp(String(r.pattern ?? ''))
      if (!r.pattern) out.push(`${where}（matches）缺少 pattern`)
    } catch {
      out.push(`${where}（matches）的 pattern 不是合法的正则`)
    }
  }
  if (r.op === 'count' && r.value === undefined && r.min === undefined && r.max === undefined) out.push(`${where}（count）需要 value、min 或 max`)
  return out
}

/** Apply one rule to a run. */
export function applyRule(rule: Rule, run: { status: string; output: unknown }): FieldCheck {
  const actual = readPath(run, rule.path)
  const name = rule.label ?? (rule.op === 'equals' ? rule.path : `${rule.path}（${OP_LABEL[rule.op]}）`)
  const check = (expected: string, ok: boolean, shown = text(actual)): FieldCheck => ({ path: name, expected, actual: shown, ok })
  switch (rule.op) {
    case 'equals':
      return check(text(rule.value), text(actual) === text(rule.value))
    case 'number': {
      const want = num(rule.value)!
      const got = num(actual)
      const room = Math.max(rule.tolerance ?? 0, rule.relative ? Math.abs(want) * rule.relative : 0)
      return check(room ? `${want} ± ${room}` : String(want), got !== null && Math.abs(got - want) <= room + 1e-12)
    }
    case 'oneOf':
      return check((rule.values ?? []).map(text).join(' / '), (rule.values ?? []).some((v) => text(v) === text(actual)))
    case 'contains':
      return check(`包含 ${text(rule.value)}`, Array.isArray(actual) ? actual.some((x) => text(x) === text(rule.value)) : text(actual).includes(text(rule.value)))
    case 'matches':
      return check(`匹配 /${rule.pattern}/`, new RegExp(rule.pattern!).test(text(actual)))
    case 'count': {
      const n = Array.isArray(actual) ? actual.length : 0
      const want = rule.value !== undefined ? String(rule.value) : `${rule.min ?? 0}..${rule.max ?? '∞'}`
      const ok = Array.isArray(actual) && (rule.value !== undefined ? n === Number(rule.value) : n >= (rule.min ?? 0) && n <= (rule.max ?? Infinity))
      return check(want, ok, String(n))
    }
    case 'present':
      return check('非空', !empty(actual))
    case 'absent':
      return check('为空', empty(actual))
  }
}

/** Apply a case's rules to a run, in order. */
export function applyRules(rules: Rule[] | undefined, run: { status: string; output: unknown }): FieldCheck[] {
  return (rules ?? []).map((r) => applyRule(r, run))
}
