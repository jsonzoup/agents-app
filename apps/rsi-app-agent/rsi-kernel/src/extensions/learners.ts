/**
 * Built-in learners. A learner reads an issue and evolvable files and drafts change lists.
 * The kernel validates every draft (anchors, tiers) before it becomes a proposal.
 */

import type { Change } from '../domain/change.ts'
import type { DecisionRecord } from '../domain/proposal.ts'
import { scopeLabel } from '../domain/signal.ts'
import type { LearnContext, Learner, Model, ProposalDraft } from '../ports.ts'

/**
 * A learner whose drafts come from a function: tests, and humans proposing through the same pipeline.
 * @param name - learner name shown as proposal author.
 * @param draft - builds drafts from the context.
 */
export function scriptedLearner(name: string, draft: (context: LearnContext) => ProposalDraft[] | Promise<ProposalDraft[]>): Learner {
  return { name, propose: async (context) => draft(context) }
}

const SYSTEM = [
  '你是一个应用的维护者。你只能修改给你的知识文件，用最小的改动让人工反馈不再出现。',
  '只输出一个 JSON 对象：{"title": string, "changes": Change[], "record": DecisionRecord}。',
  'Change = {"path": string, "op": "replace"|"create"|"append", "find"?: string, "text": string}；replace 的 find 必须在文件中恰好出现一次。',
  'DecisionRecord = {"title","date","background","options":[{"title","pros","cons"}],"decision","impact","review"}，至少给出两个候选方案。',
  '范围是某个客户时，只写 scopes/<key>/<value>/AGENTS.md，不改全局规则。不得修改期望值、裁判或契约。',
].join('\n')

/**
 * Model-backed learner: shows the model the issue, the human signals and the knowledge files.
 * @param model - completion port; the driver decides which model serves it.
 * @param options - `maxFileChars` caps each file shown to the model.
 */
export function reflectiveLearner(model: Model, options: { maxFileChars?: number } = {}): Learner {
  const cap = options.maxFileChars ?? 12000
  return {
    name: 'reflective',
    async propose(context) {
      const user = buildPrompt(context, cap)
      const text = await model.complete({ system: SYSTEM, user })
      return [parseDraft(text)]
    },
  }
}

/** Prompt body for {@link reflectiveLearner}; exported for inspection in tests and UI. */
export function buildPrompt(context: LearnContext, cap: number): string {
  const { issue, signals, files, app } = context
  const lines = [`应用：${app.title}（${app.name}），基线版本 ${context.base.id}`, `问题：${issue.summary}`, `范围：${scopeLabel(issue.scope)}`, '', '人工反馈：']
  for (const s of signals) {
    lines.push(`- [${s.kind}] ${s.field ?? '整票'}：${s.before ?? ''} → ${s.after ?? ''}${s.note ? `；说明：${s.note}` : ''}`)
  }
  lines.push('', '可修改的知识文件：')
  for (const [path, file] of Object.entries(files)) {
    if (file.tier !== 'knowledge') continue
    const body = file.text.length > cap ? `${file.text.slice(0, cap)}\n…（截断）` : file.text
    lines.push(`=== ${path}`, body)
  }
  return lines.join('\n')
}

function parseDraft(text: string): ProposalDraft {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('模型没有返回 JSON')
  const raw = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; changes?: unknown; record?: unknown }
  if (typeof raw.title !== 'string' || !Array.isArray(raw.changes) || typeof raw.record !== 'object' || raw.record === null) {
    throw new Error('模型返回的提案缺少 title、changes 或 record')
  }
  return { title: raw.title, changes: raw.changes as Change[], record: raw.record as DecisionRecord }
}
