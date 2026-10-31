/**
 * Evaluation cases and results (spec `rsi-eval/1`). A case's checks come from its standard
 * declarative rules and from its validator program (app code); the kernel aggregates and
 * compares them, and holds no app-specific scoring.
 */

import type { Rule } from './rules.ts'

export type Split = 'dev' | 'holdout'

/** Version tag of the evaluation spec this kernel reads (`evals/eval.json` → `spec`). */
export const EVAL_SPEC = 'rsi-eval/1'

/** The validator every case uses unless it names another: the manifest's `judge`. */
export const DEFAULT_VALIDATOR = 'judge'

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/** Most runs per case one evaluation may ask for. */
export const MAX_TRIALS = 5

/** A complete correct run of a case, written or confirmed by people; the validator must give it full marks. */
export interface Oracle {
  status: string
  output: unknown
  /** Where it came from: who wrote or confirmed it, from what. */
  provenance?: unknown
}

/**
 * One case, a self-contained folder `cases/<id>/`: `case.json`, its input materials in `input/`,
 * and expected output files in `expected/`.
 */
export interface EvalCase {
  id: string
  title: string
  /** Opaque task input passed to the executor. */
  input: unknown
  /** Opaque expectation passed to the validator; `case.json` may name a file under the case folder instead. Only humans edit it. */
  expected: unknown
  /** Standard declarative rules the kernel applies itself. Only humans edit them. */
  rules?: Rule[]
  /** Validator program by name (`judge` is the manifest's); `null` scores by rules alone. */
  validator?: string | null
  tags?: string[]
  scope: Record<string, string>
  /** Where the case came from, e.g. a fixture path or an adopted run. */
  source: string
  /** Content hash of the case folder's description and expectation; a changed case is scored again. */
  hash?: string
  /** `holdout` when the case file reserves itself for the one-look split (besides the manifest's list). */
  split?: Split
  difficulty?: Difficulty
  /** What makes the case hard, for people and agents alike. */
  why?: string
  /** What the case tests, from `eval.json` → `capabilities`; the coverage matrix counts these. */
  capabilities?: string[]
  /** Reference run; `case.json` names a file under the case folder or writes it inline. Only humans edit it. */
  oracle?: Oracle
}

/** A validator program: an MCP stdio server with `score` and `check`, started in the evaluation tree. */
export interface ValidatorSpec {
  command: string
  args: string[]
  title?: string
}

/** `evals/eval.json`: the evaluation set's own manifest. Optional; absent means defaults. */
export interface EvalSpecFile {
  spec: string
  /** Extra validators by name, besides `judge` from the app manifest. */
  validators: Record<string, ValidatorSpec>
  /** What each tag means, for people choosing cases to run. */
  tags: Record<string, string>
  /** What each capability means; cases name the ones they test, and the coverage matrix shows the gaps. */
  capabilities: Record<string, string>
  /** Runs per case when a proposal is verified; outputs vary between runs, so gates look at pass rates. */
  trials: number
}

/**
 * Parse `eval.json`.
 * @throws Error listing every problem.
 */
export function parseEvalSpec(raw: unknown): EvalSpecFile {
  if (raw === undefined) return { spec: EVAL_SPEC, validators: {}, tags: {}, capabilities: {}, trials: 1 }
  const problems: string[] = []
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (o.spec !== EVAL_SPEC) problems.push(`spec 应为 ${EVAL_SPEC}`)
  const validators: Record<string, ValidatorSpec> = {}
  for (const [name, v] of Object.entries((o.validators ?? {}) as Record<string, unknown>)) {
    const x = v as Partial<ValidatorSpec>
    if (name === DEFAULT_VALIDATOR) problems.push(`验证程序名 ${DEFAULT_VALIDATOR} 留给 app.json 的 judge`)
    else if (!x || typeof x.command !== 'string' || !Array.isArray(x.args) || !x.args.every((a) => typeof a === 'string')) problems.push(`验证程序 ${name} 需要 command 和 args`)
    else validators[name] = { command: x.command, args: x.args, ...(typeof x.title === 'string' ? { title: x.title } : {}) }
  }
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries((o.tags ?? {}) as Record<string, unknown>)) tags[k] = String(v)
  const capabilities: Record<string, string> = {}
  for (const [k, v] of Object.entries((o.capabilities ?? {}) as Record<string, unknown>)) capabilities[k] = String(v)
  const trials = o.trials ?? 1
  if (!Number.isInteger(trials) || (trials as number) < 1 || (trials as number) > MAX_TRIALS) problems.push(`trials 应为 1 到 ${MAX_TRIALS} 的整数`)
  if (problems.length) throw new Error(`eval.json 无效：${problems.join('；')}`)
  return { spec: EVAL_SPEC, validators, tags, capabilities, trials: trials as number }
}

/**
 * A snapshot of an app's evaluation tree (cases, materials, validators, tests). Every
 * change people make to it becomes a new snapshot, so every score names the cases it used.
 */
export interface EvalSet {
  /** `e1`, `e2`… per app. */
  id: string
  app: string
  parent: string | null
  at: string
  by: string
  note: string
  /** Path to content hash, relative to the evaluation tree. */
  files: Record<string, string>
  fingerprint: string
}

export interface FieldCheck {
  path: string
  expected: string
  actual: string
  ok: boolean
  /** With several runs: share of runs where the check passed; `ok` means more than half. */
  rate?: number
}

/** One of several runs of a case. */
export interface TrialScore {
  ok: boolean
  score: number
  /** Set when the run failed for reasons outside the agent (the executor's `RunResult.error`); it is not scored. */
  error?: string
  status?: string
  ms?: number
}

export interface CaseScore {
  case: string
  split: Split
  ok: boolean
  /** Share of passing checks, 0..1; the mean over runs that were scored. */
  score: number
  checks: FieldCheck[]
  /** Invariant violations reported by the judge's `check`, in any run. */
  violations: string[]
  run: string
  /** What the agent produced, so people can see why a check failed. */
  status?: string
  output?: unknown
  ms?: number
  /** The run never reached the agent's answer (executor, model service, isolation): not scored, not compared, rerun it. */
  error?: string
  /** The case's reference run does not get full marks, so the case itself is wrong: it did not run, fix the case. */
  invalid?: string
  /** With several runs: share of scored runs that passed. */
  passRate?: number
  trials?: TrialScore[]
}

export interface SuiteResult {
  release: string
  split: Split
  /** Evaluation-set snapshot the cases came from. */
  evalset?: string
  /** Set when only some of the split's cases ran; such a result never verifies a proposal. */
  selection?: string[]
  cases: CaseScore[]
  /** Passing cases among the scored ones. */
  passed: number
  /** Scored cases: those without an error and with a valid case. */
  total: number
  /** Mean score of the scored cases, 0..1. */
  score: number
  /** Cases whose run failed outside the agent. */
  errors?: string[]
  /** Cases whose reference run fails their own checks. */
  invalid?: string[]
  /** Runs per case. */
  trials?: number
}

/** A case that was not scored: its run errored or the case is invalid. */
export const unscored = (c: CaseScore) => Boolean(c.error || c.invalid)

/**
 * Aggregate case scores of one release on one split. Errored and invalid cases are listed, not scored.
 * @returns totals; a split with nothing scored scores 1.
 */
export function summarize(release: string, split: Split, cases: CaseScore[], trials = 1): SuiteResult {
  const scored = cases.filter((c) => !unscored(c))
  const passed = scored.filter((c) => c.ok).length
  const score = scored.length === 0 ? 1 : scored.reduce((sum, c) => sum + c.score, 0) / scored.length
  return {
    release,
    split,
    cases,
    passed,
    total: scored.length,
    score,
    errors: cases.filter((c) => c.error).map((c) => c.case),
    invalid: cases.filter((c) => c.invalid).map((c) => c.case),
    ...(trials > 1 ? { trials } : {}),
  }
}

/** One run of a case, scored. */
export interface TrialRun {
  checks: FieldCheck[]
  violations: string[]
  status: string
  output: unknown
  ms: number
  run: string
  error?: string
}

/**
 * Fold several runs of one case into one score: a check passes when it passed in more than half
 * of the scored runs, the case passes when more than half of them passed, and a violation in any
 * run counts. Runs that errored are left out; if all of them errored, the case is an error.
 */
export function aggregateTrials(id: string, split: Split, runs: TrialRun[]): CaseScore {
  const scored = runs.filter((r) => !r.error)
  const okOf = (r: TrialRun) => r.checks.every((c) => c.ok) && r.violations.length === 0
  const scoreOf = (r: TrialRun) => (r.checks.length === 0 ? 1 : r.checks.filter((c) => c.ok).length / r.checks.length)
  const trials = runs.length > 1 ? runs.map((r) => ({ ok: !r.error && okOf(r), score: r.error ? 0 : scoreOf(r), status: r.status, ms: r.ms, ...(r.error ? { error: r.error } : {}) })) : undefined
  if (scored.length === 0) {
    const first = runs[0]
    return { case: id, split, ok: false, score: 0, checks: [], violations: [], run: first.run, status: first.status, ms: first.ms, error: first.error ?? '没有执行', ...(trials ? { trials } : {}) }
  }
  if (runs.length === 1) {
    const r = scored[0]
    return { case: id, split, ok: okOf(r), score: scoreOf(r), checks: r.checks, violations: r.violations, run: r.run, status: r.status, output: r.output, ms: r.ms }
  }
  const paths: string[] = []
  const byPath = new Map<string, FieldCheck[]>()
  for (const r of scored) {
    for (const c of r.checks) {
      if (!byPath.has(c.path)) {
        paths.push(c.path)
        byPath.set(c.path, [])
      }
      byPath.get(c.path)!.push(c)
    }
  }
  const checks = paths.map((path) => {
    const seen = byPath.get(path)!
    const rate = seen.filter((c) => c.ok).length / scored.length
    const shown = seen.find((c) => !c.ok) ?? seen[0]
    return { path, expected: shown.expected, actual: shown.actual, ok: rate > 0.5, rate }
  })
  const passRate = scored.filter(okOf).length / scored.length
  const first = scored.find((r) => !okOf(r)) ?? scored[0]
  return {
    case: id,
    split,
    ok: passRate > 0.5,
    score: scored.reduce((sum, r) => sum + scoreOf(r), 0) / scored.length,
    checks,
    violations: [...new Set(scored.flatMap((r) => r.violations))],
    run: first.run,
    status: first.status,
    output: first.output,
    ms: Math.round(scored.reduce((sum, r) => sum + r.ms, 0) / scored.length),
    passRate,
    trials,
  }
}

export interface Comparison {
  /** Cases that passed on baseline and fail on candidate. */
  regressions: string[]
  /** Cases that failed on baseline and pass on candidate. */
  fixed: string[]
  /** Field checks that passed on baseline and fail on candidate, as `case:path`. */
  fieldRegressions: string[]
  /** Field checks that failed on baseline and pass on candidate. */
  fieldFixes: string[]
  delta: number
  /** With several runs: candidate checks that passed in some runs and failed in others, as `case:path`. */
  unstable?: string[]
  /** Cases left out because one side errored or the case is invalid. */
  skipped?: string[]
}

const caseRate = (c: CaseScore) => c.passRate ?? (c.ok ? 1 : 0)
const checkRate = (c: FieldCheck) => c.rate ?? (c.ok ? 1 : 0)

/**
 * Compare two runs of the same split. With several runs per case only stable movement counts:
 * a regression passed in every baseline run and fails in more than half of the candidate's;
 * a fix failed in every baseline run and passes in more than half of the candidate's.
 * With one run this is plain pass → fail and fail → pass.
 * @returns per-case and per-field movement plus the score delta.
 */
export function compare(baseline: SuiteResult, candidate: SuiteResult): Comparison {
  const before = new Map(baseline.cases.map((c) => [c.case, c]))
  const out: Comparison = { regressions: [], fixed: [], fieldRegressions: [], fieldFixes: [], delta: candidate.score - baseline.score, unstable: [], skipped: [] }
  for (const after of candidate.cases) {
    const prev = before.get(after.case)
    if (!prev) continue
    if (unscored(prev) || unscored(after)) {
      out.skipped!.push(after.case)
      continue
    }
    if (caseRate(prev) === 1 && caseRate(after) < 0.5) out.regressions.push(after.case)
    if (caseRate(prev) === 0 && caseRate(after) > 0.5) out.fixed.push(after.case)
    const prevChecks = new Map(prev.checks.map((c) => [c.path, checkRate(c)]))
    for (const check of after.checks) {
      const was = prevChecks.get(check.path)
      const now = checkRate(check)
      if (was === 1 && now < 0.5) out.fieldRegressions.push(`${after.case}:${check.path}`)
      if (was === 0 && now > 0.5) out.fieldFixes.push(`${after.case}:${check.path}`)
      if (now > 0 && now < 1) out.unstable!.push(`${after.case}:${check.path}`)
    }
  }
  return out
}

/** Pass rate per capability over the scored cases that name it; capabilities without a case get `cases: 0`. */
export function coverage(cases: EvalCase[], scores: CaseScore[], vocabulary: Record<string, string>) {
  const byCase = new Map(scores.filter((s) => !unscored(s)).map((s) => [s.case, s]))
  const names = [...new Set([...Object.keys(vocabulary), ...cases.flatMap((c) => c.capabilities ?? [])])]
  return names.map((name) => {
    const named = cases.filter((c) => c.capabilities?.includes(name))
    const scored = named.map((c) => byCase.get(c.id)).filter((s): s is CaseScore => Boolean(s))
    return {
      capability: name,
      title: vocabulary[name] ?? null,
      cases: named.map((c) => c.id),
      scored: scored.length,
      passed: scored.filter((s) => s.ok).length,
      score: scored.length ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length : null,
    }
  })
}
