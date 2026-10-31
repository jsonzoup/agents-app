/**
 * Runs apps' web applications. An app's `web/` is a full-stack Next.js project with its own
 * `.env`; each version of it is built once into its own directory and served by its own
 * `next start` on a loopback port. The platform proxies `/apps/<app>/v/<version>/…` (and a
 * build session's workspace at `/apps/<app>/w/<session>/…`) to it after checking access, and
 * tells it who is calling. Dependencies are installed once per package.json + lockfile.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { FsTree } from '../../rsi-kernel/src/index.ts'
import type { User } from './rbac.ts'

/** One deployable web application: a version of an app's `web/`, or a workspace's. */
export interface WebSite {
  /** URL prefix the application is mounted at and built for (its `basePath`), e.g. `/apps/notes/v/r4`. */
  base: string
  /** Changes whenever the project's files do. */
  fingerprint: string
  /** Directory holding the project (`package.json`, `next.config.ts`, `.env`, …); called only when a build is needed. */
  source: () => Promise<string>
  /** How the application reaches the platform; baked into the build. */
  env: Record<string, string>
  /** The app's own database, cache, queue and bucket (server-side variables, never in the fingerprint); asked for at every start. */
  resources?: () => Promise<Record<string, string>>
}

export type WebStatus =
  | { state: 'idle' }
  | { state: 'building'; step: string; log: string[] }
  | { state: 'ready'; log: string[] }
  | { state: 'failed'; error: string; log: string[] }

interface Running {
  fingerprint: string
  status: WebStatus
  ready: Promise<number>
  child: ChildProcess | null
  used: number
}

/** Environment the platform passes to app processes: enough to run node and npm, none of the platform's own secrets. */
function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER', 'TZ'].includes(k) || /^(HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|NPM_CONFIG_.*|npm_config_registry)$/.test(k)) out[k] = v
  }
  out.NEXT_TELEMETRY_DISABLED = '1'
  return out
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

/** The web directory an app.json declares (`"web": "web"`), or null. */
export function webOf(manifest: { web?: unknown }): string | null {
  return typeof manifest.web === 'string' && /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(manifest.web) ? manifest.web : null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export class WebHost {
  readonly #root: string
  readonly #maxRunning: number
  readonly #sites = new Map<string, Running>()
  readonly #deps = new Map<string, Promise<string>>()
  #building: Promise<unknown> = Promise.resolve()

  /** @param root - where builds, dependency caches and logs live (e.g. `<home>/.rsi/web`). */
  constructor(root: string, options: { maxRunning?: number } = {}) {
    this.#root = root
    this.#maxRunning = options.maxRunning ?? 6
    mkdirSync(root, { recursive: true })
    this.#reap()
    const stop = () => {
      for (const s of this.#sites.values()) s.child?.kill('SIGTERM')
    }
    process.once('exit', stop)
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => (stop(), process.exit(130)))
  }

  /** Servers a previous platform process left behind (it was killed without cleaning up). */
  #reap() {
    const file = join(this.#root, 'pids.json')
    try {
      for (const pid of JSON.parse(readFileSync(file, 'utf8')) as number[]) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // already gone
        }
      }
    } catch {
      // nothing recorded
    }
    this.#savePids()
  }

  #savePids() {
    try {
      writeFileSync(join(this.#root, 'pids.json'), JSON.stringify([...this.#sites.values()].map((s) => s.child?.pid).filter(Boolean)))
    } catch {
      // root not created yet
    }
  }

  status(base: string, fingerprint?: string): WebStatus {
    const s = this.#sites.get(base)
    if (!s || (fingerprint && s.fingerprint !== fingerprint)) return { state: 'idle' }
    return s.status
  }

  /** Make sure the site is built and running; returns at once, the work continues in the background. A failed build stays failed until the code changes or {@link rebuild}. */
  ensure(site: WebSite): Running {
    const current = this.#sites.get(site.base)
    if (current && current.fingerprint === site.fingerprint) {
      current.used = Date.now()
      return current
    }
    current?.child?.kill('SIGTERM')
    const running: Running = { fingerprint: site.fingerprint, status: { state: 'building', step: '排队', log: [] }, ready: Promise.resolve(0), child: null, used: Date.now() }
    running.ready = this.#start(site, running)
    running.ready.catch((error: Error) => {
      running.status = { state: 'failed', error: error.message, log: running.status.state === 'idle' ? [] : running.status.log }
    })
    this.#sites.set(site.base, running)
    this.#evict()
    return running
  }

  /** Rebuild from scratch: drops the built directory, keeps the dependency cache. */
  async rebuild(site: WebSite) {
    this.#sites.get(site.base)?.child?.kill('SIGTERM')
    this.#sites.delete(site.base)
    await rm(this.#dir(site), { recursive: true, force: true })
    return this.ensure(site)
  }

  #evict() {
    const live = [...this.#sites.entries()].filter(([, s]) => s.child).sort((a, b) => a[1].used - b[1].used)
    while (live.length > this.#maxRunning) {
      const [base, s] = live.shift()!
      s.child?.kill('SIGTERM')
      this.#sites.delete(base)
    }
  }

  #dir(site: WebSite) {
    const slug = site.base.replace(/^\/+/, '').replace(/[^a-zA-Z0-9_-]+/g, '_')
    return join(this.#root, 'sites', slug, site.fingerprint.slice(0, 16))
  }

  async #start(site: WebSite, running: Running): Promise<number> {
    const dir = this.#dir(site)
    const log: string[] = []
    const logFile = join(dir, 'rsi-web.log')
    const step = (name: string) => {
      running.status = { state: 'building', step: name, log }
    }
    const say = (line: string) => {
      for (const l of line.split('\n')) if (l.trim()) log.push(l)
      if (log.length > 400) log.splice(0, log.length - 400)
      void appendFile(logFile, `${line}\n`).catch(() => {})
    }
    const env = { ...baseEnv(), ...site.env, RSI_BASE_PATH: site.base }
    if (site.resources) {
      step('开通应用资源')
      Object.assign(env, await site.resources(), site.env, { RSI_BASE_PATH: site.base })
      say('已接入应用自己的数据库、缓存、队列和对象存储（变量见 web.md）')
    }

    if (!existsSync(join(dir, '.rsi-built'))) {
      await (this.#building = this.#building.catch(() => {}).then(async () => {
        await rm(dir, { recursive: true, force: true })
        await mkdir(dir, { recursive: true })
        step('复制代码')
        const src = await site.source()
        const tree = new FsTree(src)
        for (const path of await tree.list()) {
          await mkdir(dirname(join(dir, path)), { recursive: true })
          await copyFile(join(src, path), join(dir, path))
        }
        if (!existsSync(join(dir, 'package.json'))) throw new Error('web 目录里没有 package.json')
        step('安装依赖')
        const deps = await this.#install(dir, say)
        await this.#clone(join(deps, 'node_modules'), join(dir, 'node_modules'))
        step('构建（next build）')
        say(`$ next build  (basePath ${site.base})`)
        await this.#run(process.execPath, [join(dir, 'node_modules/next/dist/bin/next'), 'build'], dir, { ...env, NODE_ENV: 'production' }, say)
        await writeFile(join(dir, '.rsi-built'), new Date().toISOString())
      }))
    } else {
      say('已构建过，直接启动')
    }

    step('启动')
    const port = await freePort()
    say(`$ next start -p ${port}`)
    const child = spawn(process.execPath, [join(dir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: dir, env: { ...env, NODE_ENV: 'production', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    running.child = child
    this.#savePids()
    child.stdout!.on('data', (b: Buffer) => say(b.toString()))
    child.stderr!.on('data', (b: Buffer) => say(b.toString()))
    let exited: string | null = null
    child.on('exit', (code, signal) => {
      exited = `进程退出（${signal ?? code}）`
      say(exited)
      running.child = null
      if (running.status.state === 'ready') running.status = { state: 'failed', error: exited, log }
      if (this.#sites.get(site.base) === running) this.#sites.delete(site.base)
      this.#savePids()
    })
    for (let i = 0; i < 120; i++) {
      if (exited) throw new Error(`启动失败：${exited}`)
      try {
        await fetch(`http://127.0.0.1:${port}${site.base}`, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
        running.status = { state: 'ready', log }
        return port
      } catch {
        await sleep(500)
      }
    }
    child.kill('SIGTERM')
    throw new Error('启动超时（60 秒）')
  }

  /** node_modules for a package.json + lockfile, installed once and shared by every build that has the same ones. */
  async #install(dir: string, say: (line: string) => void): Promise<string> {
    const pkg = await readFile(join(dir, 'package.json'))
    const lock = await readFile(join(dir, 'package-lock.json')).catch(() => null)
    const parsed = JSON.parse(pkg.toString()) as Record<string, unknown>
    const key = createHash('sha256').update(JSON.stringify([parsed.dependencies, parsed.devDependencies, parsed.overrides])).update(lock ?? '').digest('hex').slice(0, 16)
    const target = join(this.#root, 'deps', key)
    if (!this.#deps.has(key)) {
      const work = (async () => {
        if (existsSync(join(target, '.rsi-ok'))) return target
        const tmp = `${target}.${process.pid}.tmp`
        await rm(tmp, { recursive: true, force: true })
        await mkdir(tmp, { recursive: true })
        await writeFile(join(tmp, 'package.json'), pkg)
        if (lock) await writeFile(join(tmp, 'package-lock.json'), lock)
        say(lock ? '$ npm ci' : '$ npm install')
        await this.#run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund', '--loglevel=error', '--include=dev'], tmp, baseEnv(), say)
        await writeFile(join(tmp, '.rsi-ok'), new Date().toISOString())
        await rm(target, { recursive: true, force: true })
        await rename(tmp, target)
        return target
      })()
      work.catch(() => this.#deps.delete(key))
      this.#deps.set(key, work)
    } else say('依赖已安装过，复用')
    return this.#deps.get(key)!
  }

  /** Copy a dependency tree; copy-on-write where the filesystem can. */
  async #clone(from: string, to: string) {
    const args = process.platform === 'darwin' ? ['-cR', from, to] : ['-R', '--reflink=auto', from, to]
    try {
      await this.#run('cp', args, dirname(to), baseEnv(), () => {})
    } catch {
      await this.#run('cp', ['-R', from, to], dirname(to), baseEnv(), () => {})
    }
  }

  #run(cmd: string, args: string[], cwd: string, env: Record<string, string>, say: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', (b: Buffer) => say(b.toString()))
      child.stderr.on('data', (b: Buffer) => say(b.toString()))
      child.on('error', reject)
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} 失败（退出码 ${code}）`))))
    })
  }

  /**
   * Forward a request to the site, as `user`. While the site builds, pages get a holding page
   * that refreshes itself.
   */
  async proxy(site: WebSite, req: Request, user: User): Promise<Response> {
    const running = this.ensure(site)
    const status = running.status
    if (status.state !== 'ready') {
      const accept = req.headers.get('accept') ?? ''
      if (req.method !== 'GET' || !accept.includes('text/html')) return Response.json({ error: status.state === 'failed' ? status.error : '应用正在构建' }, { status: 503 })
      return new Response(holdingPage(status), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
    }
    const port = await running.ready
    running.used = Date.now()
    const url = new URL(req.url)
    const headers = new Headers()
    for (const [k, v] of req.headers) {
      if (['host', 'connection', 'cookie', 'accept-encoding', 'content-length'].includes(k) || k.startsWith('x-rsi-')) continue
      headers.set(k, v)
    }
    const cookies = (req.headers.get('cookie') ?? '').split(/;\s*/).filter((c) => c && !c.startsWith('rsi_session='))
    if (cookies.length) headers.set('cookie', cookies.join('; '))
    headers.set('x-rsi-user-id', user.id)
    headers.set('x-rsi-user-name', encodeURIComponent(user.name))
    headers.set('x-rsi-user-roles', user.roles.join(','))
    headers.set('x-forwarded-host', url.host)
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''))
    const hasBody = !['GET', 'HEAD'].includes(req.method)
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual', ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit)
    } catch (error) {
      return Response.json({ error: `应用没有响应：${(error as Error).message}` }, { status: 502 })
    }
    const out = new Headers(res.headers)
    out.delete('content-encoding')
    out.delete('content-length')
    out.delete('transfer-encoding')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
  }
}

function holdingPage(status: WebStatus): string {
  const failed = status.state === 'failed'
  const title = failed ? '应用启动失败' : status.state === 'building' ? `应用正在准备：${status.step}` : '应用正在准备'
  const log = status.state === 'idle' ? [] : status.log.slice(-40)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${failed ? '' : '<meta http-equiv="refresh" content="3">'}<title>${escape(title)}</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:0;padding:32px;color:#334155;background:#f8fafc}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 16px;color:#64748b}pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;font-size:12px;overflow:auto;max-height:60vh;white-space:pre-wrap}</style></head>
<body><h1>${escape(title)}</h1><p>${failed ? escape((status as { error: string }).error) : '第一次打开某个版本时要安装依赖并构建，通常一两分钟；页面会自动刷新。'}</p>${log.length ? `<pre>${escape(log.join('\n'))}</pre>` : ''}</body></html>`
}
