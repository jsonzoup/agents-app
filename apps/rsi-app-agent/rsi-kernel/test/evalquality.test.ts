import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FsAppSource, FsStore, RsiKernel, ablatedPaths, aggregateTrials, compare, completeGate, hashContent, mcpJudge, parseManifest, steppingClock, summarize } from '../src/index.ts'
import type { Executor, RunRequest, SuiteResult } from '../src/index.ts'
import { NOTES_APP } from './helpers.ts'
import { notesExecutor } from './notes-double.ts'

async function notesCopy(executor: Executor) {
  const app = join(await mkdtemp(join(tmpdir(), 'rsi-quality-')), 'notes-digest')
  await cp(NOTES_APP, app, { recursive: true })
  const kernel = new RsiKernel({
    store: new FsStore(await mkdtemp(join(tmpdir(), 'rsi-kernel-'))),
    clock: steppingClock('2026-10-09T08:00:00Z'),
    executor,
    judge: (a, v) => mcpJudge(a.source.evals.root, v.command, v.args),
  })
  return { app, kernel }
}

/** Counts runs per case and can fail some of them the way a dead model service would. */
function counting(fail: (caseId: string, n: number) => 'error' | 'wrong' | null = () => null) {
  const runs = new Map<string, number>()
  const executor: Executor = {
    name: 'notes-double',
    run: async (request: RunRequest) => {
      const n = (runs.get(request.caseId ?? '') ?? 0) + 1
      runs.set(request.caseId ?? '', n)
      const how = fail(request.caseId ?? '', n)
      if (how === 'error') return { status: 'failed', output: null, trace: [], ms: 1, executor: 'notes-double', note: '模型服务 503', error: '模型服务 503' }
      const result = await notesExecutor.run(request)
      return how === 'wrong' ? { ...result, output: { ...(result.output as object), owner: '某人' } } : result
    },
  }
  return { executor, runs }
}

test('多次运行：检查项按通过次数过半判定，用例给出通过率，违例任何一次都算', () => {
  const ok = { path: 'owner', expected: 'A', actual: 'A', ok: true }
  const bad = { path: 'owner', expected: 'A', actual: 'B', ok: false }
  const base = { violations: [], status: 'result', output: {}, ms: 10, run: 'x' }
  const score = aggregateTrials('c1', 'dev', [
    { ...base, checks: [ok] },
    { ...base, checks: [bad], violations: ['净重大于毛重'] },
    { ...base, checks: [ok] },
    { ...base, checks: [], error: '超时' },
  ])
  assert.equal(score.passRate, 2 / 3)
  assert.equal(score.ok, true)
  assert.deepEqual(score.checks, [{ path: 'owner', expected: 'A', actual: 'B', ok: true, rate: 2 / 3 }])
  assert.deepEqual(score.violations, ['净重大于毛重'])
  assert.equal(score.trials?.length, 4)
  assert.equal(score.trials?.[3].error, '超时')
  assert.equal(aggregateTrials('c1', 'dev', [{ ...base, checks: [], error: '超时' }]).error, '超时')
})

test('比较只认稳定的变化：基线次次通过、候选过半失败才算退步，时过时不过单独列出', () => {
  const suite = (passRate: number, rate: number, extra: Partial<SuiteResult['cases'][number]> = {}): SuiteResult =>
    summarize('r', 'dev', [{ case: 'c1', split: 'dev', ok: passRate > 0.5, score: rate, checks: [{ path: 'owner', expected: 'A', actual: 'B', ok: rate > 0.5, rate }], violations: [], run: 'x', passRate, ...extra }], 3)
  assert.deepEqual(compare(suite(1, 1), suite(1 / 3, 1 / 3)).regressions, ['c1'])
  assert.deepEqual(compare(suite(1, 1), suite(1 / 3, 1 / 3)).fieldRegressions, ['c1:owner'])
  const flaky = compare(suite(1, 1), suite(2 / 3, 2 / 3))
  assert.deepEqual([flaky.regressions, flaky.fieldRegressions, flaky.unstable], [[], [], ['c1:owner']])
  assert.deepEqual(compare(suite(2 / 3, 2 / 3), suite(0, 0)).regressions, [], '基线本身不稳定时不算退步')
  assert.deepEqual(compare(suite(0, 0), suite(1, 1)).fieldFixes, ['c1:owner'])
  const errored = compare(suite(1, 1), suite(0, 0, { error: '模型服务 503' }))
  assert.deepEqual([errored.regressions, errored.skipped], [[], ['c1']])
})

test('执行出错不计分、不缓存、不算退步，评测完整这道门挡住发布', async () => {
  const { executor, runs } = counting((id, n) => (id === 'n1' && n === 1 ? 'error' : null))
  const { app, kernel } = await notesCopy(executor)
  await kernel.install(new FsAppSource(app))
  const first = await kernel.evaluate('notes-digest', 'r1', 'dev')
  const n1 = first.cases.find((c) => c.case === 'n1')!
  assert.equal(n1.error, '模型服务 503')
  assert.deepEqual(first.errors, ['n1'])
  assert.equal(first.total, first.cases.length - 1, '出错的用例不在分母里')
  const gate = completeGate.check({ proposal: {} as never, dev: { baseline: first, candidate: first, comparison: compare(first, first) }, holdout: null, violations: [], appTests: null })
  assert.equal(gate.ok, false)
  assert.match(gate.detail, /n1 执行出错/)
  const again = await kernel.evaluate('notes-digest', 'r1', 'dev')
  assert.equal(runs.get('n1'), 2, '出错的结果没有缓存，再跑一次会重新执行')
  assert.equal(again.cases.find((c) => c.case === 'n1')!.error, undefined)
  assert.deepEqual(again.errors, [])
})

test('参考答案得不了满分的用例不执行、不计分，体检指出哪里不对', async () => {
  const { executor, runs } = counting()
  const { app, kernel } = await notesCopy(executor)
  const n1 = join(app, 'evals/cases/n1')
  const doc = JSON.parse(await readFile(join(n1, 'case.json'), 'utf8'))
  await mkdir(join(n1, 'expected'), { recursive: true })
  await writeFile(join(n1, 'expected/oracle.json'), JSON.stringify({ status: 'result', output: { title: '周会', owner: 'Alice' }, provenance: '测试' }))
  await writeFile(join(n1, 'case.json'), JSON.stringify({ ...doc, oracle: 'expected/oracle.json' }))
  await kernel.install(new FsAppSource(app))
  const result = await kernel.evaluate('notes-digest', 'r1', 'dev')
  const score = result.cases.find((c) => c.case === 'n1')!
  assert.match(score.invalid ?? '', /参考答案没有得满分：owner（期望 Alice Wang，参考答案 Alice）/)
  assert.equal(runs.get('n1'), undefined, '用例本身有问题时不花执行成本')
  assert.deepEqual(result.invalid, ['n1'])
  const audit = await kernel.audit('notes-digest')
  const a1 = audit.cases.find((c) => c.id === 'n1')!
  assert.equal(a1.oracle?.ok, false)
  assert.match(a1.problems.join(), /参考答案没有得满分/)
  assert.match(audit.cases.find((c) => c.id === 'n2')!.warnings.join(), /没有参考答案/)

  await writeFile(join(n1, 'expected/oracle.json'), JSON.stringify({ status: 'result', output: { title: '周会', owner: 'Alice Wang' } }))
  await kernel.snapshotEvals('notes-digest', { by: '主管', note: '修正参考答案' })
  assert.equal((await kernel.audit('notes-digest')).cases.find((c) => c.id === 'n1')!.oracle?.ok, true)
  await assert.rejects(
    (async () => {
      await writeFile(join(n1, 'case.json'), JSON.stringify({ ...doc, oracle: { output: {} } }))
      await kernel.snapshotEvals('notes-digest', { by: '主管', note: '写错' })
    })(),
    /oracle（参考答案）要写成 \{status, output\}/,
  )
})

test('多次运行：每次运行分别缓存，验证按 eval.json 的 trials 跑', async () => {
  const { executor, runs } = counting((id, n) => (id === 'n2' && n === 2 ? 'wrong' : null))
  const { app, kernel } = await notesCopy(executor)
  await kernel.install(new FsAppSource(app))
  const result = await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n2'], { trials: 3 })
  const n2 = result.cases[0]
  assert.equal(runs.get('n2'), 3)
  assert.equal(result.trials, 3)
  assert.equal(n2.passRate, 2 / 3)
  assert.equal(n2.checks.find((c) => c.path.includes('owner'))?.rate, 2 / 3)
  await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n2'], { trials: 3 })
  assert.equal(runs.get('n2'), 3, '三次运行都已缓存')
  await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n2'])
  assert.equal(runs.get('n2'), 3, '只跑一次时用的是第一次运行的缓存')
  await assert.rejects(kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n2'], { trials: 9 }), /1 到 5/)
})

test('消融：去掉知识保留根说明和 SKILL.md，去掉技能拿走整个技能目录，结果分开缓存', async () => {
  const manifest = parseManifest(JSON.parse(await readFile(join(NOTES_APP, 'code/app.json'), 'utf8')))
  const paths = ['AGENTS.md', 'skills/digest/SKILL.md', 'skills/digest/references/rules.md', 'skills/digest/scripts/a.py', 'scopes/team/t1/AGENTS.md', 'contract/input.schema.json']
  assert.deepEqual(ablatedPaths(manifest, paths, 'knowledge'), ['skills/digest/references/rules.md', 'scopes/team/t1/AGENTS.md'])
  assert.deepEqual(ablatedPaths(manifest, paths, 'skills'), ['skills/digest/SKILL.md', 'skills/digest/references/rules.md', 'skills/digest/scripts/a.py'])

  const seen: string[][] = []
  const executor: Executor = { name: 'notes-double', run: async (r) => (seen.push(Object.keys(r.release.files)), notesExecutor.run(r)) }
  const { app, kernel } = await notesCopy(executor)
  await mkdir(join(app, 'code/skills/digest/references'), { recursive: true })
  await writeFile(join(app, 'code/skills/digest/references/rules.md'), '参考')
  await kernel.install(new FsAppSource(app))
  await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n1'])
  await kernel.evaluate('notes-digest', 'r1', 'dev', undefined, ['n1'], { ablate: 'knowledge' })
  assert.equal(seen.length, 2, '消融运行不复用完整版本的缓存')
  assert.ok(seen[0].includes('skills/digest/references/rules.md'))
  assert.ok(!seen[1].includes('skills/digest/references/rules.md'))
  assert.ok(seen[1].includes('skills/digest/SKILL.md'))
})

test('用例体检：材料哈希、词表、出处和难度，并给出能力覆盖', async () => {
  const { executor } = counting()
  const { app, kernel } = await notesCopy(executor)
  const n1 = join(app, 'evals/cases/n1')
  const doc = JSON.parse(await readFile(join(n1, 'case.json'), 'utf8'))
  await mkdir(join(n1, 'input'), { recursive: true })
  await writeFile(join(n1, 'input/note.txt'), '周会纪要')
  const material = { path: 'notes-digest/evals/cases/n1/input/note.txt', sha256: hashContent('另一份') }
  await writeFile(join(n1, 'case.json'), JSON.stringify({ ...doc, input: { ...doc.input, file: material }, difficulty: 'medium', capabilities: ['姓名', '日期'] }))
  await writeFile(join(app, 'evals/eval.json'), JSON.stringify({ spec: 'rsi-eval/1', capabilities: { 姓名: '负责人姓名写全', 标题: '标题取冒号前' } }))
  await kernel.install(new FsAppSource(app))
  const audit = await kernel.audit('notes-digest')
  const a1 = audit.cases.find((c) => c.id === 'n1')!
  assert.match(a1.problems.join(), /note.txt 的内容和记录的 sha256 不一致/)
  assert.match(a1.problems.join(), /不在 eval.json 的词表里：日期/)
  assert.match(a1.warnings.join(), /写了难度但没有写 why/)
  assert.deepEqual(
    audit.coverage.map((c) => [c.capability, c.cases]),
    [['姓名', ['n1']], ['标题', []], ['日期', ['n1']]],
  )
  assert.match(audit.warnings.join(), /这些能力还没有用例：标题/)
  await assert.rejects(
    (async () => {
      await writeFile(join(n1, 'case.json'), JSON.stringify({ ...doc, difficulty: 'extreme' }))
      await kernel.snapshotEvals('notes-digest', { by: '主管', note: '写错' })
    })(),
    /difficulty 只能是/,
  )
})
