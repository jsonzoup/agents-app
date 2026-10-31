/**
 * Password credentials for console users. Only scrypt hashes with a per-user salt are kept
 * (`credentials.json` in the state directory, or one `credentials` document per user in the
 * platform database). Each credential has a version that sessions carry, so changing or
 * resetting a password ends the sessions signed before it.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Docs } from './pgstore.ts'

export interface Credential {
  salt: string
  hash: string
  version: number
  at: string
  /** Who set it: the user themself, or the administrator who reset it. */
  by: string
}

const KEY_LENGTH = 64
export const MIN_PASSWORD = 6

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key))))
}

/** Why a new password is not acceptable, or null. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`
  if (password.length > 128) return '密码不能超过 128 位'
  return null
}

export class Accounts {
  readonly #file: string
  readonly #now: () => string
  readonly #docs: Docs | null

  constructor(file: string, now: () => string, docs: Docs | null = null) {
    this.#file = file
    this.#now = now
    this.#docs = docs
  }

  async #one(id: string): Promise<Credential | undefined> {
    if (this.#docs) return this.#docs.get<Credential>('credentials', id)
    return (await this.#all())[id]
  }

  async #all(): Promise<Record<string, Credential>> {
    if (this.#docs) return Object.fromEntries((await this.#docs.list<Credential & { id: string }>('credentials')).map((c) => [c.id, c]))
    try {
      return JSON.parse(await readFile(this.#file, 'utf8')) as Record<string, Credential>
    } catch {
      return {}
    }
  }

  async #write(all: Record<string, Credential>): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true })
    const tmp = `${this.#file}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, this.#file)
  }

  /** The current credential version, or null when the user has no password yet. */
  async version(id: string): Promise<number | null> {
    return (await this.#one(id))?.version ?? null
  }

  /** The credential version when the password matches, else null. */
  async verify(id: string, password: string): Promise<number | null> {
    const found = await this.#one(id)
    const got = await derive(password, found?.salt ?? 'no-such-user')
    if (!found) return null
    const want = Buffer.from(found.hash, 'base64')
    return want.length === got.length && timingSafeEqual(want, got) ? found.version : null
  }

  async set(id: string, password: string, by: string): Promise<void> {
    const problem = passwordProblem(password)
    if (problem) throw new Error(problem)
    const salt = randomBytes(16).toString('base64')
    const credential: Credential = { salt, hash: (await derive(password, salt)).toString('base64'), version: ((await this.#one(id))?.version ?? 0) + 1, at: this.#now(), by }
    if (this.#docs) return this.#docs.put('credentials', id, { id, ...credential })
    const all = await this.#all()
    all[id] = credential
    await this.#write(all)
  }

  /** Users that have a password. */
  async ids(): Promise<Set<string>> {
    return new Set(Object.keys(await this.#all()))
  }
}
