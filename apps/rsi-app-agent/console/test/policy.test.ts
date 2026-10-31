import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUILTIN_ROLES, DEFAULT_APPROVAL_POLICY, AccessError, approvalRoles, can, checkAdminRemains, checkCodeApprovals, checkGrants, demandApproval, levelOf, permissionsOf, sourcesOf, systemPermissionsOf, visibleApps } from '../core/rbac.ts'
import type { Directory, User } from '../core/rbac.ts'
import { getPath, parsePath, setPath } from '../core/paths.ts'
import { seedProblems, skeletonApp } from '../core/scaffold.ts'
import { checkWorkspace } from '../core/workspace.ts'
import { webTemplate } from '../core/webtemplate.ts'
import { readZip, writeZip } from '../core/zip.ts'
import { FsAppSource, FsStore, RsiKernel, parseManifest, tierOf } from '../../rsi-kernel/src/index.ts'
import { agentPatch } from '../../rsi-harness/src/index.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const admin: User = { id: 'a', name: '管', title: '', roles: ['admin'] }
const dev: User = { id: 'd', name: '开', title: '', roles: ['developer'] }
const m1: User = { id: 'm1', name: '甲', title: '', roles: [] }
const m2: User = { id: 'm2', name: '乙', title: '', roles: [] }
const op: User = { id: 'op', name: '办', title: '', roles: [] }
const off: User = { id: 'off', name: '停', title: '', roles: [], disabled: true }

const dir: Directory = {
  users: [admin, dev, m1, m2, op, off],
  groups: [{ id: 'ops', name: '录入组', description: '', members: ['op', 'off'] }],
  roles: BUILTIN_ROLES,
  grants: {
    x: [
      { kind: 'group', id: 'ops', level: 'use' },
      { kind: 'user', id: 'm1', level: 'manage' },
      { kind: 'user', id: 'm2', level: 'manage' },
    ],
  },
}

test('应用只分使用和管理：用户组授予使用，管理包含使用', () => {
  assert.equal(levelOf(dir, 'x', op), 'use')
  assert.ok(can(dir, 'x', op, 'app.use'))
  assert.ok(can(dir, 'x', op, 'signal.record'))
  assert.ok(!can(dir, 'x', op, 'app.read'))
  assert.deepEqual(sourcesOf(dir, 'x', op), ['用户组 录入组：使用'])
  assert.equal(levelOf(dir, 'x', m1), 'manage')
  for (const p of ['app.use', 'app.read', 'proposal.create', 'approve.owner', 'approve.engineer', 'release.rollback', 'access.manage'] as const) assert.ok(can(dir, 'x', m1, p), p)
  assert.deepEqual(permissionsOf(dir, 'y', op), [])
  assert.deepEqual(visibleApps(dir, ['x', 'y'], op), ['x'])
  assert.equal(levelOf(dir, 'x', off), null)
})

test('系统权限来自角色；管理所有应用的角色对每个应用都是管理', () => {
  assert.deepEqual(systemPermissionsOf(dir, admin), ['app.all', 'app.create', 'system.roles', 'system.users'])
  assert.deepEqual(systemPermissionsOf(dir, dev), ['app.create'])
  assert.equal(levelOf(dir, 'y', admin), 'manage')
  assert.equal(levelOf(dir, 'x', dev), null)
})

test('代码级需要两位不同的管理者：一个人不能签两处', () => {
  demandApproval(dir, 'x', m2, 'engineer', [{ role: 'owner', by: '甲' }])
  assert.throws(() => demandApproval(dir, 'x', m1, 'engineer', [{ role: 'owner', by: '甲' }]), /两位不同的管理者/)
  assert.throws(() => demandApproval(dir, 'x', op, 'owner', []), AccessError)
})

test('代码级批准人数按应用设置：默认两位，可改为一位；知识级始终一位，契约级不走批准', () => {
  assert.deepEqual(approvalRoles('code', DEFAULT_APPROVAL_POLICY), ['owner', 'engineer'])
  assert.deepEqual(approvalRoles('code', { codeApprovals: 1, history: [] }), ['owner'])
  assert.deepEqual(approvalRoles('knowledge', DEFAULT_APPROVAL_POLICY), ['owner'])
  assert.throws(() => approvalRoles('contract', { codeApprovals: 1, history: [] }), /契约级/)
  assert.equal(checkCodeApprovals(1), 1)
  assert.throws(() => checkCodeApprovals(0), /1 或 2/)
  assert.throws(() => checkCodeApprovals('2'), /1 或 2/)
})

test('授权必须留一位可用的管理者；对象必须存在', () => {
  checkGrants('x', [{ kind: 'user', id: 'm1', level: 'manage' }], dir)
  assert.throws(() => checkGrants('x', [{ kind: 'group', id: 'ops', level: 'use' }], dir), /管理者/)
  assert.throws(() => checkGrants('x', [{ kind: 'user', id: 'off', level: 'manage' }], dir), /管理者/)
  assert.throws(() => checkGrants('x', [{ kind: 'user', id: 'nobody', level: 'manage' }], dir), /没有用户/)
  assert.throws(() => checkGrants('x', [{ kind: 'user', id: 'm1', level: 'owner' as never }], dir), /权限级别/)
  assert.throws(() => checkAdminRemains({ ...dir, users: dir.users.filter((u) => u.id !== 'a') }), /系统管理员/)
})

test('点路径能读写数组里的值，不新建中间层', () => {
  const doc = { a: { list: [{ v: '1' }, { v: '2' }] } }
  assert.deepEqual(parsePath('a.list[1].v'), ['a', 'list', 1, 'v'])
  assert.equal(getPath(doc, 'a.list[1].v'), '2')
  const next = setPath(doc, 'a.list[1].v', '3') as typeof doc
  assert.equal(next.a.list[1].v, '3')
  assert.equal(doc.a.list[1].v, '2')
  assert.throws(() => setPath(doc, 'a.missing.v', 'x'))
})

test('新应用骨架能被内核加载；没有人填的评测用例就不能发布', async () => {
  assert.deepEqual(seedProblems({ name: 'Bad Name', title: '', goal: '' }).length, 3)
  const root = await mkdtemp(join(tmpdir(), 'skeleton-'))
  for (const [path, text] of Object.entries(skeletonApp({ name: 'demo-app', title: '演示', goal: '把一句话变成摘要' }, await readFile(join(REPO, 'rsi-kernel/src/mcp-server.ts'), 'utf8')))) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  assert.match((await checkWorkspace(root, 'demo-app')).problems.join(), /code\/web\/ 不存在/)
  for (const [path, bytes] of Object.entries(await webTemplate())) {
    await mkdir(dirname(join(root, 'code/web', path)), { recursive: true })
    await writeFile(join(root, 'code/web', path), bytes)
  }
  const report = await checkWorkspace(root, 'demo-app')
  assert.deepEqual(report.app, { name: 'demo-app', title: '演示' })
  assert.deepEqual(report.problems.length, 1)
  assert.match(report.problems[0], /评测用例/)
  await mkdir(join(root, 'evals/cases/c1'), { recursive: true })
  await writeFile(join(root, 'evals/cases/c1/case.json'), JSON.stringify({ id: 'c1', title: '一', input: { text: 'a' }, expected: { result: 'a' }, source: '测试' }))
  assert.ok((await checkWorkspace(root, 'demo-app')).ok)
  assert.match((await checkWorkspace(root, 'other')).problems.join(), /应为 other/)
  await writeFile(join(root, 'code/web/.env'), 'MODEL_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n')
  assert.ok((await checkWorkspace(root, 'demo-app')).ok, 'web/.env 是放密钥的地方')
  await writeFile(join(root, 'code/AGENTS.md'), 'key: sk-abcdefghijklmnopqrstuvwxyz123456')
  assert.match((await checkWorkspace(root, 'demo-app')).problems.join(), /密钥/)
  await writeFile(join(root, 'code/web/views/index.tsx'), 'export default function App() { return null }\n')
  assert.match((await checkWorkspace(root, 'demo-app')).problems.join(), /没有植入改进入口/)
  await rm(root, { recursive: true, force: true })
})

test('web 应用：.env 是契约、进版本；智能体拿到的版本里没有 web/；学习者看不到 .env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webapp-'))
  for (const [path, text] of Object.entries(skeletonApp({ name: 'demo-app', title: '演示', goal: '摘要' }, await readFile(join(REPO, 'rsi-kernel/src/mcp-server.ts'), 'utf8')))) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  for (const [path, bytes] of Object.entries(await webTemplate())) {
    await mkdir(dirname(join(root, 'code/web', path)), { recursive: true })
    await writeFile(join(root, 'code/web', path), bytes)
  }
  await writeFile(join(root, 'code/web/.env'), 'MODEL_KEY=secret-value\n')
  await mkdir(join(root, 'code/web/node_modules/x'), { recursive: true })
  await writeFile(join(root, 'code/web/node_modules/x/index.js'), '')
  await mkdir(join(root, 'evals/cases/c1'), { recursive: true })
  await writeFile(join(root, 'evals/cases/c1/case.json'), JSON.stringify({ id: 'c1', title: '一', input: { text: 'a' }, expected: { result: 'a' }, source: '测试' }))
  const manifest = parseManifest(JSON.parse(await readFile(join(root, 'code/app.json'), 'utf8')))
  assert.equal(manifest.web, 'web')
  assert.equal(tierOf(manifest, 'web/.env'), 'contract')
  assert.equal(tierOf(manifest, 'web/views/index.tsx'), 'contract')
  assert.equal(tierOf({ ...manifest, evolve: { ...manifest.evolve, code: ['web/**'] } }, 'web/.env'), 'contract')

  let seen: string[] = []
  const kernel = new RsiKernel({
    store: new FsStore(await mkdtemp(join(tmpdir(), 'webapp-store-'))),
    clock: { now: () => '2026-10-10T00:00:00Z' },
    executor: { name: 'spy', run: async ({ dir }) => ((seen = await readdir(dir, { recursive: true })), { status: 'result', output: { result: 'a' }, trace: [], ms: 1, executor: 'spy' }) },
    judge: () => ({ score: async () => [], check: async () => [], close: async () => {} }),
  })
  const { release } = await kernel.install(new FsAppSource(root))
  assert.ok('web/.env' in release.files, '.env 跟着版本走')
  assert.ok(!Object.keys(release.files).some((p) => p.includes('node_modules')))
  await kernel.runTask('demo-app', { input: { text: 'a' } })
  assert.ok(seen.length > 0 && !seen.some((p) => p.startsWith('web')), seen.join(','))

  const zip = readZip(writeZip([{ path: 'demo-app/code/web/.env', bytes: new TextEncoder().encode('K=v') }, { path: '../evil', bytes: new Uint8Array(1) }]))
  assert.deepEqual(zip.map((e) => e.path), ['demo-app/code/web/.env'])
  await rm(root, { recursive: true, force: true })
})

test('agent patch 把技能目录和 MCP 服务挂成 harness 插件', () => {
  const patch = agentPatch({ skillDirs: ['/s', '/s'], servers: { tools: { command: 'node', args: ['t.ts'], env: { K: '${KEY}' } } }, cwd: '/w' })
  assert.match(patch, /customSkillDirs: \["\/s"\]/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/)
  assert.match(patch, /cwd: "\/w"/)
  assert.match(patch, /"K": !!js process\.env\.KEY/)
})

test('平台层不出现行业名词', async () => {
  const banned = /报关|表头|表体|征免|关区|海关|customs|declaration/i
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walk(path)))
      else if (/\.(ts|tsx|css|md)$/.test(entry.name) && !entry.name.includes('.generated.')) out.push(path)
    }
    return out
  }
  for (const file of [...(await walk(join(REPO, 'console/core'))), ...(await walk(join(REPO, 'console/web/src'))), ...(await walk(join(REPO, 'builder')))]) {
    const text = await readFile(file, 'utf8')
    assert.ok(!banned.test(text), `${file} 出现了 ${banned.exec(text)?.[0]}`)
  }
})
