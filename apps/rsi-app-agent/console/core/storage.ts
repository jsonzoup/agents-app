/**
 * Where the platform keeps app files: app packages (`<app>/code`, `<app>/evals`), release and
 * evaluation-set contents (kernel blobs), uploaded materials and produced artifacts.
 *
 * - `local` (default): everything stays in the home directory.
 * - `minio` (any S3-compatible store): the bucket is where files live; the home is a local
 *   working copy that executors and judges read, filled from the bucket on demand and on boot.
 *
 * Configured by `storage` in `rsi.config.json`, overridable by `RSI_STORAGE`, `RSI_S3_ENDPOINT`,
 * `RSI_S3_BUCKET`, `RSI_S3_REGION`, `RSI_S3_PREFIX`. Credentials only come from
 * `RSI_S3_ACCESS_KEY` and `RSI_S3_SECRET_KEY`. Metadata (releases, proposals, signals, tasks,
 * users) is in the platform database (see `cluster.ts`): JSON files in the home by default,
 * PostgreSQL when configured.
 */

import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { BlobStore } from '../../rsi-kernel/src/index.ts'

export type StorageConfig =
  | { driver: 'local' }
  | { driver: 'minio'; endpoint: string; bucket: string; region: string; prefix: string }

export interface StorageStatus {
  driver: 'local' | 'minio'
  /** Where files live, for people: a directory or `endpoint/bucket/prefix`. */
  location: string
  note: string
}

/**
 * Read the storage configuration.
 * @throws when MinIO is chosen but its endpoint, bucket or credentials are missing.
 */
export function storageConfig(platform: string, env: NodeJS.ProcessEnv): StorageConfig {
  let file: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(readFileSync(join(platform, 'rsi.config.json'), 'utf8')) as { storage?: Record<string, unknown> }
    file = raw.storage ?? {}
  } catch {
    // no config file
  }
  const pick = (envName: string, key: string) => env[envName]?.trim() || (typeof file[key] === 'string' ? (file[key] as string) : '')
  const driver = pick('RSI_STORAGE', 'driver') || 'local'
  if (driver === 'local') return { driver: 'local' }
  if (driver !== 'minio' && driver !== 's3') throw new Error(`未知的存储方式 ${driver}：只支持 local 和 minio`)
  const endpoint = pick('RSI_S3_ENDPOINT', 'endpoint').replace(/\/$/, '')
  const bucket = pick('RSI_S3_BUCKET', 'bucket')
  const missing = [!endpoint && 'endpoint（RSI_S3_ENDPOINT）', !bucket && 'bucket（RSI_S3_BUCKET）', !env.RSI_S3_ACCESS_KEY && 'RSI_S3_ACCESS_KEY', !env.RSI_S3_SECRET_KEY && 'RSI_S3_SECRET_KEY'].filter(Boolean)
  if (missing.length) throw new Error(`MinIO 存储缺少 ${missing.join('、')}`)
  const prefix = pick('RSI_S3_PREFIX', 'prefix').replace(/^\/+|\/+$/g, '')
  return { driver: 'minio', endpoint, bucket, region: pick('RSI_S3_REGION', 'region') || 'us-east-1', prefix: prefix ? `${prefix}/` : '' }
}

// ── S3 (SigV4, path-style) ────────────────────────────────────────

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export interface S3Object {
  key: string
  size: number
  modified: string
}

/** A minimal S3 client: enough for MinIO and other S3-compatible stores. */
export class S3 {
  readonly #endpoint: URL
  readonly bucket: string
  readonly endpoint: string
  readonly region: string
  readonly #region: string
  readonly #access: string
  readonly #secret: string

  constructor(options: { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string }) {
    this.#endpoint = new URL(options.endpoint)
    this.endpoint = this.#endpoint.origin
    this.region = options.region
    this.bucket = options.bucket
    this.#region = options.region
    this.#access = options.accessKey
    this.#secret = options.secretKey
  }

  async #request(method: string, key: string | null, query: Record<string, string> = {}, body?: Uint8Array, type?: string): Promise<Response> {
    return this.signed(method, `/${encode(this.bucket)}${key === null ? '' : `/${key.split('/').map(encode).join('/')}`}`, query, body, type)
  }

  /** Any signed request to the server, by already-encoded path (MinIO's admin API uses this too). */
  async signed(method: string, path: string, query: Record<string, string> = {}, body?: Uint8Array, type?: string): Promise<Response> {
    const qs = Object.keys(query)
      .sort()
      .map((k) => `${encode(k)}=${encode(query[k])}`)
      .join('&')
    const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')
    const day = now.slice(0, 8)
    const payload = sha256(body ?? '')
    const headers: Record<string, string> = { host: this.#endpoint.host, 'x-amz-content-sha256': payload, 'x-amz-date': now }
    if (type) headers['content-type'] = type
    const names = Object.keys(headers).sort()
    const canonical = [method, path, qs, names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n')
    const scope = `${day}/${this.#region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n')
    const key4 = hmac(hmac(hmac(hmac(`AWS4${this.#secret}`, day), this.#region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', key4).update(toSign).digest('hex')
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.#access}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
    delete headers.host
    const url = `${this.#endpoint.origin}${path}${qs ? `?${qs}` : ''}`
    return fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined })
  }

  async #fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '')
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
    throw new Error(`MinIO ${what}失败：HTTP ${res.status}${code ? ` ${code}` : ''}`)
  }

  /** Create the bucket when it does not exist. */
  async ensureBucket(): Promise<void> {
    const head = await this.#request('HEAD', null)
    if (head.ok) return
    if (head.status !== 404) return this.#fail(head, '访问存储桶')
    const res = await this.#request('PUT', null)
    if (!res.ok && res.status !== 409) return this.#fail(res, '创建存储桶')
  }

  /** The same server and credentials, another bucket. */
  withBucket(bucket: string): S3 {
    return new S3({ endpoint: this.endpoint, bucket, region: this.region, accessKey: this.#access, secretKey: this.#secret })
  }

  async put(key: string, body: Uint8Array, type = 'application/octet-stream'): Promise<void> {
    const res = await this.#request('PUT', key, {}, body, type)
    if (!res.ok) return this.#fail(res, `写入 ${key} `)
  }

  /** @returns the object, or null when it does not exist. */
  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.#request('GET', key)
    if (res.status === 404) return null
    if (!res.ok) return this.#fail(res, `读取 ${key} `)
    return new Uint8Array(await res.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    const res = await this.#request('DELETE', key)
    if (!res.ok && res.status !== 404) return this.#fail(res, `删除 ${key} `)
  }

  /** Delete every object under a prefix. */
  async deletePrefix(prefix: string): Promise<number> {
    const all = await this.list(prefix)
    for (const o of all) await this.delete(o.key)
    return all.length
  }

  async has(key: string): Promise<boolean> {
    const res = await this.#request('HEAD', key)
    if (res.status === 404) return false
    if (!res.ok) return this.#fail(res, `查看 ${key} `)
    return true
  }

  async list(prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = []
    let token: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix }
      if (token) query['continuation-token'] = token
      const res = await this.#request('GET', null, query)
      if (!res.ok) return this.#fail(res, '列出对象')
      const xml = await res.text()
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const field = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(m[1])?.[1] ?? ''
        out.push({ key: unescapeXml(field('Key')), size: Number(field('Size')), modified: field('LastModified') })
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unescapeXml(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') : undefined
    } while (token)
    return out
  }
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** Kernel blobs (release and evaluation-set contents) in a bucket, keyed by content hash. */
export function s3Blobs(s3: S3, prefix: string): BlobStore {
  const key = (hash: string) => `${prefix}blobs/${hash.slice(0, 2)}/${hash}`
  return {
    name: 'minio',
    put: (hash, content) => s3.put(key(hash), content),
    get: async (hash) => {
      const bytes = await s3.get(key(hash))
      if (!bytes) throw Object.assign(new Error(`MinIO 里没有内容 ${hash}`), { code: 'ENOENT' })
      return bytes
    },
    has: (hash) => s3.has(key(hash)),
  }
}

// ── home files ────────────────────────────────────────────────────

/** Never stored: dependencies, build output, caches. */
export const SKIP = /(^|\/)(node_modules|\.next|__pycache__|\.git|\.venv|\.pytest_cache|\.turbo)(\/|$)|(^|\/)\.DS_Store$/

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name
    if (SKIP.test(path)) continue
    if (e.isDirectory()) out.push(...(await walk(root, path)))
    else if (e.isFile()) out.push(path)
  }
  return out
}

/** Home files the bucket holds: app packages, uploaded materials, produced artifacts. */
const SYNCED = (rel: string) => !rel.startsWith('.rsi/') || /^\.rsi\/(uploads|console\/artifacts)\//.test(rel)
const SYNC_STATE = '.rsi/files-synced.json'

/**
 * Files under the home that belong to apps (packages, materials, artifacts). With MinIO,
 * every write goes to the bucket too and reads fall back to it, so the home can be rebuilt
 * from the bucket on any machine, and several platform instances can share one bucket.
 */
export class HomeFiles {
  readonly home: string
  readonly #s3: S3 | null
  readonly #prefix: string
  readonly status: StorageStatus
  /** Files known to be in both places at the last sync: tells a deletion on one side from a new file on the other. */
  #synced: Set<string> | null = null
  #saving: Promise<void> | null = null
  /** Called after this instance changed files under a directory, so other instances can refresh. */
  onChange: ((rel: string) => void) | null = null

  constructor(home: string, s3: S3 | null = null, config: StorageConfig = { driver: 'local' }) {
    this.home = home
    this.#s3 = s3
    this.#prefix = config.driver === 'minio' ? `${config.prefix}files/` : ''
    this.status =
      config.driver === 'minio'
        ? { driver: 'minio', location: `${config.endpoint}/${config.bucket}/${config.prefix}`, note: '应用包、版本内容、评测集、材料和产物存放在 MinIO；本机 home 只是工作副本和缓存' }
        : { driver: 'local', location: home, note: '所有应用文件都在本机 home 目录' }
  }

  get remote(): boolean {
    return this.#s3 !== null
  }

  #abs(rel: string): string {
    const abs = join(this.home, rel)
    const back = relative(this.home, abs)
    if (back.startsWith('..') || back.split(sep).includes('..')) throw new Error(`路径越界：${rel}`)
    return abs
  }

  #key(rel: string): string {
    return `${this.#prefix}${rel.split(sep).join('/')}`
  }

  async #state(): Promise<Set<string>> {
    if (!this.#synced) {
      try {
        this.#synced = new Set(JSON.parse(await readFile(this.#abs(SYNC_STATE), 'utf8')) as string[])
      } catch {
        this.#synced = new Set()
      }
    }
    return this.#synced
  }

  #mark(rel: string, present: boolean): void {
    if (!this.#s3 || !this.#synced) return
    if (present) this.#synced.add(rel)
    else this.#synced.delete(rel)
    this.#saving ??= new Promise<void>((resolve) => setTimeout(resolve, 500)).then(async () => {
      this.#saving = null
      await this.#persist()
    })
  }

  async #persist(): Promise<void> {
    if (!this.#synced) return
    const abs = this.#abs(SYNC_STATE)
    await mkdir(dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify([...this.#synced].sort()))
    await rename(tmp, abs)
  }

  async #download(rel: string, o: S3Object): Promise<boolean> {
    const bytes = await this.#s3!.get(o.key)
    if (!bytes) return false
    const abs = this.#abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, abs)
    const at = new Date(o.modified)
    await utimes(abs, at, at)
    this.#mark(rel, true)
    return true
  }

  async #upload(rel: string): Promise<void> {
    await this.#s3!.put(this.#key(rel), await readFile(this.#abs(rel)))
    const now = new Date()
    await utimes(this.#abs(rel), now, now)
    this.#mark(rel, true)
  }

  /** Write a home-relative file (and to the bucket). */
  async write(rel: string, bytes: Uint8Array): Promise<void> {
    const abs = this.#abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, abs)
    if (!this.#s3) return
    await this.#state()
    await this.#upload(rel)
  }

  /** Delete a home-relative file locally and from the bucket. */
  async remove(rel: string): Promise<void> {
    await rm(this.#abs(rel), { force: true })
    if (!this.#s3) return
    await this.#state()
    await this.#s3.delete(this.#key(rel))
    this.#mark(rel, false)
  }

  /** Read a home-relative file, fetching it from the bucket when the local copy is missing. */
  async read(rel: string): Promise<Uint8Array> {
    const abs = this.#abs(rel)
    try {
      return await readFile(abs)
    } catch (error) {
      if (!this.#s3 || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const bytes = await this.#s3.get(this.#key(rel))
      if (!bytes) throw error
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, bytes)
      await this.#state()
      this.#mark(rel, true)
      return bytes
    }
  }

  /** Make sure a home-relative file is present locally (e.g. a material an executor will read). @returns its absolute path. */
  async local(rel: string): Promise<string> {
    const abs = this.#abs(rel)
    if (!existsSync(abs)) await this.read(rel)
    return abs
  }

  /**
   * Make the bucket's copy of a home-relative directory match the local one after the platform
   * wrote it: changed files go up, files no longer there are deleted from the bucket.
   */
  async pushDir(rel: string): Promise<void> {
    if (!this.#s3) return
    await this.#state()
    const local = new Set((await walk(this.#abs(rel))).map((p) => `${rel}/${p}`))
    const remote = new Map((await this.#s3.list(this.#key(`${rel}/`))).map((o) => [o.key.slice(this.#prefix.length), o]))
    for (const path of local) {
      const o = remote.get(path)
      const info = await stat(this.#abs(path))
      if (o && o.size === info.size && info.mtime.getTime() <= Date.parse(o.modified) + 1000) continue
      await this.#upload(path)
    }
    for (const [path, o] of remote) {
      if (local.has(path)) continue
      await this.#s3.delete(o.key)
      this.#mark(path, false)
    }
    this.onChange?.(rel)
  }

  /**
   * Make the local copy of a home-relative directory match the bucket (another instance changed
   * it): newer files come down, files the bucket no longer has are deleted locally.
   * @returns how many files changed.
   */
  async pullDir(rel: string): Promise<number> {
    if (!this.#s3) return 0
    await this.#state()
    const remote = new Map((await this.#s3.list(this.#key(`${rel}/`))).map((o) => [o.key.slice(this.#prefix.length), o]))
    let changed = 0
    for (const [path, o] of remote) {
      const info = await stat(this.#abs(path)).catch(() => null)
      if (info && info.size === o.size && info.mtime.getTime() >= Date.parse(o.modified) - 1000) continue
      if (await this.#download(path, o)) changed++
    }
    for (const p of await walk(this.#abs(rel))) {
      const path = `${rel}/${p}`
      if (remote.has(path)) continue
      await rm(this.#abs(path), { force: true })
      this.#mark(path, false)
      changed++
    }
    return changed
  }

  /**
   * Bring the home and the bucket together on boot. Against the files both had at the last sync:
   * a file only in the bucket is new there (or was deleted here while stopped), a file only here
   * is new here (or was deleted from the bucket by another instance). Newer copies win.
   * @returns counts, for the boot log.
   */
  async sync(): Promise<{ pulled: number; pushed: number; deleted: number }> {
    if (!this.#s3) return { pulled: 0, pushed: 0, deleted: 0 }
    await this.#s3.ensureBucket()
    const known = await this.#state()
    const remote = new Map((await this.#s3.list(this.#prefix)).map((o) => [o.key.slice(this.#prefix.length), o]))
    const local = new Set((await walk(this.home)).filter(SYNCED))
    let pulled = 0
    let pushed = 0
    let deleted = 0
    for (const [rel, o] of remote) {
      if (!SYNCED(rel)) continue
      const info = local.has(rel) ? await stat(this.#abs(rel)) : null
      if (!info && known.has(rel)) {
        await this.#s3.delete(o.key)
        this.#mark(rel, false)
        deleted++
        continue
      }
      if (info && info.mtime.getTime() >= Date.parse(o.modified) - 1000) {
        this.#mark(rel, true)
        continue
      }
      if (await this.#download(rel, o)) pulled++
    }
    for (const rel of local) {
      const o = remote.get(rel)
      if (!o && known.has(rel)) {
        await rm(this.#abs(rel), { force: true })
        this.#mark(rel, false)
        deleted++
        continue
      }
      const info = await stat(this.#abs(rel))
      if (o && info.mtime.getTime() <= Date.parse(o.modified) + 1000) continue
      await this.#upload(rel)
      pushed++
    }
    await this.#persist()
    return { pulled, pushed, deleted }
  }
}

/**
 * A local directory kept in the bucket under a prefix, with a manifest of content hashes and a
 * revision: an instance pulls only when its copy is behind, and pushes only what changed. Used
 * for the assistant's workspaces, which any instance may serve or work in.
 */
export class DirMirror {
  readonly #s3: S3
  readonly #prefix: string

  constructor(s3: S3, prefix: string) {
    this.#s3 = s3
    this.#prefix = prefix
  }

  #manifestKey(name: string): string {
    return `${this.#prefix}${name}/.manifest.json`
  }

  async #manifest(name: string): Promise<{ rev: string; files: Record<string, string> } | null> {
    const bytes = await this.#s3.get(this.#manifestKey(name))
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { rev: string; files: Record<string, string> }) : null
  }

  static async #hashes(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    for (const path of (await walk(dir)).sort()) out[path] = sha256(await readFile(join(dir, path)))
    return out
  }

  /** Upload what changed in `dir` and delete what is gone. @returns the new revision. */
  async push(name: string, dir: string): Promise<string> {
    const before = (await this.#manifest(name))?.files ?? {}
    const files = await DirMirror.#hashes(dir)
    for (const [path, hash] of Object.entries(files)) if (before[path] !== hash) await this.#s3.put(`${this.#prefix}${name}/files/${path}`, await readFile(join(dir, path)))
    for (const path of Object.keys(before)) if (!(path in files)) await this.#s3.delete(`${this.#prefix}${name}/files/${path}`)
    const rev = `${Date.now().toString(36)}-${sha256(JSON.stringify(files)).slice(0, 12)}`
    await this.#s3.put(this.#manifestKey(name), new TextEncoder().encode(JSON.stringify({ rev, files })), 'application/json')
    await writeFile(join(dirname(dir), `.${basenameOf(dir)}.rev`), rev)
    return rev
  }

  /** Bring `dir` to the bucket's revision when it is behind. @returns whether anything changed. */
  async pull(name: string, dir: string, rev?: string | null): Promise<boolean> {
    const marker = join(dirname(dir), `.${basenameOf(dir)}.rev`)
    const have = await readFile(marker, 'utf8').catch(() => null)
    if (rev && have === rev) return false
    const m = await this.#manifest(name)
    if (!m || m.rev === have) return false
    const current = await DirMirror.#hashes(dir)
    for (const [path, hash] of Object.entries(m.files)) {
      if (current[path] === hash) continue
      const bytes = await this.#s3.get(`${this.#prefix}${name}/files/${path}`)
      if (!bytes) continue
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), bytes)
    }
    for (const path of Object.keys(current)) if (!(path in m.files)) await rm(join(dir, path), { force: true })
    await mkdir(dirname(marker), { recursive: true })
    await writeFile(marker, m.rev)
    return true
  }

  async remove(name: string): Promise<void> {
    await this.#s3.deletePrefix(`${this.#prefix}${name}/`)
  }
}

const basenameOf = (dir: string) => dir.split(sep).filter(Boolean).at(-1) ?? 'dir'

export interface OpenedStorage {
  /** Kernel blobs in the bucket; null for local. */
  blobs: BlobStore | null
  files: HomeFiles
  /** The bucket client; null for local. */
  s3: S3 | null
  config: StorageConfig
}

/** Open the configured storage. */
export function openStorage(home: string, config: StorageConfig, env: NodeJS.ProcessEnv): OpenedStorage {
  if (config.driver === 'local') return { blobs: null, files: new HomeFiles(home), s3: null, config }
  const s3 = new S3({ endpoint: config.endpoint, bucket: config.bucket, region: config.region, accessKey: env.RSI_S3_ACCESS_KEY!, secretKey: env.RSI_S3_SECRET_KEY! })
  return { blobs: s3Blobs(s3, config.prefix), files: new HomeFiles(home, s3, config), s3, config }
}
