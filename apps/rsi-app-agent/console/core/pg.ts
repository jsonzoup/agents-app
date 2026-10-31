/**
 * A small PostgreSQL client (protocol 3): extended queries with text parameters, SCRAM-SHA-256,
 * MD5 or cleartext sign-in, TLS when `sslmode` asks for it, and a connection pool. Enough for
 * the platform's documents, counters and advisory locks, and for provisioning app databases.
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { connect as tcp } from 'node:net'
import type { Socket } from 'node:net'
import { connect as tls } from 'node:tls'

export class PgError extends Error {
  readonly code: string
  readonly detail?: string
  constructor(fields: Record<string, string>) {
    super(fields.M ?? 'PostgreSQL 出错')
    this.name = 'PgError'
    this.code = fields.C ?? ''
    if (fields.D) this.detail = fields.D
  }
}

export interface PgResult<T = Record<string, unknown>> {
  rows: T[]
  /** e.g. `INSERT 0 1`. */
  command: string
  count: number
}

interface Target {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: 'disable' | 'prefer' | 'require' | 'verify-full'
}

function parseUrl(url: string): Target {
  const u = new URL(url)
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('数据库地址要以 postgres:// 开头')
  const mode = u.searchParams.get('sslmode') ?? 'disable'
  const ssl = mode === 'verify-ca' ? 'verify-full' : mode === 'allow' ? 'prefer' : mode
  if (!['disable', 'prefer', 'require', 'verify-full'].includes(ssl)) throw new Error(`不支持的 sslmode ${mode}`)
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)) || decodeURIComponent(u.username),
    ssl: ssl as Target['ssl'],
  }
}

/** Where a database URL points, without its password: for logs and status pages. */
export function describePg(url: string): string {
  const t = parseUrl(url)
  return `postgres://${t.user}@${t.host}:${t.port}/${t.database}`
}

const OID = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701, numeric: 1700, jsonb: 3802 }

function decode(type: number, text: string): unknown {
  switch (type) {
    case OID.bool:
      return text === 't'
    case OID.int2:
    case OID.int4:
    case OID.oid:
    case OID.float4:
    case OID.float8:
      return Number(text)
    case OID.int8:
    case OID.numeric: {
      const n = Number(text)
      return Number.isSafeInteger(n) || !Number.isInteger(n) ? n : text
    }
    case OID.json:
    case OID.jsonb:
      return JSON.parse(text)
    case OID.bytea:
      return text.startsWith('\\x') ? Buffer.from(text.slice(2), 'hex') : Buffer.from(text, 'binary')
    default:
      return text
  }
}

function encode(value: unknown): Buffer | null {
  if (value === null || value === undefined) return null
  if (value instanceof Uint8Array) return Buffer.from(`\\x${Buffer.from(value).toString('hex')}`)
  if (typeof value === 'boolean') return Buffer.from(value ? 't' : 'f')
  if (value instanceof Date) return Buffer.from(value.toISOString())
  if (typeof value === 'object') return Buffer.from(JSON.stringify(value))
  return Buffer.from(String(value))
}

class Writer {
  readonly #parts: Buffer[] = []
  str(s: string): this {
    this.#parts.push(Buffer.from(`${s}\0`))
    return this
  }
  i16(n: number): this {
    const b = Buffer.alloc(2)
    b.writeInt16BE(n)
    this.#parts.push(b)
    return this
  }
  i32(n: number): this {
    const b = Buffer.alloc(4)
    b.writeInt32BE(n)
    this.#parts.push(b)
    return this
  }
  bytes(b: Buffer): this {
    this.#parts.push(b)
    return this
  }
  /** The message with its type byte (none for the startup message) and length. */
  frame(type?: string): Buffer {
    const body = Buffer.concat(this.#parts)
    const head = Buffer.alloc(type ? 5 : 4)
    if (type) head.write(type, 0, 'latin1')
    head.writeInt32BE(body.length + 4, type ? 1 : 0)
    return Buffer.concat([head, body])
  }
}

interface Message {
  type: string
  body: Buffer
}

function cstrings(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i])
    const end = body.indexOf(0, i + 1)
    out[code] = body.toString('utf8', i + 1, end)
    i = end + 1
  }
  return out
}

/** One server connection; used by one caller at a time (the pool sees to that). */
class Connection {
  #socket!: Socket
  #buffer: Buffer = Buffer.alloc(0)
  readonly #inbox: Message[] = []
  #wake: (() => void) | null = null
  #failure: Error | null = null
  closed = false

  static async open(t: Target): Promise<Connection> {
    const c = new Connection()
    await c.#connect(t)
    return c
  }

  async #connect(t: Target): Promise<void> {
    let socket = await new Promise<Socket>((resolve, reject) => {
      const s = tcp({ host: t.host, port: t.port })
      s.once('connect', () => resolve(s))
      s.once('error', reject)
    })
    if (t.ssl !== 'disable') {
      socket.write(new Writer().i32(80877103).frame())
      const answer = await new Promise<string>((resolve, reject) => {
        socket.once('data', (d: Buffer) => resolve(d.toString('latin1', 0, 1)))
        socket.once('error', reject)
      })
      if (answer === 'S') {
        socket = await new Promise<Socket>((resolve, reject) => {
          const s = tls({ socket, servername: t.host, rejectUnauthorized: t.ssl === 'verify-full' })
          s.once('secureConnect', () => resolve(s))
          s.once('error', reject)
        })
      } else if (t.ssl !== 'prefer') throw new Error('数据库服务器不支持 TLS，但 sslmode 要求加密')
    }
    this.#socket = socket
    socket.on('data', (d: Buffer) => this.#receive(d))
    socket.on('error', (e) => this.#fail(e))
    socket.on('close', () => this.#fail(new Error('数据库连接已断开')))
    const startup = new Writer().i32(196608).str('user').str(t.user).str('database').str(t.database).str('application_name').str('rsi-app-agent').str('client_encoding').str('UTF8').str('').frame()
    socket.write(startup)
    await this.#authenticate(t)
  }

  #receive(data: Buffer): void {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, data]) : data
    while (this.#buffer.length >= 5) {
      const length = this.#buffer.readInt32BE(1)
      if (this.#buffer.length < length + 1) break
      this.#inbox.push({ type: String.fromCharCode(this.#buffer[0]), body: this.#buffer.subarray(5, length + 1) })
      this.#buffer = this.#buffer.subarray(length + 1)
    }
    this.#wake?.()
  }

  #fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    this.#failure = error
    this.#wake?.()
  }

  async #next(): Promise<Message> {
    for (;;) {
      const m = this.#inbox.shift()
      if (m) {
        if (m.type === 'N' || m.type === 'S' || m.type === 'K' || m.type === 'A') continue
        return m
      }
      if (this.#failure) throw this.#failure
      await new Promise<void>((resolve) => (this.#wake = resolve))
      this.#wake = null
    }
  }

  async #authenticate(t: Target): Promise<void> {
    let scram: { nonce: string; bare: string; salted?: Buffer; auth?: string } | null = null
    for (;;) {
      const m = await this.#next()
      if (m.type === 'E') throw new PgError(cstrings(m.body))
      if (m.type === 'Z') return
      if (m.type !== 'R') continue
      const code = m.body.readInt32BE(0)
      if (code === 0) continue
      if (code === 3) this.#socket.write(new Writer().str(t.password).frame('p'))
      else if (code === 5) {
        const inner = createHash('md5').update(t.password + t.user).digest('hex')
        const outer = createHash('md5').update(inner).update(m.body.subarray(4, 8)).digest('hex')
        this.#socket.write(new Writer().str(`md5${outer}`).frame('p'))
      } else if (code === 10) {
        if (!m.body.toString('utf8', 4).split('\0').includes('SCRAM-SHA-256')) throw new Error('数据库要求的认证方式不受支持')
        const nonce = randomBytes(18).toString('base64')
        const bare = `n=,r=${nonce}`
        const first = Buffer.from(`n,,${bare}`)
        scram = { nonce, bare }
        this.#socket.write(new Writer().str('SCRAM-SHA-256').i32(first.length).bytes(first).frame('p'))
      } else if (code === 11 && scram) {
        const server = m.body.toString('utf8', 4)
        const f = Object.fromEntries(server.split(',').map((kv) => [kv[0], kv.slice(2)]))
        if (!f.r?.startsWith(scram.nonce)) throw new Error('数据库 SCRAM 握手不一致')
        const salted = pbkdf2Sync(t.password, Buffer.from(f.s, 'base64'), Number(f.i), 32, 'sha256')
        const clientKey = createHmac('sha256', salted).update('Client Key').digest()
        const stored = createHash('sha256').update(clientKey).digest()
        const withoutProof = `c=biws,r=${f.r}`
        const auth = `${scram.bare},${server},${withoutProof}`
        const signature = createHmac('sha256', stored).update(auth).digest()
        const proof = Buffer.from(clientKey.map((b, i) => b ^ signature[i]))
        scram.salted = salted
        scram.auth = auth
        this.#socket.write(new Writer().bytes(Buffer.from(`${withoutProof},p=${proof.toString('base64')}`)).frame('p'))
      } else if (code === 12 && scram?.salted && scram.auth) {
        const v = /v=([^,]+)/.exec(m.body.toString('utf8', 4))?.[1] ?? ''
        const serverKey = createHmac('sha256', scram.salted).update('Server Key').digest()
        const expected = createHmac('sha256', serverKey).update(scram.auth).digest()
        const got = Buffer.from(v, 'base64')
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new Error('数据库服务器的 SCRAM 签名不对')
      } else throw new Error(`数据库要求的认证方式（${code}）不受支持`)
    }
  }

  /** One statement with `$1…` parameters. */
  async query<T>(sql: string, params: unknown[] = []): Promise<PgResult<T>> {
    if (this.closed) throw this.#failure ?? new Error('数据库连接已关闭')
    const bind = new Writer().str('').str('').i16(0).i16(params.length)
    for (const p of params) {
      const b = encode(p)
      if (b === null) bind.i32(-1)
      else bind.i32(b.length).bytes(b)
    }
    bind.i16(0)
    this.#socket.write(
      Buffer.concat([
        new Writer().str('').str(sql).i16(0).frame('P'),
        bind.frame('B'),
        new Writer().bytes(Buffer.from('P\0')).frame('D'),
        new Writer().str('').i32(0).frame('E'),
        new Writer().frame('S'),
      ]),
    )
    return this.#collect<T>()
  }

  /** Statements without parameters, possibly several separated by `;` (schema setup). */
  async simple(sql: string): Promise<void> {
    if (this.closed) throw this.#failure ?? new Error('数据库连接已关闭')
    this.#socket.write(new Writer().str(sql).frame('Q'))
    await this.#collect()
  }

  async #collect<T>(): Promise<PgResult<T>> {
    let fields: { name: string; type: number }[] = []
    const rows: T[] = []
    let command = ''
    let error: PgError | null = null
    for (;;) {
      const m = await this.#next()
      switch (m.type) {
        case 'T': {
          const n = m.body.readInt16BE(0)
          let i = 2
          fields = []
          for (let k = 0; k < n; k++) {
            const end = m.body.indexOf(0, i)
            const name = m.body.toString('utf8', i, end)
            i = end + 1
            fields.push({ name, type: m.body.readInt32BE(i + 6) })
            i += 18
          }
          break
        }
        case 'D': {
          const n = m.body.readInt16BE(0)
          let i = 2
          const row: Record<string, unknown> = {}
          for (let k = 0; k < n; k++) {
            const len = m.body.readInt32BE(i)
            i += 4
            if (len === -1) row[fields[k].name] = null
            else {
              row[fields[k].name] = decode(fields[k].type, m.body.toString(fields[k].type === OID.bytea ? 'latin1' : 'utf8', i, i + len))
              i += len
            }
          }
          rows.push(row as T)
          break
        }
        case 'C':
          command = m.body.toString('utf8', 0, m.body.length - 1)
          break
        case 'E':
          error = new PgError(cstrings(m.body))
          break
        case 'Z':
          if (error) throw error
          return { rows, command, count: Number(/(\d+)$/.exec(command)?.[1] ?? rows.length) }
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.#socket.write(new Writer().frame('X'))
    } catch {
      // already gone
    }
    this.#socket.end()
  }
}

export interface PgClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PgResult<T>>
  simple(sql: string): Promise<void>
}

/** A pool of connections to one database. */
export class Pg implements PgClient {
  readonly #target: Target
  readonly #max: number
  readonly #idle: Connection[] = []
  #open = 0
  readonly #waiting: ((c: Connection) => void)[] = []
  #ended = false
  /** For logs: the URL without its password. */
  readonly location: string

  constructor(url: string, options: { max?: number } = {}) {
    this.#target = parseUrl(url)
    this.#max = options.max ?? 10
    this.location = describePg(url)
  }

  /** The same server, another database (for provisioning). */
  database(name: string, options: { user?: string; password?: string } = {}): string {
    const t = this.#target
    const user = encodeURIComponent(options.user ?? t.user)
    const password = encodeURIComponent(options.password ?? t.password)
    return `postgres://${user}:${password}@${t.host}:${t.port}/${encodeURIComponent(name)}${t.ssl === 'disable' ? '' : `?sslmode=${t.ssl}`}`
  }

  get target(): { host: string; port: number; ssl: string } {
    return { host: this.#target.host, port: this.#target.port, ssl: this.#target.ssl }
  }

  async #acquire(): Promise<Connection> {
    if (this.#ended) throw new Error('数据库连接池已关闭')
    for (;;) {
      const c = this.#idle.pop()
      if (!c) break
      if (!c.closed) return c
      this.#open--
    }
    if (this.#open < this.#max) {
      this.#open++
      try {
        return await Connection.open(this.#target)
      } catch (error) {
        this.#open--
        throw error
      }
    }
    return new Promise((resolve) => this.#waiting.push(resolve))
  }

  #release(c: Connection): void {
    if (c.closed || this.#ended) {
      this.#open--
      c.close()
      const next = this.#waiting.shift()
      if (next) {
        this.#open++
        Connection.open(this.#target).then(next, () => {
          this.#open--
        })
      }
      return
    }
    const next = this.#waiting.shift()
    if (next) next(c)
    else this.#idle.push(c)
  }

  /** Run `fn` on one connection held for its whole duration (transactions, session locks). */
  async with<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const c = await this.#acquire()
    try {
      return await fn(c)
    } finally {
      this.#release(c)
    }
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<PgResult<T>> {
    return this.with((c) => c.query<T>(sql, params))
  }

  simple(sql: string): Promise<void> {
    return this.with((c) => c.simple(sql))
  }

  /** `fn` inside BEGIN … COMMIT, rolled back when it throws. */
  async transaction<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    return this.with(async (c) => {
      await c.simple('BEGIN')
      try {
        const out = await fn(c)
        await c.simple('COMMIT')
        return out
      } catch (error) {
        await c.simple('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  async end(): Promise<void> {
    this.#ended = true
    for (const c of this.#idle.splice(0)) c.close()
  }
}

/** Quote an identifier the platform made itself (app databases and roles). */
export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`不合法的数据库标识 ${name}`)
  return `"${name}"`
}

/** Quote a literal for statements that cannot take parameters (CREATE ROLE … PASSWORD). */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
