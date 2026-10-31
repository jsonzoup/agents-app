/**
 * Console use cases: everything the platform UI does, checked against access control and
 * carried out by the real kernel. Knows no industry; app-specific behaviour comes from the
 * app's manifest (`web`, `actions`) and the app's own web application.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FsAppSource,
  RsiKernel,
  hashContent,
  isProductSignal,
  isWebPath,
  renderRecord,
  tierOf,
} from '../../rsi-kernel/src/index.ts'
import type { Change, DecisionRecord, Model, Release, Signal, SignalScope, SignalTarget, Store } from '../../rsi-kernel/src/index.ts'
import type { ApprovalPolicy, Directory, Grant, Group, Permission, Role, User } from './rbac.ts'
import {
  AccessError,
  BUILTIN_ROLES,
  DEFAULT_APPROVAL_POLICY,
  LEVEL_LABEL,
  approvalRoles,
  checkAdminRemains,
  checkCodeApprovals,
  checkGrants,
  checkGroup,
  checkRole,
  checkUser,
  demand,
  demandApproval,
  demandSystem,
  hasSystem,
  levelOf,
  permissionsOf,
  sourcesOf,
  systemPermissionsOf,
  visibleApps,
} from './rbac.ts'
import { actionSummaries, runAction } from './actions.ts'
import type { AppAction } from './actions.ts'
import { getPath, setPath } from './paths.ts'
import { Accounts, passwordProblem } from './accounts.ts'
import type { ExecutorStatus } from './executor.ts'
import type { ModelStatus } from './model.ts'
import { STATE_DIR, UPLOAD_DIR, appDirs } from './home.ts'
import { HomeFiles } from './storage.ts'
import { InlineJobs } from './cluster.ts'
import type { DeploymentStatus, Jobs, PlatformEvent } from './cluster.ts'
import { AppInfra } from './appinfra.ts'
import type { Docs } from './pgstore.ts'
import { webOf } from './webhost.ts'
import { writeZip } from './zip.ts'
import type { ZipEntry } from './zip.ts'
import type { WebSite } from './webhost.ts'

export type { AppAction }

export interface Correction {
  at: string
  by: string
  run: string
  path: string
  field: string
  before: string
  after: string
  note?: string
  scope: SignalScope
  /** Kernel signal id; empty for trial tasks, which teach nothing. */
  signal: string
}

/** A person's suggestion about a region of the result or the whole task. */
export interface Suggestion {
  at: string
  by: string
  run: string
  target: SignalTarget
  note: string
  scope: SignalScope
  attachments: { path: string; name: string; size: number }[]
  signal: string
}

export interface Artifact {
  id: string
  action: string
  title: string
  file: string
  at: string
  by: string
  ok: boolean
  report: unknown
}

export interface Task {
  id: string
  app: string
  title: string
  createdBy: string
  createdAt: string
  input: unknown
  runs: string[]
  state: 'running' | 'ready' | 'confirmed'
  outcome: string | null
  working: unknown
  corrections: Correction[]
  suggestions?: Suggestion[]
  confirmed: { by: string; at: string } | null
  artifacts: Artifact[]
  /** A trial on a version that is not the stable one (a release or a proposal's candidate); never feeds evolution. */
  trial?: { version: string; by: string }
}

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
}

/** Content type for a file name; text types only for files that decode as UTF-8. */
export function mimeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

const isText = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** A path inside an app tree: forward slashes, no `..`, no leading slash, no hidden segments except `.mcp.json`. */
export function safeRelPath(path: string): string {
  const clean = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!clean || clean.split('/').some((s) => s === '' || s === '..' || s === '.' || (s.startsWith('.') && s !== '.mcp.json'))) throw new AccessError(`不合法的路径：${path}`, 400)
  return clean
}

export interface ConsoleOptions {
  /** Home directory: one folder per app plus platform state. Material paths are relative to it. */
  home: string
  stateDir: string
  store: Store
  kernel: RsiKernel
  model: Model | null
  modelStatus: ModelStatus
  executorStatus: ExecutorStatus
  /** App files (packages, materials, artifacts); defaults to the local home. */
  files?: HomeFiles
  /** Where kernel blobs live: `local` or `minio`. */
  blobStore?: string
  now?: () => string
  /** Platform documents in a database; JSON files in `stateDir` when absent. */
  docs?: Docs | null
  /** Background work and events between instances; in-process when absent. */
  jobs?: Jobs
  deployment?: DeploymentStatus
}

const TEXT = new TextDecoder()
/** Home-relative files users may read: uploads and each app's evaluation materials. */
const READABLE = [new RegExp(`^${UPLOAD_DIR.replace('.', '\\.')}/`), /^[a-z][a-z0-9-]*\/evals\/(materials|cases)\//]

/** Before evaluation spec v1, case materials lived in `evals/materials/<id>/`; tasks, signals and released UIs still name that path. */
const LEGACY_MATERIAL = /^([a-z][a-z0-9-]*)\/evals\/materials\/([^/]+)\/(.+)$/
const MAX_UPLOAD = 200 * 1024 * 1024

/** A suggestion about the app's interface or abilities, cleaned; null for suggestions about results. */
export function productTarget(target: SignalTarget | undefined): SignalTarget | null {
  if (target?.level !== 'ui' && target?.level !== 'feature') return null
  const label = target.label?.trim().slice(0, 80) || undefined
  if (target.level === 'feature') return { level: 'feature', label }
  const path = typeof target.path === 'string' && target.path.startsWith('/') ? target.path.slice(0, 300) : '/'
  return { level: 'ui', path, label }
}

/** The first unused `<prefix>-<n>` id, for records named only in Chinese. */
function freshId(prefix: string, taken: { id: string }[]): string {
  let n = taken.length + 1
  while (taken.some((x) => x.id === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

export class Console {
  readonly home: string
  readonly stateDir: string
  readonly kernel: RsiKernel
  readonly #store: Store
  readonly #model: Model | null
  readonly modelStatus: ModelStatus
  readonly executorStatus: ExecutorStatus
  readonly #now: () => string
  readonly files: HomeFiles
  readonly blobStore: string
  readonly accounts: Accounts
  readonly jobs: Jobs
  readonly deployment: DeploymentStatus | null
  /** Each app's own resources, when the deployment opens them. */
  infra: AppInfra | null = null
  readonly #docs: Docs | null
  #apps: string[] = []
  /** App folders that failed to load, with the reason. */
  readonly broken: { app: string; error: string }[] = []

  constructor(options: ConsoleOptions) {
    this.home = options.home
    this.stateDir = options.stateDir
    this.kernel = options.kernel
    this.#store = options.store
    this.#model = options.model
    this.modelStatus = options.modelStatus
    this.executorStatus = options.executorStatus
    this.files = options.files ?? new HomeFiles(options.home)
    this.blobStore = options.blobStore ?? 'local'
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#docs = options.docs ?? null
    this.deployment = options.deployment ?? null
    this.accounts = new Accounts(join(this.stateDir, 'credentials.json'), this.#now, this.#docs)
    this.jobs = options.jobs ?? new InlineJobs()
    this.jobs.handle('task.run', (payload, job) => this.#runQueued(String(payload.task), payload.caseId ? String(payload.caseId) : undefined, job.reclaimed))
    this.jobs.subscribe((event) => void this.#heard(event))
  }

  /** Platform documents beside the kernel's, when they are in a database (sessions, preview tasks). */
  get docs(): Docs | null {
    return this.#docs
  }

  /** The key that signs sign-in cookies; made once and shared by every instance. */
  async sessionSecret(): Promise<Buffer> {
    if (!this.#docs) {
      const file = join(this.stateDir, 'session.key')
      if (existsSync(file)) return readFile(file)
      const key = randomBytes(32)
      await mkdir(this.stateDir, { recursive: true })
      await writeFile(file, key, { mode: 0o600 })
      return key
    }
    const docs = this.#docs
    const make = async () => {
      const found = await docs.get<{ key: string }>('console', 'session.key')
      if (found) return Buffer.from(found.key, 'base64')
      const key = randomBytes(32)
      await docs.put('console', 'session.key', { key: key.toString('base64') })
      return key
    }
    return this.#store.exclusive ? this.#store.exclusive('console:session.key', make) : make()
  }

  /** Tell other instances that an app's files, releases or evaluation set changed. */
  async announce(app: string): Promise<void> {
    await this.jobs.publish({ type: 'app', app }).catch((error) => process.stderr.write(`[rsi] 通知其他实例失败：${(error as Error).message}
`))
  }

  async #heard(event: PlatformEvent): Promise<void> {
    if (event.type === 'app' && typeof event.app === 'string') await this.refreshApp(event.app).catch((error) => process.stderr.write(`[rsi] 刷新应用 ${event.app} 失败：${(error as Error).message}
`))
  }

  /** Another instance changed an app: bring its files here and load it again (or for the first time). */
  async refreshApp(name: string): Promise<void> {
    await this.files.pullDir(name)
    if (!existsSync(join(this.home, name, 'code/app.json'))) return
    if (this.#apps.includes(name)) await this.kernel.reload(new FsAppSource(join(this.home, name)))
    else {
      await this.kernel.install(new FsAppSource(join(this.home, name)))
      this.#apps.push(name)
      this.#apps.sort()
    }
  }

  now(): string {
    return this.#now()
  }

  /** Check one app permission (used by the builder and the evaluation bench). */
  async demand(app: string, user: User, permission: Permission): Promise<void> {
    return this.#demand(app, user, permission)
  }

  /** Platform documents beside the kernel's (tasks, evaluation runs). */
  get store(): Store {
    return this.#store
  }

  // ── state files ────────────────────────────────────────────────

  async #json<T>(name: string, fallback: T): Promise<T> {
    if (this.#docs) return (await this.#docs.get<T>('console', name)) ?? fallback
    try {
      return JSON.parse(await readFile(join(this.stateDir, name), 'utf8')) as T
    } catch {
      return fallback
    }
  }

  async #save(name: string, value: unknown): Promise<void> {
    if (this.#docs) return this.#docs.put('console', name, value)
    await mkdir(this.stateDir, { recursive: true })
    await writeFile(join(this.stateDir, name), `${JSON.stringify(value, null, 2)}\n`)
  }

  users(): Promise<User[]> {
    return this.#json<User[]>('users.json', [])
  }

  /** Users, groups, roles and app grants, read fresh on every call so edits apply at once. */
  async directory(): Promise<Directory> {
    const roles = await this.#json<Role[]>('roles.json', [])
    return {
      users: await this.users(),
      groups: await this.#json<Group[]>('groups.json', []),
      roles: [...BUILTIN_ROLES.filter((b) => !roles.some((r) => r.id === b.id)), ...roles],
      grants: await this.#json<Directory['grants']>('grants.json', {}),
    }
  }

  // ── sign-in ───────────────────────────────────────────────────

  /** The user and their credential version when the password matches; one message for every failure. */
  async login(id: string, password: string): Promise<{ user: User; version: number }> {
    const users = await this.users()
    if (users.length === 0) throw new AccessError('还没有任何用户：设置环境变量 RSI_ADMIN_PASSWORD 启动一次，会创建管理员账号 admin', 409)
    const user = users.find((u) => u.id === String(id ?? '').trim())
    const version = await this.accounts.verify(user?.id ?? '', String(password ?? ''))
    if (!user || user.disabled || version === null) throw new AccessError('账号或密码不对', 400)
    return { user, version }
  }

  /** Change one's own password; returns the new credential version so the caller can renew the session. */
  async changePassword(user: User, current: string, next: string): Promise<number> {
    if ((await this.accounts.verify(user.id, String(current ?? ''))) === null) throw new AccessError('当前密码不对', 400)
    const problem = passwordProblem(next)
    if (problem) throw new AccessError(problem, 400)
    await this.accounts.set(user.id, next, user.id)
    return (await this.accounts.version(user.id))!
  }

  /** An administrator sets someone's password; their existing sessions end. */
  async resetPassword(user: User, id: string, password: string): Promise<void> {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.users')
    if (!dir.users.some((u) => u.id === id)) throw new AccessError(`没有用户 ${id}`, 404)
    const problem = passwordProblem(password)
    if (problem) throw new AccessError(problem, 400)
    await this.accounts.set(id, password, user.id)
  }

  /** On a home without users, create the administrator `admin` with the given password. */
  async ensureAdmin(password: string | undefined): Promise<boolean> {
    if (!password || (await this.users()).length > 0) return false
    const problem = passwordProblem(password)
    if (problem) throw new Error(`RSI_ADMIN_PASSWORD：${problem}`)
    await this.#save('users.json', [{ id: 'admin', name: '管理员', title: '', roles: ['admin'] } satisfies User])
    await this.accounts.set('admin', password, 'RSI_ADMIN_PASSWORD')
    return true
  }

  async user(id: string): Promise<User> {
    const user = (await this.users()).find((u) => u.id === id)
    if (!user || user.disabled) throw new AccessError('请先登录', 401)
    return user
  }

  /** Install every app folder in the home. Already-installed apps keep their releases; broken ones are reported, not fatal. */
  async boot(): Promise<void> {
    for (const name of appDirs(this.home)) {
      try {
        const { app } = await this.kernel.install(new FsAppSource(join(this.home, name)))
        if (app.manifest.name !== name) throw new Error(`目录名 ${name} 与 app.json 的 name ${app.manifest.name} 不一致`)
        this.#apps.push(name)
      } catch (error) {
        this.broken.push({ app: name, error: (error as Error).message })
      }
    }
  }

  appNames(): string[] {
    return [...this.#apps]
  }

  async #demand(app: string, user: User, permission: Permission): Promise<void> {
    if (!this.#apps.includes(app)) throw new AccessError(`没有应用 ${app}`, 404)
    demand(await this.directory(), app, user, permission)
  }

  // ── apps ──────────────────────────────────────────────────────

  async apps(user: User) {
    const dir = await this.directory()
    const names = visibleApps(dir, this.appNames(), user)
    return Promise.all(names.map((name) => this.appSummary(name, user, dir)))
  }

  async appSummary(name: string, user: User, directory?: Directory) {
    if (!this.#apps.includes(name)) throw new AccessError(`没有应用 ${name}`, 404)
    const dir = directory ?? (await this.directory())
    const permissions = permissionsOf(dir, name, user)
    if (permissions.length === 0) throw new AccessError(`没有 ${name} 的访问权限`)
    const { manifest } = this.kernel.app(name)
    const channels = await this.kernel.channels(name)
    const proposals = await this.kernel.proposals(name)
    const issues = await this.kernel.issues(name)
    const tasks = await this.tasks(name)
    const dismissed = await this.#issueStates(name)
    const raw = await this.#manifestRaw(name)
    return {
      name,
      title: manifest.title,
      description: manifest.description,
      version: manifest.version,
      stable: channels.stable,
      releases: (await this.kernel.releases(name)).length,
      level: levelOf(dir, name, user),
      sources: sourcesOf(dir, name, user),
      permissions,
      hasWeb: Boolean(manifest.web),
      evalset: this.kernel.app(name).evalset,
      actions: actionSummaries(raw),
      scopes: manifest.scopes,
      counts: {
        tasks: tasks.length,
        issues: issues.filter((i) => !dismissed[i.id] && !proposals.some((p) => p.issue === i.id && p.status === 'released')).length,
        openProposals: proposals.filter((p) => p.status === 'draft' || p.status === 'verified' || p.status === 'failed').length,
        users: dir.users.filter((u) => !u.disabled && levelOf(dir, name, u) !== null).length,
      },
    }
  }

  async #manifestRaw(name: string): Promise<Record<string, unknown>> {
    const { source } = this.kernel.app(name)
    return JSON.parse(TEXT.decode(await source.read('app.json'))) as Record<string, unknown>
  }

  /**
   * Register a new app folder already written into the home: install its first release and
   * give the creator manage. Used when an app built in a workspace is published.
   */
  async registerApp(user: User, name: string, note: string) {
    const dir = await this.directory()
    demandSystem(dir, user, 'app.create')
    if (this.#apps.includes(name) || (await this.#store.get('channels', name))) throw new AccessError(`应用 ${name} 已存在`, 409)
    const { app, release } = await this.kernel.install(new FsAppSource(join(this.home, name)), note)
    if (app.manifest.name !== name) throw new AccessError(`目录名 ${name} 与 app.json 的 name ${app.manifest.name} 不一致`, 400)
    dir.grants[name] = [{ kind: 'user', id: user.id, level: 'manage' }]
    await this.#save('grants.json', dir.grants)
    this.#apps.push(name)
    this.#apps.sort()
    await this.announce(name)
    return { app: name, release: release.id }
  }

  /** Whether an app name is taken by an installed app or an existing folder. */
  appExists(name: string): boolean {
    return this.#apps.includes(name) || existsSync(join(this.home, name))
  }

  async directoryFor(user: User) {
    return this.directory().then((dir) => ({ dir, system: systemPermissionsOf(dir, user) }))
  }

  // ── app access ────────────────────────────────────────────────

  /** Grants on one app plus everyone's effective level, for the app's access tab. */
  async access(name: string, user: User) {
    await this.#demand(name, user, 'access.manage')
    const dir = await this.directory()
    return {
      grants: (dir.grants[name] ?? []).map((g) => {
        const group = g.kind === 'group' ? dir.groups.find((x) => x.id === g.id) : undefined
        const person = g.kind === 'user' ? dir.users.find((x) => x.id === g.id) : undefined
        return { ...g, name: group?.name ?? person?.name ?? g.id, note: group ? `${group.members.length} 人` : person?.title ?? '' }
      }),
      effective: dir.users
        .filter((u) => !u.disabled)
        .map((u) => ({ id: u.id, name: u.name, title: u.title, level: levelOf(dir, name, u), sources: sourcesOf(dir, name, u) }))
        .filter((u) => u.level !== null),
      approval: await this.approvalPolicy(name),
    }
  }

  async setAccess(name: string, user: User, next: Grant[]) {
    await this.#demand(name, user, 'access.manage')
    const dir = await this.directory()
    const grants = (next ?? []).map((g) => ({ kind: g.kind, id: g.id, level: g.level }))
    checkGrants(name, grants, dir)
    dir.grants[name] = grants
    await this.#save('grants.json', dir.grants)
    return this.access(name, user)
  }

  async approvalPolicy(name: string): Promise<ApprovalPolicy> {
    return (await this.#json<Record<string, ApprovalPolicy>>('policies.json', {}))[name] ?? DEFAULT_APPROVAL_POLICY
  }

  /** Set how many managers approve a code-tier proposal; applies to open proposals from their next approval. */
  async setApprovalPolicy(name: string, user: User, body: { codeApprovals: unknown }) {
    await this.#demand(name, user, 'access.manage')
    const codeApprovals = checkCodeApprovals(body?.codeApprovals)
    const all = await this.#json<Record<string, ApprovalPolicy>>('policies.json', {})
    const current = all[name] ?? DEFAULT_APPROVAL_POLICY
    if (current.codeApprovals !== codeApprovals) {
      all[name] = { codeApprovals, history: [...current.history, { codeApprovals, by: user.name, at: this.#now() }] }
      await this.#save('policies.json', all)
    }
    return this.access(name, user)
  }

  /** People and groups to pick from when granting; open to anyone who manages an app or the directory. */
  async principals(user: User) {
    const dir = await this.directory()
    const manages = this.#apps.some((a) => levelOf(dir, a, user) === 'manage')
    if (!manages && !hasSystem(dir, user, 'system.users')) throw new AccessError('没有可授权的应用')
    return {
      users: dir.users.filter((u) => !u.disabled).map((u) => ({ id: u.id, name: u.name, title: u.title })),
      groups: dir.groups.map((g) => ({ id: g.id, name: g.name, description: g.description, members: g.members })),
    }
  }

  // ── system administration ─────────────────────────────────────

  async systemView(user: User) {
    const dir = await this.directory()
    if (!hasSystem(dir, user, 'system.users') && !hasSystem(dir, user, 'system.roles')) throw new AccessError('没有系统管理权限')
    const appsOf = (u: User) =>
      this.#apps.map((a) => ({ app: a, title: this.kernel.app(a).manifest.title, level: levelOf(dir, a, u) })).filter((x) => x.level !== null)
    const withPassword = await this.accounts.ids()
    return {
      users: dir.users.map((u) => ({ ...u, passwordSet: withPassword.has(u.id), groups: dir.groups.filter((g) => g.members.includes(u.id)).map((g) => g.id), apps: appsOf(u) })),
      groups: dir.groups.map((g) => ({ ...g, apps: this.#apps.flatMap((a) => (dir.grants[a] ?? []).filter((x) => x.kind === 'group' && x.id === g.id).map((x) => ({ app: a, title: this.kernel.app(a).manifest.title, level: x.level }))) })),
      roles: dir.roles.map((r) => ({ ...r, users: dir.users.filter((u) => u.roles.includes(r.id)).length })),
    }
  }

  /** Grants on every app must still leave a manager after a directory change. */
  #checkAllApps(dir: Directory): void {
    for (const app of this.#apps) {
      try {
        checkGrants(app, dir.grants[app] ?? [], dir)
      } catch (error) {
        throw new AccessError(`这样改会让应用 ${this.kernel.app(app).manifest.title} 没有管理者：${(error as Error).message}`, 400)
      }
    }
  }

  async saveUser(user: User, body: User & { password?: string }, isNew: boolean) {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.users')
    const problem = isNew ? passwordProblem(body.password) : null
    if (problem) throw new AccessError(`初始${problem}`, 400)
    const next: User = { id: body.id?.trim(), name: body.name?.trim(), title: body.title?.trim() ?? '', roles: [...new Set(body.roles ?? [])], ...(body.disabled ? { disabled: true } : {}) }
    checkUser(next, dir)
    const at = dir.users.findIndex((u) => u.id === next.id)
    if (isNew && at >= 0) throw new AccessError(`用户 ${next.id} 已存在`, 409)
    if (!isNew && at < 0) throw new AccessError(`没有用户 ${next.id}`, 404)
    if (at >= 0) dir.users[at] = next
    else dir.users.push(next)
    checkAdminRemains(dir)
    this.#checkAllApps(dir)
    await this.#save('users.json', dir.users)
    if (isNew) await this.accounts.set(next.id, body.password!, user.id)
    return this.systemView(user)
  }

  /** Create a group. App managers may create one while granting; editing existing groups needs the directory permission. */
  async createGroup(user: User, body: Group) {
    const dir = await this.directory()
    const manages = this.#apps.some((a) => levelOf(dir, a, user) === 'manage')
    if (!manages && !hasSystem(dir, user, 'system.users')) throw new AccessError('没有创建用户组的权限')
    const id = body.id?.trim() || freshId('group', dir.groups)
    const group: Group = { id, name: body.name?.trim(), description: body.description?.trim() ?? '', members: [...new Set(body.members ?? [])] }
    checkGroup(group, dir)
    if (dir.groups.some((g) => g.id === group.id)) throw new AccessError(`用户组 ${group.id} 已存在`, 409)
    dir.groups.push(group)
    await this.#save('groups.json', dir.groups)
    return group
  }

  async updateGroup(user: User, id: string, body: Group) {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.users')
    const at = dir.groups.findIndex((g) => g.id === id)
    if (at < 0) throw new AccessError(`没有用户组 ${id}`, 404)
    const group: Group = { id, name: body.name?.trim(), description: body.description?.trim() ?? '', members: [...new Set(body.members ?? [])] }
    checkGroup(group, dir)
    dir.groups[at] = group
    this.#checkAllApps(dir)
    await this.#save('groups.json', dir.groups)
    return this.systemView(user)
  }

  async deleteGroup(user: User, id: string) {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.users')
    if (!dir.groups.some((g) => g.id === id)) throw new AccessError(`没有用户组 ${id}`, 404)
    dir.groups = dir.groups.filter((g) => g.id !== id)
    for (const app of Object.keys(dir.grants)) dir.grants[app] = dir.grants[app].filter((g) => !(g.kind === 'group' && g.id === id))
    this.#checkAllApps(dir)
    await this.#save('groups.json', dir.groups)
    await this.#save('grants.json', dir.grants)
    return this.systemView(user)
  }

  async saveRole(user: User, body: Role, isNew: boolean) {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.roles')
    const id = body.id?.trim() || (isNew ? freshId('role', dir.roles) : '')
    const role: Role = { id, name: body.name?.trim(), description: body.description?.trim() ?? '', permissions: [...new Set(body.permissions ?? [])] }
    checkRole(role)
    const at = dir.roles.findIndex((r) => r.id === role.id)
    if (isNew && at >= 0) throw new AccessError(`角色 ${role.id} 已存在`, 409)
    if (!isNew && at < 0) throw new AccessError(`没有角色 ${role.id}`, 404)
    if (at >= 0 && dir.roles[at].builtin) throw new AccessError('内置角色不能修改，可以新建一个角色', 400)
    if (at >= 0) dir.roles[at] = role
    else dir.roles.push(role)
    checkAdminRemains(dir)
    this.#checkAllApps(dir)
    await this.#save('roles.json', dir.roles.filter((r) => !r.builtin))
    return this.systemView(user)
  }

  async deleteRole(user: User, id: string) {
    const dir = await this.directory()
    demandSystem(dir, user, 'system.roles')
    const role = dir.roles.find((r) => r.id === id)
    if (!role) throw new AccessError(`没有角色 ${id}`, 404)
    if (role.builtin) throw new AccessError('内置角色不能删除', 400)
    dir.roles = dir.roles.filter((r) => r.id !== id)
    for (const u of dir.users) u.roles = u.roles.filter((r) => r !== id)
    checkAdminRemains(dir)
    this.#checkAllApps(dir)
    await this.#save('roles.json', dir.roles.filter((r) => !r.builtin))
    await this.#save('users.json', dir.users)
    return this.systemView(user)
  }

  // ── code tree ─────────────────────────────────────────────────

  /** Directory holding a version's files (shared cache; copy before changing). */
  async materialize(name: string, version: string): Promise<string> {
    return this.kernel.materialize(name, version)
  }

  async #version(name: string, id?: string | null): Promise<Release> {
    return id ? this.kernel.version(name, id) : this.kernel.stable(name)
  }

  /** Versions people can browse, evaluate or try: releases (newest first), then open proposals' candidates. */
  async versions(name: string, user: User) {
    await this.#demand(name, user, 'app.read')
    const stable = (await this.kernel.channels(name)).stable
    const releases = (await this.kernel.releases(name)).reverse().map((r) => ({ id: r.id, kind: 'release' as const, label: `${r.id}${r.id === stable ? ' · 稳定版' : ''}`, note: r.note, stable: r.id === stable, at: r.createdAt }))
    const candidates = (await this.kernel.proposals(name))
      .filter((p) => p.status === 'draft' || p.status === 'verified' || p.status === 'failed')
      .reverse()
      .map((p) => ({ id: p.id, kind: 'candidate' as const, label: `${p.id} 候选`, note: p.title, stable: false, at: p.createdAt }))
    return [...releases, ...candidates]
  }

  /**
   * A version's web application, for the platform to build, run and proxy: everyone gets the
   * stable one; other versions are trials. Null when the version has no `web`.
   */
  async webSite(name: string, user: User, versionId: string): Promise<WebSite | null> {
    await this.#demand(name, user, 'app.use')
    const stable = await this.kernel.stable(name)
    const release = versionId === 'stable' ? stable : await this.kernel.version(name, versionId)
    if (release.id !== stable.id) await this.#demand(name, user, 'app.trial')
    const web = webOf(JSON.parse(new TextDecoder().decode(await this.kernel.blob(release.files['app.json']))))
    if (!web || !Object.keys(release.files).some((p) => p.startsWith(`${web}/`))) return null
    const files = Object.keys(release.files).filter((p) => p.startsWith(`${web}/`)).sort()
    return {
      base: `/apps/${name}/v/${release.id}`,
      fingerprint: hashContent(new TextEncoder().encode(files.map((p) => `${p}:${release.files[p]}`).join('\n'))),
      source: async () => join(await this.kernel.materialize(name, release.id), web),
      env: { NEXT_PUBLIC_RSI_APP: name, NEXT_PUBLIC_RSI_VERSION: release.id, NEXT_PUBLIC_RSI_API: `/api/apps/${name}` },
      ...(this.infra ? { resources: async () => AppInfra.variables(await this.infra!.ensure(name, 'prod')) } : {}),
    }
  }

  /** The app's own database, cache, queue and bucket, without credentials. */
  async infraSummary(name: string, user: User) {
    await this.#demand(name, user, 'release.import')
    if (!this.infra) return { enabled: false, note: '这个部署没有为应用开通独立资源（设置 RSI_APP_PROVISION=1 并配置 PostgreSQL、Redis、MinIO）', environments: [] }
    return { enabled: true, note: '', ...(await this.infra.summary(name)) }
  }

  /**
   * A version of the app as a zip archive: its code (with `web/.env`, so only managers may take
   * it), the app's current evaluation set and where it came from. Import opens a build session.
   */
  async exportApp(name: string, user: User, versionId?: string | null): Promise<{ bytes: Uint8Array; name: string; type: string }> {
    await this.#demand(name, user, 'app.trial')
    const release = await this.#version(name, versionId)
    const loaded = this.kernel.app(name)
    const meta = { format: 'rsi-app/1', app: name, title: loaded.manifest.title, version: release.id, fingerprint: release.fingerprint, evalset: loaded.evalset, exportedBy: user.name, exportedAt: this.#now() }
    const entries: ZipEntry[] = [{ path: `${name}/rsi-export.json`, bytes: new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`) }]
    for (const path of Object.keys(release.files).sort()) entries.push({ path: `${name}/code/${path}`, bytes: await this.kernel.blob(release.files[path]) })
    for (const path of await loaded.source.evals.list()) entries.push({ path: `${name}/evals/${path}`, bytes: await loaded.source.evals.read(path) })
    return { bytes: writeZip(entries), name: `${name}-${release.id}.zip`, type: 'application/zip' }
  }

  async tree(name: string, user: User, versionId?: string | null) {
    await this.#demand(name, user, 'app.read')
    const release = await this.#version(name, versionId)
    const { manifest } = this.kernel.app(name)
    const files = []
    for (const path of Object.keys(release.files).sort()) {
      const bytes = await this.kernel.blob(release.files[path])
      files.push({ path, tier: tierOf(manifest, path), text: isText(bytes) !== null, size: bytes.length, web: isWebPath(manifest, path) })
    }
    return { release: release.id, fingerprint: release.fingerprint, files }
  }

  async file(name: string, user: User, path: string, versionId?: string | null) {
    await this.#demand(name, user, 'app.read')
    const release = await this.#version(name, versionId)
    if (!(path in release.files)) throw new AccessError(`${release.id} 没有文件 ${path}`, 404)
    const bytes = await this.kernel.blob(release.files[path])
    return { release: release.id, path, tier: tierOf(this.kernel.app(name).manifest, path), text: isText(bytes), size: bytes.length, hash: release.files[path] }
  }

  /** A version's file as bytes, for previews and downloads. */
  async raw(name: string, user: User, path: string, versionId?: string | null): Promise<{ bytes: Uint8Array; name: string; type: string }> {
    await this.#demand(name, user, 'app.read')
    const release = await this.#version(name, versionId)
    if (!(path in release.files)) throw new AccessError(`${release.id} 没有文件 ${path}`, 404)
    return { bytes: await this.kernel.blob(release.files[path]), name: basename(path), type: mimeOf(path) }
  }

  /** Files that differ between two releases (or a release and the source directory). */
  async diff(name: string, user: User, from: string, to: string) {
    await this.#demand(name, user, 'app.read')
    const a = await this.kernel.version(name, from)
    const fromTexts = await this.kernel.textFiles(a)
    let toFiles: Record<string, string>
    let toTexts: Map<string, string>
    if (to === 'source') {
      const { source } = this.kernel.app(name)
      toFiles = {}
      toTexts = new Map()
      for (const path of await source.list()) {
        const bytes = await source.read(path)
        toFiles[path] = hashContent(bytes)
        try {
          toTexts.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
          // binary
        }
      }
    } else {
      const b = await this.kernel.version(name, to)
      toFiles = b.files
      toTexts = await this.kernel.textFiles(b)
    }
    const { manifest } = this.kernel.app(name)
    const paths = [...new Set([...Object.keys(a.files), ...Object.keys(toFiles)])].sort()
    return paths
      .filter((p) => a.files[p] !== toFiles[p])
      .map((path) => ({
        path,
        tier: tierOf(manifest, path),
        status: !(path in a.files) ? 'added' : !(path in toFiles) ? 'removed' : 'changed',
        before: fromTexts.get(path) ?? null,
        after: toTexts.get(path) ?? null,
        binary: (path in a.files && !fromTexts.has(path)) || (path in toFiles && !toTexts.has(path)),
      }))
  }

  // ── releases ──────────────────────────────────────────────────

  async releases(name: string, user: User) {
    await this.#demand(name, user, 'app.read')
    const channels = await this.kernel.channels(name)
    const proposals = await this.kernel.proposals(name)
    const releases = await this.kernel.releases(name)
    const sizes = new Map<string, number>()
    const sizeOf = async (hash: string) => {
      if (!sizes.has(hash)) sizes.set(hash, (await this.kernel.blob(hash)).length)
      return sizes.get(hash)!
    }
    const rows = []
    for (const r of releases) {
      let bytes = 0
      for (const hash of Object.values(r.files)) bytes += await sizeOf(hash)
      const parent = r.parent ? releases.find((x) => x.id === r.parent) : undefined
      const changed = parent ? Object.keys({ ...parent.files, ...r.files }).filter((p) => parent.files[p] !== r.files[p]).length : Object.keys(r.files).length
      const p = proposals.find((x) => x.id === r.proposal) ?? null
      rows.push({ id: r.id, parent: r.parent, createdAt: r.createdAt, origin: r.origin, proposal: p && { id: p.id, title: p.title, tier: p.tier, author: p.author }, note: r.note, files: Object.keys(r.files).length, bytes, changed, fingerprint: r.fingerprint })
    }
    return {
      channels,
      releases: rows.reverse(),
      storage: { ...this.files.status, blobs: this.blobStore, unique: sizes.size, bytes: [...sizes.values()].reduce((a, b) => a + b, 0) },
    }
  }

  async rollback(name: string, user: User, to: string, reason: string) {
    await this.#demand(name, user, 'release.rollback')
    if (!reason.trim()) throw new AccessError('回滚需要写明原因', 400)
    return this.kernel.rollback(name, to, `${user.name} 回滚：${reason.trim()}`)
  }

  async importSource(name: string, user: User, note: string) {
    await this.#demand(name, user, 'release.import')
    if (!note.trim()) throw new AccessError('需要写明这次人工变更的说明', 400)
    const changed = await this.diff(name, user, (await this.kernel.stable(name)).id, 'source')
    if (changed.length === 0) throw new AccessError('源目录与稳定版本一致，没有可导入的变更', 400)
    await this.files.pushDir(`${name}/code`)
    const release = await this.kernel.importSource(name, `${user.name} 人工导入：${note.trim()}`)
    await this.announce(name)
    return release
  }

  // ── signals, issues, proposals ────────────────────────────────

  async #issueStates(name: string): Promise<Record<string, { status: 'dismissed'; by: string; at: string; reason: string }>> {
    return (await this.#json<Record<string, Record<string, { status: 'dismissed'; by: string; at: string; reason: string }>>>('issues.json', {}))[name] ?? {}
  }

  async improvements(name: string, user: User) {
    await this.#demand(name, user, 'app.read')
    const signals = await this.kernel.signals(name)
    const issues = await this.kernel.issues(name)
    const proposals = await this.kernel.proposals(name)
    const states = await this.#issueStates(name)
    const brief = (s: Signal) => {
      const { context, ...rest } = s
      const ctx = (context ?? {}) as { task?: string; title?: string }
      return { ...rest, task: ctx.task ?? null, taskTitle: ctx.title ?? null, hasContext: Boolean(context) }
    }
    return {
      issues: issues.map((i) => ({
        ...i,
        signals: signals.filter((s) => i.signals.includes(s.id)).map(brief),
        proposals: proposals.filter((p) => p.issue === i.id).map((p) => ({ id: p.id, title: p.title, status: p.status, release: p.release })),
        state: states[i.id] ?? null,
      })),
      taskOnly: signals.filter((s) => s.scope.level === 'task' && s.kind !== 'confirmation').length,
      confirmations: signals.filter((s) => s.kind === 'confirmation').length,
      suggestions: signals.filter((s) => s.kind === 'suggestion').length,
      total: signals.length,
    }
  }

  /** One signal with everything the person saw: input, the agent's output, corrections, attachments. */
  async signal(name: string, user: User, id: string) {
    await this.#demand(name, user, 'app.read')
    const s = (await this.kernel.signals(name)).find((x) => x.id === id)
    if (!s) throw new AccessError(`没有信号 ${id}`, 404)
    const issue = (await this.kernel.issues(name)).find((i) => i.signals.includes(id)) ?? null
    return { ...s, issue: issue?.id ?? null }
  }

  /** Close an issue without changing the app (not a real problem, a one-off, already handled); can be reopened. */
  async setIssueState(name: string, user: User, issueId: string, body: { dismissed: boolean; reason?: string }) {
    await this.#demand(name, user, 'proposal.create')
    if (!(await this.kernel.issues(name)).some((i) => i.id === issueId)) throw new AccessError(`没有问题 ${issueId}`, 404)
    const all = await this.#json<Record<string, Record<string, unknown>>>('issues.json', {})
    const states = { ...(all[name] ?? {}) }
    if (body.dismissed) {
      if (!body.reason?.trim()) throw new AccessError('不采纳需要写明原因，提出的人会看到', 400)
      states[issueId] = { status: 'dismissed', by: user.name, at: this.#now(), reason: body.reason.trim() }
    } else delete states[issueId]
    all[name] = states
    await this.#save('issues.json', all)
    return this.improvements(name, user)
  }

  async proposals(name: string, user: User) {
    await this.#demand(name, user, 'app.read')
    return (await this.kernel.proposals(name)).map((p) => ({ id: p.id, title: p.title, author: p.author, tier: p.tier, status: p.status, base: p.base, release: p.release, createdAt: p.createdAt, issue: p.issue, files: [...new Set(p.changes.map((c) => c.path))], passed: p.verification?.passed ?? null })).reverse()
  }

  async proposal(name: string, user: User, id: string) {
    await this.#demand(name, user, 'app.read')
    const p = await this.kernel.proposal(name, id)
    const base = await this.kernel.release(name, p.base)
    const texts = await this.kernel.textFiles(base)
    const stable = await this.kernel.stable(name)
    const paths = [...new Set(p.changes.map((c) => c.path))]
    const { manifest } = this.kernel.app(name)
    return {
      ...p,
      recordMarkdown: renderRecord(p.record, p.status),
      before: Object.fromEntries(paths.map((path) => [path, texts.get(path) ?? null])),
      existed: Object.fromEntries(paths.map((path) => [path, path in base.files])),
      webOnly: paths.every((path) => isWebPath(manifest, path)),
      stable: stable.id,
      required: p.tier === 'contract' ? [] : approvalRoles(p.tier, await this.approvalPolicy(name)),
    }
  }

  /** Store an uploaded file's content for a proposal (`puts`). @returns its hash and size. */
  async putBlob(name: string, user: User, bytes: Uint8Array) {
    await this.#demand(name, user, 'proposal.create')
    if (bytes.length === 0) throw new AccessError('文件是空的', 400)
    if (bytes.length > MAX_UPLOAD) throw new AccessError(`文件超过 ${MAX_UPLOAD / 1024 / 1024} MB`, 413)
    return { blob: await this.kernel.putBlob(bytes), size: bytes.length }
  }

  /** Manual correction: a person edits evolvable files; whole-file edits become anchored changes. */
  async submitProposal(
    name: string,
    user: User,
    body: { title: string; record: DecisionRecord; edits?: { path: string; text: string }[]; puts?: { path: string; blob: string; size?: number }[]; deletes?: string[]; changes?: Change[]; issue?: string | null },
  ) {
    await this.#demand(name, user, 'proposal.create')
    if (!body.title?.trim()) throw new AccessError('提案需要标题', 400)
    const stable = await this.kernel.stable(name)
    const texts = await this.kernel.textFiles(stable)
    const changes: Change[] = [...(body.changes ?? [])]
    for (const edit of body.edits ?? []) {
      const current = texts.get(edit.path)
      if (current === undefined && edit.path in stable.files) changes.push({ path: edit.path, op: 'put', blob: await this.kernel.putBlob(new TextEncoder().encode(edit.text)) })
      else if (current === undefined) changes.push({ path: edit.path, op: 'create', text: edit.text })
      else if (current !== edit.text) changes.push({ path: edit.path, op: 'replace', find: current, text: edit.text })
    }
    for (const put of body.puts ?? []) changes.push({ path: safeRelPath(put.path), op: 'put', blob: put.blob, size: put.size })
    for (const path of body.deletes ?? []) changes.push({ path: safeRelPath(path), op: 'delete' })
    const record: DecisionRecord = { ...body.record, title: body.record?.title || body.title, date: body.record?.date || this.#now().slice(0, 10), options: body.record?.options ?? [] }
    return this.kernel.submit(name, { title: body.title.trim(), changes, record }, `human:${user.name}`, body.issue ?? null)
  }

  /** AI correction: from an issue, or from a free instruction recorded as an app-wide instruction signal first. */
  async draftProposal(name: string, user: User, body: { issue?: string; instruction?: string }) {
    await this.#demand(name, user, 'proposal.create')
    if (!this.#model) throw new AccessError(this.modelStatus.note, 503)
    let issueId = body.issue
    if (!issueId) {
      if (!body.instruction?.trim()) throw new AccessError('请说明要改什么', 400)
      const stable = await this.kernel.stable(name)
      const signal = await this.kernel.recordSignal(name, { kind: 'instruction', release: stable.id, scope: { level: 'app' }, by: user.name, note: body.instruction.trim() })
      issueId = (await this.kernel.issues(name)).find((i) => i.signals.includes(signal.id))?.id
    }
    if (!issueId) throw new AccessError('没有找到对应的问题', 400)
    const issue = (await this.kernel.issues(name)).find((i) => i.id === issueId)
    const signals = await this.kernel.signals(name)
    if (issue?.signals.some((id) => isProductSignal(signals.find((s) => s.id === id) ?? {}))) throw new AccessError('界面和功能建议要改应用的代码，请用“AI 修改”交给编码助手', 400)
    return this.kernel.propose(name, issueId, LEARNER)
  }

  async verify(name: string, user: User, id: string) {
    await this.#demand(name, user, 'proposal.verify')
    return this.kernel.verify(name, id)
  }

  async decide(name: string, user: User, id: string, body: { role: 'owner' | 'engineer'; ok: boolean; note?: string }) {
    if (!this.#apps.includes(name)) throw new AccessError(`没有应用 ${name}`, 404)
    const p = await this.kernel.proposal(name, id)
    demandApproval(await this.directory(), name, user, body.role, p.approvals)
    if (!body.ok && !body.note?.trim()) throw new AccessError('驳回需要写明原因', 400)
    const required = approvalRoles(p.tier, await this.approvalPolicy(name))
    return this.kernel.decide(name, id, { role: body.role, by: user.name, at: this.#now(), ok: body.ok, note: body.note?.trim() || undefined }, required)
  }

  // ── business tasks ────────────────────────────────────────────

  async tasks(name: string): Promise<Task[]> {
    return (await this.#store.list<Task>('tasks')).filter((t) => t.app === name).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Tasks people see: everyone's real tasks; trials only for those who may try versions. */
  async listTasks(name: string, user: User, opts: { version?: string | null } = {}) {
    await this.#demand(name, user, 'app.use')
    const trials = permissionsOf(await this.directory(), name, user).includes('app.trial')
    const users = await this.users()
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id
    const runs = new Map((await this.kernel.runs(name)).map((r) => [r.id, r]))
    const version = opts.version && opts.version !== (await this.kernel.channels(name)).stable ? opts.version : null
    return (await this.tasks(name))
      .filter((t) => (version ? trials && t.trial?.version === version : !t.trial))
      .map((t) => {
        const last = runs.get(t.runs.at(-1) ?? '')
        return { ...t, createdByName: nameOf(t.createdBy), run: last ? { ...last, result: { ...last.result, output: null } } : null }
      })
  }

  async #task(name: string, id: string): Promise<Task> {
    const task = await this.#store.get<Task>('tasks', id)
    if (!task || task.app !== name) throw new AccessError(`没有单据 ${id}`, 404)
    return task
  }

  async task(name: string, user: User, id: string) {
    await this.#demand(name, user, 'app.use')
    const task = await this.#task(name, id)
    if (task.trial) await this.#demand(name, user, 'app.trial')
    const runs = (await this.kernel.runs(name)).filter((r) => task.runs.includes(r.id))
    const users = await this.users()
    return { ...task, suggestions: task.suggestions ?? [], createdByName: users.find((u) => u.id === task.createdBy)?.name ?? task.createdBy, run: runs.at(-1) ?? null, runCount: runs.length }
  }

  async #nextTaskId(): Promise<string> {
    let n: number
    if (this.#store.next) n = await this.#store.next('task')
    else {
      n = ((await this.#store.get<{ n: number }>('counters', 'task'))?.n ?? 0) + 1
      await this.#store.put('counters', 'task', { n })
    }
    return `T-${String(n).padStart(4, '0')}`
  }

  /**
   * Create a task and start its first run. With `version` it is a trial on that release or
   * proposal candidate: only people who may try versions can do it, and it never feeds evolution.
   * Resolves once the run is recorded unless `wait` is false.
   */
  async createTask(name: string, user: User, body: { title?: string; input: unknown; caseId?: string; version?: string | null }, opts: { wait?: boolean } = {}) {
    await this.#demand(name, user, 'app.use')
    const stable = (await this.kernel.channels(name)).stable
    const version = body.version && body.version !== stable ? body.version : null
    if (version) {
      await this.#demand(name, user, 'app.trial')
      await this.kernel.version(name, version)
    }
    const task: Task = {
      id: await this.#nextTaskId(),
      app: name,
      title: body.title?.trim() || '未命名',
      createdBy: user.id,
      createdAt: this.#now(),
      input: body.input,
      runs: [],
      state: 'running',
      outcome: null,
      working: null,
      corrections: [],
      suggestions: [],
      confirmed: null,
      artifacts: [],
      ...(version ? { trial: { version, by: user.name } } : {}),
    }
    await this.#store.put('tasks', task.id, task)
    await this.#dispatch(task, body.caseId, opts.wait !== false)
    return this.task(name, user, task.id)
  }

  /**
   * Run a task: in this process with one instance, otherwise as a queued job any instance may
   * take (and another takes over if that one stops). `wait` resolves once the task is ready.
   */
  async #dispatch(task: Task, caseId: string | undefined, wait: boolean): Promise<void> {
    if (this.jobs.driver === 'inline') {
      const running = this.#run(task, caseId)
      if (wait) await running
      else running.catch(() => undefined)
      return
    }
    await this.jobs.submit('task.run', { task: task.id, ...(caseId ? { caseId } : {}) })
    if (!wait) return
    const until = Date.now() + 60 * 60_000
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 400))
      if ((await this.#store.get<Task>('tasks', task.id))?.state !== 'running') return
    }
  }

  async #runQueued(id: string, caseId: string | undefined, reclaimed: boolean): Promise<void> {
    const task = await this.#store.get<Task>('tasks', id)
    if (!task || task.state !== 'running') return
    if (reclaimed) process.stderr.write(`[rsi] 接手执行单据 ${id}（原实例已停止）\n`)
    await this.#run(task, caseId)
  }

  async rerun(name: string, user: User, id: string, input?: unknown) {
    await this.#demand(name, user, 'app.use')
    const task = await this.#task(name, id)
    if (task.confirmed) throw new AccessError('单据已确认，不能重新执行', 409)
    if (input !== undefined) task.input = input
    task.state = 'running'
    task.corrections = []
    await this.#store.put('tasks', task.id, task)
    await this.#dispatch(task, undefined, true)
    return this.task(name, user, id)
  }

  /** Materials named in an input must be on local disk before an executor reads them. */
  async ensureLocal(value: unknown): Promise<void> {
    if (typeof value === 'string') {
      if (READABLE.some((re) => re.test(value))) await this.files.local(value).catch(() => undefined)
    } else if (Array.isArray(value)) for (const v of value) await this.ensureLocal(v)
    else if (value && typeof value === 'object') for (const v of Object.values(value)) await this.ensureLocal(v)
  }

  async #run(task: Task, caseId?: string): Promise<void> {
    let fresh: Task
    const input = this.#currentPaths(task.input)
    await this.ensureLocal(input)
    try {
      const run = await this.kernel.runTask(task.app, { input, caseId, release: task.trial?.version })
      fresh = (await this.#store.get<Task>('tasks', task.id)) ?? task
      fresh.runs.push(run.id)
      fresh.state = 'ready'
      fresh.outcome = run.result.status
      fresh.working = run.result.output
    } catch (error) {
      fresh = (await this.#store.get<Task>('tasks', task.id)) ?? task
      fresh.state = 'ready'
      fresh.outcome = 'error'
      fresh.working = null
      ;(fresh as Task & { error?: string }).error = (error as Error).message
    }
    await this.#store.put('tasks', fresh.id, fresh)
  }

  /** What the person sees right now, kept with every signal so improvements can be analysed in full. */
  async #context(task: Task, runId: string) {
    const run = (await this.kernel.runs(task.app)).find((r) => r.id === runId)
    return {
      task: task.id,
      title: task.title,
      input: task.input,
      output: run?.result.output ?? null,
      status: run?.result.status ?? task.outcome,
      working: task.working,
      corrections: task.corrections.map((c) => ({ field: c.field, path: c.path, before: c.before, after: c.after, note: c.note, by: c.by })),
      suggestions: (task.suggestions ?? []).map((s) => ({ target: s.target, note: s.note, by: s.by })),
      instructions: run?.instructions ?? [],
      executor: run ? `${run.result.executor}${run.result.note ? `：${run.result.note}` : ''}` : null,
    }
  }

  #lastRun(task: Task): string {
    const runId = task.runs.at(-1)
    if (!runId || task.working === null) throw new AccessError('单据还没有结果', 409)
    return runId
  }

  /**
   * A person changes one value. The working copy changes, and the change becomes a kernel
   * signal with the scope the person chose and the whole task as context; task-scoped
   * signals never become issues, trial tasks never become signals.
   */
  async correct(name: string, user: User, id: string, body: { path: string; field: string; value: string; note?: string; scope: SignalScope; label?: string }) {
    await this.#demand(name, user, 'signal.record')
    const task = await this.#task(name, id)
    if (task.confirmed) throw new AccessError('单据已确认，不能再修改', 409)
    const runId = this.#lastRun(task)
    const run = (await this.kernel.runs(name)).find((r) => r.id === runId)!
    const before = getPath(task.working, body.path)
    const beforeText = typeof before === 'string' ? before : JSON.stringify(before ?? '')
    task.working = setPath(task.working, body.path, body.value)
    let signal = ''
    if (!task.trial) {
      const recorded = await this.kernel.recordSignal(name, {
        kind: 'correction',
        release: run.release,
        run: run.id,
        field: body.field,
        before: beforeText,
        after: body.value,
        target: { level: 'field', path: body.field, label: body.label?.trim() || undefined },
        note: body.note?.trim() || undefined,
        scope: body.scope,
        by: user.name,
        context: await this.#context({ ...task, corrections: [...task.corrections, { at: '', by: user.name, run: run.id, path: body.path, field: body.field, before: beforeText, after: body.value, note: body.note, scope: body.scope, signal: '' }] }, run.id),
      })
      signal = recorded.id
    }
    task.corrections.push({ at: this.#now(), by: user.name, run: run.id, path: body.path, field: body.field, before: beforeText, after: body.value, note: body.note?.trim() || undefined, scope: body.scope, signal })
    await this.#store.put('tasks', task.id, task)
    return this.task(name, user, id)
  }

  /**
   * A person suggests how the app should handle a region of the result (a section, a table,
   * some rows) or the whole task: a rule, an order of reading, a missing step. It becomes a
   * signal with the whole task as context and any files the person attached.
   */
  async suggest(name: string, user: User, id: string, body: { target?: SignalTarget; note: string; scope: SignalScope; attachments?: { path: string; name: string; size: number }[] }) {
    await this.#demand(name, user, 'signal.record')
    const task = await this.#task(name, id)
    if (!body.note?.trim()) throw new AccessError('请写下建议', 400)
    const runId = task.runs.at(-1)
    if (!runId) throw new AccessError('单据还没有运行过', 409)
    const run = (await this.kernel.runs(name)).find((r) => r.id === runId)!
    const product = productTarget(body.target)
    const target: SignalTarget = product ?? (body.target?.level === 'region' || body.target?.level === 'field' ? { level: body.target.level, path: body.target.path, label: body.target.label?.trim() || undefined } : { level: 'task', label: body.target?.label?.trim() || undefined })
    const scope: SignalScope = product ? { level: 'app' } : body.scope
    const attachments = (body.attachments ?? []).map((a) => ({ path: a.path, name: a.name, size: a.size }))
    for (const a of attachments) this.resolveFile(a.path)
    let signal = ''
    // a trial's results never teach the app, but what people say about its pages and abilities does
    if (!task.trial || product) {
      const recorded = await this.kernel.recordSignal(name, {
        kind: 'suggestion',
        release: run.release,
        run: run.id,
        target,
        note: body.note.trim(),
        scope,
        by: user.name,
        attachments,
        context: await this.#context(task, run.id),
      })
      signal = recorded.id
    }
    task.suggestions = [...(task.suggestions ?? []), { at: this.#now(), by: user.name, run: run.id, target, note: body.note.trim(), scope, attachments, signal }]
    await this.#store.put('tasks', task.id, task)
    return this.task(name, user, id)
  }

  /**
   * A person suggests a change to the app itself rather than to one task's result: how a page
   * looks or works (`ui`), or something the app should be able to do (`feature`). It needs no
   * task; when the person was looking at one, its content goes along. Always app-wide.
   */
  async suggestApp(name: string, user: User, body: { target?: SignalTarget; note: string; task?: string | null; version?: string | null; attachments?: { path: string; name: string; size: number }[] }) {
    await this.#demand(name, user, 'signal.record')
    const target = productTarget(body.target)
    if (!target) throw new AccessError('请说明是对界面还是功能的建议；对处理结果的意见请在单据里提', 400)
    if (!body.note?.trim()) throw new AccessError('请写下建议', 400)
    const attachments = (body.attachments ?? []).map((a) => ({ path: a.path, name: a.name, size: a.size }))
    for (const a of attachments) this.resolveFile(a.path)
    const task = body.task ? await this.#store.get<Task>('tasks', body.task) : undefined
    const seen = task?.app === name ? task : undefined
    const runId = seen?.runs.at(-1)
    const stable = await this.kernel.stable(name)
    const release = body.version && (await this.kernel.releases(name)).some((r) => r.id === body.version) ? body.version : (seen?.trial?.version ?? stable.id)
    const context = { page: target.level === 'ui' ? (target.path ?? null) : null, version: release, ...(seen && runId ? await this.#context(seen, runId) : {}) }
    const signal = await this.kernel.recordSignal(name, { kind: 'suggestion', release, ...(runId ? { run: runId } : {}), target, note: body.note.trim(), scope: { level: 'app' }, by: user.name, attachments, context })
    if (seen) {
      seen.suggestions = [...(seen.suggestions ?? []), { at: this.#now(), by: user.name, run: runId ?? '', target, note: body.note.trim(), scope: { level: 'app' }, attachments, signal: signal.id }]
      await this.#store.put('tasks', seen.id, seen)
    }
    return { signal: signal.id, issue: (await this.kernel.issues(name)).find((i) => i.signals.includes(signal.id))?.id ?? null }
  }

  /** Confirm a task. With no corrections this is itself a signal: the result was right. */
  async confirm(name: string, user: User, id: string) {
    await this.#demand(name, user, 'app.use')
    const task = await this.#task(name, id)
    if (task.state !== 'ready' || task.working === null) throw new AccessError('单据没有可确认的结果', 409)
    const run = (await this.kernel.runs(name)).find((r) => r.id === this.#lastRun(task))!
    if (task.corrections.length === 0 && !task.trial) await this.kernel.recordSignal(name, { kind: 'confirmation', release: run.release, run: run.id, scope: { level: 'task' }, by: user.name, note: '人工确认无误' })
    task.state = 'confirmed'
    task.confirmed = { by: user.name, at: this.#now() }
    await this.#store.put('tasks', task.id, task)
    return this.task(name, user, id)
  }

  /** Run an app-declared action (e.g. render a document) in the task's version directory. */
  async action(name: string, user: User, id: string, actionName: string) {
    await this.#demand(name, user, 'app.use')
    const task = await this.#task(name, id)
    const action = ((await this.#manifestRaw(name)).actions as Record<string, AppAction> | undefined)?.[actionName]
    if (!action) throw new AccessError(`应用没有声明动作 ${actionName}`, 404)
    if (action.requiresConfirmed && !task.confirmed) throw new AccessError(`先确认单据，再${action.title}`, 409)
    const run = (await this.kernel.runs(name)).find((r) => r.id === task.runs.at(-1))
    if (!run) throw new AccessError('单据还没有结果', 409)
    const dir = await this.kernel.materialize(name, run.release)
    const artifactId = `${actionName}-${task.artifacts.length + 1}`
    const { ok, outputFile, report } = await runAction(action, task.working, dir, join(this.stateDir, 'artifacts', task.id), artifactId)
    if (ok) await this.files.write(relative(this.home, outputFile).split(sep).join('/'), await readFile(outputFile))
    const artifact: Artifact = { id: artifactId, action: actionName, title: action.title, file: ok ? relative(this.stateDir, outputFile) : '', at: this.#now(), by: user.name, ok, report }
    task.artifacts.push(artifact)
    await this.#store.put('tasks', task.id, task)
    return this.task(name, user, id)
  }

  async artifactPath(name: string, user: User, id: string, artifactId: string): Promise<string> {
    await this.#demand(name, user, 'app.use')
    const task = await this.#store.get<Task>('tasks', id)
    const artifact = task?.app === name ? task.artifacts.find((a) => a.id === artifactId && a.ok) : undefined
    if (!artifact) throw new AccessError('没有这个文件', 404)
    return this.files.local(relative(this.home, join(this.stateDir, artifact.file)).split(sep).join('/'))
  }

  /** What became of one person's corrections and suggestions: recorded → grouped into an issue → proposal → release, or not adopted. */
  async contributions(name: string, user: User) {
    await this.#demand(name, user, 'app.use')
    const signals = (await this.kernel.signals(name)).filter((s) => s.by === user.name && s.kind !== 'confirmation')
    const issues = await this.kernel.issues(name)
    const proposals = await this.kernel.proposals(name)
    const states = await this.#issueStates(name)
    return signals.map((s) => {
      const issue = issues.find((i) => i.signals.includes(s.id)) ?? null
      const ps = issue ? proposals.filter((p) => p.issue === issue.id) : []
      const released = ps.find((p) => p.status === 'released')
      const dismissed = issue ? states[issue.id] : undefined
      const stage = released ? 'released' : dismissed ? 'dismissed' : ps.length ? 'proposed' : issue ? 'queued' : 'task-only'
      return {
        signal: s.id,
        at: s.at,
        kind: s.kind,
        field: s.field ?? s.target?.label ?? s.target?.path,
        note: s.note,
        before: s.before,
        after: s.after,
        scope: s.scope,
        issue: issue?.id ?? null,
        proposal: (released ?? ps.at(-1))?.id ?? null,
        release: released?.release ?? null,
        reason: dismissed?.reason ?? null,
        stage,
      }
    })
  }

  // ── files ─────────────────────────────────────────────────────

  async upload(name: string, user: User, fileName: string, bytes: Uint8Array) {
    await this.#demand(name, user, 'app.use')
    return this.storeUpload(fileName, bytes)
  }

  /** Keep an uploaded material under its content hash; callers check who may upload. */
  async storeUpload(fileName: string, bytes: Uint8Array) {
    if (bytes.length === 0) throw new AccessError('文件为空', 400)
    if (bytes.length > MAX_UPLOAD) throw new AccessError(`文件超过 ${MAX_UPLOAD / 1024 / 1024} MB`, 413)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const safe = basename(fileName).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || `file${extname(fileName)}`
    const rel = `${UPLOAD_DIR}/${sha256}/${safe}`
    await this.files.write(rel, bytes)
    return { path: rel, sha256, name: safe, size: bytes.length }
  }

  /** Resolve a home-relative material a user may read, or throw. @returns the home-relative path. */
  resolveFile(path: string): string {
    const abs = resolve(this.home, path)
    const rel = relative(this.home, abs).split(sep).join('/')
    if (rel.startsWith('..') || !READABLE.some((re) => re.test(rel))) throw new AccessError('这个文件不在可访问的材料目录里', 404)
    return this.#current(rel)
  }

  /** Where a material named by an older record lives now. */
  #current(rel: string): string {
    const m = LEGACY_MATERIAL.exec(rel)
    if (!m || existsSync(join(this.home, rel))) return rel
    const moved = `${m[1]}/evals/cases/${m[2]}/input/${m[3]}`
    return existsSync(join(this.home, moved)) ? moved : rel
  }

  /**
   * Task input as an executor outside the home sees it: readable material paths become absolute.
   * For an app still in a workspace, `<app>/evals/...` means the workspace's own `evals/`.
   */
  executorInput(value: unknown, workspace?: { app: string; root: string }): unknown {
    if (typeof value === 'string') {
      const own = workspace && value.startsWith(`${workspace.app}/evals/`) ? value.slice(workspace.app.length + 1) : null
      if (own !== null && !own.split('/').includes('..')) return join(workspace!.root, own)
      return READABLE.some((re) => re.test(value)) ? join(this.home, this.#current(value)) : value
    }
    if (Array.isArray(value)) return value.map((v) => this.executorInput(v, workspace))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.executorInput(v, workspace)]))
    return value
  }

  #currentPaths(value: unknown): unknown {
    if (typeof value === 'string') return LEGACY_MATERIAL.test(value) ? this.#current(value) : value
    if (Array.isArray(value)) return value.map((v) => this.#currentPaths(v))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.#currentPaths(v)]))
    return value
  }

  /** A material's bytes, fetched from storage when the local copy is missing. */
  async material(path: string): Promise<{ bytes: Uint8Array; name: string; type: string }> {
    const rel = this.resolveFile(path)
    return { bytes: await this.files.read(rel), name: basename(rel), type: mimeOf(rel) }
  }

  async me(user: User) {
    const dir = await this.directory()
    return {
      user,
      system: systemPermissionsOf(dir, user),
      roles: user.roles.map((r) => dir.roles.find((x) => x.id === r)?.name ?? r),
      apps: visibleApps(dir, this.appNames(), user).map((name) => ({ name, level: levelOf(dir, name, user)!, label: LEVEL_LABEL[levelOf(dir, name, user)!] })),
    }
  }

}

/** Name of the model-backed learner the server registers when a model is configured. */
export const LEARNER = 'reflective'
