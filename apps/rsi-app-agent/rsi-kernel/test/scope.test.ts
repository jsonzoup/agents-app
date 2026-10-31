import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scriptedLearner } from '../src/index.ts'
import { notesKernel, record } from './helpers.ts'

test('范围知识：只对某团队生效的口径写进该团队的 AGENTS.md，其他任务不受影响', async () => {
  const learner = scriptedLearner('scoped-note', (ctx) => {
    assert.equal(ctx.issue.scope.level, 'scope')
    assert.ok(!Object.keys(ctx.files).some((p) => p.startsWith('evals/') || p.startsWith('judge/')), '提案器看不到契约文件')
    return [{
      title: 'infra 团队标题加前缀',
      changes: [{ path: 'scopes/team/infra/AGENTS.md', op: 'create', text: '# infra 团队\n\n- 标题前加 [infra]\n' }],
      record: record('infra 团队标题加前缀'),
    }]
  })
  const { kernel } = await notesKernel({ learners: [learner] })

  const before = await kernel.runTask('notes-digest', { input: { text: '发布会：Dan 负责值班。' }, scope: { team: 'infra' } })
  assert.equal((before.result.output as { title: string }).title, '发布会')
  await kernel.recordSignal('notes-digest', {
    kind: 'correction', release: 'r1', run: before.id, field: 'title', before: '发布会', after: '[infra] 发布会',
    scope: { level: 'scope', key: 'team', value: 'infra' }, by: 'infra 负责人',
  })
  const [issue] = await kernel.issues('notes-digest')
  assert.equal(issue.id, 'correction:title:team=infra')
  const [p] = await kernel.propose('notes-digest', issue.id, 'scoped-note')
  const v = await kernel.verify('notes-digest', p.id)
  assert.ok(v.passed, JSON.stringify(v.gates))
  assert.deepEqual(v.dev.comparison.fieldFixes, ['n4:title'])
  assert.deepEqual(v.dev.comparison.fieldRegressions, [])
  await kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true })

  const infra = await kernel.runTask('notes-digest', { input: { text: '发布会：Dan 负责值班。' }, scope: { team: 'infra' } })
  assert.equal((infra.result.output as { title: string }).title, '[infra] 发布会')
  assert.deepEqual(infra.instructions, ['AGENTS.md', 'scopes/team/infra/AGENTS.md'])
  const web = await kernel.runTask('notes-digest', { input: { text: '发布会：Dan 负责值班。' }, scope: { team: 'web' } })
  assert.equal((web.result.output as { title: string }).title, '发布会')
})
