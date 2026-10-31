/**
 * Framework-agnostic HTTP surface of the console: Web `Request` in, `Response` out.
 * Any host (Next.js route handlers, a plain Node server, tests) forwards requests here.
 * Sign-in is by account and password (see `accounts.ts`); an organisation's SSO would replace
 * `/api/login` and `identify`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { KernelError, ManifestError } from '../../rsi-kernel/src/index.ts'
import type { Bench } from './bench.ts'
import { bootPlatform } from './boot.ts'
import type { BootOptions, Platform } from './boot.ts'
import type { Builder } from './builder.ts'
import type { Console } from './console.ts'
import { mimeOf } from './console.ts'
import { AccessError, LEVEL_LABEL, LEVEL_NOTE, SYSTEM_PERMISSIONS } from './rbac.ts'
import type { Grant, Role, User } from './rbac.ts'
import { STATE_DIR } from './home.ts'
import { WebHost } from './webhost.ts'
import type { WebSite } from './webhost.ts'

type Ctx = { req: Request; user: User; params: string[]; query: URLSearchParams }
type Handler = (ctx: Ctx) => Promise<unknown>

/** A file response from a handler (previews, downloads, video with ranges). */
class FileReply {
  readonly file: { bytes: Uint8Array; name: string; type: string }
  readonly download: boolean
  constructor(file: { bytes: Uint8Array; name: string; type: string }, download = false) {
    this.file = file
    this.download = download
  }
}

async function json<T>(req: Request): Promise<T> {
  const raw = await req.text()
  try {
    return (raw ? JSON.parse(raw) : {}) as T
  } catch {
    throw new AccessError('请求不是合法 JSON', 400)
  }
}

const send = (status: number, value: unknown) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })

/** Serve bytes, honouring a single `Range` so video and audio can seek. */
function sendFile(req: Request, file: { bytes: Uint8Array; name: string; type: string }, download = false): Response {
  const headers: Record<string, string> = { 'content-type': file.type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' }
  headers['content-disposition'] = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`
  const total = file.bytes.length
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1
    if (start >= total || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } })
    return new Response(file.bytes.slice(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(end - start + 1) } })
  }
  return new Response(file.bytes, { status: 200, headers: { ...headers, 'content-length': String(total) } })
}

const bytesOf = async (req: Request) => new Uint8Array(await req.arrayBuffer())

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

function routes(app: Console, builder: Builder, bench: Bench) {
  const table: { method: string; pattern: RegExp; handler: Handler }[] = []
  const route = (method: string, pattern: string, handler: Handler) => table.push({ method, pattern: new RegExp(`^${pattern.replace(/:[a-z]+/g, '([^/]+)')}$`), handler })

  route('GET', '/api/me', async ({ user }) => ({
    ...(await app.me(user)),
    platform: { model: app.modelStatus, executor: app.executorStatus, harness: { available: builder.harness.available, note: builder.harness.note }, storage: { ...app.files.status, blobs: app.blobStore }, deployment: app.deployment },
    levels: Object.fromEntries(Object.entries(LEVEL_LABEL).map(([k, label]) => [k, { label, note: LEVEL_NOTE[k as keyof typeof LEVEL_NOTE] }])),
  }))
  route('GET', '/api/apps', async ({ user }) => app.apps(user))
  route('GET', '/api/apps/:a/infra', async ({ user, params }) => app.infraSummary(params[0], user))
  route('GET', '/api/principals', async ({ user }) => app.principals(user))
  route('POST', '/api/groups', async ({ req, user }) => app.createGroup(user, await json(req)))

  route('GET', '/api/system', async ({ user }) => ({ ...(await app.systemView(user)), permissions: SYSTEM_PERMISSIONS }))
  route('POST', '/api/system/users', async ({ req, user }) => app.saveUser(user, await json(req), true))
  route('PUT', '/api/system/users/:u', async ({ req, user, params }) => app.saveUser(user, { ...(await json<User>(req)), id: params[0] }, false))
  route('POST', '/api/system/users/:u/password', async ({ req, user, params }) => {
    await app.resetPassword(user, params[0], (await json<{ password: string }>(req)).password)
    return { ok: true }
  })
  route('PUT', '/api/system/groups/:g', async ({ req, user, params }) => app.updateGroup(user, params[0], await json(req)))
  route('DELETE', '/api/system/groups/:g', async ({ user, params }) => app.deleteGroup(user, params[0]))
  route('POST', '/api/system/roles', async ({ req, user }) => app.saveRole(user, await json(req), true))
  route('PUT', '/api/system/roles/:r', async ({ req, user, params }) => app.saveRole(user, { ...(await json<Role>(req)), id: params[0] }, false))
  route('DELETE', '/api/system/roles/:r', async ({ user, params }) => app.deleteRole(user, params[0]))

  route('GET', '/api/builds', async ({ user }) => builder.list(user))
  route('POST', '/api/builds/import', async ({ req, user, query }) => builder.importArchive(user, query.get('name') ?? 'app.zip', await bytesOf(req)))
  route('POST', '/api/builds', async ({ req, user }) => {
    const b = await json<{ name: string; title: string; goal: string; app?: string; issue?: string }>(req)
    return b.app ? builder.open(user, b.app, b.goal, b.issue) : builder.create(user, b)
  })
  route('GET', '/api/builds/:b', async ({ user, params }) => builder.view(user, params[0]))
  route('POST', '/api/builds/:b/messages', async ({ req, user, params }) => builder.send(user, params[0], (await json<{ text: string }>(req)).text))
  route('POST', '/api/builds/:b/cancel', async ({ user, params }) => builder.cancel(user, params[0]))
  route('GET', '/api/builds/:b/file', async ({ user, params, query }) => builder.file(user, params[0], query.get('path') ?? ''))
  route('PUT', '/api/builds/:b/file', async ({ req, user, params, query }) => builder.writeFile(user, params[0], query.get('path') ?? '', (await json<{ text: string | null }>(req)).text))
  route('GET', '/api/builds/:b/raw', async ({ user, params, query }) => new FileReply(await builder.raw(user, params[0], query.get('path') ?? ''), query.has('download')))
  route('POST', '/api/builds/:b/upload', async ({ req, user, params, query }) => builder.upload(user, params[0], query.get('path') ?? '', await bytesOf(req)))
  route('POST', '/api/builds/:b/move', async ({ req, user, params }) => {
    const b = await json<{ from: string; to: string }>(req)
    return builder.move(user, params[0], b.from, b.to)
  })
  route('POST', '/api/builds/:b/check', async ({ user, params }) => builder.check(user, params[0]))
  route('POST', '/api/builds/:b/test', async ({ req, user, params }) => builder.test(user, params[0], (await json<{ cases?: string[] }>(req)).cases))
  route('POST', '/api/builds/:b/requests/:r/files', async ({ req, user, params, query }) => builder.fulfil(user, params[0], params[1], query.get('name') ?? 'file', await bytesOf(req)))
  route('POST', '/api/builds/:b/requests/:r/answer', async ({ req, user, params }) => builder.answer(user, params[0], params[1], await json(req)))
  route('POST', '/api/builds/:b/requests/:r/confirm', async ({ req, user, params }) => builder.confirm(user, params[0], params[1], await json(req)))
  route('GET', '/api/builds/:b/changes', async ({ user, params }) => builder.changes(user, params[0]))
  route('POST', '/api/builds/:b/publish', async ({ req, user, params }) => builder.publish(user, params[0], await json(req)))

  const preview = builder.preview
  route('GET', '/api/builds/:b/preview', async ({ user, params }) => preview.view(user, params[0]))
  route('DELETE', '/api/builds/:b/preview', async ({ user, params }) => preview.clear(user, params[0]))
  route('GET', '/api/builds/:b/preview/tasks', async ({ user, params }) => preview.tasks(user, params[0]))
  route('POST', '/api/builds/:b/preview/tasks', async ({ req, user, params }) => preview.create(user, params[0], await json(req)))
  route('GET', '/api/builds/:b/preview/tasks/:t', async ({ user, params }) => preview.task(user, params[0], params[1]))
  route('POST', '/api/builds/:b/preview/tasks/:t/rerun', async ({ req, user, params }) => preview.rerun(user, params[0], params[1], (await json<{ input?: unknown }>(req)).input))
  route('POST', '/api/builds/:b/preview/tasks/:t/corrections', async ({ req, user, params }) => preview.correct(user, params[0], params[1], await json(req)))
  route('POST', '/api/builds/:b/preview/tasks/:t/suggestions', async ({ req, user, params }) => preview.suggest(user, params[0], params[1], await json(req)))
  route('POST', '/api/builds/:b/preview/tasks/:t/confirm', async ({ user, params }) => preview.confirm(user, params[0], params[1]))
  route('POST', '/api/builds/:b/preview/tasks/:t/actions/:n', async ({ user, params }) => preview.action(user, params[0], params[1], params[2]))
  route('GET', '/api/builds/:b/preview/tasks/:t/artifacts/:x', async ({ user, params }) => new FileReply(await preview.artifact(user, params[0], params[1], params[2]), true))
  route('POST', '/api/builds/:b/preview/uploads', async ({ req, user, params, query }) => preview.upload(user, params[0], query.get('name') ?? 'file', await bytesOf(req)))

  route('GET', '/api/apps/:a', async ({ user, params }) => app.appSummary(params[0], user))
  route('GET', '/api/apps/:a/access', async ({ user, params }) => app.access(params[0], user))
  route('PUT', '/api/apps/:a/access', async ({ req, user, params }) => app.setAccess(params[0], user, (await json<{ grants: Grant[] }>(req)).grants))
  route('PUT', '/api/apps/:a/approval', async ({ req, user, params }) => app.setApprovalPolicy(params[0], user, await json(req)))
  route('GET', '/api/apps/:a/versions', async ({ user, params }) => app.versions(params[0], user))
  route('GET', '/api/apps/:a/export', async ({ user, params, query }) => new FileReply(await app.exportApp(params[0], user, query.get('version')), true))
  route('GET', '/api/apps/:a/tree', async ({ user, params, query }) => app.tree(params[0], user, query.get('version') ?? query.get('release')))
  route('GET', '/api/apps/:a/file', async ({ user, params, query }) => app.file(params[0], user, query.get('path') ?? '', query.get('version') ?? query.get('release')))
  route('GET', '/api/apps/:a/raw', async ({ user, params, query }) => new FileReply(await app.raw(params[0], user, query.get('path') ?? '', query.get('version')), query.has('download')))
  route('POST', '/api/apps/:a/blobs', async ({ req, user, params }) => app.putBlob(params[0], user, await bytesOf(req)))
  route('GET', '/api/apps/:a/diff', async ({ user, params, query }) => app.diff(params[0], user, query.get('from') ?? '', query.get('to') ?? ''))
  route('GET', '/api/apps/:a/releases', async ({ user, params }) => app.releases(params[0], user))
  route('POST', '/api/apps/:a/rollback', async ({ req, user, params }) => {
    const b = await json<{ to: string; reason: string }>(req)
    return app.rollback(params[0], user, b.to, b.reason ?? '')
  })
  route('POST', '/api/apps/:a/import', async ({ req, user, params }) => app.importSource(params[0], user, (await json<{ note: string }>(req)).note ?? ''))

  route('GET', '/api/apps/:a/bench/overview', async ({ user, params }) => bench.overview(params[0], user))
  route('GET', '/api/apps/:a/bench/rules', async ({ user, params }) => bench.rules(params[0], user))
  route('GET', '/api/apps/:a/bench/runs', async ({ user, params }) => bench.runs(params[0], user))
  route('POST', '/api/apps/:a/bench/runs', async ({ req, user, params }) => bench.start(params[0], user, await json(req)))
  route('GET', '/api/apps/:a/bench/runs/:r', async ({ user, params }) => bench.run(params[0], user, params[1]))
  route('GET', '/api/apps/:a/bench/runs/:r/cases/:c', async ({ user, params }) => bench.caseResult(params[0], user, params[1], params[2]))
  route('GET', '/api/apps/:a/bench/runs/:r/report', async ({ user, params, query }) => new FileReply(await bench.report(params[0], user, params[1], query.get('format') === 'md' ? 'md' : 'json'), query.has('download')))
  route('GET', '/api/apps/:a/bench/cases/:c/history', async ({ user, params }) => bench.caseHistory(params[0], user, params[1]))
  route('GET', '/api/apps/:a/bench/cases', async ({ user, params }) => bench.cases(params[0], user))
  route('POST', '/api/apps/:a/bench/cases', async ({ req, user, params }) => bench.saveCase(params[0], user, await json(req), true))
  route('PUT', '/api/apps/:a/bench/cases/:c', async ({ req, user, params }) => bench.saveCase(params[0], user, { ...(await json<{ id: string; title: string; input: unknown; expected: unknown }>(req)), id: params[1] }, false))
  route('DELETE', '/api/apps/:a/bench/cases/:c', async ({ user, params }) => bench.deleteCase(params[0], user, params[1]))
  route('POST', '/api/apps/:a/bench/draft', async ({ req, user, params }) => bench.draftFromTask(params[0], user, (await json<{ task: string }>(req)).task))
  route('GET', '/api/apps/:a/bench/files', async ({ user, params }) => bench.files(params[0], user))
  route('GET', '/api/apps/:a/bench/file', async ({ user, params, query }) => bench.file(params[0], user, query.get('path') ?? ''))
  route('GET', '/api/apps/:a/bench/raw', async ({ user, params, query }) => new FileReply(await bench.raw(params[0], user, query.get('path') ?? ''), query.has('download')))
  route('PUT', '/api/apps/:a/bench/file', async ({ req, user, params, query }) => {
    const b = await json<{ text: string | null; note?: string }>(req)
    await bench.write(params[0], user, [{ path: query.get('path') ?? '', bytes: b.text === null ? null : new TextEncoder().encode(b.text) }], b.note ?? '')
    return bench.files(params[0], user)
  })
  route('POST', '/api/apps/:a/bench/upload', async ({ req, user, params, query }) => {
    await bench.write(params[0], user, [{ path: query.get('path') ?? '', bytes: await bytesOf(req) }], query.get('note') ?? `上传 ${query.get('path')}`)
    return bench.files(params[0], user)
  })
  route('POST', '/api/apps/:a/bench/move', async ({ req, user, params }) => {
    const b = await json<{ from: string; to: string }>(req)
    const raw = await bench.raw(params[0], user, b.from)
    await bench.write(params[0], user, [{ path: b.to, bytes: raw.bytes }, { path: b.from, bytes: null }], `${b.from} 改名为 ${b.to}`)
    return bench.files(params[0], user)
  })
  route('GET', '/api/apps/:a/bench/history', async ({ user, params }) => bench.history(params[0], user))
  route('GET', '/api/apps/:a/bench/audit', async ({ user, params }) => bench.audit(params[0], user))

  route('GET', '/api/apps/:a/improvements', async ({ user, params }) => app.improvements(params[0], user))
  route('GET', '/api/apps/:a/signals/:s', async ({ user, params }) => app.signal(params[0], user, params[1]))
  route('PUT', '/api/apps/:a/issues/:i/state', async ({ req, user, params }) => app.setIssueState(params[0], user, params[1], await json(req)))
  route('GET', '/api/apps/:a/proposals', async ({ user, params }) => app.proposals(params[0], user))
  route('POST', '/api/apps/:a/proposals', async ({ req, user, params }) => app.submitProposal(params[0], user, await json(req)))
  route('POST', '/api/apps/:a/proposals/draft', async ({ req, user, params }) => app.draftProposal(params[0], user, await json(req)))
  route('GET', '/api/apps/:a/proposals/:p', async ({ user, params }) => app.proposal(params[0], user, params[1]))
  route('POST', '/api/apps/:a/proposals/:p/verify', async ({ user, params }) => app.verify(params[0], user, params[1]))
  route('POST', '/api/apps/:a/proposals/:p/decide', async ({ req, user, params }) => app.decide(params[0], user, params[1], await json(req)))

  route('GET', '/api/apps/:a/tasks', async ({ user, params, query }) => app.listTasks(params[0], user, { version: query.get('version') }))
  route('POST', '/api/apps/:a/tasks', async ({ req, user, params }) => app.createTask(params[0], user, await json(req)))
  route('GET', '/api/apps/:a/tasks/:t', async ({ user, params }) => app.task(params[0], user, params[1]))
  route('POST', '/api/apps/:a/tasks/:t/rerun', async ({ req, user, params }) => app.rerun(params[0], user, params[1], (await json<{ input?: unknown }>(req)).input))
  route('POST', '/api/apps/:a/tasks/:t/corrections', async ({ req, user, params }) => app.correct(params[0], user, params[1], await json(req)))
  route('POST', '/api/apps/:a/tasks/:t/suggestions', async ({ req, user, params }) => app.suggest(params[0], user, params[1], await json(req)))
  route('POST', '/api/apps/:a/suggestions', async ({ req, user, params }) => app.suggestApp(params[0], user, await json(req)))
  route('POST', '/api/apps/:a/tasks/:t/confirm', async ({ user, params }) => app.confirm(params[0], user, params[1]))
  route('POST', '/api/apps/:a/tasks/:t/actions/:n', async ({ user, params }) => app.action(params[0], user, params[1], params[2]))
  route('GET', '/api/apps/:a/contributions', async ({ user, params }) => app.contributions(params[0], user))
  route('POST', '/api/apps/:a/uploads', async ({ req, user, params, query }) => app.upload(params[0], user, query.get('name') ?? 'file', await bytesOf(req)))
  return table
}

/**
 * Build the request handler around one console instance.
 * @returns `(request) => response`; never throws.
 */
export function createHandler(app: Console, builder: Builder, bench: Bench, web?: WebHost): (req: Request) => Promise<Response> {
  /** Cookie-signing key, kept with the platform's state so sessions survive restarts and work on every instance. */
  const secret = app.sessionSecret()
  /** A session names the user and their credential version, so a new password ends older sessions. */
  const sign = async (id: string, version: number) => {
    const body = `${id}.${version}`
    return `${body}.${createHmac('sha256', await secret).update(body).digest('base64url')}`
  }
  const sessionCookie = async (id: string, version: number) => `rsi_session=${encodeURIComponent(await sign(id, version))}; Path=/; HttpOnly; SameSite=Lax`
  const identify = async (req: Request): Promise<string | null> => {
    const token = cookie(req, 'rsi_session')
    const m = token ? /^(.+)\.(\d+)\.[^.]+$/.exec(token) : null
    if (!m) return null
    const want = Buffer.from(await sign(m[1], Number(m[2])))
    const got = Buffer.from(token!)
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null
    return (await app.accounts.version(m[1])) === Number(m[2]) ? m[1] : null
  }
  const table = routes(app, builder, bench)
  /** Where an app's web application is and how its build is going; asking starts the build. */
  const webStatus = (site: WebSite | null, rebuild = false) => {
    if (!site) return { base: null, state: 'none' }
    if (!web) return { base: null, state: 'off', error: '这个部署没有开启应用的 web 运行' }
    const running = rebuild ? null : web.ensure(site)
    if (rebuild) void web.rebuild(site)
    const status = running?.status ?? { state: 'building', step: '排队', log: [] }
    return { base: site.base, ...status, log: 'log' in status ? status.log.slice(-60) : [] }
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = decodeURIComponent(url.pathname)

    if (path === '/api/login' && req.method === 'POST') {
      const body = await json<{ user: string; password: string }>(req)
      const { user, version } = await app.login(body.user, body.password)
      const res = send(200, { ok: true })
      res.headers.set('set-cookie', await sessionCookie(user.id, version))
      return res
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const res = send(200, { ok: true })
      res.headers.set('set-cookie', 'rsi_session=; Path=/; Max-Age=0')
      return res
    }
    const userId = await identify(req)
    if (!userId && path.startsWith('/apps/') && req.method === 'GET' && (req.headers.get('accept') ?? '').includes('text/html')) return Response.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, url), 302)
    if (!userId) return send(401, { error: '请先登录' })
    const user = await app.user(userId)
    if (path === '/api/me/password' && req.method === 'POST') {
      const body = await json<{ current: string; password: string }>(req)
      const version = await app.changePassword(user, body.current, body.password)
      const res = send(200, { ok: true })
      res.headers.set('set-cookie', await sessionCookie(user.id, version))
      return res
    }
    if (path.startsWith('/files/')) return sendFile(req, await app.material(path.slice('/files/'.length)), url.searchParams.has('download'))
    if (path.startsWith('/artifacts/')) {
      const [, , name, task, artifact] = path.split('/')
      const abs = await app.artifactPath(name, user, task, artifact)
      return sendFile(req, { bytes: await readFile(abs), name: `${task}-${basename(abs).replace(/^[a-z]+-\d+-/, '')}`, type: mimeOf(abs) }, true)
    }
    const site = /^\/apps\/([^/]+)\/(v|w)\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (site) {
      const [, name, kind, id, rest = ''] = site
      if (kind === 'v' && id === 'stable') return Response.redirect(new URL(`/apps/${name}/v/${await app.kernel.stable(name).then((r) => r.id)}${rest || '/'}${url.search}`, url), 302)
      const target = kind === 'v' ? await app.webSite(name, user, id) : await builder.preview.webSite(user, id)
      if (!target) return send(404, { error: '这个版本没有自己的 web 应用' })
      if (!web) return send(404, { error: '这个部署没有开启应用的 web 运行' })
      return web.proxy(target, req, user)
    }
    const webApi = /^\/api\/apps\/([^/]+)\/web(\/rebuild)?$/.exec(path)
    if (webApi && (webApi[2] ? req.method === 'POST' : req.method === 'GET')) {
      if (webApi[2]) await app.demand(webApi[1], user, 'release.rollback')
      return send(200, webStatus(await app.webSite(webApi[1], user, url.searchParams.get('version') || 'stable'), Boolean(webApi[2])))
    }
    const previewWeb = /^\/api\/builds\/([^/]+)\/preview\/web(\/rebuild)?$/.exec(path)
    if (previewWeb && (previewWeb[2] ? req.method === 'POST' : req.method === 'GET')) return send(200, webStatus(await builder.preview.webSite(user, previewWeb[1]), Boolean(previewWeb[2])))
    for (const r of table) {
      if (r.method !== req.method) continue
      const m = r.pattern.exec(path)
      if (!m) continue
      const out = await r.handler({ req, user, params: m.slice(1), query: url.searchParams })
      return out instanceof FileReply ? sendFile(req, out.file, out.download) : send(200, out)
    }
    return send(404, { error: `没有接口 ${req.method} ${path}` })
  }

  return async (req) => {
    try {
      return await handle(req)
    } catch (error) {
      if (error instanceof AccessError) return send(error.status, { error: error.message })
      if (error instanceof KernelError || error instanceof ManifestError) return send(409, { error: error.message })
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return send(404, { error: '文件不存在' })
      console.error(error)
      return send(500, { error: (error as Error)?.message ?? String(error) })
    }
  }
}

/** Boot the console for the platform directory (home from its configuration) and return its handler. */
export async function start(platform: string, hooks: Pick<BootOptions, 'onAppAdded'> = {}): Promise<(req: Request) => Promise<Response>> {
  return (await startPlatform(platform, hooks)).handler
}

/** Boot and also return the platform, for hosts that shut it down themselves. */
export async function startPlatform(platform: string, hooks: Pick<BootOptions, 'onAppAdded' | 'env'> = {}): Promise<{ platform: Platform; handler: (req: Request) => Promise<Response> }> {
  const booted = await bootPlatform({ platform, ...hooks })
  const { console, builder, bench, home } = booted
  return { platform: booted, handler: createHandler(console, builder, bench, new WebHost(join(home, STATE_DIR, 'web'))) }
}
