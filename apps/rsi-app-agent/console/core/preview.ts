/**
 * Try what a build session has made before publishing it: the app's own web application built
 * from the workspace, and tasks run on the workspace's files in a scratch kernel. Preview tasks stay in
 * the session; they never become signals and never touch the app's real tasks.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { FsAppSource, FsTree, parseManifest } from '../../rsi-kernel/src/index.ts'
import type { Release, RsiKernel, Run, SignalScope, SignalTarget } from '../../rsi-kernel/src/index.ts'
import { actionSummaries, runAction } from './actions.ts'
import type { AppAction } from './actions.ts'
import { productTarget } from './console.ts'
import type { Artifact, Console, Correction, Suggestion } from './console.ts'
import { mimeOf } from './console.ts'
import { getPath, setPath } from './paths.ts'
import { AccessError, GRANTS } from './rbac.ts'
import type { User } from './rbac.ts'
import type { WebSite } from './webhost.ts'
import { AppInfra } from './appinfra.ts'

interface PreviewTask {
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
  suggestions: Suggestion[]
  confirmed: { by: string; at: string } | null
  artifacts: Artifact[]
  trial: { version: string; by: string }
  run: Run | null
  error?: string
}

export interface PreviewHost {
  console: Console
  /** The session, if the user may see it; throws otherwise. */
  session(user: User, id: string): Promise<{ id: string; app: string; base: string | null }>
  /** Directory of the session's state (the workspace is `workspace/` inside it). */
  dir(id: string): string
  scratch(dir: string, workspace?: { app: string; root: string }): RsiKernel
  now(): string
}

/** Stands in for a version id: the scratch kernel's own release ids would read like the app's real ones. */
const WORKSPACE_LABEL = '工作区'

export class BuildPreview {
  readonly #host: PreviewHost
  readonly #kernels = new Map<string, Promise<{ fingerprint: string; kernel: RsiKernel; release: Release }>>()

  constructor(host: PreviewHost) {
    this.#host = host
  }

  #workspace(id: string) {
    return join(this.#host.dir(id), 'workspace')
  }

  #root(id: string) {
    return join(this.#host.dir(id), 'preview')
  }

  async #manifestRaw(id: string): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(join(this.#workspace(id), 'code/app.json'), 'utf8')) as Record<string, unknown>
    } catch (error) {
      throw new AccessError(`code/app.json 读不了：${(error as Error).message}`, 400)
    }
  }

  async #manifest(id: string) {
    try {
      return parseManifest(await this.#manifestRaw(id))
    } catch (error) {
      throw new AccessError(`应用清单有问题，先在“检查”里修好：${(error as Error).message}`, 400)
    }
  }

  /** Content hash of files under `dir` (relative to the workspace), so a preview rebuilds only after a change. */
  async #fingerprint(id: string, under: string): Promise<string> {
    const dir = join(this.#workspace(id), under)
    const hash = createHash('sha256')
    if (existsSync(dir)) for (const path of await new FsTree(dir).list()) hash.update(`${path}\0`).update(await readFile(join(dir, path))).update('\0')
    return hash.digest('hex').slice(0, 16)
  }

  /** What the preview page needs: the app as its web application sees it, and where that application is. */
  async view(user: User, id: string) {
    const s = await this.#host.session(user, id)
    const raw = await this.#manifestRaw(id)
    const manifest = await this.#manifest(id)
    return {
      app: {
        name: manifest.name,
        title: manifest.title,
        description: manifest.description,
        stable: s.base ?? WORKSPACE_LABEL,
        level: 'manage' as const,
        permissions: GRANTS.manage,
        actions: actionSummaries(raw),
        scopes: manifest.scopes,
        hasWeb: Boolean(manifest.web),
      },
      web: manifest.web ? { base: `/apps/${manifest.name}/w/${id}`, fingerprint: await this.#fingerprint(id, `code/${manifest.web}`) } : null,
    }
  }

  /** The workspace's web application, for the platform to build, run and proxy; null without one. */
  async webSite(user: User, id: string): Promise<WebSite | null> {
    const s = await this.#host.session(user, id)
    const manifest = await this.#manifest(id)
    if (!manifest.web) return null
    const dir = join(this.#workspace(id), 'code', manifest.web)
    if (!existsSync(dir)) throw new AccessError(`code/${manifest.web}/ 不存在`, 404)
    const infra = this.#host.console.infra
    return {
      base: `/apps/${s.app}/w/${id}`,
      fingerprint: await this.#fingerprint(id, `code/${manifest.web}`),
      source: async () => dir,
      env: { NEXT_PUBLIC_RSI_APP: s.app, NEXT_PUBLIC_RSI_VERSION: WORKSPACE_LABEL, NEXT_PUBLIC_RSI_API: `/api/builds/${id}/preview`, NEXT_PUBLIC_RSI_PREVIEW: '1' },
      ...(infra ? { resources: async () => AppInfra.variables(await infra.ensure(s.app, 'dev')) } : {}),
    }
  }

  /** A scratch kernel with the workspace installed, reused until the workspace's files change. */
  async #kernel(id: string, app: string) {
    const fingerprint = await this.#fingerprint(id, '.')
    const cached = this.#kernels.get(id)
    if (cached && (await cached.catch(() => null))?.fingerprint === fingerprint) return cached
    const store = join(this.#root(id), 'kernel')
    const loading = (async () => {
      await rm(store, { recursive: true, force: true })
      await mkdir(store, { recursive: true })
      const kernel = this.#host.scratch(store, { app, root: this.#workspace(id) })
      const { release } = await kernel.install(new FsAppSource(this.#workspace(id)), '工作区预览')
      if (release.app !== app) throw new AccessError(`应用标识变成了 ${release.app}，和会话的 ${app} 不一致`, 400)
      return { fingerprint, kernel, release }
    })()
    loading.catch(() => this.#kernels.delete(id))
    this.#kernels.set(id, loading)
    return loading
  }

  // ── tasks ─────────────────────────────────────────────────────

  #file(id: string, task: string) {
    if (!/^PV-\d+$/.test(task)) throw new AccessError(`没有预览单据 ${task}`, 404)
    return join(this.#root(id), 'tasks', `${task}.json`)
  }

  get #docs() {
    return this.#host.console.docs
  }

  async #load(id: string, task: string): Promise<PreviewTask> {
    if (this.#docs) {
      this.#file(id, task)
      const found = await this.#docs.get<PreviewTask>('preview.tasks', `${id}/${task}`)
      if (!found) throw new AccessError(`没有预览单据 ${task}`, 404)
      return found
    }
    try {
      return JSON.parse(await readFile(this.#file(id, task), 'utf8')) as PreviewTask
    } catch {
      throw new AccessError(`没有预览单据 ${task}`, 404)
    }
  }

  async #save(id: string, task: PreviewTask) {
    if (this.#docs) return this.#docs.put('preview.tasks', `${id}/${task.id}`, task)
    await mkdir(join(this.#root(id), 'tasks'), { recursive: true })
    await writeFile(this.#file(id, task.id), JSON.stringify(task, null, 2))
  }

  async #all(id: string): Promise<PreviewTask[]> {
    const dir = join(this.#root(id), 'tasks')
    const out: PreviewTask[] = []
    if (this.#docs) out.push(...(await this.#docs.list<PreviewTask>('preview.tasks', `${id}/`)))
    else if (existsSync(dir)) for (const f of await readdir(dir)) if (f.endsWith('.json')) out.push(JSON.parse(await readFile(join(dir, f), 'utf8')) as PreviewTask)
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, undefined, { numeric: true }))
  }

  #shown(task: PreviewTask, user: User) {
    return { ...task, createdByName: task.createdBy === user.id ? user.name : task.createdBy, runCount: task.runs.length }
  }

  async tasks(user: User, id: string) {
    await this.#host.session(user, id)
    return (await this.#all(id)).map((t) => ({ ...this.#shown(t, user), run: t.run ? { ...t.run, result: { ...t.run.result, output: null } } : null }))
  }

  async task(user: User, id: string, task: string) {
    await this.#host.session(user, id)
    return this.#shown(await this.#load(id, task), user)
  }

  async #run(id: string, app: string, task: PreviewTask) {
    try {
      await this.#host.console.ensureLocal(task.input)
      const { kernel } = await this.#kernel(id, app)
      const run = { ...(await kernel.runTask(app, { input: task.input })), release: WORKSPACE_LABEL }
      task.runs.push(run.id)
      task.run = run
      task.outcome = run.result.status
      task.working = run.result.output
      delete task.error
    } catch (error) {
      task.outcome = 'error'
      task.working = null
      task.error = (error as Error).message
    }
    task.state = 'ready'
    await this.#save(id, task)
  }

  async create(user: User, id: string, body: { title?: string; input: unknown }) {
    const s = await this.#host.session(user, id)
    const n = (await this.#all(id)).reduce((m, t) => Math.max(m, Number(t.id.slice(3))), 0) + 1
    const task: PreviewTask = {
      id: `PV-${n}`,
      app: s.app,
      title: body.title?.trim() || '未命名',
      createdBy: user.id,
      createdAt: this.#host.now(),
      input: body.input,
      runs: [],
      state: 'running',
      outcome: null,
      working: null,
      corrections: [],
      suggestions: [],
      confirmed: null,
      artifacts: [],
      trial: { version: WORKSPACE_LABEL, by: user.name },
      run: null,
    }
    await this.#save(id, task)
    await this.#run(id, s.app, task)
    return this.task(user, id, task.id)
  }

  async rerun(user: User, id: string, taskId: string, input?: unknown) {
    const s = await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    if (task.confirmed) throw new AccessError('单据已确认，不能重新执行', 409)
    if (input !== undefined) task.input = input
    task.state = 'running'
    task.corrections = []
    await this.#save(id, task)
    await this.#run(id, s.app, task)
    return this.task(user, id, taskId)
  }

  async correct(user: User, id: string, taskId: string, body: { path: string; field: string; value: string; note?: string; scope: SignalScope }) {
    await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    if (task.confirmed) throw new AccessError('单据已确认，不能再修改', 409)
    const before = getPath(task.working, body.path)
    task.working = setPath(task.working, body.path, body.value)
    task.corrections.push({ at: this.#host.now(), by: user.name, run: task.runs.at(-1) ?? '', path: body.path, field: body.field, before: typeof before === 'string' ? before : JSON.stringify(before ?? ''), after: body.value, note: body.note?.trim() || undefined, scope: body.scope, signal: '' })
    await this.#save(id, task)
    return this.task(user, id, taskId)
  }

  async suggest(user: User, id: string, taskId: string, body: { target?: SignalTarget; note: string; scope: SignalScope; attachments?: { path: string; name: string; size: number }[] }) {
    await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    if (!body.note?.trim()) throw new AccessError('请写下建议', 400)
    const product = productTarget(body.target)
    const target: SignalTarget = product ?? (body.target?.level === 'region' || body.target?.level === 'field' ? { level: body.target.level, path: body.target.path, label: body.target.label?.trim() || undefined } : { level: 'task', label: body.target?.label?.trim() || undefined })
    const attachments = (body.attachments ?? []).map((a) => ({ path: this.#host.console.resolveFile(a.path), name: a.name, size: a.size }))
    task.suggestions.push({ at: this.#host.now(), by: user.name, run: task.runs.at(-1) ?? '', target, note: body.note.trim(), scope: product ? { level: 'app' } : body.scope, attachments, signal: '' })
    await this.#save(id, task)
    return this.task(user, id, taskId)
  }

  async confirm(user: User, id: string, taskId: string) {
    await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    if (task.state !== 'ready' || task.working === null) throw new AccessError('单据没有可确认的结果', 409)
    task.state = 'confirmed'
    task.confirmed = { by: user.name, at: this.#host.now() }
    await this.#save(id, task)
    return this.task(user, id, taskId)
  }

  async action(user: User, id: string, taskId: string, name: string) {
    await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    const action = ((await this.#manifestRaw(id)).actions as Record<string, AppAction> | undefined)?.[name]
    if (!action) throw new AccessError(`应用没有声明动作 ${name}`, 404)
    if (action.requiresConfirmed && !task.confirmed) throw new AccessError(`先确认单据，再${action.title}`, 409)
    if (task.working === null) throw new AccessError('单据还没有结果', 409)
    const artifactId = `${name}-${task.artifacts.length + 1}`
    const { ok, outputFile, report } = await runAction(action, task.working, join(this.#workspace(id), 'code'), join(this.#root(id), 'artifacts', task.id), artifactId)
    task.artifacts.push({ id: artifactId, action: name, title: action.title, file: ok ? relative(this.#root(id), outputFile).split(sep).join('/') : '', at: this.#host.now(), by: user.name, ok, report })
    await this.#save(id, task)
    return this.task(user, id, taskId)
  }

  /** A produced file of a preview task. */
  async artifact(user: User, id: string, taskId: string, artifactId: string) {
    await this.#host.session(user, id)
    const task = await this.#load(id, taskId)
    const artifact = task.artifacts.find((a) => a.id === artifactId && a.ok)
    if (!artifact) throw new AccessError('没有这个文件', 404)
    const abs = join(this.#root(id), artifact.file)
    await stat(abs)
    return { bytes: await readFile(abs), name: `${task.id}-${artifact.file.split('/').pop()!.replace(/^[a-z]+-\d+-/, '')}`, type: mimeOf(abs) }
  }

  async upload(user: User, id: string, fileName: string, bytes: Uint8Array) {
    await this.#host.session(user, id)
    return this.#host.console.storeUpload(fileName, bytes)
  }

  /** Drop preview tasks and the scratch kernel. */
  async clear(user: User, id: string) {
    await this.#host.session(user, id)
    this.#kernels.delete(id)
    if (this.#docs) for (const t of await this.#all(id)) await this.#docs.delete('preview.tasks', `${id}/${t.id}`)
    await rm(this.#root(id), { recursive: true, force: true })
    return { ok: true }
  }
}
