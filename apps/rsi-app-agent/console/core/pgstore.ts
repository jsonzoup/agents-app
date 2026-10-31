/**
 * Platform documents in PostgreSQL: the kernel's collections (releases, proposals, runs…),
 * the console's state (users, grants, tasks…) and the assistant's sessions, as one table of
 * JSON documents keyed by collection and id. Blobs and materialized versions stay in a local
 * cache directory in front of the object store, exactly as with the directory store.
 *
 * Counters are atomic and locks are PostgreSQL advisory locks, so several platform instances
 * can share one database.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { FsStore, LocalLocks } from '../../rsi-kernel/src/index.ts'
import type { BlobStore, Release, Store } from '../../rsi-kernel/src/index.ts'
import { Pg } from './pg.ts'

/** Documents outside the kernel's own collections (console state, sessions, preview tasks). */
export interface Docs {
  get<T>(collection: string, id: string): Promise<T | undefined>
  put(collection: string, id: string, doc: unknown): Promise<void>
  /** Every document of a collection, by id; only ids starting with `prefix` when given. */
  list<T>(collection: string, prefix?: string): Promise<T[]>
  delete(collection: string, id: string): Promise<void>
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rsi_docs (
  collection text NOT NULL,
  id text NOT NULL,
  doc json NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS rsi_meta (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO rsi_meta (key, value) VALUES ('schema', '1') ON CONFLICT (key) DO NOTHING;
`

/** Create the platform's tables once, even when several instances start together. */
export async function migrate(pg: Pg): Promise<void> {
  await pg.with(async (c) => {
    await c.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['rsi:schema'])
    try {
      await c.simple(SCHEMA)
    } finally {
      await c.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['rsi:schema'])
    }
  })
}

export class PgStore implements Store, Docs {
  readonly pg: Pg
  readonly #locks: Pg
  readonly #cache: FsStore
  readonly #local = new LocalLocks()
  readonly #held = new AsyncLocalStorage<Set<string>>()

  /**
   * @param url - the platform database.
   * @param cacheDir - local directory for blobs and materialized versions.
   */
  constructor(url: string, cacheDir: string, options: { blobs?: BlobStore } = {}) {
    this.pg = new Pg(url, { max: 10 })
    this.#locks = new Pg(url, { max: 16 })
    this.#cache = new FsStore(cacheDir, options)
  }

  get blobStore(): string {
    return this.#cache.blobStore
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    const { rows } = await this.pg.query<{ doc: T }>('SELECT doc FROM rsi_docs WHERE collection = $1 AND id = $2', [collection, id])
    return rows[0]?.doc
  }

  async put(collection: string, id: string, doc: unknown): Promise<void> {
    await this.pg.query(
      'INSERT INTO rsi_docs (collection, id, doc) VALUES ($1, $2, $3::json) ON CONFLICT (collection, id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()',
      [collection, id, JSON.stringify(doc)],
    )
  }

  async list<T>(collection: string, prefix?: string): Promise<T[]> {
    const { rows } = prefix
      ? await this.pg.query<{ doc: T }>('SELECT doc FROM rsi_docs WHERE collection = $1 AND starts_with(id, $2) ORDER BY id COLLATE "C"', [collection, prefix])
      : await this.pg.query<{ doc: T }>('SELECT doc FROM rsi_docs WHERE collection = $1 ORDER BY id COLLATE "C"', [collection])
    return rows.map((r) => r.doc)
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.pg.query('DELETE FROM rsi_docs WHERE collection = $1 AND id = $2', [collection, id])
  }

  putBlob(content: Uint8Array): Promise<string> {
    return this.#cache.putBlob(content)
  }

  getBlob(hash: string): Promise<Uint8Array> {
    return this.#cache.getBlob(hash)
  }

  materialize(release: Release): Promise<string> {
    return this.#cache.materialize(release)
  }

  async next(counter: string): Promise<number> {
    const { rows } = await this.pg.query<{ n: number }>(
      `INSERT INTO rsi_docs (collection, id, doc) VALUES ('counters', $1, '{"n":1}'::json)
       ON CONFLICT (collection, id) DO UPDATE SET doc = json_build_object('n', (rsi_docs.doc->>'n')::bigint + 1), updated_at = now()
       RETURNING (doc->>'n')::bigint AS n`,
      [counter],
    )
    return Number(rows[0].n)
  }

  /** Serialize on `key` in this process first, then across processes with an advisory lock held on its own connection. */
  exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const held = this.#held.getStore()
    if (held?.has(key)) return fn()
    return this.#local.run(key, () =>
      this.#locks.with(async (c) => {
        await c.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key])
        try {
          return await this.#held.run(new Set([...(held ?? []), key]), fn)
        } finally {
          await c.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
        }
      }),
    )
  }

  async close(): Promise<void> {
    await this.pg.end()
    await this.#locks.end()
  }
}
