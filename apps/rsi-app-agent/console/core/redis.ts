/**
 * A small Redis client (RESP2): commands, pub/sub, and blocking stream reads on their own
 * connection. Used for the job queue (Redis Streams), events between platform instances and
 * provisioning app users (ACL).
 */

import { connect as tcp } from 'node:net'
import type { Socket } from 'node:net'
import { connect as tls } from 'node:tls'

export type Reply = string | number | null | Reply[] | Error

export class RedisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedisError'
  }
}

interface Target {
  host: string
  port: number
  user: string | null
  password: string | null
  db: number
  tls: boolean
}

function parseUrl(url: string): Target {
  const u = new URL(url)
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error('Redis 地址要以 redis:// 或 rediss:// 开头')
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 6379),
    user: u.username ? decodeURIComponent(u.username) : null,
    password: u.password ? decodeURIComponent(u.password) : null,
    db: Number(u.pathname.slice(1) || 0),
    tls: u.protocol === 'rediss:',
  }
}

/** Where a Redis URL points, without its password. */
export function describeRedis(url: string): string {
  const t = parseUrl(url)
  return `${t.tls ? 'rediss' : 'redis'}://${t.user ? `${t.user}@` : ''}${t.host}:${t.port}/${t.db}`
}

function command(args: (string | number | Uint8Array)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)]
  for (const a of args) {
    const b = a instanceof Uint8Array ? Buffer.from(a) : Buffer.from(String(a))
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n'))
  }
  return Buffer.concat(parts)
}

/** Parse one reply from `buf` at `at`. @returns the reply and where the next starts, or null when incomplete. */
function parse(buf: Buffer, at: number): [Reply, number] | null {
  if (at >= buf.length) return null
  const line = buf.indexOf('\r\n', at)
  if (line < 0) return null
  const head = buf.toString('utf8', at + 1, line)
  switch (buf[at]) {
    case 43: // +
      return [head, line + 2]
    case 45: // -
      return [new RedisError(head), line + 2]
    case 58: // :
      return [Number(head), line + 2]
    case 36: {
      // $
      const n = Number(head)
      if (n < 0) return [null, line + 2]
      if (buf.length < line + 2 + n + 2) return null
      return [buf.toString('utf8', line + 2, line + 2 + n), line + 2 + n + 2]
    }
    case 42: {
      // *
      const n = Number(head)
      if (n < 0) return [null, line + 2]
      const out: Reply[] = []
      let next = line + 2
      for (let i = 0; i < n; i++) {
        const r = parse(buf, next)
        if (!r) return null
        out.push(r[0])
        next = r[1]
      }
      return [out, next]
    }
    default:
      throw new RedisError(`无法解析 Redis 回复：${head.slice(0, 40)}`)
  }
}

/** One connection. Replies come back in order, so commands can be pipelined. */
export class Redis {
  readonly location: string
  readonly #target: Target
  #socket: Socket | null = null
  #ready: Promise<void> | null = null
  #buffer: Buffer = Buffer.alloc(0)
  readonly #pending: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = []
  #onPush: ((reply: Reply[]) => void) | null = null
  #closed = false

  readonly #url: string

  constructor(url: string) {
    this.#url = url
    this.#target = parseUrl(url)
    this.location = describeRedis(url)
  }

  /** Another connection to the same server (blocking reads and subscriptions need their own). */
  duplicate(): Redis {
    return new Redis(this.#url)
  }

  /** The server's host and port, for building app connection URLs. */
  get target(): { host: string; port: number; tls: boolean } {
    return { host: this.#target.host, port: this.#target.port, tls: this.#target.tls }
  }

  async #connect(): Promise<void> {
    const t = this.#target
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = t.tls ? tls({ host: t.host, port: t.port, servername: t.host }) : tcp({ host: t.host, port: t.port })
      s.once(t.tls ? 'secureConnect' : 'connect', () => resolve(s))
      s.once('error', reject)
    })
    socket.setNoDelay(true)
    this.#socket = socket
    socket.on('data', (d: Buffer) => this.#receive(d))
    const lost = (error: Error) => {
      this.#socket = null
      this.#ready = null
      for (const p of this.#pending.splice(0)) p.reject(error)
    }
    socket.on('error', lost)
    socket.on('close', () => lost(new RedisError('Redis 连接已断开')))
    if (t.password !== null) await this.#send(t.user ? ['AUTH', t.user, t.password] : ['AUTH', t.password])
    if (t.db) await this.#send(['SELECT', t.db])
  }

  #receive(data: Buffer): void {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, data]) : data
    let at = 0
    for (;;) {
      const r = parse(this.#buffer, at)
      if (!r) break
      at = r[1]
      const reply = r[0]
      if (this.#onPush && Array.isArray(reply) && (reply[0] === 'message' || reply[0] === 'pmessage')) {
        this.#onPush(reply)
        continue
      }
      const p = this.#pending.shift()
      if (!p) continue
      if (reply instanceof Error) p.reject(reply)
      else p.resolve(reply)
    }
    this.#buffer = this.#buffer.subarray(at)
  }

  #send(args: (string | number | Uint8Array)[]): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.#pending.push({ resolve, reject })
      this.#socket!.write(command(args))
    })
  }

  /** Run one command, connecting (again) when needed. */
  async call(...args: (string | number | Uint8Array)[]): Promise<Reply> {
    if (this.#closed) throw new RedisError('Redis 连接已关闭')
    if (!this.#socket) {
      this.#ready ??= this.#connect().catch((error) => {
        this.#ready = null
        throw error
      })
      await this.#ready
    }
    return this.#send(args)
  }

  /** Subscribe this connection to channels; it can only receive messages afterwards. */
  async subscribe(channels: string[], onMessage: (channel: string, message: string) => void): Promise<void> {
    this.#onPush = (reply) => {
      if (reply[0] === 'message') onMessage(String(reply[1]), String(reply[2]))
    }
    await this.call('SUBSCRIBE', ...channels)
    for (let i = 1; i < channels.length; i++) await new Promise<Reply>((resolve, reject) => this.#pending.push({ resolve, reject }))
  }

  close(): void {
    this.#closed = true
    this.#socket?.end()
    this.#socket = null
  }
}

/** `[field, value, field, value…]` as an object. */
export function pairs(reply: Reply): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(reply)) return out
  for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1])
  return out
}
