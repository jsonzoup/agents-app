/**
 * Storage against a real MinIO. Runs when `RSI_TEST_MINIO` names an endpoint and
 * `RSI_S3_ACCESS_KEY` / `RSI_S3_SECRET_KEY` are set; skipped otherwise.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FsStore } from '../../rsi-kernel/src/index.ts'
import { DirMirror, openStorage, storageConfig } from '../core/storage.ts'

const endpoint = process.env.RSI_TEST_MINIO
const skip = !endpoint || !process.env.RSI_S3_ACCESS_KEY || !process.env.RSI_S3_SECRET_KEY ? '设置 RSI_TEST_MINIO 和 RSI_S3_* 后在真 MinIO 上运行' : false

test('存储配置：缺少地址或凭据时直说，凭据只认环境变量', () => {
  const platform = tmpdir()
  assert.deepEqual(storageConfig(platform, {}), { driver: 'local' })
  assert.throws(() => storageConfig(platform, { RSI_STORAGE: 'minio', RSI_S3_ENDPOINT: 'http://x:9000' }), /bucket.*RSI_S3_ACCESS_KEY.*RSI_S3_SECRET_KEY/)
  assert.throws(() => storageConfig(platform, { RSI_STORAGE: 'ftp' }), /只支持 local 和 minio/)
})

test('MinIO：版本内容、应用文件写进存储桶，换一台机器（空 home）能完整取回', { skip }, async () => {
  const prefix = `test-${Date.now().toString(36)}`
  const env = { ...process.env, RSI_STORAGE: 'minio', RSI_S3_ENDPOINT: endpoint, RSI_S3_BUCKET: 'rsi-test', RSI_S3_PREFIX: prefix }
  const config = storageConfig(tmpdir(), env)
  const homeA = await mkdtemp(join(tmpdir(), 'rsi-home-a-'))
  const a = openStorage(homeA, config, env)
  await mkdir(join(homeA, 'demo/code'), { recursive: true })
  await writeFile(join(homeA, 'demo/code/app.json'), '{"name":"demo"}')
  assert.deepEqual(await a.files.sync(), { pulled: 0, pushed: 1, deleted: 0 })
  await a.files.write('.rsi/uploads/abc/发票 1.pdf', new TextEncoder().encode('%PDF 材料'))

  const storeA = new FsStore(join(homeA, '.rsi/store'), { blobs: a.blobs! })
  const hash = await storeA.putBlob(new TextEncoder().encode('规则 v2'))

  const homeB = await mkdtemp(join(tmpdir(), 'rsi-home-b-'))
  const b = openStorage(homeB, config, env)
  const synced = await b.files.sync()
  assert.equal(synced.pulled, 2)
  assert.equal(await readFile(join(homeB, 'demo/code/app.json'), 'utf8'), '{"name":"demo"}')
  assert.equal(await readFile(join(homeB, '.rsi/uploads/abc/发票 1.pdf'), 'utf8'), '%PDF 材料')
  assert.deepEqual(await b.files.sync(), { pulled: 0, pushed: 0, deleted: 0 })

  const storeB = new FsStore(join(homeB, '.rsi/store'), { blobs: b.blobs! })
  const release = { id: 'r1', app: 'demo', parent: null, createdAt: '', files: { 'AGENTS.md': hash }, fingerprint: 'f'.repeat(64), origin: 'source' as const, proposal: null, note: '' }
  const dir = await storeB.materialize(release)
  assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), '规则 v2')

  await rm(join(homeB, '.rsi/uploads'), { recursive: true })
  assert.equal(new TextDecoder().decode(await b.files.read('.rsi/uploads/abc/发票 1.pdf')), '%PDF 材料')
})

test('MinIO：删掉的文件在存储桶和其他实例里也删掉，不会在启动同步时复活；工作区按修订号同步', { skip }, async () => {
  const prefix = `test-${Date.now().toString(36)}-del`
  const env = { ...process.env, RSI_STORAGE: 'minio', RSI_S3_ENDPOINT: endpoint, RSI_S3_BUCKET: 'rsi-test', RSI_S3_PREFIX: prefix }
  const config = storageConfig(tmpdir(), env)
  const homeA = await mkdtemp(join(tmpdir(), 'rsi-home-a-'))
  const homeB = await mkdtemp(join(tmpdir(), 'rsi-home-b-'))
  const a = openStorage(homeA, config, env)
  const b = openStorage(homeB, config, env)
  await mkdir(join(homeA, 'demo/code/ui'), { recursive: true })
  await writeFile(join(homeA, 'demo/code/app.json'), '{"name":"demo"}')
  await writeFile(join(homeA, 'demo/code/ui/index.tsx'), 'old ui')
  await a.files.sync()
  await b.files.sync()
  assert.ok(existsSync(join(homeB, 'demo/code/ui/index.tsx')))

  // A replaces ui/ by web/ and pushes the directory: the bucket loses ui/
  await rm(join(homeA, 'demo/code/ui'), { recursive: true })
  await mkdir(join(homeA, 'demo/code/web/.next'), { recursive: true })
  await writeFile(join(homeA, 'demo/code/web/page.tsx'), 'new web')
  await writeFile(join(homeA, 'demo/code/web/.next/cache.bin'), 'build output')
  await a.files.pushDir('demo/code')
  const s3Keys = async () => (await a.s3!.list(`${prefix}/files/demo/`)).map((o) => o.key.slice(`${prefix}/files/`.length)).sort()
  assert.deepEqual(await s3Keys(), ['demo/code/app.json', 'demo/code/web/page.tsx'], '删掉的 ui/ 从存储桶删除，.next 不上传')

  // B still has ui/ locally from before; on boot it must drop it, not push it back
  assert.deepEqual(await b.files.sync(), { pulled: 1, pushed: 0, deleted: 1 })
  assert.ok(!existsSync(join(homeB, 'demo/code/ui/index.tsx')))
  assert.deepEqual(await s3Keys(), ['demo/code/app.json', 'demo/code/web/page.tsx'])

  // a file B made while A was not looking goes up, a file deleted on B while stopped goes from the bucket
  await writeFile(join(homeB, 'demo/code/new.md'), 'B 新加的')
  await rm(join(homeB, 'demo/code/web/page.tsx'))
  assert.deepEqual(await b.files.sync(), { pulled: 0, pushed: 1, deleted: 1 })
  assert.equal(await a.files.pullDir('demo'), 2)
  assert.ok(existsSync(join(homeA, 'demo/code/new.md')) && !existsSync(join(homeA, 'demo/code/web/page.tsx')))

  const mirror = new DirMirror(a.s3!, `${prefix}/builder/`)
  const wsA = join(homeA, 'b-1/workspace')
  const wsB = join(homeB, 'b-1/workspace')
  await mkdir(join(wsA, 'code'), { recursive: true })
  await writeFile(join(wsA, 'code/a.txt'), '1')
  await writeFile(join(wsA, 'code/b.txt'), '2')
  const rev1 = await mirror.push('b-1', wsA)
  assert.equal(await mirror.pull('b-1', wsB, rev1), true)
  assert.equal(await readFile(join(wsB, 'code/b.txt'), 'utf8'), '2')
  assert.equal(await mirror.pull('b-1', wsB, rev1), false, '已是这个修订，不再下载')
  await rm(join(wsA, 'code/b.txt'))
  await writeFile(join(wsA, 'code/a.txt'), '1+')
  const rev2 = await mirror.push('b-1', wsA)
  assert.equal(await mirror.pull('b-1', wsB, rev2), true)
  assert.equal(await readFile(join(wsB, 'code/a.txt'), 'utf8'), '1+')
  assert.ok(!existsSync(join(wsB, 'code/b.txt')))

  await a.s3!.deletePrefix(`${prefix}/`)
  await rm(homeA, { recursive: true, force: true })
  await rm(homeB, { recursive: true, force: true })
})
