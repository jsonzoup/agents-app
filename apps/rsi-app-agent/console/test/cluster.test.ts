import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import * as crypto from 'node:crypto'
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { FsStore, LocalLocks } from '../../rsi-kernel/src/index.ts'
import type { Executor } from '../../rsi-kernel/src/index.ts'
import { notesExecutor } from '../../rsi-kernel/test/notes-double.ts'
import { AppInfra, madminEncrypt, resourceNames } from '../core/appinfra.ts'
import { bootPlatform } from '../core/boot.ts'
import type { Platform } from '../core/boot.ts'
import { clusterConfig } from '../core/cluster.ts'
import { resolveHome } from '../core/home.ts'
import { createHandler } from '../core/http.ts'
import { Pg } from '../core/pg.ts'
import { PgStore, migrate } from '../core/pgstore.ts'
import type { Grants, User } from '../core/rbac.ts'
import { Redis } from '../core/redis.ts'
import { S3 } from '../core/storage.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = 'notes-digest'

test('进程内的锁可重入、按键排队；计数器并发也不重号', async () => {
  const locks = new LocalLocks()
  const order: string[] = []
  await Promise.all([
    locks.run('k', async () => {
      order.push('a1')
      await locks.run('k', async () => order.push('a-inner'))
      await new Promise((r) => setTimeout(r, 20))
      order.push('a2')
    }),
    locks.run('k', async () => order.push('b')),
  ])
  assert.deepEqual(order, ['a1', 'a-inner', 'a2', 'b'])

  const dir = await mkdtemp(join(tmpdir(), 'store-'))
  after(() => rm(dir, { recursive: true, force: true }))
  const store = new FsStore(dir)
  const got = await Promise.all(Array.from({ length: 40 }, () => store.next('x')))
  assert.deepEqual([...got].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1))
})

test('部署配置：默认单实例；选了 postgres、redis 却没给地址时报错', () => {
  const plain = clusterConfig('/nonexistent', {})
  assert.equal(plain.database.driver, 'file')
  assert.equal(plain.queue.driver, 'inline')
  assert.equal(plain.provision, false)
  assert.throws(() => clusterConfig('/nonexistent', { RSI_DATABASE: 'postgres' }), /RSI_DATABASE_URL/)
  assert.throws(() => clusterConfig('/nonexistent', { RSI_QUEUE: 'redis' }), /RSI_REDIS_URL/)
  const full = clusterConfig('/nonexistent', { RSI_DATABASE: 'postgres', RSI_DATABASE_URL: 'postgres://u:p@h/d', RSI_QUEUE: 'redis', RSI_REDIS_URL: 'redis://h', RSI_APP_PROVISION: '1' })
  assert.equal(full.database.driver, 'postgres')
  assert.equal(full.queue.driver, 'redis')
  assert.equal(full.provision, true)
})

test('MinIO 管理接口的请求体按 madmin 的格式加密（argon2id + AES-GCM）', () => {
  const data = new TextEncoder().encode(JSON.stringify({ secretKey: 's', status: 'enabled' }))
  const sealed = madminEncrypt('root-secret', data)
  assert.equal(sealed.length, 32 + 1 + 8 + data.length + 16)
  assert.equal(sealed[32], 0x00)
  const argon2Sync = (crypto as unknown as { argon2Sync: (a: string, p: object) => Buffer }).argon2Sync
  const key = argon2Sync('argon2id', { message: Buffer.from('root-secret'), nonce: sealed.subarray(0, 32), parallelism: 4, tagLength: 32, memory: 65536, passes: 1 })
  const nonce = (n: number) => Buffer.concat([sealed.subarray(33, 41), Buffer.from([n, 0, 0, 0])])
  const head = crypto.createCipheriv('aes-256-gcm', key, nonce(0))
  head.final()
  const d = createDecipheriv('aes-256-gcm', key, nonce(1))
  d.setAAD(Buffer.concat([Buffer.from([0x80]), head.getAuthTag()]))
  d.setAuthTag(sealed.subarray(sealed.length - 16))
  const plain = Buffer.concat([d.update(sealed.subarray(41, sealed.length - 16)), d.final()])
  assert.deepEqual(new Uint8Array(plain), data)
})

// ── two instances on PostgreSQL, Redis and MinIO ─────────────────

const svc = {
  pg: process.env.RSI_TEST_DATABASE_URL,
  redis: process.env.RSI_TEST_REDIS_URL,
  s3: process.env.RSI_TEST_S3_ENDPOINT,
  key: process.env.RSI_TEST_S3_ACCESS_KEY,
  secret: process.env.RSI_TEST_S3_SECRET_KEY,
}
const cluster = Boolean(svc.pg && svc.redis && svc.s3 && svc.key && svc.secret)

const FAKE_DSH = `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const sid = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : 'session-fake'
  const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
  out({ type: 'session', sessionId: sid, cwd: process.cwd() })
  mkdirSync('evals/cases/c1', { recursive: true })
  writeFileSync('evals/cases/c1/case.json', JSON.stringify({ id: 'c1', title: '一', input: { text: 'a' }, expected: { result: 'a' }, source: '用户在对话里给出' }))
  out({ type: 'final', text: '已写入用例 c1' })
})
`

const until = async <T>(what: string, check: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms
  for (;;) {
    const got = await check()
    if (got) return got
    if (Date.now() > end) throw new Error(`等不到：${what}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

test('应用资源：平台开通应用自己的库、Redis 前缀、桶，应用只碰得到自己的', { skip: cluster ? false : '没有设置 RSI_TEST_DATABASE_URL、RSI_TEST_REDIS_URL、RSI_TEST_S3_*' }, async () => {
  const app = `pv${Date.now().toString(36)}`
  const stateDir = await mkdtemp(join(tmpdir(), 'infra-'))
  const platformS3 = new S3({ endpoint: svc.s3!, bucket: `rsi-${app}-platform`, region: 'us-east-1', accessKey: svc.key!, secretKey: svc.secret! })
  await platformS3.ensureBucket()
  const infra = new AppInfra({ pgUrl: svc.pg!, redisUrl: svc.redis!, s3: platformS3, s3Secret: svc.secret!, stateDir })
  const admin = new Pg(svc.pg!)
  const redis = new Redis(svc.redis!)
  const names = resourceNames(app, 'dev')
  try {
    const r = await infra.ensure(app, 'dev')
    assert.deepEqual(r.problems, [])
    assert.equal(await infra.ensure(app, 'dev'), r)
    const other = new AppInfra({ pgUrl: svc.pg!, redisUrl: svc.redis!, s3: platformS3, s3Secret: svc.secret!, stateDir })
    const again = await other.ensure(app, 'dev')
    await other.close()
    assert.deepEqual(again.postgres, r.postgres, '再开一次沿用原来的库和密码')
    const vars = AppInfra.variables(r)
    assert.equal(vars.RSI_APP_ENV, 'dev')
    assert.ok(!vars.DATABASE_URL.includes(svc.pg!.split('@')[0]), '应用拿到的是自己的账号，不是平台的')

    const own = new Pg(vars.DATABASE_URL)
    await own.simple('CREATE TABLE notes (id serial primary key, body text)')
    await own.query('INSERT INTO notes (body) VALUES ($1)', ['你好'])
    assert.deepEqual((await own.query('SELECT body FROM notes')).rows, [{ body: '你好' }])
    await own.end()
    const sneak = new Pg(vars.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${new URL(svc.pg!).pathname.slice(1)}$1`))
    await assert.rejects(sneak.query('SELECT 1'), /permission denied|42501/, '连不上平台的库')
    await sneak.end()

    const appRedis = new Redis(vars.REDIS_URL)
    assert.equal(await appRedis.call('SET', `${vars.REDIS_PREFIX}k`, 'v'), 'OK')
    await appRedis.call('XADD', `${vars.QUEUE_PREFIX}jobs`, '*', 'a', '1')
    await assert.rejects(appRedis.call('SET', 'rsi:other', 'v'), /NOPERM/)
    await assert.rejects(appRedis.call('FLUSHALL'), /NOPERM/)
    appRedis.close()

    const appS3 = new S3({ endpoint: vars.S3_ENDPOINT, bucket: vars.S3_BUCKET, region: vars.S3_REGION, accessKey: vars.S3_ACCESS_KEY, secretKey: vars.S3_SECRET_KEY })
    assert.equal((await appS3.signed('PUT', `/${vars.S3_BUCKET}/a.txt`, {}, new TextEncoder().encode('x'), 'text/plain')).status, 200)
    assert.equal((await appS3.signed('HEAD', `/${platformS3.bucket}`)).status, 403, '平台的桶不让碰')
    await appS3.deletePrefix('')
  } finally {
    await infra.close()
    await admin.simple(`DROP DATABASE IF EXISTS ${names.database} WITH (FORCE)`).catch(() => undefined)
    await admin.simple(`DROP ROLE IF EXISTS ${names.database}`).catch(() => undefined)
    await admin.end()
    const keys = (await redis.call('KEYS', `${names.prefix}*`)) as string[]
    if (keys.length) await redis.call('DEL', ...keys)
    await redis.call('ACL', 'DELUSER', names.redisUser)
    redis.close()
    await platformS3.signed('DELETE', '/minio/admin/v3/remove-user', { accessKey: names.s3User }).catch(() => undefined)
    await platformS3.signed('DELETE', '/minio/admin/v3/remove-canned-policy', { name: names.bucket }).catch(() => undefined)
    for (const b of [names.bucket, platformS3.bucket]) await platformS3.signed('DELETE', `/${b}`).catch(() => undefined)
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('集群：两个实例共用 PostgreSQL、Redis、MinIO——数据、文件、任务、会话、登录互通', { skip: cluster ? false : '没有设置 RSI_TEST_DATABASE_URL、RSI_TEST_REDIS_URL、RSI_TEST_S3_*' }, async () => {
  const run = `t${process.pid}${Date.now().toString(36)}`
  const admin = new Pg(svc.pg!)
  await admin.simple(`CREATE DATABASE rsi_${run}`)
  const dbUrl = admin.database(`rsi_${run}`)
  const bucket = `rsi-${run}`
  const s3 = new S3({ endpoint: svc.s3!, bucket, region: 'us-east-1', accessKey: svc.key!, secretKey: svc.secret! })
  const prefix = `rsi-${run}:`
  const platforms: Platform[] = []
  const homes: string[] = []
  try {
    const users: User[] = [
      { id: 'sys', name: '系统管理员', title: '', roles: ['admin'] },
      { id: 'owner', name: '管理者甲', title: '', roles: ['developer'] },
      { id: 'op', name: '业务员丙', title: '', roles: [] },
    ]
    const grants: Grants = { [APP]: [{ kind: 'user', id: 'owner', level: 'manage' }, { kind: 'user', id: 'op', level: 'use' }] }
    const seed = new PgStore(dbUrl, join(tmpdir(), `${run}-seed`))
    await migrate(seed.pg)
    await seed.put('console', 'users.json', users)
    await seed.put('console', 'grants.json', grants)
    await seed.close()

    const env = {
      RSI_DATABASE: 'postgres',
      RSI_DATABASE_URL: dbUrl,
      RSI_QUEUE: 'redis',
      RSI_REDIS_URL: svc.redis!,
      RSI_REDIS_PREFIX: prefix,
      RSI_STORAGE: 'minio',
      RSI_S3_ENDPOINT: svc.s3!,
      RSI_S3_BUCKET: bucket,
      RSI_S3_ACCESS_KEY: svc.key!,
      RSI_S3_SECRET_KEY: svc.secret!,
    }
    const fakeDir = await mkdtemp(join(tmpdir(), 'fake-'))
    homes.push(fakeDir)
    const fake = join(fakeDir, 'fake-dsh.cjs')
    await writeFile(fake, FAKE_DSH)
    await chmod(fake, 0o755)
    const executor: Executor = notesExecutor
    const boot = async (seedApp: boolean) => {
      const home = await mkdtemp(join(tmpdir(), `${run}-home-`))
      homes.push(home)
      if (seedApp) await cp(join(resolveHome(REPO), APP), join(home, APP), { recursive: true })
      const p = await bootPlatform({ platform: REPO, home, env, executor, harness: { available: true, command: { command: process.execPath, args: [fake] }, note: '测试用替身' } })
      platforms.push(p)
      return p
    }
    const a = await boot(true)
    const b = await boot(false)
    assert.equal(a.deployment.mode, 'cluster')
    assert.deepEqual(b.console.appNames(), [APP], 'B 从 MinIO 取回应用并装载，用的是 A 发布的版本')
    assert.equal((await b.console.kernel.stable(APP)).id, 'r1')

    const [op, owner, sys] = [users[2], users[1], users[0]]
    const tasks = await Promise.all([a, b, a, b, a, b].map((p, i) => p.console.createTask(APP, op, { title: `并发${i}`, input: { text: `会议${i}：Alice Wang 负责。` } })))
    assert.equal(new Set(tasks.map((t) => t.id)).size, 6, '两个实例并发建单，编号不重复')
    assert.deepEqual(tasks.map((t) => [t.state, t.run?.release, (t as { error?: string }).error]), tasks.map(() => ['ready', 'r1', undefined]), '单据由队列里某个实例执行完')
    const seen = await b.console.task(APP, op, tasks[0].id)
    assert.deepEqual(seen.working, tasks[0].working)

    const cases = join(a.home, APP, 'evals/cases')
    const one = JSON.parse(await readFile(join(cases, 'n1/case.json'), 'utf8')) as Record<string, unknown>
    const { evalset } = await a.bench.write(APP, owner, [{ path: 'cases/cx/case.json', bytes: new TextEncoder().encode(JSON.stringify({ ...one, id: 'cx', title: '集群加的用例' })) }], '集群测试')
    await until('B 收到评测集变化', async () => b.console.kernel.app(APP).evalset === evalset && b.console.kernel.app(APP).cases.some((c) => c.id === 'cx'))

    const created = await a.builder.create(sys, { name: 'clu-app', title: '集群应用', goal: '测试' })
    const done = await until('助手这一轮结束', async () => {
      const v = await b.builder.view(sys, created.id)
      return !v.running && v.messages.at(-1)?.text?.includes('c1') ? v : null
    })
    assert.ok(done.files.some((f: { path: string }) => f.path === 'evals/cases/c1/case.json'), 'B 看到助手在 A 或 B 上写进工作区的文件')
    assert.ok((await b.builder.list(sys)).some((s) => s.id === created.id))

    const handlerA = createHandler(a.console, a.builder, a.bench)
    const handlerB = createHandler(b.console, b.builder, b.bench)
    await a.console.accounts.set('op', 'pass-123456', 'test')
    const login = await handlerA(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ user: 'op', password: 'pass-123456' }) }))
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const me = await handlerB(new Request('http://x/api/me', { headers: { cookie } }))
    assert.equal(me.status, 200, '在 A 登录，B 也认')
  } finally {
    for (const p of platforms) await p.close()
    await admin.simple(`DROP DATABASE IF EXISTS rsi_${run} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    await s3.deletePrefix('').catch(() => undefined)
    await s3.signed('DELETE', `/${bucket}`).catch(() => undefined)
    const redis = new Redis(svc.redis!)
    const keys = (await redis.call('KEYS', `${prefix}*`)) as string[]
    if (keys.length) await redis.call('DEL', ...keys)
    redis.close()
    for (const h of homes) await rm(h, { recursive: true, force: true })
  }
})
