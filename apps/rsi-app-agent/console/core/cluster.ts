/**
 * How the platform is deployed: where its documents live, how background work is queued, and
 * whether apps get their own database, cache and bucket.
 *
 * - Single instance (default): documents are JSON files in the home, work runs in-process.
 * - Cluster: documents in PostgreSQL, files in MinIO (see `storage.ts`), jobs and events in
 *   Redis. Any number of instances share them; each one serves requests and works on jobs.
 *
 * `rsi.config.json`:
 * ```json
 * { "database": { "driver": "postgres" }, "queue": { "driver": "redis", "prefix": "rsi:" }, "apps": { "provision": true } }
 * ```
 * Overridable by `RSI_DATABASE` (`file` | `postgres`), `RSI_QUEUE` (`inline` | `redis`),
 * `RSI_REDIS_PREFIX`, `RSI_APP_PROVISION` (`1`). Addresses with credentials only come from the
 * environment: `RSI_DATABASE_URL`, `RSI_REDIS_URL`.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { describePg } from './pg.ts'
import { Redis, describeRedis } from './redis.ts'
import type { Reply } from './redis.ts'

export interface ClusterConfig {
  database: { driver: 'file' } | { driver: 'postgres'; url: string }
  queue: { driver: 'inline' } | { driver: 'redis'; url: string; prefix: string }
  /** Give every app its own PostgreSQL database, Redis namespace, queue and bucket. */
  provision: boolean
  /** Jobs this instance works on at once; 0 makes it serve requests only. */
  workers: number
}

/**
 * Read the deployment configuration.
 * @throws when a driver is chosen without its address.
 */
export function clusterConfig(platform: string, env: NodeJS.ProcessEnv): ClusterConfig {
  let file: Record<string, Record<string, unknown>> = {}
  try {
    file = JSON.parse(readFileSync(join(platform, 'rsi.config.json'), 'utf8')) as Record<string, Record<string, unknown>>
  } catch {
    // no config file
  }
  const pick = (envName: string, section: string, key: string) => env[envName]?.trim() || (typeof file[section]?.[key] === 'string' ? (file[section][key] as string) : '')
  const db = pick('RSI_DATABASE', 'database', 'driver') || 'file'
  if (db !== 'file' && db !== 'postgres') throw new Error(`未知的数据库方式 ${db}：只支持 file 和 postgres`)
  if (db === 'postgres' && !env.RSI_DATABASE_URL) throw new Error('数据库选了 postgres，但没有设置 RSI_DATABASE_URL')
  const queue = pick('RSI_QUEUE', 'queue', 'driver') || 'inline'
  if (queue !== 'inline' && queue !== 'redis') throw new Error(`未知的队列方式 ${queue}：只支持 inline 和 redis`)
  if (queue === 'redis' && !env.RSI_REDIS_URL) throw new Error('队列选了 redis，但没有设置 RSI_REDIS_URL')
  const prefix = pick('RSI_REDIS_PREFIX', 'queue', 'prefix') || 'rsi:'
  const provision = (env.RSI_APP_PROVISION ?? (file.apps?.provision === true ? '1' : '')) === '1'
  const workers = Number(env.RSI_WORKERS ?? file.queue?.workers ?? 4)
  return {
    database: db === 'postgres' ? { driver: 'postgres', url: env.RSI_DATABASE_URL! } : { driver: 'file' },
    queue: queue === 'redis' ? { driver: 'redis', url: env.RSI_REDIS_URL!, prefix } : { driver: 'inline' },
    provision,
    workers: Number.isFinite(workers) && workers >= 0 ? workers : 4,
  }
}

export interface DeploymentStatus {
  /** `cluster` when documents, files and jobs are all shared; otherwise one instance only. */
  mode: 'single' | 'cluster'
  database: { driver: 'file' | 'postgres'; location: string }
  queue: { driver: 'inline' | 'redis'; location: string }
  storage: { driver: 'local' | 'minio'; location: string }
  instance: string
  provision: boolean
  /** What keeps this deployment from running as several instances, for people. */
  notes: string[]
}

export function deploymentStatus(config: ClusterConfig, storage: { driver: 'local' | 'minio'; location: string }, instance: string): DeploymentStatus {
  const notes: string[] = []
  if (config.database.driver === 'file') notes.push('单据、版本、用户等数据是 home 里的 JSON 文件，只能一个实例使用')
  if (storage.driver === 'local') notes.push('文件在本机 home 目录，其他实例看不到')
  if (config.queue.driver === 'inline') notes.push('后台任务在本进程里执行，实例重启会中断')
  return {
    mode: notes.length ? 'single' : 'cluster',
    database: { driver: config.database.driver, location: config.database.driver === 'postgres' ? describePg(config.database.url) : 'home/.rsi' },
    queue: { driver: config.queue.driver, location: config.queue.driver === 'redis' ? `${describeRedis(config.queue.url)} ${config.queue.prefix}jobs` : '本进程' },
    storage,
    instance,
    provision: config.provision,
    notes,
  }
}

export function instanceId(): string {
  return `${hostname().replace(/[^A-Za-z0-9.-]/g, '-')}-${process.pid}-${randomBytes(2).toString('hex')}`
}

// ── jobs and events ───────────────────────────────────────────────

export interface JobContext {
  id: string
  /** Picked up again after the instance working on it stopped (crashed or was restarted). */
  reclaimed: boolean
}

export type JobHandler = (payload: Record<string, unknown>, job: JobContext) => Promise<void>

/** Something another instance should know about: an app changed, a turn should stop. */
export interface PlatformEvent {
  type: string
  [key: string]: unknown
}

export interface Jobs {
  readonly driver: 'inline' | 'redis'
  readonly instance: string
  /** Register what a kind of job does; every instance registers the same handlers. */
  handle(kind: string, fn: JobHandler): void
  /** Queue a job; some instance runs it soon. @returns its id. */
  submit(kind: string, payload: Record<string, unknown>): Promise<string>
  /** Tell the other instances. */
  publish(event: PlatformEvent): Promise<void>
  /** Hear what other instances publish. */
  subscribe(fn: (event: PlatformEvent) => void): void
  start(): Promise<void>
  stop(): Promise<void>
}

/** One instance: jobs run in this process right away, there is nobody to tell. */
export class InlineJobs implements Jobs {
  readonly driver = 'inline'
  readonly instance: string
  readonly #handlers = new Map<string, JobHandler>()
  readonly #running = new Set<Promise<void>>()
  #n = 0

  constructor(instance = instanceId()) {
    this.instance = instance
  }

  handle(kind: string, fn: JobHandler): void {
    this.#handlers.set(kind, fn)
  }

  async submit(kind: string, payload: Record<string, unknown>): Promise<string> {
    const fn = this.#handlers.get(kind)
    if (!fn) throw new Error(`没有处理 ${kind} 的后台任务`)
    const id = `local-${++this.#n}`
    const p = Promise.resolve()
      .then(() => fn(payload, { id, reclaimed: false }))
      .catch((error) => {
        process.stderr.write(`[rsi] 后台任务 ${kind} 失败：${(error as Error).message}\n`)
      })
      .finally(() => this.#running.delete(p))
    this.#running.add(p)
    return id
  }

  async publish(): Promise<void> {}

  subscribe(): void {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    await Promise.allSettled([...this.#running])
  }
}

const HEARTBEAT = 15_000
/** A job not heard from for this long belonged to an instance that stopped. */
const STALE = 60_000

/**
 * Jobs in a Redis stream read by one consumer group: each job goes to one instance. Instances
 * keep their running jobs fresh; a job whose instance stopped is claimed by another.
 * Events go over pub/sub.
 */
export class RedisJobs implements Jobs {
  readonly driver = 'redis'
  readonly instance: string
  readonly redis: Redis
  readonly #reader: Redis
  readonly #subscriber: Redis
  readonly #stream: string
  readonly #channel: string
  readonly #group = 'workers'
  readonly #handlers = new Map<string, JobHandler>()
  readonly #listeners: ((event: PlatformEvent) => void)[] = []
  readonly #active = new Map<string, Promise<void>>()
  readonly #concurrency: number
  readonly #stale: number
  #running = false
  #loop: Promise<void> | null = null
  #timers: NodeJS.Timeout[] = []

  constructor(url: string, prefix: string, options: { instance?: string; concurrency?: number; staleMs?: number } = {}) {
    this.instance = options.instance ?? instanceId()
    this.redis = new Redis(url)
    this.#reader = this.redis.duplicate()
    this.#subscriber = this.redis.duplicate()
    this.#stream = `${prefix}jobs`
    this.#channel = `${prefix}events`
    this.#concurrency = options.concurrency ?? 4
    this.#stale = options.staleMs ?? STALE
  }

  handle(kind: string, fn: JobHandler): void {
    this.#handlers.set(kind, fn)
  }

  async submit(kind: string, payload: Record<string, unknown>): Promise<string> {
    return String(await this.redis.call('XADD', this.#stream, 'MAXLEN', '~', 10000, '*', 'kind', kind, 'payload', JSON.stringify(payload), 'by', this.instance))
  }

  async publish(event: PlatformEvent): Promise<void> {
    await this.redis.call('PUBLISH', this.#channel, JSON.stringify({ ...event, from: this.instance }))
  }

  subscribe(fn: (event: PlatformEvent) => void): void {
    this.#listeners.push(fn)
  }

  async start(): Promise<void> {
    await this.redis.call('XGROUP', 'CREATE', this.#stream, this.#group, '$', 'MKSTREAM').catch((error: Error) => {
      if (!/BUSYGROUP/.test(error.message)) throw error
    })
    await this.#subscriber.subscribe([this.#channel], (_, message) => {
      let event: PlatformEvent & { from?: string }
      try {
        event = JSON.parse(message) as PlatformEvent & { from?: string }
      } catch {
        return
      }
      if (event.from === this.instance) return
      for (const fn of this.#listeners) {
        try {
          fn(event)
        } catch (error) {
          process.stderr.write(`[rsi] 处理事件 ${event.type} 出错：${(error as Error).message}\n`)
        }
      }
    })
    if (this.#concurrency === 0) return
    this.#running = true
    this.#loop = this.#read()
    this.#timers.push(setInterval(() => void this.#heartbeat(), Math.min(HEARTBEAT, this.#stale / 4)).unref())
    this.#timers.push(setInterval(() => void this.#reclaim(), this.#stale / 2).unref())
  }

  async #read(): Promise<void> {
    while (this.#running) {
      if (this.#active.size >= this.#concurrency) {
        await Promise.race(this.#active.values())
        continue
      }
      let reply: Reply
      try {
        reply = await this.#reader.call('XREADGROUP', 'GROUP', this.#group, this.instance, 'COUNT', 1, 'BLOCK', 5000, 'STREAMS', this.#stream, '>')
      } catch (error) {
        if (!this.#running) return
        process.stderr.write(`[rsi] 读取任务队列失败：${(error as Error).message}\n`)
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      if (!Array.isArray(reply)) continue
      for (const [, entries] of reply as [string, [string, Reply[]][]][]) for (const [id, fields] of entries) this.#run(id, fields, false)
    }
  }

  #run(id: string, fields: Reply[], reclaimed: boolean): void {
    const f: Record<string, string> = {}
    for (let i = 0; i + 1 < (fields?.length ?? 0); i += 2) f[String(fields[i])] = String(fields[i + 1])
    const fn = this.#handlers.get(f.kind)
    const work = (async () => {
      if (!fn) {
        process.stderr.write(`[rsi] 没有处理 ${f.kind} 的后台任务，丢弃 ${id}\n`)
        return
      }
      await fn(JSON.parse(f.payload ?? '{}') as Record<string, unknown>, { id, reclaimed })
    })()
      .catch((error) => {
        process.stderr.write(`[rsi] 后台任务 ${f.kind} ${id} 失败：${(error as Error).message}\n`)
      })
      .finally(async () => {
        this.#active.delete(id)
        await this.redis.call('XACK', this.#stream, this.#group, id).catch(() => undefined)
        await this.redis.call('XDEL', this.#stream, id).catch(() => undefined)
      })
    this.#active.set(id, work)
  }

  /** Reset the idle time of the jobs this instance is working on, so nobody reclaims them. */
  async #heartbeat(): Promise<void> {
    const ids = [...this.#active.keys()]
    if (ids.length) await this.redis.call('XCLAIM', this.#stream, this.#group, this.instance, 0, ...ids, 'JUSTID').catch(() => undefined)
  }

  /** Take over jobs whose instance has gone quiet. */
  async #reclaim(): Promise<void> {
    if (this.#active.size >= this.#concurrency) return
    const reply = await this.redis.call('XAUTOCLAIM', this.#stream, this.#group, this.instance, this.#stale, '0-0', 'COUNT', this.#concurrency - this.#active.size).catch(() => null)
    if (!Array.isArray(reply) || !Array.isArray(reply[1])) return
    for (const entry of reply[1] as [string, Reply[]][]) {
      if (!entry || this.#active.has(entry[0])) continue
      this.#run(entry[0], entry[1], true)
    }
  }

  async stop(): Promise<void> {
    this.#running = false
    for (const t of this.#timers) clearInterval(t)
    this.#reader.close()
    this.#subscriber.close()
    await Promise.allSettled([...this.#active.values()])
    this.redis.close()
  }
}
