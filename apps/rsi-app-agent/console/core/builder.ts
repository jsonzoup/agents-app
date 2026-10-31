/**
 * The app coding assistant: a person describes an app, a harness agent writes it in a
 * workspace while they talk, and the person checks, tests and publishes it.
 *
 * The agent is defined by `builder/` in the platform (its AGENTS.md, skills and an MCP check
 * tool) and runs through the harness's headless profile; each message is one turn on the
 * same harness session. A workspace is an app folder (`code/`, `evals/`):
 * - new app: starts from a skeleton; publishing installs it as the app's first release;
 * - existing app: starts from the stable release; publishing becomes a proposal (knowledge
 *   and code tiers, verified and approved as usual) or, when contract files change, a
 *   reviewed human import. Changes to `evals/` are saved as a new evaluation-set snapshot
 *   by the manager who publishes; that click is the human confirmation of what the agent drafted.
 *
 * The agent's own tools (`builder/mcp/server.ts`) reach back through a loopback bridge with a
 * per-session token: to test the workspace and to ask the person for files it needs.
 */

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FsAppSource, hashContent, isProductSignal, parseManifest, tierOf } from '../../rsi-kernel/src/index.ts'
import type { RsiKernel, SuiteResult } from '../../rsi-kernel/src/index.ts'
import { agentPatch, headlessTurn } from '../../rsi-harness/src/index.ts'
import type { TurnHandle } from '../../rsi-harness/src/index.ts'
import type { Console } from './console.ts'
import { mimeOf } from './console.ts'
import type { HarnessStatus } from './executor.ts'
import { AccessError, hasSystem, levelOf } from './rbac.ts'
import type { User } from './rbac.ts'
import { BuildPreview } from './preview.ts'
import { seedProblems, skeletonApp } from './scaffold.ts'
import { checkWorkspace, workspaceFiles } from './workspace.ts'
import { leaves, parsePath, setPath } from './paths.ts'
import { readZip } from './zip.ts'
import { webTemplate } from './webtemplate.ts'
import type { DirMirror } from './storage.ts'
import type { JobContext } from './cluster.ts'

const MCP_HELPER = fileURLToPath(new URL('../../rsi-kernel/src/mcp-server.ts', import.meta.url))
const BUILDER = fileURLToPath(new URL('../../builder/', import.meta.url))

export interface Activity {
  id: string
  name: string
  detail: string
  ok: boolean | null
}

export interface BuildMessage {
  id: string
  role: 'user' | 'assistant'
  at: string
  by?: string
  text: string
  activity?: Activity[]
  running?: boolean
  error?: string | null
}

export interface BuildSession {
  id: string
  app: string
  title: string
  goal: string
  mode: 'new' | 'existing'
  /** Release the workspace started from (existing apps). */
  base: string | null
  /** Evaluation-set snapshot the workspace's `evals/` started from (existing apps). */
  evalsBase?: string | null
  /** Issue this session resolves; the proposal it publishes is linked to it. */
  issue: string | null
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
  harnessSession: string | null
  running: boolean
  messages: BuildMessage[]
  /** Files a person edited by hand since the agent's last turn. */
  edited: string[]
  published: { at: string; by: string; kind: 'install' | 'proposal' | 'import' | 'evals'; release?: string; proposal?: string; evalset?: string } | null
  /** The latest test of the workspace, by a person or by the assistant. */
  lastTest?: TestRecord | null
  /** Revision of the workspace in the bucket, when workspaces are shared between instances. */
  workspaceRev?: string | null
  /** The turn in progress: queued, then kept fresh by the instance working on it. */
  turn?: { queuedAt: string; beat: string | null; instance: string | null } | null
  /** Machine whose harness holds `harnessSession`; another machine starts a new one with the context. */
  harnessHost?: string | null
}

export interface TestRecord {
  at: string
  by: string
  executor: string
  /** Case ids tested; null for every case. */
  cases: string[] | null
  dev: SuiteResult
  holdout: SuiteResult
}

/**
 * Something the assistant asked the person for, kept beside the session: files to upload, or
 * (`kind: 'confirm'`) whether a real run's result is what they expect for one case.
 */
export interface FileRequest {
  id: string
  at: string
  title: string
  why: string
  /** Workspace folder the files go into, e.g. `evals/cases/c1/input/`; for a confirmation, the case's folder. */
  target: string
  accept: string | null
  multiple: boolean
  status: 'open' | 'done' | 'declined'
  files: string[]
  note?: string
  kind?: 'confirm'
  /** The case whose input was run. */
  case?: string
  /** The run's output as path → value, in output order. */
  fields?: { path: string; value: unknown }[]
  run?: { status: string; ms: number; note?: string }
  /** The run's output as it came, so a confirmed result can become the case's reference run. */
  output?: unknown
  answer?: 'yes' | 'no'
  /** Values the person changed or added; the corrected result became the case's expected value. */
  corrections?: { path: string; was: unknown; value: unknown }[]
}

export interface BuilderOptions {
  console: Console
  /** `<home>/.rsi/builder`. */
  root: string
  harness: HarnessStatus
  /** A kernel over a throwaway store, for testing a workspace with the platform's executor and judges. */
  scratchKernel: (storeDir: string, workspace?: { app: string; root: string }) => RsiKernel
  now?: () => string
  /** Called after a new app is installed into the home, e.g. to link its UI into the console build. */
  onAppAdded?: (app: string) => Promise<void> | void
  /** Save files into an installed app's evaluation set as one snapshot (the bench's `write`). */
  saveEvals?: (app: string, user: User, writes: { path: string; bytes: Uint8Array | null }[], note: string) => Promise<{ evalset: string }>
  /** Where workspaces are kept for every instance; local only when absent. */
  mirror?: DirMirror | null
}

/** A turn whose instance has not been heard from for this long has stopped. */
const TURN_STALE = 90_000
const TURN_BEAT = 15_000

const TOOL_TIMEOUT = 20 * 60_000

const short = (v: unknown, max = 140) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v) ?? ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export class Builder {
  readonly harness: HarnessStatus
  readonly #console: Console
  readonly #root: string
  readonly #scratch: BuilderOptions['scratchKernel']
  readonly #now: () => string
  readonly #turns = new Map<string, TurnHandle>()
  /** Turns queued by this instance that no instance has started yet. */
  readonly #pending = new Set<string>()

  readonly #onAppAdded?: (app: string) => Promise<void> | void
  readonly #saveEvals?: BuilderOptions['saveEvals']
  readonly #mirror: DirMirror | null
  #bridge: Promise<string> | null = null
  readonly #tokens = new Map<string, { session: string; user: string }>()
  /** Trying the session's app (its UI and tasks) before publishing. */
  readonly preview: BuildPreview

  constructor(options: BuilderOptions) {
    this.#console = options.console
    this.#root = options.root
    this.harness = options.harness
    this.#scratch = options.scratchKernel
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#onAppAdded = options.onAppAdded
    this.#saveEvals = options.saveEvals
    this.#mirror = options.mirror ?? null
    this.#console.jobs.handle('builder.turn', (payload, job) => this.#turn(payload as unknown as TurnJob, job))
    this.#console.jobs.subscribe((event) => {
      if (event.type === 'turn.cancel' && typeof event.session === 'string') this.#turns.get(event.session)?.cancel()
    })
    this.preview = new BuildPreview({
      console: options.console,
      session: (user, id) => this.#get(user, id),
      dir: (id) => this.#dir(id),
      scratch: (dir, workspace) => this.#scratch(dir, workspace),
      now: () => this.#now(),
    })
  }

  // ── storage ───────────────────────────────────────────────────

  #dir(id: string): string {
    if (!/^b-[a-z0-9]+$/.test(id)) throw new AccessError(`没有会话 ${id}`, 404)
    return join(this.#root, id)
  }

  workspace(id: string): string {
    return join(this.#dir(id), 'workspace')
  }

  async #load(id: string): Promise<BuildSession> {
    const docs = this.#console.docs
    if (docs) {
      this.#dir(id)
      const found = await docs.get<BuildSession>('builder.sessions', id)
      if (!found) throw new AccessError(`没有会话 ${id}`, 404)
      return found
    }
    try {
      return JSON.parse(await readFile(join(this.#dir(id), 'session.json'), 'utf8')) as BuildSession
    } catch {
      throw new AccessError(`没有会话 ${id}`, 404)
    }
  }

  /** Save the session; with `workspace`, first put the workspace where other instances find it. */
  async #save(s: BuildSession, options: { workspace?: boolean } = {}): Promise<void> {
    s.updatedAt = this.#now()
    if (options.workspace && this.#mirror) s.workspaceRev = await this.#mirror.push(s.id, this.workspace(s.id))
    const docs = this.#console.docs
    if (docs) return docs.put('builder.sessions', s.id, s)
    await mkdir(this.#dir(s.id), { recursive: true })
    const file = join(this.#dir(s.id), 'session.json')
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, JSON.stringify(s, null, 2))
    await rename(tmp, file)
  }

  async #canView(user: User, s: BuildSession): Promise<boolean> {
    if (s.createdBy === user.id) return true
    const dir = await this.#console.directory()
    if (hasSystem(dir, user, 'app.all')) return true
    return s.mode === 'existing' && levelOf(dir, s.app, user) === 'manage'
  }

  async #get(user: User, id: string): Promise<BuildSession> {
    const s = await this.#load(id)
    if (!(await this.#canView(user, s))) throw new AccessError('这是别人的创建会话')
    if (s.running && !this.#alive(s)) {
      // the process that ran this turn is gone (server restart)
      s.running = false
      s.turn = null
      const last = s.messages.at(-1)
      if (last?.running) Object.assign(last, { running: false, error: last.error ?? '服务重启，这一轮被中断' })
      await this.#save(s)
    }
    if (this.#mirror && !this.#turns.has(s.id)) await this.#mirror.pull(s.id, this.workspace(s.id), s.workspaceRev)
    return s
  }

  /** Whether the session's turn is still being worked on, here or by another instance. */
  #alive(s: BuildSession): boolean {
    if (this.#turns.has(s.id) || this.#pending.has(s.id)) return true
    if (this.#console.jobs.driver === 'inline' || !s.turn) return false
    if (s.turn.beat) return Date.now() - Date.parse(s.turn.beat) < TURN_STALE
    return true
  }

  // ── sessions ──────────────────────────────────────────────────

  async list(user: User) {
    const out: BuildSession[] = []
    const docs = this.#console.docs
    if (docs) {
      for (const s of await docs.list<BuildSession>('builder.sessions')) if (await this.#canView(user, s)) out.push(s)
    } else if (existsSync(this.#root)) {
      for (const name of await readdir(this.#root)) {
        const s = await this.#load(name).catch(() => null)
        if (s && (await this.#canView(user, s))) out.push(s)
      }
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return Promise.all(
      out.map(async (s) => ({
        id: s.id,
        app: s.app,
        title: s.title,
        mode: s.mode,
        createdByName: s.createdByName,
        updatedAt: s.updatedAt,
        running: s.running && this.#alive(s),
        published: s.published,
        messages: s.messages.length,
        waiting: (await this.#requests(s.id)).filter((r) => r.status === 'open').length,
      })),
    )
  }

  #newId(): string {
    return `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  }

  /** Start building a new app from a name, a title and a goal; the first turn starts at once when the harness is available. */
  async create(user: User, body: { name: string; title: string; goal: string }) {
    const dir = await this.#console.directory()
    if (!hasSystem(dir, user, 'app.create')) throw new AccessError('没有创建应用的权限')
    const seed = { name: body.name?.trim(), title: body.title?.trim(), goal: body.goal?.trim() }
    const problems = seedProblems(seed)
    if (problems.length) throw new AccessError(problems.join('；'), 400)
    if (this.#console.appExists(seed.name)) throw new AccessError(`应用标识 ${seed.name} 已被占用`, 409)
    const id = this.#newId()
    const ws = this.workspace(id)
    for (const [path, text] of Object.entries(skeletonApp(seed, await readFile(MCP_HELPER, 'utf8')))) {
      await mkdir(dirname(join(ws, path)), { recursive: true })
      await writeFile(join(ws, path), text)
    }
    for (const [path, bytes] of Object.entries(await webTemplate())) {
      await mkdir(dirname(join(ws, 'code/web', path)), { recursive: true })
      await writeFile(join(ws, 'code/web', path), bytes)
    }
    await cp(join(BUILDER, 'AGENTS.md'), join(ws, 'AGENTS.md'))
    const s: BuildSession = {
      id,
      app: seed.name,
      title: seed.title,
      goal: seed.goal,
      mode: 'new',
      base: null,
      issue: null,
      createdBy: user.id,
      createdByName: user.name,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      harnessSession: null,
      running: false,
      messages: [],
      edited: [],
      published: null,
    }
    await this.#save(s, { workspace: true })
    if (this.harness.available) await this.send(user, id, `请创建这个应用。\n\n应用名称：${seed.title}\n应用标识：${seed.name}\n目标与需求：\n${seed.goal}`)
    return this.view(user, id)
  }

  /**
   * Open a build session from an app archive (see `Console.exportApp`): a new app when its name
   * is free, otherwise a change to the existing app from its stable version. The archive's
   * `code/` and `evals/` become the workspace; checking, testing and publishing stay with people.
   */
  async importArchive(user: User, fileName: string, bytes: Uint8Array) {
    let entries
    try {
      entries = readZip(bytes)
    } catch (error) {
      throw new AccessError(`压缩包读不了：${(error as Error).message}`, 400)
    }
    const found = entries.filter((e) => e.path === 'code/app.json' || e.path.endsWith('/code/app.json')).sort((a, b) => a.path.length - b.path.length)[0]
    if (!found) throw new AccessError('压缩包里没有 code/app.json：要导入的是应用目录（code/ 和 evals/）', 400)
    const prefix = found.path.slice(0, -'code/app.json'.length)
    let manifest
    try {
      manifest = parseManifest(JSON.parse(new TextDecoder().decode(found.bytes)))
    } catch (error) {
      throw new AccessError(`压缩包里的 app.json 有问题：${(error as Error).message}`, 400)
    }
    const meta = (() => {
      const e = entries.find((x) => x.path === `${prefix}rsi-export.json`)
      try {
        return e ? (JSON.parse(new TextDecoder().decode(e.bytes)) as { app?: string; version?: string; exportedBy?: string; exportedAt?: string }) : null
      } catch {
        return null
      }
    })()
    const files = entries
      .filter((e) => e.path.startsWith(prefix))
      .map((e) => ({ path: e.path.slice(prefix.length), bytes: e.bytes }))
      .filter((e) => e.path.startsWith('code/') || e.path.startsWith('evals/'))
    const app = manifest.name
    const dir = await this.#console.directory()
    const exists = this.#console.appExists(app)
    if (exists && levelOf(dir, app, user) !== 'manage') throw new AccessError(`应用 ${app} 已存在，你没有它的管理权限，不能导入新版本`)
    if (!exists) {
      if (!hasSystem(dir, user, 'app.create')) throw new AccessError('没有创建应用的权限')
      const problems = seedProblems({ name: app, title: manifest.title, goal: '导入' })
      if (problems.length) throw new AccessError(problems.join('；'), 400)
    }
    const id = this.#newId()
    const ws = this.workspace(id)
    for (const f of files) {
      await mkdir(dirname(join(ws, f.path)), { recursive: true })
      await writeFile(join(ws, f.path), f.bytes)
    }
    await mkdir(join(ws, 'evals'), { recursive: true })
    await cp(join(BUILDER, 'AGENTS.md'), join(ws, 'AGENTS.md'))
    const origin = meta?.app && meta.version ? `（${meta.exportedBy ?? '有人'}${meta.exportedAt ? ` 于 ${meta.exportedAt.slice(0, 10)} ` : ''}导出自 ${meta.app} 的 ${meta.version}）` : ''
    const stable = exists ? await this.#console.kernel.stable(app) : null
    const s: BuildSession = {
      id,
      app,
      title: manifest.title,
      goal: `导入压缩包 ${fileName}${origin}${exists ? `，作为 ${app} 的新版本（起始版本 ${stable!.id}）` : '，作为新应用'}。请检查、测试后发布。`,
      mode: exists ? 'existing' : 'new',
      base: stable?.id ?? null,
      ...(exists ? { evalsBase: this.#console.kernel.app(app).evalset } : {}),
      issue: null,
      createdBy: user.id,
      createdByName: user.name,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      harnessSession: null,
      running: false,
      messages: [],
      edited: files.filter((f) => f.path.startsWith('code/')).map((f) => f.path),
      published: null,
    }
    await this.#save(s, { workspace: true })
    return this.view(user, id)
  }

  /** What people said about an issue, as a request the assistant can act on; the full context goes into the workspace. */
  async #issueRequest(app: string, issueId: string, ws: string): Promise<string> {
    const issue = (await this.#console.kernel.issues(app)).find((i) => i.id === issueId)
    if (!issue) throw new AccessError(`没有问题 ${issueId}`, 404)
    const signals = (await this.#console.kernel.signals(app)).filter((x) => issue.signals.includes(x.id))
    await mkdir(join(ws, 'signals'), { recursive: true })
    await writeFile(join(ws, 'signals', `${issueId}.json`), JSON.stringify({ issue, signals }, null, 2))
    for (const a of signals.flatMap((x) => x.attachments ?? [])) {
      const bytes = await this.#console.files.read(a.path).catch(() => null)
      if (bytes) await writeFile(join(ws, 'signals', `${issueId}-${a.name}`), bytes)
    }
    const scope = issue.scope.level === 'scope' ? `只对 ${issue.scope.key}=${issue.scope.value}` : issue.scope.level === 'app' ? '对所有任务' : '只这一单'
    const what = (x: (typeof signals)[number]) =>
      x.target?.level === 'ui'
        ? `界面建议（页面 ${x.target.path ?? '/'}${x.target.label ? `，${x.target.label}` : ''}）`
        : x.target?.level === 'feature'
          ? '功能建议'
          : x.kind === 'suggestion'
            ? `建议（${x.target?.label ?? (x.target?.level === 'task' ? '整单' : x.target?.path ?? '')}）`
            : x.field
              ? `${x.field} 从「${x.before ?? ''}」改成「${x.after ?? ''}」`
              : x.kind
    const lines = signals.map((x) => `- ${x.by}：${what(x)}${x.note ? `，说明：${x.note}` : ''}（版本 ${x.release}）`)
    if (signals.some(isProductSignal)) {
      return [
        `使用者对应用的界面或功能提了建议：${issue.summary}。`,
        ...lines,
        '',
        `每条建议的附件（常是截图）和当时所在的页面、单据在工作区 signals/${issueId}.json 及同目录的附件里，请先看再动手。`,
        '这类建议改的是应用的代码：页面、交互和服务端接口在 code/web/。先说清你打算怎么改、改哪些页面，再动手；改完跑检查和测试，并请用户在预览里试用。',
        '如果要做到需要改契约（任务的输入输出结构）或评测，先停下来告诉用户为什么，由用户决定；不要自己改。',
      ].join('\n')
    }
    return [
      `使用者的反馈归成了一个问题：${issue.summary}（范围：${scope}）。`,
      ...lines,
      '',
      `每条反馈当时的完整单据（输入、应用的输出、人工修正、附件）在工作区 signals/${issueId}.json，请先读它再动手。`,
      '请改应用的知识、技能或界面（不要改契约和评测），让以后的结果符合这些反馈；范围知识写进 scopes/<键>/<值>/AGENTS.md。',
    ].join('\n')
  }

  /** Start changing an existing app with the assistant, from its stable release; optionally to resolve one issue. */
  async open(user: User, app: string, goal: string, issue?: string) {
    const dir = await this.#console.directory()
    if (levelOf(dir, app, user) !== 'manage') throw new AccessError(`没有 ${app} 的管理权限`)
    const stable = await this.#console.kernel.stable(app)
    const id = this.#newId()
    const ws = this.workspace(id)
    await mkdir(ws, { recursive: true })
    if (issue) goal = `${await this.#issueRequest(app, issue, ws)}${goal?.trim() ? `\n\n补充：${goal.trim()}` : ''}`
    await cp(await this.#console.materialize(app, stable.id), join(ws, 'code'), { recursive: true })
    const evals = this.#console.kernel.app(app).source.evals.root
    if (existsSync(evals)) await cp(evals, join(ws, 'evals'), { recursive: true })
    await cp(join(BUILDER, 'AGENTS.md'), join(ws, 'AGENTS.md'))
    const manifest = this.#console.kernel.app(app).manifest
    const s: BuildSession = {
      id,
      app,
      title: manifest.title,
      goal: goal?.trim() ?? '',
      mode: 'existing',
      base: stable.id,
      evalsBase: this.#console.kernel.app(app).evalset,
      issue: issue ?? null,
      createdBy: user.id,
      createdByName: user.name,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      harnessSession: null,
      running: false,
      messages: [],
      edited: [],
      published: null,
    }
    await this.#save(s, { workspace: true })
    if (this.harness.available && s.goal) await this.send(user, id, `这是已发布的应用「${manifest.title}」（${app}，版本 ${stable.id}）。请按下面的要求修改：\n\n${s.goal}`)
    return this.view(user, id)
  }

  /** What the agent needs to know when a conversation reaches it without an earlier harness session. */
  #context(s: BuildSession): string {
    const what = s.mode === 'new' ? `你在创建应用「${s.title}」（标识 ${s.app}）。` : `你在修改已发布的应用「${s.title}」（${s.app}，基于版本 ${s.base}）。`
    return `${what}${s.goal ? `\n目标与需求：\n${s.goal}` : ''}\n工作区里已有的文件是之前的进度，请先看一下。`
  }

  async view(user: User, id: string) {
    const s = await this.#get(user, id)
    return { ...s, files: await workspaceFiles(this.workspace(id)), requests: await this.#requests(id), harness: { available: this.harness.available, note: this.harness.note } }
  }

  // ── the assistant's tools ─────────────────────────────────────

  /** Loopback endpoint the assistant's MCP tools call, started on first use. @returns its base URL. */
  #bridgeUrl(): Promise<string> {
    this.#bridge ??= new Promise<string>((resolveUrl, reject) => {
      const server: Server = createServer((req, res) => {
        const reply = (code: number, body: unknown) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(body))
        }
        const grant = this.#tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
        if (!grant) return reply(401, { error: '无效的会话令牌' })
        let raw = ''
        req.on('data', (c: Buffer) => (raw += c.toString()))
        req.on('end', async () => {
          try {
            const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
            const user = await this.#console.user(grant.user)
            if (req.url === '/test') return reply(200, await this.#testFor(user, grant.session, Array.isArray(body.cases) ? (body.cases as string[]) : undefined, '助手'))
            if (req.url === '/confirm') return reply(200, await this.#askConfirm(user, grant.session, String(body.case ?? ''), typeof body.question === 'string' ? body.question : undefined))
            reply(404, { error: `没有 ${req.url}` })
          } catch (error) {
            reply(200, { error: (error as Error).message })
          }
        })
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.unref()
        const address = server.address()
        resolveUrl(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
      })
    })
    return this.#bridge
  }

  /** Environment for the assistant's tools in one session: the bridge and a token acting as this person. */
  async toolEnv(user: User, id: string): Promise<Record<string, string>> {
    await this.#get(user, id)
    return this.#grant(user, id)
  }

  async #grant(user: User, id: string): Promise<Record<string, string>> {
    const token = randomBytes(18).toString('hex')
    for (const [t, g] of this.#tokens) if (g.session === id) this.#tokens.delete(t)
    this.#tokens.set(token, { session: id, user: user.id })
    return { RSI_BUILDER_BRIDGE: await this.#bridgeUrl(), RSI_BUILDER_TOKEN: token }
  }

  #requestsFile(id: string): string {
    return join(this.#dir(id), 'requests.json')
  }

  async #requests(id: string): Promise<FileRequest[]> {
    const docs = this.#console.docs
    if (docs) return (await docs.get<FileRequest[]>('builder.requests', id)) ?? []
    try {
      return JSON.parse(await readFile(this.#requestsFile(id), 'utf8')) as FileRequest[]
    } catch {
      return []
    }
  }

  async #saveRequests(id: string, list: FileRequest[]): Promise<void> {
    const docs = this.#console.docs
    if (docs) return docs.put('builder.requests', id, list)
    await writeFile(this.#requestsFile(id), `${JSON.stringify(list, null, 2)}\n`)
  }

  /** Upload one file for a request into its target folder. */
  async fulfil(user: User, id: string, requestId: string, name: string, bytes: Uint8Array) {
    const list = await this.#requests(id)
    const r = list.find((x) => x.id === requestId)
    if (!r) throw new AccessError(`没有请求 ${requestId}`, 404)
    if (r.status !== 'open') throw new AccessError('这个请求已经处理过', 409)
    const safe = basename(name).replace(/[\\/]/g, '_')
    if (!safe || safe.startsWith('.')) throw new AccessError('文件名不合法', 400)
    const path = `${r.target.replace(/\/?$/, '/')}${safe}`
    await this.upload(user, id, path, bytes)
    if (!r.multiple) r.files = []
    if (!r.files.includes(path)) r.files.push(path)
    await this.#saveRequests(id, list)
    return this.view(user, id)
  }

  /** Close a request, as provided or as unavailable, and tell the assistant in the conversation. */
  async answer(user: User, id: string, requestId: string, body: { declined?: boolean; note?: string }) {
    const list = await this.#requests(id)
    const r = list.find((x) => x.id === requestId)
    if (!r) throw new AccessError(`没有请求 ${requestId}`, 404)
    if (r.status !== 'open') throw new AccessError('这个请求已经处理过', 409)
    if (!body.declined && r.files.length === 0) throw new AccessError('还没有上传文件', 400)
    r.status = body.declined ? 'declined' : 'done'
    r.note = body.note?.trim() || undefined
    await this.#saveRequests(id, list)
    const text = body.declined
      ? `关于「${r.title}」：我暂时提供不了。${r.note ? `说明：${r.note}` : ''}请先用已有的材料继续，并告诉我还缺什么会影响哪些用例。`
      : `「${r.title}」已上传：${r.files.join('、')}。${r.note ? `说明：${r.note}。` : ''}请据此继续。`
    if (this.harness.available) return this.send(user, id, text)
    return this.view(user, id)
  }

  /**
   * Run the workspace's app on one case's input and ask the person whether the result is what
   * they expect. Supersedes an open confirmation for the same case.
   */
  async #askConfirm(user: User, id: string, caseId: string, question?: string) {
    const s = await this.#get(user, id)
    const store = await mkdtemp(join(tmpdir(), 'rsi-confirm-'))
    let run
    try {
      const kernel = this.#scratch(store, { app: s.app, root: this.workspace(id) })
      const { release, app } = await kernel.install(new FsAppSource(this.workspace(id)), '工作区确认')
      const c = app.cases.find((x) => x.id === caseId)
      if (!c) throw new AccessError(`没有用例 ${caseId}：先写 evals/cases/${caseId}/case.json（真实 input，expected 写 {}）`, 400)
      run = await kernel.runTask(s.app, { input: c.input, caseId, release: release.id })
    } finally {
      await rm(store, { recursive: true, force: true })
    }
    const { status, output, ms, note } = run.result
    const fields = leaves(output)
    if (output === null || output === undefined || fields.length === 0) return { ok: false, status, note: note ?? null, error: '应用没有给出结果，没法请用户确认；先改应用，让它在这个用例上跑出结果' }
    const list = await this.#requests(id)
    for (const r of list) {
      if (r.kind === 'confirm' && r.case === caseId && r.status === 'open') {
        r.status = 'declined'
        r.note = '已被新的确认请求取代'
      }
    }
    const request: FileRequest = {
      id: `R${list.length + 1}`,
      at: this.#now(),
      kind: 'confirm',
      title: question?.trim() || `用例 ${caseId} 的运行结果是你期望的吗？`,
      why: `应用在用例 ${caseId} 的真实输入上运行出的结果。确认无误，或改正不对的地方后，它就成为这个用例的期望值，以后逐项比对。`,
      target: `evals/cases/${caseId}/`,
      accept: null,
      multiple: false,
      status: 'open',
      files: [],
      case: caseId,
      fields,
      run: { status, ms, ...(note ? { note } : {}) },
      output,
    }
    list.push(request)
    await this.#saveRequests(id, list)
    return { ok: true, id: request.id, status, output, note: '已请用户确认；这一轮结束时告诉用户在等他确认结果' }
  }

  /**
   * The person's answer to a confirmation. Confirmed, or corrected, results become the case's
   * expected value (written by the platform, never by the assistant); a reason alone leaves the
   * case pending. Either way the assistant hears about it.
   */
  async confirm(user: User, id: string, requestId: string, body: { ok: boolean; corrections?: { path: string; value: unknown }[]; note?: string }) {
    await this.#editable(user, id)
    const list = await this.#requests(id)
    const r = list.find((x) => x.id === requestId)
    if (!r || r.kind !== 'confirm' || !r.case || !r.fields) throw new AccessError(`没有确认请求 ${requestId}`, 404)
    if (r.status !== 'open') throw new AccessError('这个请求已经处理过', 409)
    const note = body.note?.trim() || undefined
    const fixes = body.ok ? [] : (body.corrections ?? []).filter((c) => typeof c.path === 'string' && c.path.trim())
    if (!body.ok && fixes.length === 0 && !note) throw new AccessError('请改正不对的值，或说明哪里不对', 400)
    const was = new Map(r.fields.map((f) => [f.path, f.value]))
    const corrections = fixes.map((c) => {
      parsePath(c.path)
      return { path: c.path.trim(), was: was.has(c.path.trim()) ? was.get(c.path.trim()) : null, value: c.value }
    })
    const expected = body.ok || corrections.length ? Object.fromEntries(r.fields.map((f) => [f.path, f.value])) : null
    if (expected) for (const c of corrections) expected[c.path] = c.value
    if (expected) {
      const path = `evals/cases/${r.case}/case.json`
      const raw = JSON.parse(await readFile(this.#path(id, path), 'utf8')) as Record<string, unknown>
      const day = this.#now().slice(0, 10)
      raw.expected = expected
      raw.source = `${user.name} 于 ${day} 确认了应用的运行结果（${r.id}）${corrections.length ? `，改正了 ${corrections.length} 处` : ''}`
      let output: unknown = r.output
      try {
        for (const c of corrections) output = setPath(output, c.path, c.value)
      } catch {
        output = undefined
      }
      if (output !== undefined && r.run) {
        const oracle = { status: r.run.status, output, provenance: { kind: 'confirmed-run', by: user.name, at: this.#now(), request: r.id, corrections: corrections.length } }
        const file = typeof raw.oracle === 'string' ? raw.oracle.replace(/^\.\//, '') : 'expected/oracle.json'
        await this.upload(user, id, `evals/cases/${r.case}/${file}`, new TextEncoder().encode(`${JSON.stringify(oracle, null, 2)}\n`))
        raw.oracle = file
      }
      await this.upload(user, id, path, new TextEncoder().encode(`${JSON.stringify(raw, null, 2)}\n`))
    }
    r.status = 'done'
    r.answer = body.ok ? 'yes' : 'no'
    r.note = note
    if (corrections.length) r.corrections = corrections
    await this.#saveRequests(id, list)
    const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
    const text = body.ok
      ? `用例 ${r.case} 的运行结果是我期望的，已保存为期望值（${r.fields.length} 项）。${note ? `说明：${note}。` : ''}请继续，用 run_tests 跑测试。`
      : corrections.length
        ? `用例 ${r.case} 的运行结果有 ${corrections.length} 处不对，我已改正并保存为期望值：\n${corrections.map((c) => `- ${c.path}：应用给出 ${c.was === null ? '（没有）' : show(c.was)}，应为 ${show(c.value)}`).join('\n')}${note ? `\n说明：${note}` : ''}\n请据此改进应用，再用 run_tests 验证。`
        : `用例 ${r.case} 的运行结果不是我期望的：${note}\n期望值还没定。请据此改进应用，再用 confirm_result 请我确认。`
    if (this.harness.available) return this.send(user, id, text)
    return this.view(user, id)
  }

  // ── conversation ──────────────────────────────────────────────

  async send(user: User, id: string, text: string) {
    const s = await this.#get(user, id)
    if (!this.harness.available || !this.harness.command) throw new AccessError(this.harness.note, 503)
    if (s.published && s.mode === 'new') throw new AccessError('这个应用已经发布；继续修改请在应用管理里打开“AI 修改”', 409)
    if (s.running) throw new AccessError('助手还在处理上一条消息', 409)
    if (!text?.trim()) throw new AccessError('请输入内容', 400)
    const edited = s.edited.length ? `\n\n（我在界面上手动改过这些文件：${s.edited.join('、')}。请以文件当前内容为准。）` : ''
    s.messages.push({ id: `m${s.messages.length + 1}`, role: 'user', at: this.#now(), by: user.name, text: text.trim() })
    s.messages.push({ id: `m${s.messages.length + 1}`, role: 'assistant', at: this.#now(), text: '', activity: [], running: true, error: null })
    s.running = true
    s.edited = []
    s.turn = { queuedAt: this.#now(), beat: null, instance: null }
    this.#pending.add(id)
    try {
      await this.#save(s)
      await this.#console.jobs.submit('builder.turn', { session: id, user: user.id, prompt: `${text.trim()}${edited}` } satisfies TurnJob)
    } catch (error) {
      this.#pending.delete(id)
      throw error
    }
    return this.view(user, id)
  }

  /** One turn of the assistant, on whichever instance took the job. */
  async #turn(job: TurnJob, ctx: JobContext): Promise<void> {
    try {
      await this.#runTurn(job, ctx)
    } finally {
      this.#pending.delete(job.session)
    }
  }

  async #runTurn(job: TurnJob, ctx: JobContext): Promise<void> {
    const s = await this.#load(job.session)
    const reply = s.messages.at(-1)
    if (!s.running || !reply || reply.role !== 'assistant' || !reply.running) return
    const finish = async (error: string) => {
      reply.running = false
      reply.error = reply.error ?? error
      s.running = false
      s.turn = null
      await this.#save(s)
    }
    if (ctx.reclaimed && s.turn?.beat) return finish('处理这一轮的实例已停止，这一轮被中断')
    const user = await this.#console.user(job.user)
    const id = s.id
    const ws = this.workspace(id)
    if (this.#mirror) await this.#mirror.pull(id, ws, s.workspaceRev)
    const here = hostname()
    if (s.harnessSession && (s.harnessHost ?? here) !== here) s.harnessSession = null
    const context = !s.harnessSession && s.messages.length > 2 ? `${this.#context(s)}\n\n` : ''
    const env = await this.#grant(user, id)
    s.turn = { queuedAt: s.turn?.queuedAt ?? this.#now(), beat: this.#now(), instance: this.#console.jobs.instance }
    s.harnessHost = here
    await this.#save(s)

    const patch = agentPatch({
      skillDirs: [join(BUILDER, 'skills')],
      servers: { 'rsi-builder': { command: process.execPath, args: [join(BUILDER, 'mcp/server.ts'), ws, s.app], env, timeoutMs: TOOL_TIMEOUT } },
      cwd: ws,
    })
    let afterTool = false
    let dirty = false
    let flushing: Promise<void> | null = null
    let pushedAt = Date.now()
    const flush = (workspace = false) => {
      if (flushing) {
        dirty = true
        return
      }
      if (s.turn) s.turn.beat = this.#now()
      flushing = this.#save(s, { workspace })
        .catch((error) => {
          process.stderr.write(`[rsi] 保存会话 ${id} 失败：${(error as Error).message}\n`)
        })
        .finally(() => {
          flushing = null
          if (dirty) {
            dirty = false
            flush()
          }
        })
    }
    const beat = setInterval(() => flush(), TURN_BEAT)
    const turn = headlessTurn({
      harness: this.harness.command!,
      cwd: ws,
      patch,
      sessionId: s.harnessSession,
      prompt: `${context}${job.prompt}`,
      onEvent: (event) => {
        let workspace = false
        switch (event.type) {
          case 'session':
            s.harnessSession = event.sessionId
            break
          case 'text':
            if (afterTool && reply.text) reply.text += '\n\n'
            afterTool = false
            reply.text += event.text
            break
          case 'tool_call':
            afterTool = true
            reply.activity!.push({ id: event.callId, name: event.tool.replace(/^mcp__rsi-builder__/, ''), detail: short(event.input), ok: null })
            break
          case 'tool_result': {
            const a = reply.activity!.find((x) => x.id === event.callId)
            if (a) a.ok = event.status === 'completed'
            if (this.#mirror && Date.now() - pushedAt > 20_000) {
              pushedAt = Date.now()
              workspace = true
            }
            break
          }
          case 'final':
            reply.text = event.text
            break
          case 'error':
            reply.error = event.message
            break
        }
        flush(workspace)
      },
    })
    this.#turns.set(id, turn)
    try {
      const result = await turn.done
      await flushing
      reply.running = false
      if (result.sessionId) s.harnessSession = result.sessionId
      if (!result.ok) reply.error = reply.error ?? result.error
      if (result.final) reply.text = result.final
    } finally {
      clearInterval(beat)
      this.#turns.delete(id)
      await flushing
      reply.running = false
      s.running = false
      s.turn = null
      await this.#save(s, { workspace: true })
    }
  }

  async cancel(user: User, id: string) {
    const s = await this.#get(user, id)
    const here = this.#turns.get(id)
    if (here) here.cancel()
    else if (s.running && s.turn) {
      if (!s.turn.beat) {
        // nobody has started it: end it here; whoever picks the job up finds it finished
        const last = s.messages.at(-1)
        if (last?.running) Object.assign(last, { running: false, error: '已取消' })
        s.running = false
        s.turn = null
        await this.#save(s)
      } else await this.#console.jobs.publish({ type: 'turn.cancel', session: id })
    }
    return this.view(user, id)
  }

  // ── files ─────────────────────────────────────────────────────

  #path(id: string, path: string): string {
    const ws = this.workspace(id)
    const abs = resolve(ws, path)
    const rel = relative(ws, abs).split(sep).join('/')
    if (rel.startsWith('..') || !/^(code|evals)\//.test(rel)) throw new AccessError('只能访问工作区的 code/ 和 evals/', 400)
    return abs
  }

  async file(user: User, id: string, path: string) {
    await this.#get(user, id)
    const bytes = await readFile(this.#path(id, path))
    try {
      return { path, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch {
      return { path, text: null, size: bytes.length }
    }
  }

  async writeFile(user: User, id: string, path: string, text: string | null) {
    const s = await this.#editable(user, id)
    const abs = this.#path(id, path)
    if (text === null) await rm(abs, { force: true })
    else {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, text)
    }
    if (!s.edited.includes(path)) s.edited.push(path)
    await this.#save(s, { workspace: true })
    return this.view(user, id)
  }

  /** Put any file (spreadsheets, documents, images…) into the workspace. */
  async upload(user: User, id: string, path: string, bytes: Uint8Array) {
    const s = await this.#editable(user, id)
    const abs = this.#path(id, path)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, bytes)
    if (!s.edited.includes(path)) s.edited.push(path)
    await this.#save(s, { workspace: true })
    return this.view(user, id)
  }

  async move(user: User, id: string, from: string, to: string) {
    const s = await this.#editable(user, id)
    const src = this.#path(id, from)
    const dst = this.#path(id, to)
    if (!existsSync(src)) throw new AccessError(`没有文件 ${from}`, 404)
    if (existsSync(dst)) throw new AccessError(`${to} 已存在`, 409)
    await mkdir(dirname(dst), { recursive: true })
    await rename(src, dst)
    for (const p of [from, to]) if (!s.edited.includes(p)) s.edited.push(p)
    await this.#save(s, { workspace: true })
    return this.view(user, id)
  }

  async #editable(user: User, id: string): Promise<BuildSession> {
    const s = await this.#get(user, id)
    if (s.running) throw new AccessError('助手正在修改文件，请等这一轮结束', 409)
    if (s.published && s.mode === 'new') throw new AccessError('这个应用已经发布；继续修改请在应用管理里打开“AI 修改”', 409)
    return s
  }

  /** A workspace file's bytes, for previews. */
  async raw(user: User, id: string, path: string): Promise<{ bytes: Uint8Array; name: string; type: string }> {
    await this.#get(user, id)
    const abs = this.#path(id, path)
    return { bytes: await readFile(abs), name: basename(abs), type: mimeOf(abs) }
  }

  // ── check, test, publish ──────────────────────────────────────

  async check(user: User, id: string) {
    const s = await this.#get(user, id)
    return checkWorkspace(this.workspace(id), s.app)
  }

  /** Install the workspace into a throwaway kernel and score it on all cases, or the chosen ones; the result is kept on the session. */
  async test(user: User, id: string, cases?: string[]): Promise<TestRecord> {
    return this.#testFor(user, id, cases, user.name)
  }

  async #testFor(user: User, id: string, cases: string[] | undefined, by: string): Promise<TestRecord> {
    const s = await this.#get(user, id)
    const report = await checkWorkspace(this.workspace(id), s.app)
    if (!report.ok) throw new AccessError(`先解决检查发现的问题：${report.problems.join('；')}`, 400)
    const ready = report.cases.map((c) => c.id).filter((c) => !report.pending.includes(c))
    const only = (cases?.length ? cases : report.pending.length ? ready : []).filter((c) => !report.pending.includes(c))
    if ((cases?.length || report.pending.length) && only.length === 0) throw new AccessError(`用例 ${report.pending.join('、')} 的期望值还在等用户确认，没有能测的用例`, 400)
    const store = await mkdtemp(join(tmpdir(), 'rsi-test-'))
    try {
      const kernel = this.#scratch(store, { app: s.app, root: this.workspace(id) })
      const { release } = await kernel.install(new FsAppSource(this.workspace(id)), '工作区测试')
      const pick = (split: 'dev' | 'holdout') => (only.length ? only.filter((c) => kernel.splitOf(s.app, c) === split) : undefined)
      const run = async (split: 'dev' | 'holdout') => {
        const chosen = pick(split)
        return chosen && chosen.length === 0 ? { release: release.id, split, cases: [], passed: 0, total: 0, score: 1, selection: [] } : kernel.evaluate(s.app, release.id, split, undefined, chosen)
      }
      const record: TestRecord = { at: this.#now(), by, executor: this.#console.executorStatus.note, cases: only.length ? only : null, dev: await run('dev'), holdout: await run('holdout') }
      const fresh = await this.#load(id)
      fresh.lastTest = record
      await this.#save(fresh)
      return record
    } finally {
      await rm(store, { recursive: true, force: true })
    }
  }

  /**
   * Files that differ from where the session started: `code/` against the base release (path
   * relative to `code/`, with its tier), and `evals/` against the app's current evaluation set
   * (path starting `evals/`, tier `evals`). Text is null for binary files.
   */
  async changes(user: User, id: string) {
    const s = await this.#get(user, id)
    if (s.mode !== 'existing' || !s.base) return []
    const kernel = this.#console.kernel
    const release = await kernel.release(s.app, s.base)
    const texts = await kernel.textFiles(release)
    const manifest = kernel.app(s.app).manifest
    const now = new Map<string, Uint8Array>()
    const evalsNow = new Map<string, Uint8Array>()
    for (const f of await workspaceFiles(this.workspace(id))) {
      const bytes = await readFile(join(this.workspace(id), f.path))
      if (f.path.startsWith('code/')) now.set(f.path.slice(5), bytes)
      else if (f.path.startsWith('evals/')) evalsNow.set(f.path.slice(6), bytes)
    }
    const text = (bytes: Uint8Array | undefined) => {
      if (!bytes) return null
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return null
      }
    }
    const paths = [...new Set([...Object.keys(release.files), ...now.keys()])].sort()
    const code = paths
      .filter((p) => release.files[p] !== (now.has(p) ? hashContent(now.get(p)!) : undefined))
      .map((p) => {
        const after = text(now.get(p))
        return {
          path: p,
          tier: tierOf(manifest, p) as string,
          status: !(p in release.files) ? 'added' : !now.has(p) ? 'removed' : 'changed',
          binary: now.has(p) && after === null,
          before: texts.get(p) ?? null,
          after,
        }
      })
    if (!s.evalsBase) return code
    const tree = kernel.app(s.app).source.evals
    const current = new Map<string, Uint8Array>()
    for (const p of await tree.list()) current.set(p, await tree.read(p))
    const hashOf = (m: Map<string, Uint8Array>, p: string) => (m.has(p) ? hashContent(m.get(p)!) : undefined)
    const started = (await kernel.evalSets(s.app)).find((x) => x.id === s.evalsBase)?.files ?? {}
    const baseHash = (p: string) => started[p]
    const evals = [...new Set([...Object.keys(started), ...current.keys(), ...evalsNow.keys()])]
      .sort()
      .filter((p) => baseHash(p) !== hashOf(evalsNow, p) && hashOf(current, p) !== hashOf(evalsNow, p))
      .map((p) => {
        const after = text(evalsNow.get(p))
        const conflict = baseHash(p) !== hashOf(current, p)
        return {
          path: `evals/${p}`,
          tier: 'evals',
          status: baseHash(p) === undefined ? 'added' : !evalsNow.has(p) ? 'removed' : 'changed',
          binary: evalsNow.has(p) && after === null,
          before: text(current.get(p)),
          after,
          ...(conflict ? { conflict: '会话开始后评测集里这个文件被别人改过' } : {}),
        }
      })
    return [...code, ...evals]
  }

  async publish(user: User, id: string, body: { note?: string }) {
    const s = await this.#get(user, id)
    if (s.running) throw new AccessError('助手还在处理，等这一轮结束再发布', 409)
    if (s.published && s.mode === 'new') throw new AccessError('已经发布过', 409)
    const report = await checkWorkspace(this.workspace(id), s.app)
    if (!report.ok) throw new AccessError(`还不能发布：${report.problems.join('；')}`, 400)
    if (report.pending.length) throw new AccessError(`还不能发布：用例 ${report.pending.join('、')} 的期望值还在等你确认运行结果`, 400)
    const note = body.note?.trim() || `${user.name} 用 AI 编码助手${s.mode === 'new' ? '创建' : '修改'}`

    if (s.mode === 'new') {
      if (this.#console.appExists(s.app)) throw new AccessError(`应用标识 ${s.app} 已被占用`, 409)
      const target = join(this.#console.home, s.app)
      await cp(join(this.workspace(id), 'code'), join(target, 'code'), { recursive: true })
      await cp(join(this.workspace(id), 'evals'), join(target, 'evals'), { recursive: true })
      try {
        await this.#console.files.pushDir(s.app)
        const out = await this.#console.registerApp(user, s.app, note)
        s.published = { at: this.#now(), by: user.name, kind: 'install', release: out.release }
      } catch (error) {
        await rm(target, { recursive: true, force: true })
        throw error
      }
      await this.#save(s)
      await this.#onAppAdded?.(s.app)
      return { session: await this.view(user, id), app: s.app, release: s.published.release }
    }

    const all = await this.changes(user, id)
    if (all.length === 0) throw new AccessError('和起始版本相比没有改动', 400)
    const evalChanges = all.filter((c) => c.tier === 'evals')
    const changes = all.filter((c) => c.tier !== 'evals')
    const stable = await this.#console.kernel.stable(s.app)
    if (changes.length && stable.id !== s.base) throw new AccessError(`起始版本是 ${s.base}，稳定版本已变成 ${stable.id}。请新开一个会话基于最新版本修改`, 409)
    let evalset: string | undefined
    const conflicts = evalChanges.filter((c) => 'conflict' in c)
    if (conflicts.length) throw new AccessError(`评测集里这些文件在会话开始后被别人改过：${conflicts.map((c) => c.path).join('、')}。请在会话里按最新内容重做，或先在“评测”页处理`, 409)
    if (evalChanges.length) {
      if (!this.#saveEvals) throw new AccessError('平台没有接入评测集保存', 500)
      const ws = this.workspace(id)
      const writes = await Promise.all(evalChanges.map(async (c) => ({ path: c.path.slice(6), bytes: c.status === 'removed' ? null : new Uint8Array(await readFile(join(ws, c.path))) })))
      evalset = (await this.#saveEvals(s.app, user, writes, `AI 编码助手起草、${user.name} 确认：${evalChanges.map((c) => c.path.slice(6)).join('、')}`)).evalset
    }
    if (changes.length === 0) {
      s.published = { at: this.#now(), by: user.name, kind: 'evals', evalset }
      await this.#save(s)
      return { session: await this.view(user, id), app: s.app, evalset }
    }
    const contract = changes.filter((c) => c.tier === 'contract')
    if (contract.length === 0) {
      const ws = this.workspace(id)
      const puts = []
      for (const c of changes.filter((x) => x.binary && x.status !== 'removed')) {
        const bytes = await readFile(join(ws, 'code', c.path))
        puts.push({ path: c.path, blob: await this.#console.kernel.putBlob(bytes), size: bytes.length })
      }
      const proposal = await this.#console.submitProposal(s.app, user, {
        title: note,
        issue: s.issue,
        edits: changes.filter((c) => !c.binary && c.status !== 'removed').map((c) => ({ path: c.path, text: c.after ?? '' })),
        puts,
        deletes: changes.filter((c) => c.status === 'removed').map((c) => c.path),
        record: {
          title: note,
          date: this.#now().slice(0, 10),
          background: s.goal || s.messages.find((m) => m.role === 'user')?.text || '',
          options: [],
          decision: `由 AI 编码助手按对话修改 ${changes.length} 个文件：${changes.map((c) => c.path).join('、')}`,
          impact: '知识级、代码级与界面文件；经验证和批准后发布',
          review: '验证闸门全部通过、按级别获得批准后发布',
        },
      })
      s.published = { at: this.#now(), by: user.name, kind: 'proposal', proposal: proposal.id, evalset }
      await this.#save(s)
      return { session: await this.view(user, id), app: s.app, proposal: proposal.id, evalset }
    }
    const source = join(this.#console.home, s.app, 'code')
    const drift = await this.#console.diff(s.app, user, stable.id, 'source')
    if (drift.length) throw new AccessError(`应用源目录里有尚未导入的人工改动（${drift.map((d) => d.path).join('、')}），请先在“版本与发布”里处理`, 409)
    for (const c of changes) {
      const abs = join(source, c.path)
      if (c.status === 'removed') await rm(abs, { force: true })
      else {
        await mkdir(dirname(abs), { recursive: true })
        await cp(join(this.workspace(id), 'code', c.path), abs)
      }
    }
    const release = await this.#console.importSource(s.app, user, note)
    s.published = { at: this.#now(), by: user.name, kind: 'import', release: release.id, evalset }
    await this.#save(s)
    return { session: await this.view(user, id), app: s.app, release: release.id, evalset }
  }
}

interface TurnJob {
  session: string
  /** Who sent the message; the assistant's tools act as them. */
  user: string
  prompt: string
}
