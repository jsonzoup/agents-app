import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FsAppSource, FsStore, RsiKernel, applyRule, mcpJudge, parseEvalSpec, readPath, ruleProblems, steppingClock } from '../src/index.ts'
import { NOTES_APP } from './helpers.ts'
import { notesExecutor } from './notes-double.ts'

const run = {
  status: 'result',
  output: { title: '周会', total: '1,000.50', rows: [{ field: 'a', value: 'x' }, { field: 'b', value: '' }], tags: ['p', 'q'] },
}

test('规则路径：点、下标、按字段取数组元素', () => {
  assert.equal(readPath(run, 'status'), 'result')
  assert.equal(readPath(run, 'output.rows[1].field'), 'b')
  assert.equal(readPath(run, 'output.rows[field=a].value'), 'x')
  assert.equal(readPath(run, 'output.rows[field=z].value'), undefined)
  assert.equal(readPath(run, 'output.missing.deeper'), undefined)
})

test('标准规则：等于、数值容差、取值之一、包含、匹配、个数、非空、为空', () => {
  const ok = (r: Parameters<typeof applyRule>[0]) => applyRule(r, run).ok
  assert.ok(ok({ path: 'output.title', op: 'equals', value: '周会' }))
  assert.ok(!ok({ path: 'output.title', op: 'equals', value: '月会' }))
  assert.ok(ok({ path: 'output.total', op: 'number', value: 1000, tolerance: 0.5 }))
  assert.ok(!ok({ path: 'output.total', op: 'number', value: 1000, tolerance: 0.1 }))
  assert.ok(ok({ path: 'output.total', op: 'number', value: 1000, relative: 0.001 }))
  assert.ok(ok({ path: 'status', op: 'oneOf', values: ['result', 'pause'] }))
  assert.ok(ok({ path: 'output.tags', op: 'contains', value: 'q' }))
  assert.ok(ok({ path: 'output.title', op: 'contains', value: '周' }))
  assert.ok(ok({ path: 'output.title', op: 'matches', pattern: '^周' }))
  assert.ok(ok({ path: 'output.rows', op: 'count', value: 2 }))
  assert.ok(!ok({ path: 'output.rows', op: 'count', min: 3 }))
  assert.ok(ok({ path: 'output.rows[field=a].value', op: 'present' }))
  assert.ok(ok({ path: 'output.rows[field=b].value', op: 'absent' }))
  const check = applyRule({ path: 'output.rows', op: 'count', value: 3, label: '行数' }, run)
  assert.deepEqual(check, { path: '行数', expected: '3', actual: '2', ok: false })
})

test('规则和评测集清单写错时说清楚哪里错', () => {
  assert.deepEqual(ruleProblems({ path: 'output.x', op: 'equals', value: 1 }, '规则 1'), [])
  assert.match(ruleProblems({ path: 'output.x', op: 'nearly' }, '规则 1').join(), /op 只能是/)
  assert.match(ruleProblems({ path: 'output.x', op: 'number', value: 'abc' }, '规则 1').join(), /不是数字/)
  assert.match(ruleProblems({ path: 'output[', op: 'present' }, '规则 1').join(), /写法不对/)
  assert.match(ruleProblems({ path: 'output.x', op: 'matches', pattern: '(' }, '规则 1').join(), /正则/)
  assert.deepEqual(parseEvalSpec(undefined).validators, {})
  assert.throws(() => parseEvalSpec({ spec: 'rsi-eval/9' }), /spec 应为/)
  assert.throws(() => parseEvalSpec({ spec: 'rsi-eval/1', validators: { judge: { command: 'node', args: [] } } }), /留给 app.json/)
})

async function copyNotes() {
  const app = join(await mkdtemp(join(tmpdir(), 'rsi-spec-')), 'notes-digest')
  await cp(NOTES_APP, app, { recursive: true })
  const kernel: RsiKernel = new RsiKernel({
    store: new FsStore(await mkdtemp(join(tmpdir(), 'rsi-kernel-'))),
    clock: steppingClock('2026-10-09T08:00:00Z'),
    executor: notesExecutor,
    judge: (a, v) => mcpJudge(a.source.evals.root, v.command, v.args),
  })
  return { app, kernel }
}

test('用例是一个目录：期望值可以放在 expected/ 里，只用规则也能打分，可以指定别的验证程序', async () => {
  const { app, kernel } = await copyNotes()
  const cases = join(app, 'evals/cases')
  await mkdir(join(cases, 'r1/expected'), { recursive: true })
  await writeFile(join(cases, 'r1/expected/output.json'), JSON.stringify({ title: '周会', owner: 'Alice' }))
  await writeFile(join(cases, 'r1/case.json'), JSON.stringify({ id: 'r1', title: '期望值在文件里', input: { text: '周会：Alice Wang 负责发布。' }, expected: 'expected/output.json', tags: ['基础'] }))
  await mkdir(join(cases, 'r2'), { recursive: true })
  await writeFile(
    join(cases, 'r2/case.json'),
    JSON.stringify({ id: 'r2', title: '只用规则', input: { text: '周会：Bob Li 负责发布。' }, validator: null, rules: [{ path: 'output.owner', op: 'equals', value: 'Bob' }, { path: 'output.title', op: 'present' }] }),
  )
  await mkdir(join(cases, 'r3'), { recursive: true })
  await writeFile(join(cases, 'r3/case.json'), JSON.stringify({ id: 'r3', title: '别的验证程序', input: { text: '月会：Eve 负责。' }, expected: { title: '月会', owner: 'Eve' }, validator: 'strict' }))
  await writeFile(join(app, 'evals/eval.json'), JSON.stringify({ spec: 'rsi-eval/1', validators: { strict: { command: 'node', args: ['judge/server.ts'], title: '同一个程序换个名字' } }, tags: { 基础: '最常见的写法' } }))
  await kernel.install(new FsAppSource(app))

  const loaded = kernel.app('notes-digest')
  assert.deepEqual(loaded.cases.find((c) => c.id === 'r1')!.expected, { title: '周会', owner: 'Alice' })
  assert.deepEqual(loaded.spec.tags, { 基础: '最常见的写法' })
  const result = await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['r1', 'r2', 'r3'])
  assert.deepEqual(result.selection, ['r1', 'r2', 'r3'])
  assert.deepEqual(result.cases.map((c) => [c.case, c.ok]), [['r1', true], ['r2', true], ['r3', true]])
  assert.deepEqual(result.cases.find((c) => c.case === 'r2')!.checks.map((c) => c.path), ['output.owner', 'output.title（非空）'])
  assert.deepEqual(result.cases.find((c) => c.case === 'r2')!.violations, [], '只用规则时没有不变量检查')
  await assert.rejects(kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['nope']), /没有用例 nope/)
})

test('用例写错时整套评测集加载失败，并指出是哪个用例', async () => {
  const cases = [
    [{ id: 'x1', title: '', input: {}, validator: null }, /既没有验证程序也没有规则/],
    [{ id: 'x1', title: '', input: {}, expected: {}, validator: 'ghost' }, /没有在 eval.json 里声明/],
    [{ id: 'x1', title: '', input: {}, expected: 'expected/none.json' }, /不存在/],
    [{ id: 'other', title: '', input: {}, expected: {} }, /id 应与目录名相同/],
    [{ id: 'x1', title: '', input: {}, rules: [{ path: 'output.a', op: 'bogus' }] }, /x1\/case.json：规则 1/],
  ] as const
  for (const [doc, error] of cases) {
    const { app, kernel } = await copyNotes()
    await mkdir(join(app, 'evals/cases/x1'), { recursive: true })
    await writeFile(join(app, 'evals/cases/x1/case.json'), JSON.stringify(doc))
    await assert.rejects(kernel.install(new FsAppSource(app)), error)
  }
})

test('改一个用例目录里的材料只让这个用例重新评分', async () => {
  const { app, kernel } = await copyNotes()
  await kernel.install(new FsAppSource(app))
  const before = kernel.app('notes-digest')
  await mkdir(join(app, 'evals/cases/n1/input'), { recursive: true })
  await writeFile(join(app, 'evals/cases/n1/input/note.txt'), '补充材料')
  await kernel.snapshotEvals('notes-digest', { by: '主管', note: '给 n1 加材料' })
  const after = kernel.app('notes-digest')
  assert.equal(after.judgeHash, before.judgeHash)
  assert.notEqual(after.cases.find((c) => c.id === 'n1')!.hash, before.cases.find((c) => c.id === 'n1')!.hash)
  assert.equal(after.cases.find((c) => c.id === 'n2')!.hash, before.cases.find((c) => c.id === 'n2')!.hash)
  assert.ok(JSON.parse(await readFile(join(app, 'evals/cases/n1/case.json'), 'utf8')).expected)
})
