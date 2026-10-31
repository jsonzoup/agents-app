import assert from 'node:assert/strict'
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Executor } from '../../rsi-kernel/src/index.ts'
import { notesExecutor } from '../../rsi-kernel/test/notes-double.ts'
import { HEADLESS_ARGS, headlessExecutor } from '../../rsi-harness/src/index.ts'
import { bootPlatform } from '../core/boot.ts'
import { STATE_DIR, resolveHome } from '../core/home.ts'
import { createHandler } from '../core/http.ts'
import type { Grants, User } from '../core/rbac.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = 'notes-digest'
const SKILL = 'skills/digest/SKILL.md'

const users: User[] = [
  { id: 'sys', name: '系统管理员', title: '', roles: ['admin'] },
  { id: 'owner', name: '管理者甲', title: '', roles: ['developer'] },
  { id: 'eng', name: '管理者乙', title: '', roles: [] },
  { id: 'op', name: '业务员丙', title: '', roles: [] },
  { id: 'op2', name: '业务员丁', title: '', roles: [] },
]
const [sys, owner, eng, op, op2] = users
const grants: Grants = {
  [APP]: [
    { kind: 'user', id: 'owner', level: 'manage' },
    { kind: 'user', id: 'eng', level: 'manage' },
    { kind: 'group', id: 'ops', level: 'use' },
  ],
}

/**
 * A stand-in for the harness CLI: answers every turn by writing one evaluation case into the
 * workspace, the way the coding assistant would, and emits the headless JSON stream.
 */
const FAKE_DSH = `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  if (args.indexOf('--patch') > args.indexOf('--json')) {
    process.stderr.write("unknown option '--patch'")
    process.exit(1)
  }
  const sid = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : 'session-fake'
  const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
  out({ type: 'session', sessionId: sid, cwd: process.cwd() })
  out({ type: 'tool_call', callId: 'c1', tool: 'write', input: { path: 'evals/cases/c1/case.json' } })
  mkdirSync('evals/cases/c1', { recursive: true })
  writeFileSync('evals/cases/c1/case.json', JSON.stringify({ id: 'c1', title: '一', input: { text: 'a' }, expected: { result: 'a' }, source: '用户在对话里给出' }))
  out({ type: 'tool_result', callId: 'c1', status: 'completed', result: 'ok' })
  out({ type: 'status', phase: 'turn_end', turn: 1, reason: { kind: 'completed' } })
  out({ type: 'final', text: '已写入用例 c1。收到：' + input.split('\\n')[0] })
})
`

const home = await mkdtemp(join(tmpdir(), 'console-'))
after(() => rm(home, { recursive: true, force: true }))
await cp(join(resolveHome(REPO), APP), join(home, APP), { recursive: true })
const state = join(home, STATE_DIR, 'console')
await mkdir(state, { recursive: true })
await writeFile(join(state, 'users.json'), JSON.stringify(users))
await writeFile(join(state, 'groups.json'), JSON.stringify([{ id: 'ops', name: '录入组', description: '', members: ['op'] }]))
await writeFile(join(state, 'grants.json'), JSON.stringify(grants))
const fake = join(home, 'fake-dsh.cjs')
await writeFile(fake, FAKE_DSH)
await chmod(fake, 0o755)
const fakeHarness = headlessExecutor({ command: process.execPath, args: [fake, ...HEADLESS_ARGS] })
const executor: Executor = { name: 'test-doubles', run: (r) => (r.app.name === APP ? notesExecutor : fakeHarness).run(r) }
const { console: app, builder, bench } = await bootPlatform({ platform: REPO, home, env: {}, harness: { available: true, command: { command: process.execPath, args: [fake] }, note: '测试用替身' }, executor })

test('业务员办理、修正 → 信号成为问题；管理者手动修正 → 验证 → 批准 → 发布 → 回滚', async () => {
  const task = await app.createTask(APP, op, { title: '周会', input: { text: '周会：Alice Wang 负责发布。' } })
  assert.equal(task.run?.release, 'r1')
  assert.deepEqual(task.working, { title: '周会', owner: 'Alice' })

  await assert.rejects(app.tree(APP, op), /管理权限/)
  await assert.rejects(app.createTask(APP, op2, { input: { text: 'x' } }), /使用权限/)

  const corrected = await app.correct(APP, op, task.id, { path: 'owner', field: 'owner', value: 'Alice Wang', note: '负责人要写全名', scope: { level: 'app' } })
  assert.equal((corrected.working as { owner: string }).owner, 'Alice Wang')
  const { issues } = await app.improvements(APP, owner)
  assert.equal(issues.length, 1)
  assert.equal((await app.contributions(APP, op))[0].stage, 'queued')

  const stable = (await app.file(APP, owner, SKILL)).text!
  const proposal = await app.submitProposal(APP, owner, {
    title: '负责人写全名',
    issue: issues[0].id,
    edits: [{ path: SKILL, text: stable.replace('只写名字的第一个词', '写完整姓名') }],
    record: { title: '', date: '', background: '业务员修正了负责人', options: [], decision: '负责人：写完整姓名', impact: '负责人一栏', review: '再有人改时' },
  })
  assert.equal(proposal.tier, 'knowledge')
  await assert.rejects(app.verify(APP, op, proposal.id), /管理权限/)
  const verification = await app.verify(APP, eng, proposal.id)
  assert.ok(verification.passed, JSON.stringify(verification.gates))

  const released = await app.decide(APP, owner, proposal.id, { role: 'owner', ok: true })
  assert.equal(released.release, 'r2')
  assert.equal((await app.contributions(APP, op))[0].stage, 'released')

  const next = await app.createTask(APP, op, { input: { text: '周会：Alice Wang 负责发布。' } })
  assert.equal(next.run?.release, 'r2')

  await assert.rejects(app.rollback(APP, owner, 'r1', ''), /原因/)
  await assert.rejects(app.rollback(APP, op, 'r1', '试试'), /管理权限/)
  await app.rollback(APP, owner, 'r1', '演示回滚')
  assert.equal((await app.releases(APP, owner)).channels.stable, 'r1')
})

test('代码级批准人数：默认两位；管理者可改为一位，改动留记录；提案按当前规则要求批准', async () => {
  assert.equal((await app.access(APP, owner)).approval.codeApprovals, 2)
  const p = await app.submitProposal(APP, owner, {
    title: '加一个脚本',
    changes: [{ path: 'skills/digest/scripts/helper.txt', op: 'create', text: 'helper' }],
    record: { title: '', date: '', background: '演示', options: [], decision: '加脚本', impact: '无', review: '无' },
  })
  assert.equal(p.tier, 'code')
  assert.deepEqual((await app.proposal(APP, owner, p.id)).required, ['owner', 'engineer'])

  await assert.rejects(app.setApprovalPolicy(APP, op, { codeApprovals: 1 }), /管理权限/)
  await assert.rejects(app.setApprovalPolicy(APP, owner, { codeApprovals: 3 }), /1 或 2/)
  const access = await app.setApprovalPolicy(APP, owner, { codeApprovals: 1 })
  assert.equal(access.approval.codeApprovals, 1)
  assert.deepEqual(access.approval.history.map((h) => [h.codeApprovals, h.by]), [[1, '管理者甲']])
  assert.deepEqual((await app.proposal(APP, owner, p.id)).required, ['owner'])

  await app.setApprovalPolicy(APP, eng, { codeApprovals: 2 })
  assert.equal((await app.access(APP, owner)).approval.history.length, 2)
  assert.deepEqual((await app.proposal(APP, owner, p.id)).required, ['owner', 'engineer'])
})

test('授权：加入用户组即获得使用权；不能撤掉最后一位管理者', async () => {
  await assert.rejects(app.setAccess(APP, owner, [{ kind: 'group', id: 'ops', level: 'use' }]), /管理者/)
  await assert.rejects(app.access(APP, op), /管理权限/)
  await app.updateGroup(sys, 'ops', { id: 'ops', name: '录入组', description: '', members: ['op', 'op2'] })
  assert.equal((await app.appSummary(APP, op2)).level, 'use')
  const group = await app.createGroup(owner, { id: 'reviewers', name: '审阅组', description: '', members: ['op2'] })
  const after = await app.setAccess(APP, owner, [...grants[APP], { kind: 'group', id: group.id, level: 'manage' }])
  assert.equal(after.effective.find((u) => u.id === 'op2')?.level, 'manage')
  await assert.rejects(app.updateGroup(owner, 'ops', { id: 'ops', name: 'x', description: '', members: [] }), /系统权限/)
  await app.setAccess(APP, owner, grants[APP])
})

test('AI 编码助手：对话写文件 → 检查 → 测试 → 发布成新应用', async () => {
  await assert.rejects(builder.create(op, { name: 'echo-app', title: '回声', goal: '原样返回' }), /创建应用的权限/)
  const s = await builder.create(owner, { name: 'echo-app', title: '回声', goal: '原样返回输入的文字' })
  assert.equal(s.messages.length, 2)
  for (let i = 0; i < 50 && (await builder.view(owner, s.id)).running; i++) await new Promise((r) => setTimeout(r, 100))
  const done = await builder.view(owner, s.id)
  assert.equal(done.harnessSession, 'session-fake')
  assert.match(done.messages[1].text, /已写入用例 c1/)
  assert.ok(done.files.some((f) => f.path === 'evals/cases/c1/case.json' && f.tier === 'evals'))
  await assert.rejects(builder.view(eng, s.id), /别人的/)

  await builder.writeFile(owner, s.id, 'code/skills/main/SKILL.md', '---\nname: main\ndescription: 回声\n---\n\n原样返回。\n')
  assert.deepEqual((await builder.view(owner, s.id)).edited, ['code/skills/main/SKILL.md'])
  await assert.rejects(builder.writeFile(owner, s.id, '../escape.txt', 'x'), /code\/ 和 evals\//)
  assert.ok((await builder.check(owner, s.id)).ok)
  const tested = await builder.test(owner, s.id)
  assert.equal(tested.dev.total, 1)

  const published = await builder.publish(owner, s.id, {})
  assert.equal(published.release, 'r1')
  assert.equal((await app.appSummary('echo-app', owner)).level, 'manage')
  await assert.rejects(builder.send(owner, s.id, '再改改'), /已经发布/)
})

test('AI 修改已有应用：只改知识级 → 成为提案', async () => {
  const s = await builder.open(owner, APP, '')
  await builder.writeFile(owner, s.id, `code/${SKILL}`, `${(await builder.file(owner, s.id, `code/${SKILL}`)).text}\n补充：标题去掉首尾空格。\n`)
  const changes = await builder.changes(owner, s.id)
  assert.deepEqual(changes.map((c) => [c.path, c.tier]), [[SKILL, 'knowledge']])
  const out = await builder.publish(owner, s.id, { note: '标题去空格' })
  assert.ok(out.proposal)
  assert.equal((await app.proposal(APP, owner, out.proposal!)).status, 'draft')
})

test('预览：用工作区的文件建单据和运行 web 应用；预览单据留在会话里，不成为信号', async () => {
  const s = await builder.open(owner, APP, '')
  const preview = builder.preview
  const view = await preview.view(owner, s.id)
  assert.equal(view.app.name, APP)
  assert.ok(view.app.permissions.includes('signal.record'))
  const signals = (await app.kernel.signals(APP)).length
  const realTasks = (await app.listTasks(APP, owner)).length

  const task = await preview.create(owner, s.id, { title: '预览', input: { text: '周会：Alice Wang 负责发布。' } })
  assert.equal(task.id, 'PV-1')
  assert.equal(task.state, 'ready')
  assert.equal(task.run?.release, '工作区')
  assert.deepEqual(task.working, { title: '周会', owner: 'Alice' })
  const corrected = await preview.correct(owner, s.id, task.id, { path: 'owner', field: 'owner', value: 'Alice Wang', scope: { level: 'app' } })
  assert.equal((corrected.working as { owner: string }).owner, 'Alice Wang')
  assert.equal(corrected.corrections[0].signal, '')
  await preview.confirm(owner, s.id, task.id)
  assert.equal((await app.kernel.signals(APP)).length, signals)
  assert.equal((await app.listTasks(APP, owner)).length, realTasks)
  assert.deepEqual((await preview.tasks(owner, s.id)).map((t) => t.id), ['PV-1'])
  await assert.rejects(preview.tasks(op, s.id))

  const site = await preview.webSite(owner, s.id)
  if (site) {
    assert.equal(site.base, `/apps/${APP}/w/${s.id}`)
    assert.equal(site.env.NEXT_PUBLIC_RSI_API, `/api/builds/${s.id}/preview`)
    const page = 'code/web/views/index.tsx'
    await builder.writeFile(owner, s.id, page, `${(await builder.file(owner, s.id, page)).text}\n// 预览指纹随文件变化\n`)
    assert.notEqual((await preview.webSite(owner, s.id))!.fingerprint, site.fingerprint)
  }
  await preview.clear(owner, s.id)
  assert.deepEqual(await preview.tasks(owner, s.id), [])
})

test('确认后锁定；没有修正的确认只计数，不成为问题', async () => {
  const task = await app.createTask(APP, op, { input: { text: '复盘：Bob 负责跟进。' } })
  await app.confirm(APP, op, task.id)
  await assert.rejects(app.correct(APP, op, task.id, { path: 'owner', field: 'owner', value: 'x', scope: { level: 'task' } }), /已确认/)
  const imp = await app.improvements(APP, owner)
  assert.ok(imp.confirmations >= 1)
  assert.ok(imp.issues.every((i) => i.kind !== 'confirmation'))
})

test('HTTP：密码登录，未登录 401，登录后按权限 403', async () => {
  const handle = createHandler(app, builder, bench)
  await app.accounts.set('op', 'op-secret', 'test')
  await app.accounts.set('sys', 'sys-secret', 'test')
  const login = (user: string, password: string) => handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ user, password }) }))
  const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await handle(new Request('http://x/api/me'))).status, 401)
  assert.equal((await handle(new Request('http://x/api/identities'))).status, 401)
  for (const [user, password] of [['op', 'wrong-pass'], ['nobody', 'op-secret'], ['op2', '']]) {
    const res = await login(user, password)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, '账号或密码不对')
  }
  const cookie = cookieOf(await login('op', 'op-secret'))
  const get = (path: string, c = cookie) => handle(new Request(`http://x${path}`, { headers: { cookie: c } }))
  assert.equal((await get('/api/me')).status, 200)
  assert.equal((await get(`/api/apps/${APP}/tasks`)).status, 200)
  assert.equal((await get(`/api/apps/${APP}/releases`)).status, 403)
  assert.equal((await get('/api/system')).status, 403)
  assert.equal((await get('/api/apps/nope')).status, 404)
  assert.equal((await get('/api/me', 'rsi_session=op.1.forged')).status, 401)
  assert.equal((await get('/files/etc/passwd')).status, 404)

  const post = (path: string, body: unknown, c = cookie) => handle(new Request(`http://x${path}`, { method: 'POST', headers: { cookie: c }, body: JSON.stringify(body) }))
  assert.equal((await post('/api/me/password', { current: 'nope-nope', password: 'op-secret-2' })).status, 400)
  assert.equal((await post('/api/me/password', { current: 'op-secret', password: '123' })).status, 400)
  const changed = await post('/api/me/password', { current: 'op-secret', password: 'op-secret-2' })
  assert.equal(changed.status, 200)
  assert.equal((await get('/api/me')).status, 401, '改密码后旧会话失效')
  const renewed = cookieOf(changed)
  assert.equal((await get('/api/me', renewed)).status, 200)
  assert.equal((await login('op', 'op-secret')).status, 400)

  const admin = cookieOf(await login('sys', 'sys-secret'))
  assert.equal((await post('/api/system/users/sys/password', { password: 'x-x-x-x' }, renewed)).status, 403)
  assert.equal((await post('/api/system/users/op/password', { password: 'reset-by-admin' }, admin)).status, 200)
  assert.equal((await get('/api/me', renewed)).status, 401, '管理员重置后旧会话失效')
  assert.equal((await login('op', 'reset-by-admin')).status, 200)

  assert.equal((await post('/api/system/users', { id: 'newbie', name: '新人', roles: [] }, admin)).status, 400, '新建用户必须给初始密码')
  assert.equal((await post('/api/system/users', { id: 'newbie', name: '新人', roles: [], password: 'first-pass' }, admin)).status, 200)
  assert.equal((await login('newbie', 'first-pass')).status, 200)
  const view = (await (await get('/api/system', admin)).json()) as { users: { id: string; passwordSet: boolean; password?: unknown }[] }
  assert.ok(view.users.find((u) => u.id === 'newbie')!.passwordSet)
  assert.ok(view.users.every((u) => !('password' in u)))
})

test('空的 home：RSI_ADMIN_PASSWORD 创建管理员，否则登录提示怎么开始', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'console-empty-'))
  after(() => rm(empty, { recursive: true, force: true }))
  const bare = await bootPlatform({ platform: REPO, home: empty, env: {}, harness: { available: false, command: null, note: '' }, executor: notesExecutor })
  await assert.rejects(bare.console.login('admin', 'whatever'), /RSI_ADMIN_PASSWORD/)
  const booted = await bootPlatform({ platform: REPO, home: empty, env: { RSI_ADMIN_PASSWORD: 'first-admin' }, harness: { available: false, command: null, note: '' }, executor: notesExecutor })
  const { user } = await booted.console.login('admin', 'first-admin')
  assert.deepEqual(user.roles, ['admin'])
  const again = await bootPlatform({ platform: REPO, home: empty, env: { RSI_ADMIN_PASSWORD: 'other-pass' }, harness: { available: false, command: null, note: '' }, executor: notesExecutor })
  await assert.rejects(again.console.login('admin', 'other-pass'), /账号或密码不对/)
})

test('执行器看到的任务输入：可读材料换成绝对路径，其余原样', () => {
  const input = { text: '周会：Alice 负责发布。', materials: [{ path: `${APP}/evals/cases/n1/input/a.pdf` }, { path: '.rsi/uploads/abc/b.pdf' }], other: '../etc/passwd' }
  assert.deepEqual(app.executorInput(input), {
    text: '周会：Alice 负责发布。',
    materials: [{ path: join(home, `${APP}/evals/cases/n1/input/a.pdf`) }, { path: join(home, '.rsi/uploads/abc/b.pdf') }],
    other: '../etc/passwd',
  })
})
