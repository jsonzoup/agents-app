/**
 * Filesystem adapters: an app directory (code + evals) and a JSON + blob state store.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Release } from '../domain/release.ts'
import { hashContent } from '../domain/release.ts'
import type { AppSource, BlobStore, FileTree, Store } from '../ports.ts'

const SKIP = new Set(['__pycache__', 'node_modules', '.DS_Store', '.git', '.venv', '.pytest_cache'])

/** Dotfiles that are part of an app: its MCP servers, its web application's configuration and ignore list. */
const kept = (name: string) => name === '.mcp.json' || name === '.gitignore' || name === '.env' || name.startsWith('.env.')

/** A directory on disk. Follows symlinks. */
export class FsTree implements FileTree {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async list(): Promise<string[]> {
    const out: string[] = []
    const walk = async (rel: string): Promise<void> => {
      for (const name of (await readdir(join(this.root, rel))).sort()) {
        if (SKIP.has(name) || (name.startsWith('.') && !kept(name))) continue
        const path = rel ? `${rel}/${name}` : name
        const info = await stat(join(this.root, path))
        if (info.isDirectory()) await walk(path)
        else if (info.isFile()) out.push(path)
      }
    }
    await walk('')
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    return readFile(join(this.root, path))
  }
}

/** An app directory on disk: `code/` is the source releases snapshot, `evals/` stays outside them. */
export class FsAppSource extends FsTree implements AppSource {
  readonly evals: FileTree

  constructor(appDir: string) {
    super(join(appDir, 'code'))
    this.evals = new FsTree(join(appDir, 'evals'))
  }
}

/**
 * Kernel state in a directory: `<collection>/<id>.json`, `blobs/<sha256>`, `materialized/<app>/<id>-<fp>`.
 * With a remote `BlobStore` the remote is where blobs live and `blobs/` is a cache in front of it.
 */
export class FsStore implements Store {
  readonly root: string
  readonly #remote: BlobStore | null
  readonly #materializing = new Map<string, Promise<string>>()

  constructor(root: string, options: { blobs?: BlobStore } = {}) {
    this.root = root
    this.#remote = options.blobs ?? null
  }

  /** Where blobs live: `local`, or the remote store's name. */
  get blobStore(): string {
    return this.#remote?.name ?? 'local'
  }

  async #cached(hash: string): Promise<string> {
    const path = join(this.root, 'blobs', hash)
    try {
      await stat(path)
    } catch {
      if (!this.#remote) throw Object.assign(new Error(`没有内容 ${hash}`), { code: 'ENOENT' })
      const bytes = await this.#remote.get(hash)
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, path)
    }
    return path
  }

  #doc(collection: string, id: string): string {
    return join(this.root, collection, `${encodeURIComponent(id)}.json`)
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.#doc(collection, id), 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async put(collection: string, id: string, doc: unknown): Promise<void> {
    const path = this.#doc(collection, id)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    await rename(tmp, path)
  }

  async list<T>(collection: string): Promise<T[]> {
    let names: string[]
    try {
      names = await readdir(join(this.root, collection))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const out: T[] = []
    for (const name of names.sort()) if (name.endsWith('.json')) out.push(JSON.parse(await readFile(join(this.root, collection, name), 'utf8')) as T)
    return out
  }

  async putBlob(content: Uint8Array): Promise<string> {
    const hash = hashContent(content)
    const path = join(this.root, 'blobs', hash)
    let local = true
    try {
      await stat(path)
    } catch {
      local = false
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    }
    if (this.#remote && (!local || !(await this.#remote.has(hash)))) await this.#remote.put(hash, content)
    return hash
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw Object.assign(new Error(`没有内容 ${hash}`), { code: 'ENOENT' })
    return readFile(await this.#cached(hash))
  }

  async materialize(release: Release): Promise<string> {
    const dir = join(this.root, 'materialized', release.app, `${release.id}-${release.fingerprint.slice(0, 8)}`)
    const running = this.#materializing.get(dir)
    if (running) return running
    const work = this.#materialize(release, dir).finally(() => this.#materializing.delete(dir))
    this.#materializing.set(dir, work)
    return work
  }

  async #materialize(release: Release, dir: string): Promise<string> {
    const done = () =>
      stat(join(dir, 'app.json')).then(
        () => true,
        () => false,
      )
    if (await done()) return dir
    const tmp = `${dir}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      for (const [path, hash] of Object.entries(release.files)) {
        const target = join(tmp, path)
        await mkdir(dirname(target), { recursive: true })
        const blob = await this.#cached(hash)
        try {
          await link(blob, target)
        } catch {
          await copyFile(blob, target)
        }
      }
      // another process may have finished it meanwhile; a complete directory is never replaced
      if (await done()) return dir
      await rm(dir, { recursive: true, force: true })
      try {
        await rename(tmp, dir)
      } catch (error) {
        if (!(await done())) throw error
      }
      return dir
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }

  async next(counter: string): Promise<number> {
    return this.exclusive(`counter:${counter}`, async () => {
      const n = ((await this.get<{ n: number }>('counters', counter))?.n ?? 0) + 1
      await this.put('counters', counter, { n })
      return n
    })
  }

  /** Locks within this process; a directory store is not shared between processes. */
  exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return localLocks.run(`${this.root}\0${key}`, fn)
  }
}

/** Reentrant in-process locks keyed by name: a call chain that holds a key may take it again. */
export class LocalLocks {
  readonly #tails = new Map<string, Promise<void>>()
  readonly #held = new AsyncLocalStorage<Set<string>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const held = this.#held.getStore()
    if (held?.has(key)) return fn()
    const previous = this.#tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((resolve) => (release = resolve))
    const tail = previous.then(() => mine)
    this.#tails.set(key, tail)
    await previous
    try {
      return await this.#held.run(new Set([...(held ?? []), key]), fn)
    } finally {
      release()
      if (this.#tails.get(key) === tail) this.#tails.delete(key)
    }
  }
}

const localLocks = new LocalLocks()
