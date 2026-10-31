/**
 * Proposals: a change list plus its decision record, verification and approvals.
 */

import type { Change } from './change.ts'
import type { Comparison, SuiteResult } from './evaluation.ts'
import type { Tier } from './manifest.ts'

/** The decision-record format the business already uses: background, options, decision, impact, review. */
export interface DecisionRecord {
  title: string
  date: string
  background: string
  options: { title: string; pros: string; cons: string }[]
  decision: string
  impact: string
  review: string
  /** Optional link to an existing human-written record this proposal mirrors. */
  source?: string
}

export type Role = 'owner' | 'engineer'

export interface Approval {
  role: Role
  by: string
  at: string
  ok: boolean
  note?: string
}

export interface Verification {
  baseline: string
  at: string
  dev: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison }
  /** Evaluated once per proposal; never shown to learners. */
  holdout: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison } | null
  violations: string[]
  /** Result of the app's own tests, required for code-tier changes. */
  appTests: { ok: boolean; detail: string } | null
  gates: GateResult[]
  passed: boolean
}

export interface GateResult {
  gate: string
  ok: boolean
  detail: string
}

export type ProposalStatus = 'draft' | 'verified' | 'failed' | 'rejected' | 'released'

export interface Proposal {
  id: string
  app: string
  issue: string | null
  title: string
  /** Learner name or `human:<who>`. */
  author: string
  base: string
  changes: Change[]
  tier: Tier
  record: DecisionRecord
  status: ProposalStatus
  createdAt: string
  verification: Verification | null
  approvals: Approval[]
  release: string | null
}

/**
 * Roles that must approve a tier.
 * @throws Error for contract tier: the loop never releases contract changes.
 */
export function requiredRoles(tier: Tier): Role[] {
  if (tier === 'knowledge') return ['owner']
  if (tier === 'code') return ['owner', 'engineer']
  throw new Error('契约级变更不走进化循环，只能人工评审')
}

/**
 * Render a decision record as Markdown in the business's existing format.
 * @returns Markdown text.
 */
export function renderRecord(record: DecisionRecord, status: string): string {
  const lines = [`# ${record.title}`, '', `- 日期：${record.date}`, `- 状态：${status}`]
  if (record.source) lines.push(`- 对应人工记录：${record.source}`)
  lines.push('', '## 背景', '', record.background, '', '## 候选方案', '')
  record.options.forEach((o, i) => lines.push(`${i + 1}. ${o.title}。优点：${o.pros}。代价：${o.cons}。`))
  lines.push('', '## 决策', '', record.decision, '', '## 影响与复查条件', '', `- 影响：${record.impact}`, `- 何时复查：${record.review}`, '')
  return lines.join('\n')
}
