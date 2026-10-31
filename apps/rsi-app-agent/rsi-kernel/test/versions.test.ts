import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ChangeError, FsAppSource, FsStore, RsiKernel, applyChanges, commandAppTests, groupSignals, mcpJudge, steppingClock } from '../src/index.ts'
import type { BlobStore, Signal } from '../src/index.ts'
import { notesExecutor } from './notes-double.ts'
import { NOTES_APP, OWNER_RULE_NEW, OWNER_RULE_OLD, notesKernel, record } from './helpers.ts'

const bytes = (s: string) => new TextEncoder().encode(s)

test('变更：整份文件按内容放入、删除；非文本文件不能按锚点改', () => {
  const files = new Map<string, string | { blob: string }>([['a.md', 'x'], ['t.xlsx', { blob: 'h1' }]])
  const out = applyChanges(files, [{ path: 't.xlsx', op: 'put', blob: 'h2' }, { path: 'a.md', op: 'delete' }, { path: 'b.xlsx', op: 'put', blob: 'h3' }])
  assert.deepEqual(out.get('t.xlsx'), { blob: 'h2' })
  assert.equal(out.has('a.md'), false)
  assert.deepEqual(out.get('b.xlsx'), { blob: 'h3' })
  assert.throws(() => applyChanges(files, [{ path: 't.xlsx', op: 'append', text: 'x' }]), ChangeError)
  assert.throws(() => applyChanges(files, [{ path: 'zz.md', op: 'delete' }]), ChangeError)
})

test('提案可以放入二进制文件、删除文件；没存进来的内容被驳回', async () => {
  const { kernel } = await notesKernel()
  const blob = await kernel.putBlob(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]))
  const p = await kernel.submit('notes-digest', {
    title: '加一份对照表',
    changes: [{ path: 'skills/digest/references/对照表.xlsx', op: 'put', blob, size: 6 }],
    record: record('加一份对照表'),
  }, 'human:主管')
  assert.equal(p.status, 'draft')
  assert.equal(p.tier, 'knowledge')
  const candidate = await kernel.candidate('notes-digest', p.id)
  assert.equal(candidate.files['skills/digest/references/对照表.xlsx'], blob)
  const dir = await kernel.materialize('notes-digest', p.id)
  assert.deepEqual([...(await readFile(join(dir, 'skills/digest/references/对照表.xlsx')))], [0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe])

  const missing = await kernel.submit('notes-digest', { title: '空', changes: [{ path: 'skills/digest/references/x.bin', op: 'put', blob: 'f'.repeat(64) }], record: record('空') }, 'human:主管')
  assert.equal(missing.status, 'rejected')
  assert.match(missing.approvals[0].note ?? '', /没有存进来/)
})

test('只改 web 应用的提案：智能体输出不变，沿用评测缓存，“确有改进”不拦', async () => {
  const { kernel } = await notesKernel({ appTests: commandAppTests('node', ['-e', 'process.exit(0)']) })
  const before = await kernel.evaluate('notes-digest', 'r1', 'dev')
  const page = (await kernel.textFiles(await kernel.stable('notes-digest'))).get('web/views/index.tsx')!
  const anchor = page.split('\n').find((l) => l.trim().length > 10)!
  const p = await kernel.submit('notes-digest', { title: '界面', changes: [{ path: 'web/views/index.tsx', op: 'replace', find: anchor, text: `${anchor} ` }], record: record('界面') }, 'human:主管')
  assert.equal(p.tier, 'code')
  const v = await kernel.verify('notes-digest', p.id)
  assert.equal(v.gates.find((g) => g.gate === '确有改进')?.ok, true)
  assert.deepEqual(v.dev.candidate.cases.map((c) => c.run), before.cases.map((c) => c.run))
  assert.equal(v.passed, true)
})

test('候选版本可以试运行，记录用的是候选版本', async () => {
  const { kernel } = await notesKernel()
  const p = await kernel.submit('notes-digest', { title: '全名', changes: [{ path: 'skills/digest/SKILL.md', op: 'replace', find: OWNER_RULE_OLD, text: OWNER_RULE_NEW }], record: record('全名') }, 'human:主管')
  const run = await kernel.runTask('notes-digest', { input: { text: '周会：Alice Wang 负责发布。' }, release: p.id })
  assert.equal(run.release, p.id)
  assert.equal((run.result.output as { owner: string }).owner, 'Alice Wang')
})

test('评测集：每次变化留一个快照；改了期望值的用例重新评分', async () => {
  const app = join(await mkdtemp(join(tmpdir(), 'rsi-evalset-')), 'notes-digest')
  await cp(NOTES_APP, app, { recursive: true })
  const kernel = new RsiKernel({
    store: new FsStore(await mkdtemp(join(tmpdir(), 'rsi-kernel-'))),
    clock: steppingClock('2026-10-09T08:00:00Z'),
    executor: notesExecutor,
    judge: (a, v) => mcpJudge(a.source.evals.root, v.command, v.args),
  })
  await kernel.install(new FsAppSource(app))
  assert.deepEqual((await kernel.evalSets('notes-digest')).map((s) => s.id), ['e1'])
  const first = await kernel.evaluate('notes-digest', 'r1', 'dev')
  assert.equal(first.evalset, 'e1')
  const n1 = first.cases.find((c) => c.case === 'n1')!

  const file = join(app, 'evals/cases/n1/case.json')
  const raw = JSON.parse(await readFile(file, 'utf8'))
  raw.expected.owner = 'Alice'
  await writeFile(file, JSON.stringify(raw, null, 2))
  const set = await kernel.snapshotEvals('notes-digest', { by: '主管', note: '负责人改为只写名' })
  assert.equal(set.id, 'e2')
  assert.equal(set.parent, 'e1')
  const again = await kernel.evaluate('notes-digest', 'r1', 'dev')
  assert.equal(again.evalset, 'e2')
  assert.notEqual(again.cases.find((c) => c.case === 'n1')!.ok, n1.ok)
  assert.equal((await kernel.snapshotEvals('notes-digest', { by: '主管', note: '没变' })).id, 'e2')
})

test('信号：区域建议和整单建议各自归成问题，带着名字和上下文', () => {
  const base = { app: 'x', at: '', release: 'r1', by: '甲', scope: { level: 'app' as const } }
  const signals: Signal[] = [
    { ...base, id: 'S-1', kind: 'suggestion', target: { level: 'region', path: 'rows[0]', label: '第 1 行' }, note: '单位要换算', context: { input: 1 } },
    { ...base, id: 'S-2', kind: 'suggestion', target: { level: 'region', path: 'rows[3]', label: '第 4 行' }, note: '同上' },
    { ...base, id: 'S-3', kind: 'suggestion', target: { level: 'task' }, note: '先看装箱单再看发票' },
    { ...base, id: 'S-4', kind: 'correction', field: 'rows[1].qty', before: '1', after: '2' },
  ]
  const issues = groupSignals(signals)
  const region = issues.find((i) => i.field === 'rows[*]')!
  assert.deepEqual(region.signals, ['S-1', 'S-2'])
  assert.equal(region.label, '第 1 行')
  assert.match(region.summary, /改进建议/)
  const whole = issues.find((i) => i.kind === 'suggestion' && i.field === null)!
  assert.deepEqual(whole.signals, ['S-3'])
  assert.match(whole.summary, /^整单/)
  assert.equal(issues.find((i) => i.kind === 'correction')?.field, 'rows[*].qty')
})

test('远端内容存储：内容写到远端，本地只是缓存，缓存丢了从远端取回', async () => {
  const remote = new Map<string, Uint8Array>()
  const blobs: BlobStore = {
    name: 'memory',
    put: async (h, c) => void remote.set(h, c),
    get: async (h) => {
      const c = remote.get(h)
      if (!c) throw new Error('missing')
      return c
    },
    has: async (h) => remote.has(h),
  }
  const root = await mkdtemp(join(tmpdir(), 'rsi-store-'))
  const store = new FsStore(root, { blobs })
  const hash = await store.putBlob(bytes('内容'))
  assert.ok(remote.has(hash))
  const fresh = new FsStore(await mkdtemp(join(tmpdir(), 'rsi-store-')), { blobs })
  assert.equal(new TextDecoder().decode(await fresh.getBlob(hash)), '内容')
  assert.equal(fresh.blobStore, 'memory')
})
