/**
 * Move a single-instance home into cluster mode: documents from `.rsi/` JSON files into
 * PostgreSQL, files (app packages, release contents, materials, artifacts, workspaces) into
 * MinIO. Records are copied as they are (same ids, same contents); nothing is rewritten.
 * Documents already in the database are kept unless `--overwrite`.
 *
 *   node console/bin/migrate.ts [--home <dir>] [--overwrite] [--dry-run]
 *
 * The target comes from the platform environment (`envFile` in rsi.config.json, or the
 * process): RSI_DATABASE_URL and the MinIO settings. Stop the single instance first.
 */

import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_DIR, platformEnv, resolveHome } from '../core/home.ts'
import { PgStore, migrate } from '../core/pgstore.ts'
import { DirMirror, openStorage, storageConfig } from '../core/storage.ts'

const platform = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const value = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const env = platformEnv(platform)
const home = value('home') ? resolve(value('home')!) : resolveHome(platform, env)
const overwrite = flag('overwrite')
const dry = flag('dry-run')

if (!env.RSI_DATABASE_URL) throw new Error('没有 RSI_DATABASE_URL：先生成 deploy/.env，并在 rsi.config.json 里写 "envFile": "deploy/.env"')
const storage = openStorage(home, storageConfig(platform, { ...env, RSI_STORAGE: 'minio' }), env)
if (!storage.s3 || !storage.blobs) throw new Error('迁移需要 MinIO：设置 RSI_S3_ENDPOINT、RSI_S3_BUCKET、RSI_S3_ACCESS_KEY、RSI_S3_SECRET_KEY')
const store = new PgStore(env.RSI_DATABASE_URL, join(home, STATE_DIR, 'cache'), { blobs: storage.blobs })
const state = join(home, STATE_DIR)
const counts: Record<string, { copied: number; kept: number }> = {}
const count = (what: string, copied: boolean) => {
  counts[what] ??= { copied: 0, kept: 0 }
  counts[what][copied ? 'copied' : 'kept']++
}

const migrated = (await store.pg.query("SELECT to_regclass('rsi_docs') IS NOT NULL AS ok")).rows[0].ok === true

async function put(collection: string, id: string, doc: unknown, what = collection): Promise<void> {
  if (!overwrite && (migrated || !dry) && (await store.get(collection, id)) !== undefined) return count(what, false)
  if (!dry) await store.put(collection, id, doc)
  count(what, true)
}

const json = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as unknown
const dirs = async (dir: string) => (existsSync(dir) ? (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name) : [])
const jsonFiles = async (dir: string) => (existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.json')).sort() : [])

process.stderr.write(`[rsi] 迁移 ${home}\n  → 数据库 ${store.pg.location}\n  → 文件 ${storage.files.status.location}${dry ? '（只看不写）' : ''}\n`)
if (!dry) {
  await migrate(store.pg)
  await storage.s3.ensureBucket()
}

// kernel documents and blobs
const kernelDir = join(state, 'store')
for (const collection of await dirs(kernelDir)) {
  if (collection === 'blobs' || collection === 'materialized') continue
  for (const f of await jsonFiles(join(kernelDir, collection))) await put(collection, decodeURIComponent(f.slice(0, -5)), await json(join(kernelDir, collection, f)))
}
for (const prefix of await dirs(join(kernelDir, 'blobs')).then((d) => (d.length ? d : ['']))) {
  const dir = join(kernelDir, 'blobs', prefix)
  if (!existsSync(dir)) continue
  for (const name of await readdir(dir)) {
    if (!/^[0-9a-f]{64}$/.test(name) || !(await stat(join(dir, name))).isFile()) continue
    if (await storage.blobs.has(name)) count('blobs', false)
    else {
      if (!dry) await storage.blobs.put(name, await readFile(join(dir, name)))
      count('blobs', true)
    }
  }
}

// console state
const consoleDir = join(state, 'console')
for (const f of await jsonFiles(consoleDir)) {
  if (f === 'credentials.json') {
    for (const [id, c] of Object.entries((await json(join(consoleDir, f))) as Record<string, object>)) await put('credentials', id, { id, ...c })
  } else if (f !== 'infra.json') await put('console', f, await json(join(consoleDir, f)))
}
if (existsSync(join(consoleDir, 'session.key'))) await put('console', 'session.key', { key: (await readFile(join(consoleDir, 'session.key'))).toString('base64') }, 'session.key')

// the assistant's sessions, their requests, preview tasks and workspaces
const builderDir = join(state, 'builder')
const mirror = new DirMirror(storage.s3, `${storage.config.driver === 'minio' ? storage.config.prefix : ''}builder/`)
for (const id of await dirs(builderDir)) {
  const dir = join(builderDir, id)
  if (!/^b-[a-z0-9]+$/.test(id) || !existsSync(join(dir, 'session.json'))) continue
  const session = (await json(join(dir, 'session.json'))) as Record<string, unknown>
  if (existsSync(join(dir, 'workspace')) && !dry) session.workspaceRev = await mirror.push(id, join(dir, 'workspace'))
  await put('builder.sessions', id, session)
  if (existsSync(join(dir, 'requests.json'))) await put('builder.requests', id, await json(join(dir, 'requests.json')))
  for (const f of await jsonFiles(join(dir, 'preview', 'tasks'))) await put('preview.tasks', `${id}/${f.slice(0, -5)}`, await json(join(dir, 'preview', 'tasks', f)))
}

// app packages, materials, artifacts
if (!dry) {
  const synced = await storage.files.sync()
  counts.files = { copied: synced.pushed, kept: 0 }
}

await store.close()
for (const [what, c] of Object.entries(counts)) process.stdout.write(`${what.padEnd(18)} 写入 ${c.copied}${c.kept ? `，已有未覆盖 ${c.kept}` : ''}\n`)
process.stdout.write(dry ? '只看不写：没有改动任何东西\n' : '迁移完成。把 rsi.config.json 的 envFile 指向这份配置后重启平台，即进入集群模式。\n')
