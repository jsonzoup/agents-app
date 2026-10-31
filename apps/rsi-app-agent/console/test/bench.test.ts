import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { notesExecutor } from '../../rsi-kernel/test/notes-double.ts'
import { bootPlatform } from '../core/boot.ts'
import { STATE_DIR, resolveHome } from '../core/home.ts'
import { createHandler } from '../core/http.ts'
import type { Grants, User } from '../core/rbac.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = 'notes-digest'
const SKILL = 'skills/digest/SKILL.md'

const users: User[] = [
  { id: 'owner', name: '管理者甲', title: '', roles: [] },
  { id: 'op', name: '业务员丙', title: '', roles: [] },
]
const [owner, op] = users
const grants: Grants = { [APP]: [{ kind: 'user', id: 'owner', level: 'manage' }, { kind: 'user', id: 'op', level: 'use' }] }

const home = await mkdtemp(join(tmpdir(), 'bench-'))
after(() => rm(home, { recursive: true, force: true }))
await cp(join(resolveHome(REPO), APP), join(home, APP), { recursive: true })
const state = join(home, STATE_DIR, 'console')
await mkdir(state, { recursive: true })
await writeFile(join(state, 'users.json'), JSON.stringify(users))
await writeFile(join(state, 'grants.json'), JSON.stringify(grants))
const { console: app, builder, bench } = await bootPlatform({ platform: REPO, home, env: {}, harness: { available: false, command: null, note: '测试不用助手' }, executor: notesExecutor })
await app.accounts.set('owner', 'owner-pass', 'test')

const waitRun = async (id: string) => {
  for (let i = 0; i < 100; i++) {
    const r = await bench.run(APP, owner, id)
    if (r.status === 'done' || r.status === 'failed') return r
    await new Promise((res) => setTimeout(res, 50))
  }
  throw new Error('评测没有结束')
}

test('评测集：新增、修改、删除用例都会产生新快照；坏的改动被撤销', async () => {
  const before = (await bench.cases(APP, owner)).evalset
  await assert.rejects(bench.saveCase(APP, op, { id: 'n9', title: 'x', input: { text: 'a' }, expected: { title: 'a', owner: 'a' } }, true), /管理权限/)
  const added = await bench.saveCase(APP, owner, { id: 'n9', title: '新增：一个词', input: { text: '晨会：Eve 负责记录。' }, expected: { title: '晨会', owner: 'Eve' }, split: 'holdout' }, true)
  assert.notEqual(added.evalset, before)
  assert.equal(added.cases.find((c) => c.id === 'n9')?.split, 'holdout')
  await assert.rejects(bench.saveCase(APP, owner, { id: 'n9', title: 'x', input: {}, expected: {} }, true), /已存在/)
  await assert.rejects(bench.deleteCase(APP, owner, 'n3'), /契约/)

  await assert.rejects(bench.write(APP, owner, [{ path: 'cases/n1/case.json', bytes: new TextEncoder().encode('{ 坏的') }], '写坏'), /没有保存/)
  assert.equal((await bench.file(APP, owner, 'cases/n1/case.json')).text?.includes('"n1"'), true)

  const removed = await bench.deleteCase(APP, owner, 'n9')
  assert.ok(!removed.cases.some((c) => c.id === 'n9'))
  const history = await bench.history(APP, owner)
  assert.ok(history.length >= 3)
  assert.ok(history[0].changed.some((p) => p.includes('n9')))
})

test('评测运行：按版本后台评测，记录进度、评测集和每个用例的输出', async () => {
  await assert.rejects(bench.start(APP, op, { version: 'r1' }), /管理权限/)
  const run = await bench.start(APP, owner, { version: 'r1', splits: ['dev'] })
  assert.equal(run.progress.total, 3)
  const done = await waitRun(run.id)
  assert.equal(done.status, 'done', done.error ?? '')
  assert.equal(done.progress.done, 3)
  assert.equal(done.results.dev?.cases.length, 3)
  assert.ok(done.results.dev?.cases.every((c) => c.output !== undefined))
  const one = await bench.caseResult(APP, owner, run.id, 'n1')
  assert.deepEqual(one.expected, { title: '周会', owner: 'Alice Wang' })
  const overview = await bench.overview(APP, owner)
  assert.ok(overview.latest.r1?.dev)
  assert.equal(overview.latest.r1?.dev?.cases[0].output, undefined)
})

test('候选版本：管理者可以试用和评测；试用单据不产生信号，业务员看不到', async () => {
  const stable = (await app.file(APP, owner, SKILL)).text!
  const p = await app.submitProposal(APP, owner, {
    title: '负责人写全名',
    edits: [{ path: SKILL, text: stable.replace('只写名字的第一个词', '写完整姓名') }],
    record: { title: '', date: '', background: '试用', options: [], decision: '全名', impact: '负责人', review: '-' },
  })
  assert.ok((await app.versions(APP, owner)).some((v) => v.id === p.id && v.kind === 'candidate'))
  await assert.rejects(app.createTask(APP, op, { input: { text: '周会：Alice Wang 负责发布。' }, version: p.id }), /权限/)
  const trial = await app.createTask(APP, owner, { input: { text: '周会：Alice Wang 负责发布。' }, version: p.id })
  assert.equal(trial.trial?.version, p.id)
  assert.equal((trial.working as { owner: string }).owner, 'Alice Wang')
  const signals = (await app.improvements(APP, owner)).total
  await app.correct(APP, owner, trial.id, { path: 'title', field: 'title', value: '周会纪要', scope: { level: 'app' } })
  assert.equal((await app.improvements(APP, owner)).total, signals)
  assert.ok(!(await app.listTasks(APP, op)).some((t) => t.id === trial.id))

  const run = await waitRun((await bench.start(APP, owner, { version: p.id })).id)
  assert.equal(run.kind, 'candidate')
  assert.equal(run.status, 'done', run.error ?? '')
})

test('改进建议：区域和整单建议带完整单据上下文，可以不采纳并写明原因', async () => {
  const task = await app.createTask(APP, op, { title: '周会', input: { text: '周会：Alice Wang 负责发布。' } })
  await app.suggest(APP, op, task.id, { target: { level: 'region', path: 'people', label: '人员区域' }, note: '人员区域应该把负责人和参与人分开显示', scope: { level: 'app' } })
  await app.suggest(APP, op, task.id, { target: { level: 'task' }, note: '整单：标题应该带上日期', scope: { level: 'task' } })
  const imp = await app.improvements(APP, owner)
  const region = imp.issues.find((i) => i.kind === 'suggestion' && i.label === '人员区域')
  assert.ok(region, JSON.stringify(imp.issues.map((i) => i.summary)))
  assert.match(region.summary, /人员区域/)
  const detail = await app.signal(APP, owner, region.signals[0].id)
  const ctx = detail.context as { input: unknown; output: unknown; working: unknown }
  assert.deepEqual(ctx.input, { text: '周会：Alice Wang 负责发布。' })
  assert.ok(ctx.output && ctx.working)

  await assert.rejects(app.setIssueState(APP, owner, region.id, { dismissed: true }), /原因/)
  const after = await app.setIssueState(APP, owner, region.id, { dismissed: true, reason: '界面已经分开了' })
  assert.equal(after.issues.find((i) => i.id === region.id)?.state?.status, 'dismissed')
  const mine = (await app.contributions(APP, op)).find((c) => c.issue === region.id)
  assert.equal(mine?.stage, 'dismissed')
})

test('界面和功能建议：不需要单据，总是全应用；归成问题后交给编码助手改 web', async () => {
  await assert.rejects(app.suggestApp(APP, op, { target: { level: 'region', path: 'people' }, note: 'x' }), /界面还是功能/)
  await assert.rejects(app.suggestApp(APP, op, { target: { level: 'ui', path: '/' }, note: ' ' }), /写下建议/)
  const ui = await app.suggestApp(APP, op, { target: { level: 'ui', path: '/tasks/T-0099', label: '筛选栏' }, note: '列表要能按日期筛选' })
  assert.ok(ui.signal && ui.issue)
  const feature = await app.suggestApp(APP, op, { target: { level: 'feature' }, note: '希望能把办完的单据批量导出成 Excel' })
  assert.notEqual(feature.issue, ui.issue)

  const task = await app.createTask(APP, op, { title: '周会', input: { text: '周会：Alice Wang 负责发布。' } })
  const onTask = await app.suggestApp(APP, op, { target: { level: 'ui', path: `/tasks/${task.id}`, label: '筛选栏' }, note: '筛选条件要记住', task: task.id })
  assert.equal(onTask.issue, ui.issue, '同一块界面的建议归到一起')
  const detail = await app.signal(APP, owner, onTask.signal)
  assert.deepEqual(detail.scope, { level: 'app' })
  const ctx = detail.context as { page: string; task: string; output: unknown; version: string }
  assert.equal(ctx.page, `/tasks/${task.id}`)
  assert.equal(ctx.task, task.id)
  assert.ok(ctx.output)
  assert.equal(ctx.version, (await app.kernel.stable(APP)).id)
  assert.equal((await app.task(APP, op, task.id)).suggestions?.at(-1)?.target.level, 'ui')

  const viaTask = await app.suggest(APP, op, task.id, { target: { level: 'feature', label: '导出' }, note: '这一单办完想直接导出', scope: { level: 'task' } })
  const last = viaTask.suggestions!.at(-1)!
  assert.deepEqual(last.scope, { level: 'app' }, '界面和功能建议不分范围')
  assert.ok(last.signal)

  const imp = await app.improvements(APP, owner)
  const issue = imp.issues.find((i) => i.id === ui.issue)!
  assert.equal(issue.summary, '界面「筛选栏」：2 条界面建议')
  assert.ok(imp.issues.some((i) => i.field === `feature:${feature.signal}`))
  assert.equal((await app.contributions(APP, op)).find((c) => c.signal === feature.signal)?.stage, 'queued')

  const s = await builder.open(owner, APP, '', ui.issue!)
  assert.match(s.goal, /code\/web\//)
  assert.match(s.goal, /契约.*由用户决定/)
  assert.match(s.goal, /界面建议（页面 \/tasks\/T-0099，筛选栏）/)
})

test('工作区：上传二进制和删除文件会成为提案，不需要人工导入', async () => {
  const s = await builder.open(owner, APP, '')
  await builder.upload(owner, s.id, 'code/skills/digest/references/样例.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00]))
  const changes = await builder.changes(owner, s.id)
  assert.deepEqual(changes.map((c) => [c.path, c.status, c.binary]), [['skills/digest/references/样例.xlsx', 'added', true]])
  const out = await builder.publish(owner, s.id, { note: '加一份参考表格' })
  assert.ok(out.proposal)
  const p = await app.proposal(APP, owner, out.proposal!)
  assert.equal(p.changes[0].op, 'put')
  const verified = await app.verify(APP, owner, p.id)
  assert.ok(verified.gates.length > 0)
  const raw = await app.raw(APP, owner, 'skills/digest/references/样例.xlsx', p.id)
  assert.equal(raw.bytes.length, 7)
})

test('HTTP：原始文件支持 Range；评测集接口按权限', async () => {
  const handle = createHandler(app, builder, bench)
  const login = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ user: 'owner', password: 'owner-pass' }) }))
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const res = await handle(new Request(`http://x/api/apps/${APP}/raw?path=${encodeURIComponent(SKILL)}`, { headers: { cookie, range: 'bytes=0-9' } }))
  assert.equal(res.status, 206)
  assert.equal((await res.arrayBuffer()).byteLength, 10)
  assert.match(res.headers.get('content-range') ?? '', /^bytes 0-9\//)
  assert.equal((await handle(new Request(`http://x/api/apps/${APP}/bench/cases`, { headers: { cookie } }))).status, 200)
  assert.equal((await handle(new Request(`http://x/api/apps/${APP}/versions`, { headers: { cookie } }))).status, 200)
})

test('rsi-eval/1：只靠规则的用例；勾选用例运行；标准报告；用例历史', async () => {
  const rules = [
    { path: 'status', op: 'equals', value: 'result' },
    { path: 'output.title', op: 'present' },
    { path: 'output.owner', op: 'matches', pattern: '^Alice' },
  ]
  const saved = await bench.saveCase(APP, owner, { id: 'n8', title: '只有规则', input: { text: '周会：Alice Wang 负责发布。' }, expected: null, rules, validator: null, tags: ['smoke'] }, true)
  const n8 = saved.cases.find((c) => c.id === 'n8')!
  assert.deepEqual([n8.rules?.length, n8.validator, n8.tags], [3, null, ['smoke']])
  await bench.saveCase(APP, owner, { id: 'n8', title: '只有规则（改标题）', input: { text: '周会：Alice Wang 负责发布。' }, expected: null }, false)
  assert.equal((await bench.cases(APP, owner)).cases.find((c) => c.id === 'n8')?.rules?.length, 3)

  await assert.rejects(bench.start(APP, owner, { version: 'r1', cases: ['nope'] }), /没有用例/)
  const run = await waitRun((await bench.start(APP, owner, { version: 'r1', cases: ['n1', 'n8'] })).id)
  assert.equal(run.status, 'done', run.error ?? '')
  assert.deepEqual(run.cases, ['n1', 'n8'])
  assert.deepEqual(run.results.dev?.cases.map((c) => c.case).sort(), ['n1', 'n8'])
  const ruleCase = run.results.dev!.cases.find((c) => c.case === 'n8')!
  assert.equal(ruleCase.checks.length, 3)
  assert.ok(ruleCase.ok, JSON.stringify(ruleCase.checks))
  assert.notEqual((await bench.overview(APP, owner)).latest.r1?.run, run.id)

  const json = JSON.parse(new TextDecoder().decode((await bench.report(APP, owner, run.id, 'json')).bytes))
  assert.equal(json.format, 'rsi-eval-report/1')
  assert.deepEqual(json.selection, ['n1', 'n8'])
  assert.equal(json.cases.find((c: { id: string }) => c.id === 'n8').title, '只有规则（改标题）')
  const md = await bench.report(APP, owner, run.id, 'md')
  assert.match(new TextDecoder().decode(md.bytes), /部分用例，不作为发布依据/)
  assert.match(md.name, /\.md$/)

  const history = await bench.caseHistory(APP, owner, 'n1')
  assert.ok(history.length >= 2, JSON.stringify(history))
  await bench.deleteCase(APP, owner, 'n8')
})

/** Call one tool of the assistant's MCP server the way the harness does. */
async function callTool(ws: string, env: Record<string, string>, name: string, args: unknown) {
  const { spawn } = await import('node:child_process')
  const child = spawn(process.execPath, [join(REPO, 'builder/mcp/server.ts'), ws, APP], { env: { ...process.env, ...env } })
  let out = ''
  child.stdout.on('data', (c: Buffer) => (out += c.toString()))
  const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`)
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
  for (let i = 0; i < 600 && !out.includes('"id":2'); i++) await new Promise((r) => setTimeout(r, 50))
  child.kill()
  const reply = out.split('\n').map((l) => (l ? JSON.parse(l) : null)).find((m) => m?.id === 2)
  return JSON.parse(reply.result.content[0].text)
}

test('编码助手的工具：请用户上传材料、上传后回复；通过本会话令牌真实测试', async () => {
  const s = await builder.open(owner, APP, '')
  const ws = builder.workspace(s.id)
  const env = await builder.toolEnv(owner, s.id)

  const asked = await callTool(ws, env, 'request_files', { title: '一份真实的周会记录', why: '作为新用例的输入', target: 'evals/cases/n10/input' })
  assert.deepEqual([asked.ok, asked.id], [true, 'R1'])
  assert.equal((await callTool(ws, env, 'request_files', { title: '越界', why: '', target: '../x' })).ok, false)
  const open = (await builder.view(owner, s.id)).requests
  assert.deepEqual(open.map((r) => [r.id, r.status, r.target]), [['R1', 'open', 'evals/cases/n10/input/']])

  await assert.rejects(builder.answer(owner, s.id, 'R1', {}), /还没有上传/)
  const up = await builder.fulfil(owner, s.id, 'R1', '../周会.txt', new TextEncoder().encode('周会：Bob 负责记录。'))
  assert.ok(up.files.some((f) => f.path === 'evals/cases/n10/input/周会.txt'))
  const answered = await builder.answer(owner, s.id, 'R1', { note: '上周的' })
  assert.equal(answered.requests[0].status, 'done')
  await assert.rejects(builder.answer(owner, s.id, 'R1', { declined: true }), /处理过/)

  const tested = await callTool(ws, env, 'run_tests', { cases: ['n1'] })
  assert.equal(tested.dev.passed, '0/1', JSON.stringify(tested))
  assert.deepEqual(tested.dev.cases[0].failed, [{ check: 'owner', expected: 'Alice Wang', actual: 'Alice' }])
  const last = (await builder.view(owner, s.id)).lastTest!
  assert.deepEqual([last.by, last.cases], ['助手', ['n1']])
  assert.equal((await callTool(ws, { ...env, RSI_BUILDER_TOKEN: 'bad' }, 'run_tests', {})).error, '无效的会话令牌')
})

test('期望值来自人确认运行结果：待确认的用例测试跳过、不能发布；确认或改正后由平台写入', async () => {
  const s = await builder.open(owner, APP, '')
  const ws = builder.workspace(s.id)
  const env = await builder.toolEnv(owner, s.id)
  const path = 'evals/cases/n11/case.json'
  await builder.writeFile(owner, s.id, path, JSON.stringify({ id: 'n11', title: '待确认', input: { text: '周会：Alice Wang 负责发布。' }, expected: {} }))
  const report = await builder.check(owner, s.id)
  assert.deepEqual([report.ok, report.pending], [true, ['n11']], report.problems.join('\n'))
  const tested = await builder.test(owner, s.id)
  assert.ok(![...tested.dev.cases, ...tested.holdout.cases].some((c) => c.case === 'n11'))
  await assert.rejects(builder.test(owner, s.id, ['n11']), /等用户确认/)
  await assert.rejects(builder.publish(owner, s.id, {}), /n11 的期望值还在等你确认/)

  assert.equal((await callTool(ws, env, 'confirm_result', { case: 'n99' })).ok, false)
  const first = await callTool(ws, env, 'confirm_result', { case: 'n11' })
  assert.deepEqual([first.ok, first.output], [true, { title: '周会', owner: 'Alice' }], JSON.stringify(first))
  const asked = (await builder.view(owner, s.id)).requests.find((r) => r.id === first.id)!
  assert.deepEqual([asked.kind, asked.case, asked.fields], ['confirm', 'n11', [{ path: 'title', value: '周会' }, { path: 'owner', value: 'Alice' }]])

  await assert.rejects(builder.confirm(owner, s.id, first.id, { ok: false }), /哪里不对/)
  await builder.confirm(owner, s.id, first.id, { ok: false, note: '负责人要写全名' })
  assert.deepEqual((await builder.check(owner, s.id)).pending, ['n11'])
  await assert.rejects(builder.confirm(owner, s.id, first.id, { ok: true }), /处理过/)

  const second = await callTool(ws, env, 'confirm_result', { case: 'n11' })
  const third = await callTool(ws, env, 'confirm_result', { case: 'n11' })
  const list = (await builder.view(owner, s.id)).requests
  assert.equal(list.find((r) => r.id === second.id)?.status, 'declined')
  await builder.confirm(owner, s.id, third.id, { ok: false, corrections: [{ path: 'owner', value: 'Alice Wang' }] })
  const doc = JSON.parse((await builder.file(owner, s.id, path)).text!)
  assert.deepEqual(doc.expected, { title: '周会', owner: 'Alice Wang' })
  assert.match(doc.source, /管理者甲 于 .* 确认了应用的运行结果（R\d+），改正了 1 处/)
  assert.equal(doc.oracle, 'expected/oracle.json')
  const oracle = JSON.parse((await builder.file(owner, s.id, 'evals/cases/n11/expected/oracle.json')).text!)
  assert.deepEqual([oracle.status, oracle.output, oracle.provenance.kind, oracle.provenance.by], ['result', { title: '周会', owner: 'Alice Wang' }, 'confirmed-run', '管理者甲'], '改正后的结果存为参考答案')
  assert.deepEqual((await builder.view(owner, s.id)).requests.find((r) => r.id === third.id)?.corrections, [{ path: 'owner', was: 'Alice', value: 'Alice Wang' }])
  assert.deepEqual((await builder.check(owner, s.id)).pending, [])
  const scored = await builder.test(owner, s.id, ['n11'])
  assert.equal(scored.dev.cases[0].ok, false)

  await builder.writeFile(owner, s.id, 'evals/cases/n12/case.json', JSON.stringify({ id: 'n12', title: '待确认', input: { text: '晨会：Eve 负责记录。' }, expected: {} }))
  const yes = await callTool(ws, env, 'confirm_result', { case: 'n12' })
  await builder.confirm(owner, s.id, yes.id, { ok: true })
  assert.deepEqual(JSON.parse((await builder.file(owner, s.id, 'evals/cases/n12/case.json')).text!).expected, { title: '晨会', owner: 'Eve' })
  assert.equal((await builder.test(owner, s.id, ['n12'])).dev.cases[0].ok, true)
})

test('工作区里的用例材料：<应用>/evals/... 指向工作区自己的 evals/', () => {
  const ws = { app: 'invoice', root: '/tmp/ws' }
  assert.equal(app.executorInput('invoice/evals/cases/c1/input/a.pdf', ws), '/tmp/ws/evals/cases/c1/input/a.pdf')
  assert.deepEqual(app.executorInput({ files: ['invoice/evals/cases/c1/input/a.pdf'] }, ws), { files: ['/tmp/ws/evals/cases/c1/input/a.pdf'] })
  assert.equal(app.executorInput('invoice/evals/../x', ws), app.executorInput('invoice/evals/../x'))
})

test('编码助手改的评测用例：发布时由发布人确认保存；别人先改了同一文件就提示冲突', async () => {
  const s = await builder.open(owner, APP, '')
  const other = await builder.open(owner, APP, '')
  const path = 'evals/cases/n2/case.json'
  const doc = JSON.parse((await builder.file(owner, s.id, path)).text!)
  await builder.writeFile(owner, s.id, path, `${JSON.stringify({ ...doc, title: `${doc.title}（助手补充）` }, null, 2)}\n`)
  const changes = await builder.changes(owner, s.id)
  assert.deepEqual(changes.map((c) => [c.path, c.tier, c.conflict ?? null]), [[path, 'evals', null]])
  const out = await builder.publish(owner, s.id, {})
  assert.equal((await builder.view(owner, s.id)).published?.kind, 'evals')
  assert.ok(out.evalset)
  assert.match((await bench.cases(APP, owner)).cases.find((c) => c.id === 'n2')!.title, /助手补充/)
  assert.match((await bench.history(APP, owner))[0].note ?? '', /AI 编码助手起草、管理者甲 确认/)

  await builder.writeFile(owner, other.id, path, `${JSON.stringify({ ...doc, title: '另一个会话的改动' }, null, 2)}\n`)
  assert.match((await builder.changes(owner, other.id))[0].conflict ?? '', /被别人改过/)
  await assert.rejects(builder.publish(owner, other.id, {}), /冲突|别人/)
})

test('检查工作区：界面必须植入改进入口；用例引用的材料必须在用例文件夹里', async () => {
  const s = await builder.open(owner, APP, '')
  assert.deepEqual((await builder.check(owner, s.id)).problems, [])
  await builder.writeFile(owner, s.id, 'code/web/views/index.tsx', 'export default function App() { return null }\n')
  const doc = JSON.parse((await builder.file(owner, s.id, 'evals/cases/n1/case.json')).text!)
  await builder.writeFile(owner, s.id, 'evals/cases/n1/case.json', JSON.stringify({ ...doc, input: { ...doc.input, attachment: `${APP}/evals/cases/n1/input/没有.pdf` } }))
  await builder.upload(owner, s.id, 'evals/inbox/随手.txt', new TextEncoder().encode('x'))
  const report = await builder.check(owner, s.id)
  assert.ok(report.problems.some((p) => /没有植入改进入口/.test(p)), report.problems.join('\n'))
  assert.ok(report.problems.some((p) => /n1 引用的材料 evals\/cases\/n1\/input\/没有\.pdf 不存在/.test(p)), report.problems.join('\n'))
  assert.ok(report.warnings.some((w) => /SuggestButton/.test(w)))
  assert.ok(report.warnings.some((w) => /inbox/.test(w)))
})

test('多次运行与消融：记在评测记录上，消融对照同一版本的完整运行，不进版本得分表', async () => {
  await assert.rejects(bench.start(APP, owner, { version: 'r1', splits: ['dev'], trials: 9 }), /1 到 5/)
  await assert.rejects(bench.start(APP, owner, { version: 'r1', splits: ['dev'], ablate: 'everything' as never }), /消融方式/)
  const full = await waitRun((await bench.start(APP, owner, { version: 'r1', splits: ['dev'], trials: 2 })).id)
  assert.equal(full.status, 'done', full.error ?? '')
  assert.equal(full.trials, 2)
  assert.equal(full.results.dev?.trials, 2)
  assert.equal(full.results.dev?.cases[0].trials?.length, 2)
  const cut = await waitRun((await bench.start(APP, owner, { version: 'r1', splits: ['dev'], ablate: 'knowledge' })).id)
  assert.equal(cut.ablate, 'knowledge')
  assert.ok(cut.ablation?.against, '找到了同一版本、同一评测集上的完整运行')
  assert.equal(cut.ablation?.cases.length, 3)
  assert.equal((await bench.overview(APP, owner)).latest.r1?.run === cut.id, false, '消融结果不代表版本成绩')
  const md = new TextDecoder().decode((await bench.report(APP, owner, cut.id, 'md')).bytes)
  assert.match(md, /## 消融对比/)
  assert.match(md, /去掉知识/)
})

test('用例体检：参考答案、元数据和能力覆盖；从单据生成的用例带参考答案', async () => {
  const audit = await bench.audit(APP, owner)
  assert.equal(audit.cases.length > 0, true)
  assert.match(audit.cases.find((c) => c.id === 'n1')!.warnings.join(), /没有参考答案/)
  await bench.saveCase(
    APP,
    owner,
    {
      id: 'n8',
      title: '带参考答案',
      input: { text: '晨会：Eve 负责记录。' },
      expected: { title: '晨会', owner: 'Eve' },
      difficulty: 'easy',
      why: '一个词的名字',
      capabilities: ['姓名'],
      oracle: { status: 'result', output: { title: '晨会', owner: 'Eve' }, provenance: '测试' },
    },
    true,
  )
  const row = (await bench.cases(APP, owner)).cases.find((c) => c.id === 'n8')!
  assert.deepEqual([row.difficulty, row.capabilities, row.oracle?.file], ['easy', ['姓名'], 'expected/oracle.json'])
  const edited = await bench.saveCase(APP, owner, { id: 'n8', title: '带参考答案（改标题）', input: { text: '晨会：Eve 负责记录。' }, expected: { title: '晨会', owner: 'Eve' } }, false)
  assert.equal(edited.cases.find((c) => c.id === 'n8')!.oracle?.file, 'expected/oracle.json', '改用例时保留参考答案和元数据')
  assert.equal(edited.cases.find((c) => c.id === 'n8')!.why, '一个词的名字')
  const n8 = (await bench.audit(APP, owner)).cases.find((c) => c.id === 'n8')!
  assert.equal(n8.oracle?.ok, true)
  await bench.deleteCase(APP, owner, 'n8')
})
