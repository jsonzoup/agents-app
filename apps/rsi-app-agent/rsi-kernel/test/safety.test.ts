import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KernelError, commandAppTests, scriptedLearner } from '../src/index.ts'
import { OWNER_RULE_NEW, OWNER_RULE_OLD, notesKernel, record } from './helpers.ts'

test('提案改到期望值、裁判或契约时直接驳回，不进入验证', async () => {
  const { kernel } = await notesKernel()
  const cheats = [
    { path: 'evals/cases/n1/case.json', op: 'replace' as const, find: '"Alice Wang"', text: '"Alice"' },
    { path: 'judge/server.ts', op: 'append' as const, text: '// pass everything' },
    { path: 'contract/output.schema.json', op: 'replace' as const, find: '"minLength": 1 },\n    "owner"', text: '"minLength": 0 },\n    "owner"' },
    { path: 'app.json', op: 'replace' as const, find: '"holdout": ["n3"]', text: '"holdout": []' },
  ]
  for (const change of cheats) {
    const p = await kernel.submit('notes-digest', { title: '作弊', changes: [change], record: record('作弊') }, 'reflective')
    assert.equal(p.status, 'rejected', change.path)
    assert.equal(p.tier, 'contract')
    await assert.rejects(kernel.verify('notes-digest', p.id), KernelError)
  }
})

test('版本只含代码目录：用例和裁判不进入版本，智能体看不到', async () => {
  const { kernel } = await notesKernel()
  const files = Object.keys((await kernel.stable('notes-digest')).files)
  assert.ok(files.includes('app.json') && files.includes('skills/digest/SKILL.md'))
  assert.ok(!files.some((p) => p.includes('case.json') || p.includes('judge')), files.join(', '))
  assert.equal(kernel.app('notes-digest').cases.length, 4)
})

test('锚点不唯一或不存在的提案被驳回', async () => {
  const { kernel } = await notesKernel()
  const p = await kernel.submit('notes-digest', { title: '错锚点', changes: [{ path: 'skills/digest/SKILL.md', op: 'replace', find: '不存在的一行', text: 'x' }], record: record('错锚点') }, 'human:主管')
  assert.equal(p.status, 'rejected')
  assert.match(p.approvals[0].note ?? '', /出现 0 次/)
})

test('没有改进的提案验证不通过，也不能发布', async () => {
  const { kernel } = await notesKernel()
  const p = await kernel.submit('notes-digest', {
    title: '只改措辞',
    changes: [{ path: 'AGENTS.md', op: 'append', text: '\n- 输出前自查一遍。\n' }],
    record: record('只改措辞'),
  }, 'human:主管')
  const v = await kernel.verify('notes-digest', p.id)
  assert.equal(v.passed, false)
  assert.equal(v.gates.find((g) => g.gate === '确有改进')?.ok, false)
  await assert.rejects(kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true }), /尚未通过验证/)
})

test('代码级提案需要应用自测和工程师批准', async () => {
  const learner = scriptedLearner('code', () => [{
    title: '加脚本并改规则',
    changes: [
      { path: 'skills/digest/scripts/note.txt', op: 'create', text: 'helper' },
      { path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW },
    ],
    record: record('加脚本并改规则'),
  }])
  const { kernel } = await notesKernel({ learners: [learner], appTests: commandAppTests('node', ['-e', 'process.exit(0)']) })
  const p = await kernel.submit('notes-digest', (await learner.propose({} as never))[0], 'code')
  assert.equal(p.tier, 'code')
  const v = await kernel.verify('notes-digest', p.id)
  assert.ok(v.passed, JSON.stringify(v.gates))
  const afterOwner = await kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true })
  assert.equal(afterOwner.status, 'verified', '只有主管批准还不发布')
  const done = await kernel.decide('notes-digest', p.id, { role: 'engineer', by: '工程师', at: '', ok: true })
  assert.equal(done.status, 'released')
})

test('宿主可以按自己的策略指定审批角色，但不能为空', async () => {
  const learner = scriptedLearner('code', () => [{
    title: '加脚本并改规则',
    changes: [
      { path: 'skills/digest/scripts/note.txt', op: 'create', text: 'helper' },
      { path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW },
    ],
    record: record('加脚本并改规则'),
  }])
  const { kernel } = await notesKernel({ learners: [learner], appTests: commandAppTests('node', ['-e', 'process.exit(0)']) })
  const p = await kernel.submit('notes-digest', (await learner.propose({} as never))[0], 'code')
  assert.ok((await kernel.verify('notes-digest', p.id)).passed)
  await assert.rejects(kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true }, []), /至少需要一位/)
  await assert.rejects(kernel.decide('notes-digest', p.id, { role: 'engineer', by: '工程师', at: '', ok: true }, ['owner']), /不需要 engineer/)
  const done = await kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true }, ['owner'])
  assert.equal(done.status, 'released')
})

test('代码级提案没有配置应用自测时闸门拦下', async () => {
  const { kernel } = await notesKernel()
  const p = await kernel.submit('notes-digest', {
    title: '加脚本',
    changes: [
      { path: 'skills/digest/scripts/note.txt', op: 'create', text: 'helper' },
      { path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW },
    ],
    record: record('加脚本'),
  }, 'human:工程师')
  const v = await kernel.verify('notes-digest', p.id)
  assert.equal(v.gates.find((g) => g.gate === '应用自测')?.ok, false)
})

test('基线移动后，旧提案不能发布', async () => {
  const { kernel } = await notesKernel()
  const draft = { title: '全名', changes: [{ path: 'skills/digest/SKILL.md', op: 'replace' as const, find: OWNER_RULE_OLD, text: OWNER_RULE_NEW }], record: record('全名') }
  const a = await kernel.submit('notes-digest', draft, 'human:甲')
  const b = await kernel.submit('notes-digest', draft, 'human:乙')
  await kernel.verify('notes-digest', a.id)
  await kernel.verify('notes-digest', b.id)
  await kernel.decide('notes-digest', a.id, { role: 'owner', by: '主管', at: '', ok: true })
  await assert.rejects(kernel.decide('notes-digest', b.id, { role: 'owner', by: '主管', at: '', ok: true }), /基线已从 r1 变为 r2/)
})

test('驳回是终态', async () => {
  const { kernel } = await notesKernel()
  const p = await kernel.submit('notes-digest', { title: '全名', changes: [{ path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW }], record: record('全名') }, 'human:甲')
  await kernel.verify('notes-digest', p.id)
  const rejected = await kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: false, note: '口径未定' })
  assert.equal(rejected.status, 'rejected')
  await assert.rejects(kernel.decide('notes-digest', p.id, { role: 'owner', by: '主管', at: '', ok: true }), /已驳回/)
})
