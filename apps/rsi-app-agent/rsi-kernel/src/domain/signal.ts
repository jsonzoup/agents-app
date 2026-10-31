/**
 * Signals are evidence that an app should change: a corrected value, a suggestion about a
 * region of a result or about the whole task, a pause, a failure. Each carries what the
 * person saw, so whoever improves the app sees it too. Issues group signals that point at
 * the same place and scope.
 */

/** Where a lesson applies, chosen by the person who gives the signal. */
export type SignalScope =
  | { level: 'task' }
  | { level: 'scope'; key: string; value: string }
  | { level: 'app' }

export type SignalKind = 'correction' | 'suggestion' | 'confirmation' | 'pause' | 'failure' | 'instruction'

/**
 * What a signal is about: one value, a region of the result (a section, a table, some rows), the
 * whole task — or not the result at all: the app's interface (`ui`, a page or a part of one) or
 * something it should be able to do (`feature`). Those two are changed in the app's code, not
 * its knowledge.
 */
export interface SignalTarget {
  level: 'field' | 'region' | 'task' | 'ui' | 'feature'
  /** Dotted output path of the field or region, e.g. `rows[2]` or `header`; for `ui`, the page inside the app, e.g. `/tasks/T-0003`. */
  path?: string
  /** How the person saw it, e.g. a section title. */
  label?: string
}

/**
 * What the person saw when giving the signal: the task's input, the agent's output, the
 * working copy with earlier corrections. Opaque to the kernel; the platform fills it in.
 */
export type SignalContext = Record<string, unknown>

export interface Signal {
  id: string
  app: string
  at: string
  kind: SignalKind
  /** Release the run used. */
  release: string
  run?: string
  case?: string
  /** Dotted output path of a corrected value, e.g. `table_body.basic[0].单价`. */
  field?: string
  before?: string
  after?: string
  /** For suggestions and corrections: what it is about. Corrections default to their field. */
  target?: SignalTarget
  note?: string
  scope: SignalScope
  by: string
  context?: SignalContext
  /** Files the person attached, e.g. a screenshot or the right document. Paths are platform-relative. */
  attachments?: { path: string; name: string; size: number }[]
}

export interface Issue {
  /** Stable key derived from kind, place and scope. */
  id: string
  app: string
  kind: SignalKind
  /** Field or region pattern; null when the signals are about whole tasks. */
  field: string | null
  /** The place as people named it, from the first signal that named it. */
  label: string | null
  scope: SignalScope
  signals: string[]
  summary: string
}

/**
 * Replace array indices with `*` so the same column in different rows groups together.
 * @param path - dotted output path.
 * @returns the pattern, e.g. `table_body.basic[*].单价`.
 */
export function fieldPattern(path: string): string {
  return path.replace(/\[\d+\]/g, '[*]')
}

/** Human-readable scope label. */
export function scopeLabel(scope: SignalScope): string {
  if (scope.level === 'task') return '只这一单'
  if (scope.level === 'app') return '所有任务'
  return `${scope.key}=${scope.value}`
}

function scopeKey(scope: SignalScope): string {
  return scope.level === 'scope' ? `${scope.key}=${scope.value}` : scope.level
}

/** Whether a signal asks for a change in the app's interface or abilities rather than its results. */
export function isProductSignal(signal: Pick<Signal, 'target'>): boolean {
  return signal.target?.level === 'ui' || signal.target?.level === 'feature'
}

/** A page path with the parts that name one record (`T-0003`, `42`) replaced by `*`. */
export function pagePattern(path: string): string {
  return path.split('/').map((part) => (/\d/.test(part) ? '*' : part)).join('/') || '/'
}

/**
 * The place a signal points at: its field, else its target path; null for whole tasks.
 * Interface suggestions group by the part of the page people named, else by page; every
 * feature request is its own place until a person says otherwise.
 */
export function signalPlace(signal: Signal): string | null {
  if (signal.target?.level === 'ui') return `ui:${signal.target.label?.trim() || pagePattern(signal.target.path ?? '/')}`
  if (signal.target?.level === 'feature') return `feature:${signal.id}`
  const path = signal.field ?? (signal.target?.level === 'task' ? undefined : signal.target?.path)
  return path ? fieldPattern(path) : null
}

/**
 * Group signals into issues. Task-scoped signals and confirmations teach nothing
 * beyond their own task, so they never form issues.
 * @param signals - all signals of one app.
 * @returns issues ordered by signal count, then key.
 */
export function groupSignals(signals: Signal[]): Issue[] {
  const groups = new Map<string, Issue>()
  for (const signal of signals) {
    if (signal.scope.level === 'task' || signal.kind === 'confirmation') continue
    const field = signalPlace(signal)
    const id = `${signal.kind}:${field ?? '-'}:${scopeKey(signal.scope)}`
    let issue = groups.get(id)
    if (!issue) {
      issue = { id, app: signal.app, kind: signal.kind, field, label: null, scope: signal.scope, signals: [], summary: '' }
      groups.set(id, issue)
    }
    issue.label ??= signal.target?.label ?? (signal.target?.level === 'feature' ? excerpt(signal.note ?? '') : null)
    issue.signals.push(signal.id)
  }
  const issues = [...groups.values()]
  for (const issue of issues) {
    const ui = issue.field?.startsWith('ui:')
    const feature = issue.field?.startsWith('feature:')
    if (ui || feature) {
      const place = ui ? `界面「${issue.label ?? issue.field!.slice(3)}」` : `功能「${issue.label ?? ''}」`
      issue.summary = `${place}：${issue.signals.length} 条${ui ? '界面建议' : '功能建议'}`
      continue
    }
    const place = issue.label ? `${issue.label}${issue.field ? `（${issue.field}）` : ''}` : (issue.field ?? '整单')
    issue.summary = `${place}：${issue.signals.length} 条${KIND_LABEL[issue.kind]}（${scopeLabel(issue.scope)}）`
  }
  return issues.sort((a, b) => b.signals.length - a.signals.length || a.id.localeCompare(b.id))
}

function excerpt(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 30 ? `${line.slice(0, 30)}…` : line
}

const KIND_LABEL: Record<SignalKind, string> = {
  correction: '人工修正',
  suggestion: '改进建议',
  confirmation: '人工确认',
  pause: '风险暂停',
  failure: '评测失败',
  instruction: '口径指示',
}
