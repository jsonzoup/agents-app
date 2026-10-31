import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ChangeError,
  ManifestError,
  applyChanges,
  compare,
  fieldPattern,
  globToRegExp,
  groupSignals,
  isProductSignal,
  pagePattern,
  instructionsFor,
  parseManifest,
  scopeOf,
  summarize,
  tierOf,
} from '../src/index.ts'
import type { Signal } from '../src/index.ts'
import { NOTES_APP, REPO } from './helpers.ts'

async function notesManifest() {
  return parseManifest(JSON.parse(await readFile(join(NOTES_APP, 'code/app.json'), 'utf8')))
}

test('文件分级：契约优先于任何可进化范围，未列出的默认是契约', async () => {
  const m = await notesManifest()
  assert.equal(tierOf(m, 'AGENTS.md'), 'knowledge')
  assert.equal(tierOf(m, 'skills/digest/SKILL.md'), 'knowledge')
  assert.equal(tierOf(m, 'scopes/team/infra/AGENTS.md'), 'knowledge')
  assert.equal(tierOf(m, 'skills/digest/scripts/run.py'), 'code')
  assert.equal(tierOf(m, 'evals/cases/n1/case.json'), 'contract')
  assert.equal(tierOf(m, 'judge/server.ts'), 'contract')
  assert.equal(tierOf(m, 'contract/output.schema.json'), 'contract')
  assert.equal(tierOf(m, 'app.json'), 'contract')
  assert.equal(tierOf(m, 'skills/digest/data/table.xlsx'), 'contract')
})

test('清单把契约文件划进可进化范围时加载失败', async () => {
  const raw = JSON.parse(await readFile(join(NOTES_APP, 'code/app.json'), 'utf8'))
  raw.evolve.knowledge.push('contract/**')
  assert.throws(() => parseManifest(raw), (e: unknown) => e instanceof ManifestError && e.problems.some((p) => p.includes('contract/output.schema.json')))
  raw.evolve.knowledge.pop()
  raw.evolve.code.push('**')
  assert.throws(() => parseManifest(raw), ManifestError)
})

test('glob：* 不跨目录，** 跨目录', () => {
  assert.ok(globToRegExp('skills/*/SKILL.md').test('skills/a/SKILL.md'))
  assert.ok(!globToRegExp('skills/*/SKILL.md').test('skills/a/b/SKILL.md'))
  assert.ok(globToRegExp('skills/*/references/**').test('skills/a/references/x/y.md'))
  assert.ok(globToRegExp('evals/**').test('evals/judge/server.ts'))
})

test('范围知识：根说明在前，命中范围的 AGENTS.md 在后', async () => {
  const m = await notesManifest()
  const files = ['AGENTS.md', 'scopes/team/infra/AGENTS.md', 'scopes/team/web/AGENTS.md']
  assert.deepEqual(instructionsFor(m, files, { team: 'infra' }), ['AGENTS.md', 'scopes/team/infra/AGENTS.md'])
  assert.deepEqual(instructionsFor(m, files, {}), ['AGENTS.md'])
  assert.deepEqual(instructionsFor(m, files, { team: 'ops' }), ['AGENTS.md'])
})

test('任务范围从输入里读出；可能逃出 scopes/ 的值被忽略', async () => {
  const m = await notesManifest()
  assert.deepEqual(scopeOf(m, { text: 'x', team: 'infra' }), { team: 'infra' })
  assert.deepEqual(scopeOf(m, { text: 'x' }), {})
  assert.deepEqual(scopeOf(m, { team: '../../evals' }), {})
  assert.deepEqual(scopeOf(m, { team: 42 }), {})
})

test('锚点改动：缺失或重复都报错，不静默', () => {
  const files = new Map([['a.md', 'x\ny\nx\n']])
  assert.throws(() => applyChanges(files, [{ path: 'a.md', op: 'replace', find: 'x', text: 'z' }]), ChangeError)
  assert.throws(() => applyChanges(files, [{ path: 'a.md', op: 'replace', find: 'q', text: 'z' }]), ChangeError)
  assert.throws(() => applyChanges(files, [{ path: 'a.md', op: 'create', text: 'z' }]), ChangeError)
  const out = applyChanges(files, [{ path: 'a.md', op: 'replace', find: 'y', text: 'Y' }, { path: 'b.md', op: 'create', text: 'new' }])
  assert.equal(out.get('a.md'), 'x\nY\nx\n')
  assert.equal(out.get('b.md'), 'new')
  assert.equal(files.get('a.md'), 'x\ny\nx\n')
})

test('信号分组：同列不同行归一；只这一票和确认不形成问题', () => {
  const base = { app: 'x', at: '', release: 'r1', by: 'u' }
  const signals: Signal[] = [
    { ...base, id: 'S-1', kind: 'correction', field: 'rows[0].price', scope: { level: 'app' } },
    { ...base, id: 'S-2', kind: 'correction', field: 'rows[2].price', scope: { level: 'app' } },
    { ...base, id: 'S-3', kind: 'correction', field: 'rows[1].price', scope: { level: 'task' } },
    { ...base, id: 'S-4', kind: 'confirmation', field: 'title', scope: { level: 'app' } },
    { ...base, id: 'S-5', kind: 'correction', field: 'title', scope: { level: 'scope', key: 'customer', value: 'c1' } },
  ]
  assert.equal(fieldPattern('rows[12].price'), 'rows[*].price')
  const issues = groupSignals(signals)
  assert.equal(issues.length, 2)
  assert.deepEqual(issues[0].signals, ['S-1', 'S-2'])
  assert.equal(issues[0].field, 'rows[*].price')
  assert.equal(issues[1].id, 'correction:title:customer=c1')
})

test('界面和功能建议：界面按区域（没有就按页面）归并，每个新功能单独成为一个问题', () => {
  const base = { app: 'x', at: '', release: 'r1', by: 'u', kind: 'suggestion' as const, scope: { level: 'app' as const } }
  const signals: Signal[] = [
    { ...base, id: 'S-1', target: { level: 'ui', path: '/tasks/T-0001' }, note: '按钮太靠下' },
    { ...base, id: 'S-2', target: { level: 'ui', path: '/tasks/T-0007' }, note: '确认按钮要固定在底部' },
    { ...base, id: 'S-3', target: { level: 'ui', path: '/', label: '筛选栏' }, note: '要能按日期筛' },
    { ...base, id: 'S-4', target: { level: 'ui', path: '/tasks', label: '筛选栏' }, note: '筛选条件要记住' },
    { ...base, id: 'S-5', target: { level: 'feature' }, note: '希望能批量导出 Excel\n发给客户' },
    { ...base, id: 'S-6', target: { level: 'feature', label: '批量建单' }, note: '一次上传多份材料' },
  ]
  assert.equal(pagePattern('/tasks/T-0001/edit'), '/tasks/*/edit')
  assert.ok(isProductSignal(signals[0]) && !isProductSignal({ target: { level: 'region', path: 'rows' } }))
  const issues = groupSignals(signals)
  const by = Object.fromEntries(issues.map((i) => [i.field, i]))
  assert.deepEqual(by['ui:/tasks/*'].signals, ['S-1', 'S-2'])
  assert.deepEqual(by['ui:筛选栏'].signals, ['S-3', 'S-4'])
  assert.equal(by['ui:筛选栏'].summary, '界面「筛选栏」：2 条界面建议')
  assert.equal(by['feature:S-5'].summary, '功能「希望能批量导出 Excel」：1 条功能建议')
  assert.equal(by['feature:S-6'].label, '批量建单')
  assert.equal(issues.length, 4)
})

test('对比：分得出用例退步、字段退步和修好的字段', () => {
  const chk = (path: string, ok: boolean) => ({ path, expected: '', actual: '', ok })
  const before = summarize('r1', 'dev', [
    { case: 'a', split: 'dev', ok: true, score: 1, checks: [chk('x', true)], violations: [], run: '' },
    { case: 'b', split: 'dev', ok: false, score: 0.5, checks: [chk('x', true), chk('y', false)], violations: [], run: '' },
  ])
  const after = summarize('P-1', 'dev', [
    { case: 'a', split: 'dev', ok: false, score: 0, checks: [chk('x', false)], violations: [], run: '' },
    { case: 'b', split: 'dev', ok: true, score: 1, checks: [chk('x', true), chk('y', true)], violations: [], run: '' },
  ])
  const c = compare(before, after)
  assert.deepEqual(c.regressions, ['a'])
  assert.deepEqual(c.fixed, ['b'])
  assert.deepEqual(c.fieldRegressions, ['a:x'])
  assert.deepEqual(c.fieldFixes, ['b:y'])
})

test('内核源码不出现行业名词，也不 import 任何执行框架', async () => {
  const banned = /报关|表头|表体|征免|关区|HS编码|海关|deepseek|cordis|@deepseek-ai|ctx\.|mcp__|SessionEvent/i
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walk(path)))
      else if (entry.name.endsWith('.ts')) out.push(path)
    }
    return out
  }
  for (const file of await walk(join(REPO, 'rsi-kernel/src'))) {
    const text = await readFile(file, 'utf8')
    assert.ok(!banned.test(text), `${file} 出现了 ${banned.exec(text)?.[0]}`)
  }
})
