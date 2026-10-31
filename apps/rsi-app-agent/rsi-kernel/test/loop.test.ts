import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KernelError, scriptedLearner } from '../src/index.ts'
import { OWNER_RULE_NEW, OWNER_RULE_OLD, notesKernel, record } from './helpers.ts'

const fullName = scriptedLearner('full-name', () => [
  {
    title: '负责人写完整姓名',
    changes: [{ path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW }],
    record: record('负责人写完整姓名'),
  },
])

test('完整一圈：办理 → 人工修正 → 问题 → 提案 → 验证 → 批准 → 发布 → 回退', async () => {
  const { kernel } = await notesKernel({ learners: [fullName] })

  const r1 = await kernel.stable('notes-digest')
  assert.equal(r1.id, 'r1')
  const dev1 = await kernel.evaluate('notes-digest', 'r1', 'dev')
  assert.equal(dev1.passed, 1, 'r1 只有 n2 全对')

  const run = await kernel.runTask('notes-digest', { input: { text: '周会：Alice Wang 负责发布。' } })
  assert.deepEqual(run.result.output, { title: '周会', owner: 'Alice' })
  assert.equal(run.release, 'r1')
  assert.deepEqual(run.instructions, ['AGENTS.md'])

  await kernel.recordSignal('notes-digest', {
    kind: 'correction', release: run.release, run: run.id, field: 'owner', before: 'Alice', after: 'Alice Wang',
    note: '负责人要写全名', scope: { level: 'app' }, by: '主管',
  })
  await kernel.recordSignal('notes-digest', {
    kind: 'correction', release: 'r1', field: 'owner', before: 'Carol', after: 'Carol Li', scope: { level: 'app' }, by: '主管',
  })
  const [issue] = await kernel.issues('notes-digest')
  assert.equal(issue.id, 'correction:owner:app')
  assert.equal(issue.signals.length, 2)

  const [proposal] = await kernel.propose('notes-digest', issue.id, 'full-name')
  assert.equal(proposal.status, 'draft')
  assert.equal(proposal.tier, 'knowledge')
  assert.equal(proposal.base, 'r1')

  const v = await kernel.verify('notes-digest', proposal.id)
  assert.ok(v.passed, JSON.stringify(v.gates))
  assert.deepEqual(v.dev.comparison.fieldFixes, ['n1:owner'])
  assert.deepEqual(v.holdout?.comparison.fieldFixes, ['n3:owner'])
  assert.equal(v.violations.length, 0)

  await assert.rejects(
    kernel.decide('notes-digest', proposal.id, { role: 'engineer', by: '工程师', at: '', ok: true }),
    KernelError,
    '知识级不需要工程师',
  )
  const released = await kernel.decide('notes-digest', proposal.id, { role: 'owner', by: '主管', at: '', ok: true })
  assert.equal(released.status, 'released')
  assert.equal(released.release, 'r2')
  assert.equal((await kernel.stable('notes-digest')).id, 'r2')

  const after = await kernel.runTask('notes-digest', { input: { text: '周会：Alice Wang 负责发布。' } })
  assert.deepEqual(after.result.output, { title: '周会', owner: 'Alice Wang' })

  const channels = await kernel.rollback('notes-digest', 'r1', '演示回退')
  assert.equal(channels.stable, 'r1')
  assert.deepEqual(channels.history.map((h) => h.to), ['r1', 'r2', 'r1'])
  const releases = await kernel.releases('notes-digest')
  assert.deepEqual(releases.map((r) => r.id), ['r1', 'r2'], '回退不删除版本')
})

test('留出集只看一次：同一提案再次验证沿用第一次的结果', async () => {
  const { kernel } = await notesKernel({ learners: [fullName] })
  await kernel.recordSignal('notes-digest', { kind: 'correction', release: 'r1', field: 'owner', before: 'Alice', after: 'Alice Wang', scope: { level: 'app' }, by: '主管' })
  const [issue] = await kernel.issues('notes-digest')
  const [p] = await kernel.propose('notes-digest', issue.id, 'full-name')
  const first = await kernel.verify('notes-digest', p.id)
  const second = await kernel.verify('notes-digest', p.id)
  assert.deepEqual(second.holdout, first.holdout)
})
