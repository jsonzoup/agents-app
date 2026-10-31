/**
 * Each app's own infrastructure, opened by the platform: a PostgreSQL database and role, a Redis
 * user that can only touch its key prefix (its queues are Redis Streams under the same prefix),
 * and a MinIO bucket with a user whose policy covers only that bucket. Published versions use
 * `prod`; build-session previews use `dev`, so trying a change never touches real data.
 *
 * The app's server receives them as environment variables (`DATABASE_URL`, `REDIS_URL`,
 * `REDIS_PREFIX`, `QUEUE_PREFIX`, `S3_*`). They are not written into the app's `.env`: versions
 * and exported archives stay free of credentials and work on any platform.
 *
 * Opening is idempotent; the credentials are kept in the platform database (or a 0600 file in
 * single-instance mode). Administrative access comes from the platform's own configuration:
 * `RSI_APP_PG_URL` (else `RSI_DATABASE_URL`), `RSI_APP_REDIS_URL` (else `RSI_REDIS_URL`), and
 * the MinIO credentials of `storage`.
 */

import * as crypto from 'node:crypto'
import { createCipheriv, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Console } from './console.ts'
import { Pg, ident, literal } from './pg.ts'
import type { Docs } from './pgstore.ts'
import { Redis } from './redis.ts'
import type { S3 } from './storage.ts'

export type AppEnv = 'prod' | 'dev'

export interface AppResources {
  app: string
  env: AppEnv
  at: string
  postgres?: { database: string; user: string; password: string; host: string; port: number; ssl: string }
  redis?: { user: string; password: string; prefix: string; host: string; port: number; tls: boolean }
  s3?: { bucket: string; accessKey: string; secretKey: string; endpoint: string; region: string }
  /** What could not be opened, for people. */
  problems: string[]
}

const secret = () => randomBytes(24).toString('base64url')

/** Node 24.7+ (`crypto.argon2Sync`), not yet in every type package. */
const argon2Sync = (crypto as unknown as { argon2Sync: (algorithm: string, parameters: { message: Uint8Array; nonce: Uint8Array; parallelism: number; tagLength: number; memory: number; passes: number }) => Buffer }).argon2Sync

/** Encrypt a MinIO admin request body the way `madmin.EncryptData` does (argon2id, AES-256-GCM, one sio stream frame). */
export function madminEncrypt(password: string, data: Uint8Array): Buffer {
  if (data.length > 16384) throw new Error('MinIO 管理请求过大')
  const salt = randomBytes(32)
  const key = argon2Sync('argon2id', { message: Buffer.from(password), nonce: salt, parallelism: 4, tagLength: 32, memory: 64 * 1024, passes: 1 })
  const nonce = randomBytes(8)
  const seq = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n)
    return Buffer.concat([nonce, b])
  }
  const header = createCipheriv('aes-256-gcm', key, seq(0))
  header.final()
  const ad = Buffer.concat([Buffer.from([0x80]), header.getAuthTag()])
  const body = createCipheriv('aes-256-gcm', key, seq(1))
  body.setAAD(ad)
  const sealed = Buffer.concat([body.update(data), body.final(), body.getAuthTag()])
  return Buffer.concat([salt, Buffer.from([0x00]), nonce, sealed])
}

/** Names the platform gives an app's resources. */
export function resourceNames(app: string, env: AppEnv) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(app)) throw new Error(`应用标识 ${app} 不能用来开通资源`)
  const suffix = env === 'dev' ? '-dev' : ''
  return {
    database: `app_${app.replace(/-/g, '_')}${suffix.replace('-', '_')}`,
    redisUser: `app-${app}${suffix}`,
    prefix: `rsiapp:${app}:${env}:`,
    bucket: `rsi-app-${app}${suffix}`,
    s3User: `app-${app}${suffix}`,
  }
}

export class AppInfra {
  readonly #pg: Pg | null
  readonly #redis: Redis | null
  readonly #s3: S3 | null
  readonly #s3Secret: string | null
  readonly #docs: Docs | null
  readonly #file: string
  readonly #exclusive: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  readonly #ensured = new Map<string, Promise<AppResources>>()

  constructor(options: {
    pgUrl?: string | null
    redisUrl?: string | null
    s3?: S3 | null
    s3Secret?: string | null
    docs?: Docs | null
    stateDir: string
    /** Cross-instance lock, so two instances never open the same app at once. */
    exclusive?: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  }) {
    this.#exclusive = options.exclusive ?? ((_, fn) => fn())
    this.#pg = options.pgUrl ? new Pg(options.pgUrl, { max: 2 }) : null
    this.#redis = options.redisUrl ? new Redis(options.redisUrl) : null
    this.#s3 = options.s3 ?? null
    this.#s3Secret = options.s3Secret ?? null
    this.#docs = options.docs ?? null
    this.#file = join(options.stateDir, 'infra.json')
  }

  static fromEnv(env: NodeJS.ProcessEnv, options: { docs: Docs | null; s3: S3 | null; console: Console }): AppInfra {
    const store = options.console.store
    return new AppInfra({
      exclusive: store.exclusive ? (key, fn) => store.exclusive!(key, fn) : undefined,
      pgUrl: env.RSI_APP_PG_URL || env.RSI_DATABASE_URL || null,
      redisUrl: env.RSI_APP_REDIS_URL || env.RSI_REDIS_URL || null,
      s3: options.s3,
      s3Secret: env.RSI_S3_SECRET_KEY ?? null,
      docs: options.docs,
      stateDir: options.console.stateDir,
    })
  }

  /** Which kinds of resources this platform can open. */
  get offers(): { postgres: boolean; redis: boolean; s3: boolean } {
    return { postgres: this.#pg !== null, redis: this.#redis !== null, s3: this.#s3 !== null }
  }

  async #stored(key: string): Promise<AppResources | undefined> {
    if (this.#docs) return this.#docs.get<AppResources>('infra', key)
    if (!existsSync(this.#file)) return undefined
    return (JSON.parse(await readFile(this.#file, 'utf8')) as Record<string, AppResources>)[key]
  }

  async #store(key: string, r: AppResources): Promise<void> {
    if (this.#docs) return this.#docs.put('infra', key, r)
    await this.#exclusive('infra.json', async () => {
      const all = existsSync(this.#file) ? (JSON.parse(await readFile(this.#file, 'utf8')) as Record<string, AppResources>) : {}
      all[key] = r
      await mkdir(join(this.#file, '..'), { recursive: true })
      const tmp = `${this.#file}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
      await rename(tmp, this.#file)
    })
  }

  /**
   * Open (or check again) an app's resources. Each kind is opened once per platform process;
   * the Redis user is applied every time, since Redis may have restarted without saving it.
   */
  ensure(app: string, env: AppEnv): Promise<AppResources> {
    const key = `${app}.${env}`
    let found = this.#ensured.get(key)
    if (!found) {
      found = this.#exclusive(`infra:${key}`, () => this.#open(app, env)).catch((error) => {
        this.#ensured.delete(key)
        throw error
      })
      this.#ensured.set(key, found)
      return found
    }
    return found.then(async (r) => {
      if (r.redis && this.#redis) await this.#redisUser(r.redis).catch(() => undefined)
      return r
    })
  }

  async #open(app: string, env: AppEnv): Promise<AppResources> {
    const key = `${app}.${env}`
    const names = resourceNames(app, env)
    const before = await this.#stored(key)
    const r: AppResources = { app, env, at: before?.at ?? new Date().toISOString(), problems: [] }
    if (this.#pg) {
      try {
        const password = before?.postgres?.password ?? secret()
        const role = names.database
        const exists = (await this.#pg.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length > 0
        await this.#pg.simple(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} WITH LOGIN PASSWORD ${literal(password)}`)
        if ((await this.#pg.query('SELECT 1 FROM pg_database WHERE datname = $1', [names.database])).rows.length === 0) {
          await this.#pg.simple(`CREATE DATABASE ${ident(names.database)} OWNER ${ident(role)}`)
        }
        await this.#pg.simple(`REVOKE ALL ON DATABASE ${ident(names.database)} FROM PUBLIC`)
        const home = (await this.#pg.query('SELECT current_database() AS d')).rows[0].d as string
        await this.#pg.simple(`REVOKE CONNECT ON DATABASE ${ident(home)} FROM PUBLIC`)
        const t = this.#pg.target
        r.postgres = { database: names.database, user: role, password, host: t.host, port: t.port, ssl: t.ssl }
      } catch (error) {
        r.problems.push(`PostgreSQL：${(error as Error).message}`)
      }
    }
    if (this.#redis) {
      try {
        const redis = { user: names.redisUser, password: before?.redis?.password ?? secret(), prefix: names.prefix, ...this.#redis.target }
        await this.#redisUser(redis)
        r.redis = redis
      } catch (error) {
        r.problems.push(`Redis：${(error as Error).message}`)
      }
    }
    if (this.#s3 && this.#s3Secret) {
      try {
        const secretKey = before?.s3?.secretKey ?? secret()
        await this.#s3.withBucket(names.bucket).ensureBucket()
        await this.#minioUser(names.s3User, secretKey, names.bucket)
        r.s3 = { bucket: names.bucket, accessKey: names.s3User, secretKey, endpoint: this.#s3.endpoint, region: this.#s3.region }
      } catch (error) {
        r.problems.push(`MinIO：${(error as Error).message}`)
      }
    }
    await this.#store(key, r)
    return r
  }

  async #redisUser(r: NonNullable<AppResources['redis']>): Promise<void> {
    await this.#redis!.call('ACL', 'SETUSER', r.user, 'reset', 'on', `>${r.password}`, `~${r.prefix}*`, `&${r.prefix}*`, '+@all', '-@admin', '-@dangerous')
  }

  async #admin(method: string, path: string, query: Record<string, string>, body: Uint8Array): Promise<Response> {
    return this.#s3!.signed(method, `/minio/admin/v3/${path}`, query, body)
  }

  async #minioUser(user: string, secretKey: string, bucket: string): Promise<void> {
    const policy = `rsi-app-${bucket.replace(/^rsi-app-/, '')}`
    const doc = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*'], Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`] }] }
    const fail = async (res: Response, what: string) => {
      const text = await res.text().catch(() => '')
      const code = /"Code":"([^"]+)"/.exec(text)?.[1] ?? /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? ''
      throw new Error(`${what}失败：HTTP ${res.status}${code ? ` ${code}` : ''}`)
    }
    let res = await this.#admin('PUT', 'add-canned-policy', { name: policy }, new TextEncoder().encode(JSON.stringify(doc)))
    if (!res.ok) await fail(res, '创建访问策略')
    res = await this.#admin('PUT', 'add-user', { accessKey: user }, madminEncrypt(this.#s3Secret!, new TextEncoder().encode(JSON.stringify({ secretKey, status: 'enabled' }))))
    if (!res.ok) await fail(res, '创建用户')
    res = await this.#admin('POST', 'idp/builtin/policy/attach', {}, madminEncrypt(this.#s3Secret!, new TextEncoder().encode(JSON.stringify({ policies: [policy], user }))))
    if (res.ok) return
    const text = await res.text().catch(() => '')
    if (/AlreadyApplied|already/i.test(text)) return
    res = await this.#admin('PUT', 'set-user-or-group-policy', { policyName: policy, userOrGroup: user, isGroup: 'false' }, new Uint8Array())
    if (!res.ok) await fail(res, '给用户授予策略')
  }

  /** The variables an app's server process gets. */
  static variables(r: AppResources): Record<string, string> {
    const out: Record<string, string> = { RSI_APP_ENV: r.env }
    if (r.postgres) {
      const p = r.postgres
      out.DATABASE_URL = `postgres://${encodeURIComponent(p.user)}:${encodeURIComponent(p.password)}@${p.host}:${p.port}/${encodeURIComponent(p.database)}${p.ssl === 'disable' ? '' : `?sslmode=${p.ssl}`}`
    }
    if (r.redis) {
      const x = r.redis
      out.REDIS_URL = `${x.tls ? 'rediss' : 'redis'}://${encodeURIComponent(x.user)}:${encodeURIComponent(x.password)}@${x.host}:${x.port}`
      out.REDIS_PREFIX = x.prefix
      out.QUEUE_PREFIX = `${x.prefix}queue:`
    }
    if (r.s3) {
      out.S3_ENDPOINT = r.s3.endpoint
      out.S3_REGION = r.s3.region
      out.S3_BUCKET = r.s3.bucket
      out.S3_ACCESS_KEY = r.s3.accessKey
      out.S3_SECRET_KEY = r.s3.secretKey
    }
    return out
  }

  /** What an app has, without credentials, for its managers. */
  async summary(app: string) {
    const show = async (env: AppEnv) => {
      const r = await this.#stored(`${app}.${env}`)
      if (!r) return null
      return {
        env,
        at: r.at,
        postgres: r.postgres ? { database: r.postgres.database, user: r.postgres.user, host: `${r.postgres.host}:${r.postgres.port}` } : null,
        redis: r.redis ? { user: r.redis.user, prefix: r.redis.prefix, queue: `${r.redis.prefix}queue:`, host: `${r.redis.host}:${r.redis.port}` } : null,
        s3: r.s3 ? { bucket: r.s3.bucket, user: r.s3.accessKey, endpoint: r.s3.endpoint } : null,
        problems: r.problems,
      }
    }
    return { offers: this.offers, environments: [await show('prod'), await show('dev')].filter(Boolean) }
  }

  async close(): Promise<void> {
    await this.#pg?.end()
    this.#redis?.close()
  }
}
