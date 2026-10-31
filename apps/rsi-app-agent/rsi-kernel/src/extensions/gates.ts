/**
 * Built-in gates. A gate inspects a finished verification and passes or blocks release.
 * Deployments may add gates; none of them may relax the contract-tier rule.
 */

import type { Comparison, SuiteResult } from '../domain/evaluation.ts'
import type { GateResult, Proposal } from '../domain/proposal.ts'

export interface GateInput {
  proposal: Proposal
  dev: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison }
  holdout: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison } | null
  violations: string[]
  appTests: { ok: boolean; detail: string } | null
  /** Every changed file is a view file: the agent's output cannot change, so there is nothing to improve on the cases. */
  viewOnly?: boolean
}

export interface Gate {
  readonly name: string
  check(input: GateInput): GateResult
}

export const invariantsGate: Gate = {
  name: '不变量',
  check: ({ violations }) => ({
    gate: '不变量',
    ok: violations.length === 0,
    detail: violations.length === 0 ? '候选版本的输出没有违反裁判的硬规则' : violations.slice(0, 5).join('；'),
  }),
}

/** Errored runs and invalid cases are not scored, so a verification with any of them proves nothing either way. */
export const completeGate: Gate = {
  name: '评测完整',
  check: ({ dev, holdout }) => {
    const suites = [dev.baseline, dev.candidate, ...(holdout ? [holdout.baseline, holdout.candidate] : [])]
    const errors = [...new Set(suites.flatMap((s) => s.errors ?? []))]
    const invalid = [...new Set(suites.flatMap((s) => s.invalid ?? []))]
    const parts = [
      ...(errors.length ? [`${errors.join('、')} 执行出错（不是智能体答错），请重新验证`] : []),
      ...(invalid.length ? [`${invalid.join('、')} 的参考答案没有得满分，用例本身有问题，请人修正用例`] : []),
    ]
    const trials = dev.candidate.trials ?? 1
    return {
      gate: '评测完整',
      ok: parts.length === 0,
      detail: parts.length ? parts.join('；') : `所有用例都打了分${trials > 1 ? `，每个用例运行 ${trials} 次` : ''}`,
    }
  },
}

export const noRegressionGate: Gate = {
  name: '开发集不退步',
  check: ({ dev }) => {
    const bad = [...dev.comparison.regressions, ...dev.comparison.fieldRegressions]
    const unstable = dev.comparison.unstable?.length ? `；${dev.comparison.unstable.length} 项检查时过时不过，不算退步：${dev.comparison.unstable.slice(0, 3).join('、')}` : ''
    return {
      gate: '开发集不退步',
      ok: bad.length === 0,
      detail: (bad.length === 0 ? `基线通过的 ${dev.baseline.passed} 个用例和全部字段检查仍然通过` : `退步：${bad.slice(0, 6).join('、')}`) + unstable,
    }
  },
}

export const improvesGate: Gate = {
  name: '确有改进',
  check: ({ dev, viewOnly }) => {
    if (viewOnly) return { gate: '确有改进', ok: true, detail: '只改了应用界面：智能体的输出不变，以不退步和人工批准为准' }
    const c = dev.comparison
    const ok = c.fixed.length > 0 || c.fieldFixes.length > 0 || c.delta > 1e-9
    return {
      gate: '确有改进',
      ok,
      detail: ok
        ? `修好 ${c.fieldFixes.length} 项字段检查，开发集得分 ${pct(dev.baseline.score)} → ${pct(dev.candidate.score)}`
        : '开发集上没有任何检查由失败变为通过',
    }
  },
}

export const holdoutGate: Gate = {
  name: '留出集不退步',
  check: ({ holdout }) => {
    if (!holdout || holdout.candidate.total === 0) return { gate: '留出集不退步', ok: true, detail: '没有留出用例' }
    const bad = [...holdout.comparison.regressions, ...holdout.comparison.fieldRegressions]
    return {
      gate: '留出集不退步',
      ok: bad.length === 0,
      detail: bad.length === 0
        ? `留出集 ${pct(holdout.baseline.score)} → ${pct(holdout.candidate.score)}，只看这一次`
        : `留出集退步：${bad.slice(0, 6).join('、')}`,
    }
  },
}

export const appTestsGate: Gate = {
  name: '应用自测',
  check: ({ proposal, appTests }) => {
    if (proposal.tier !== 'code') return { gate: '应用自测', ok: true, detail: '知识级变更不需要' }
    if (!appTests) return { gate: '应用自测', ok: false, detail: '代码级变更必须跑应用自测，但没有配置' }
    return { gate: '应用自测', ok: appTests.ok, detail: appTests.detail }
  },
}

export const DEFAULT_GATES: Gate[] = [invariantsGate, completeGate, noRegressionGate, improvesGate, holdoutGate, appTestsGate]

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}
