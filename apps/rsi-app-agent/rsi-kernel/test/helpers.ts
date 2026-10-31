import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FsAppSource, FsStore, RsiKernel, mcpJudge, steppingClock } from '../src/index.ts'
import type { Learner, AppTests } from '../src/index.ts'
import { resolveHome } from '../../console/core/home.ts'
import { notesExecutor } from './notes-double.ts'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** The control app from the configured home; it carries no industry vocabulary. */
export const NOTES_APP = join(resolveHome(REPO), 'notes-digest')

export async function notesKernel(options: { learners?: Learner[]; appTests?: AppTests } = {}) {
  const store = new FsStore(await mkdtemp(join(tmpdir(), 'rsi-kernel-')))
  const kernel = new RsiKernel({
    store,
    clock: steppingClock('2026-10-09T08:00:00Z'),
    executor: notesExecutor,
    judge: (app, v) => mcpJudge(app.source.evals.root, v.command, v.args),
    learners: options.learners,
    appTests: options.appTests,
  })
  await kernel.install(new FsAppSource(NOTES_APP))
  return { kernel, store }
}

export const OWNER_RULE_OLD = '- 负责人：只写名字的第一个词。'
export const OWNER_RULE_NEW = '- 负责人：写完整姓名，保留原文空格。'

export function record(title: string) {
  return {
    title,
    date: '2026-10-09',
    background: '人工把负责人从名改成了全名。',
    options: [
      { title: '保持只写第一个词', pros: '零改动', cons: '两个词的姓名被截断' },
      { title: '写完整姓名', pros: '与人工修正一致', cons: '需要确认没有别的用例依赖截断' },
    ],
    decision: '采用方案 2。',
    impact: '负责人字段保留全名。',
    review: '出现带头衔的姓名时复查。',
  }
}
