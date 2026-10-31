/**
 * The evaluation bench: how people maintain an app's evaluation set and evaluate versions.
 *
 * - The evaluation set is the app's `evals/` tree, laid out by spec `rsi-eval/1` (see
 *   documents/评测规范.md). Only people who manage the app change it; every change is
 *   snapshotted by the kernel (`e1`, `e2`…) so each score names the cases it used.
 * - A case is a folder `<cases>/<id>/`: `case.json` (`id, title, tags, split, source, input,
 *   expected, rules, validator`), its input materials in `input/`, expected files in `expected/`.
 *   The validator decides what `expected` looks like;
 *   `evals/expect.ts`, when the app has one, turns a confirmed task's result into that shape.
 * - An evaluation run scores one version (a release or a proposal's candidate) on the chosen
 *   cases or whole splits in the background. Every run has a standard report (`report()`),
 *   and every case shows its results across runs (`caseHistory()`).
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ABLATIONS, DIFFICULTIES, MAX_TRIALS, coverage, unscored } from '../../rsi-kernel/src/index.ts'
import type { Ablation, CaseScore, Difficulty, Split, SuiteResult } from '../../rsi-kernel/src/index.ts'
import type { Console, Task } from './console.ts'
import { mimeOf, safeRelPath } from './console.ts'
import type { User } from './rbac.ts'
import { AccessError } from './rbac.ts'

export type FileRole = 'case' | 'material' | 'expected' | 'spec' | 'judge' | 'test' | 'expect' | 'tool' | 'other'

export interface EvalRun {
  id: string
  app: string
  version: string
  /** The version's kind when the run started. */
  kind: 'release' | 'candidate'
  splits: Split[]
  /** Case ids chosen for this run; absent when whole splits ran. A partial run never verifies a proposal. */
  cases?: string[]
  /** Runs per case; absent means one. */
  trials?: number
  /** What was taken away from the agent, to measure what it contributes; such a run never stands for the version. */
  ablate?: Ablation
  status: 'queued' | 'running' | 'done' | 'failed'
  progress: { done: number; total: number; current: string | null }
  by: string
  at: string
  finishedAt: string | null
  evalset: string | null
  executor: string
  results: Partial<Record<Split, SuiteResult>>
  error: string | null
}

const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/
const TEXT = new TextDecoder('utf-8', { fatal: true })
const isText = (bytes: Uint8Array) => {
  try {
    return TEXT.decode(bytes)
  } catch {
    return null
  }
}

/** Drop agent outputs from scores, for lists and matrices. */
function lean(result: SuiteResult | undefined): SuiteResult | undefined {
  return result && { ...result, cases: result.cases.map(({ output: _output, ...c }) => c) }
}

export class Bench {
  readonly #console: Console
  readonly #queues = new Map<string, Promise<void>>()

  constructor(console: Console) {
    console.jobs.handle('eval.run', (payload, job) => this.#queued(String(payload.run), job.reclaimed))
    this.#console = console
  }

  get #kernel() {
    return this.#console.kernel
  }

  #root(app: string): string {
    return this.#kernel.app(app).source.evals.root
  }

  #casesDir(app: string): string {
    return this.#kernel.app(app).manifest.evals.cases.replace(/\/$/, '')
  }

  /** What a file in the evaluation tree is for. */
  #role(app: string, path: string): FileRole {
    const { manifest } = this.#kernel.app(app)
    const cases = `${this.#casesDir(app)}/`
    const entryDirs = [manifest.judge, ...Object.values(this.#kernel.app(app).spec.validators)].map((v) => {
      const entry = v.args.find((a) => /\.(ts|js|mjs|py)$/.test(a)) ?? ''
      return entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/') + 1) : entry
    })
    if (path.startsWith(cases)) {
      const inner = path.slice(cases.length).split('/').slice(1).join('/')
      if (inner === 'case.json') return 'case'
      if (inner.startsWith('expected/')) return 'expected'
      return 'material'
    }
    if (path === 'eval.json') return 'spec'
    if (path.startsWith('materials/')) return 'material'
    if (path.startsWith('validators/') || entryDirs.some((d) => d && (path === d || path.startsWith(d)))) return 'judge'
    if (path.startsWith('tools/')) return 'tool'
    if (path.startsWith('tests/')) return 'test'
    if (path === 'expect.ts') return 'expect'
    return 'other'
  }

  // ── files ─────────────────────────────────────────────────────

  async files(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const tree = this.#kernel.app(app).source.evals
    const out = []
    for (const path of await tree.list()) {
      const bytes = await tree.read(path)
      out.push({ path, size: bytes.length, text: isText(bytes) !== null, role: this.#role(app, path) })
    }
    return { files: out, evalset: this.#kernel.app(app).evalset }
  }

  async file(app: string, user: User, path: string) {
    await this.#console.demand(app, user, 'app.read')
    const rel = safeRelPath(path)
    const bytes = await this.#kernel.app(app).source.evals.read(rel).catch(() => {
      throw new AccessError(`评测集里没有 ${rel}`, 404)
    })
    return { path: rel, text: isText(bytes), size: bytes.length, role: this.#role(app, rel) }
  }

  async raw(app: string, user: User, path: string) {
    await this.#console.demand(app, user, 'app.read')
    const rel = safeRelPath(path)
    return { bytes: await this.#console.files.read(`${app}/evals/${rel}`), name: basename(rel), type: mimeOf(rel) }
  }

  /**
   * Write files into the evaluation tree, then snapshot it. A change that leaves the set
   * unloadable (a broken case) is undone and reported.
   */
  async write(app: string, user: User, writes: { path: string; bytes: Uint8Array | null }[], note: string) {
    await this.#console.demand(app, user, 'eval.manage')
    if (writes.length === 0) throw new AccessError('没有要保存的改动', 400)
    const undo: { rel: string; bytes: Uint8Array | null }[] = []
    try {
      for (const w of writes) {
        const rel = `${app}/evals/${safeRelPath(w.path)}`
        undo.push({ rel, bytes: await this.#console.files.read(rel).catch(() => null) })
        if (w.bytes === null) await this.#console.files.remove(rel)
        else await this.#console.files.write(rel, w.bytes)
      }
      const set = await this.#kernel.snapshotEvals(app, { by: user.name, note: note?.trim() || `${user.name} 修改评测集` })
      await this.#console.announce(app)
      return { evalset: set.id }
    } catch (error) {
      for (const u of undo.reverse()) {
        if (u.bytes === null) await this.#console.files.remove(u.rel)
        else await this.#console.files.write(u.rel, u.bytes)
      }
      await this.#kernel.snapshotEvals(app, { by: 'kernel', note: '撤销无效改动' }).catch(() => undefined)
      throw new AccessError(`改动没有保存：${(error as Error).message}`, 400)
    }
  }

  /** Snapshots of the evaluation set, newest first, with how many files each changed. */
  async history(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const sets = await this.#kernel.evalSets(app)
    return sets
      .map((s) => {
        const parent = sets.find((x) => x.id === s.parent)
        const paths = new Set([...Object.keys(s.files), ...Object.keys(parent?.files ?? {})])
        const changed = [...paths].filter((p) => s.files[p] !== parent?.files[p])
        return { id: s.id, parent: s.parent, at: s.at, by: s.by, note: s.note, files: Object.keys(s.files).length, changed: changed.slice(0, 20), changedCount: changed.length }
      })
      .reverse()
  }

  // ── cases ─────────────────────────────────────────────────────

  async cases(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const loaded = this.#kernel.app(app)
    const runs = (await this.#runs(app)).filter((r) => r.status === 'done')
    const stable = (await this.#kernel.channels(app)).stable
    const scoreOf = (id: string) => {
      for (const r of runs) {
        if (r.version !== stable || r.ablate) continue
        const s = [...(r.results.dev?.cases ?? []), ...(r.results.holdout?.cases ?? [])].find((c) => c.case === id)
        if (s) return { ...s, run: r.id }
      }
      return undefined
    }
    const files = await loaded.source.evals.list()
    const dir = this.#casesDir(app)
    return {
      cases: loaded.cases.map((c) => {
        const s = scoreOf(c.id)
        const folder = `${dir}/${c.id}/`
        const raw = this.#rawCase(app, c.id)
        return {
          id: c.id,
          title: c.title,
          split: this.#kernel.splitOf(app, c.id),
          locked: loaded.manifest.evals.holdout.includes(c.id),
          tags: c.tags ?? [],
          scope: c.scope,
          source: c.source,
          input: c.input,
          expected: c.expected,
          expectedFile: typeof raw?.expected === 'string' ? raw.expected : null,
          rules: c.rules ?? [],
          validator: c.validator ?? null,
          difficulty: c.difficulty ?? null,
          why: c.why ?? null,
          capabilities: c.capabilities ?? [],
          oracle: c.oracle ? { status: c.oracle.status, file: typeof raw?.oracle === 'string' ? raw.oracle : null, provenance: c.oracle.provenance ?? null } : null,
          files: files.filter((p) => p.startsWith(folder)).map((p) => p.slice(folder.length)),
          materials: this.#materials(app, c.input),
          stable: s ? { release: stable, run: s.run, score: s.score, ok: s.ok } : null,
        }
      }),
      dir,
      evalset: loaded.evalset,
      hasExpect: existsSync(join(this.#root(app), 'expect.ts')),
      validators: [
        { name: 'judge', title: 'app.json 的裁判（默认）', command: `${loaded.manifest.judge.command} ${loaded.manifest.judge.args.join(' ')}` },
        ...Object.entries(loaded.spec.validators).map(([name, v]) => ({ name, title: v.title ?? name, command: `${v.command} ${v.args.join(' ')}` })),
      ],
      tags: loaded.spec.tags,
      capabilities: loaded.spec.capabilities,
      difficulties: DIFFICULTIES,
    }
  }

  /**
   * Check the evaluation set without running the agent: reference runs get full marks,
   * materials match their hashes, cases say where they came from, how hard they are and what they test.
   */
  async audit(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const result = await this.#kernel.audit(app)
    const stable = (await this.#kernel.channels(app)).stable
    const run = (await this.#runs(app)).find((r) => r.status === 'done' && r.version === stable && !r.ablate && !r.cases)
    const scores = run ? [...(run.results.dev?.cases ?? []), ...(run.results.holdout?.cases ?? [])] : []
    return { ...result, coverage: coverage(this.#kernel.app(app).cases, scores, this.#kernel.app(app).spec.capabilities), scoredBy: run ? { run: run.id, version: stable } : null, evalset: this.#kernel.app(app).evalset }
  }

  /** A case file as written, to keep references (an expected file) when people edit it. */
  #rawCase(app: string, id: string): Record<string, unknown> | null {
    try {
      return JSON.parse(readFileSync(join(this.#root(app), this.#casesDir(app), id, 'case.json'), 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /** Home-relative files a case input names, with whether each exists. */
  #materials(app: string, input: unknown): { path: string; exists: boolean }[] {
    const out: { path: string; exists: boolean }[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'string' && (v.startsWith(`${app}/evals/`) || v.startsWith('.rsi/uploads/'))) out.push({ path: v, exists: existsSync(join(this.#console.home, v)) })
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(input)
    return out
  }

  /** Copy uploaded materials a case input names into the evaluation tree, so the set is self-contained. */
  async #adopt(app: string, id: string, input: unknown, writes: { path: string; bytes: Uint8Array | null }[]): Promise<unknown> {
    const map = async (v: unknown): Promise<unknown> => {
      if (typeof v === 'string' && v.startsWith('.rsi/uploads/')) {
        const bytes = await this.#console.files.read(this.#console.resolveFile(v))
        const rel = `${this.#casesDir(app)}/${id}/input/${basename(v)}`
        writes.push({ path: rel, bytes })
        return `${app}/evals/${rel}`
      }
      if (Array.isArray(v)) return Promise.all(v.map(map))
      if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await map(x)])))
      return v
    }
    return map(input)
  }

  async saveCase(
    app: string,
    user: User,
    body: {
      id: string
      title: string
      input: unknown
      expected: unknown
      rules?: unknown[]
      validator?: string | null
      tags?: string[]
      split?: Split
      source?: string
      note?: string
      difficulty?: Difficulty | null
      why?: string
      capabilities?: string[]
      /** A complete correct run `{status, output, provenance}`; saved as `expected/oracle.json`. */
      oracle?: { status: string; output: unknown; provenance?: unknown } | null
    },
    isNew: boolean,
  ) {
    await this.#console.demand(app, user, 'eval.manage')
    const id = body.id?.trim()
    if (!CASE_ID.test(id ?? '')) throw new AccessError('用例编号只能用字母、数字、下划线和连字符，最长 40 个字符', 400)
    if (!body.title?.trim()) throw new AccessError('用例需要标题：一句话说清它在测什么', 400)
    if (body.input === undefined || body.input === null) throw new AccessError('用例需要输入', 400)
    const was = isNew ? null : this.#rawCase(app, id)
    const rules = Array.isArray(body.rules) ? body.rules : Array.isArray(was?.rules) ? (was!.rules as unknown[]) : []
    if ((body.expected === undefined || body.expected === null) && rules.length === 0) throw new AccessError('用例需要期望结果或验证规则', 400)
    const loaded = this.#kernel.app(app)
    const exists = loaded.cases.some((c) => c.id === id)
    if (isNew && exists) throw new AccessError(`用例 ${id} 已存在`, 409)
    if (!isNew && !exists) throw new AccessError(`没有用例 ${id}`, 404)
    if (loaded.manifest.evals.holdout.includes(id) && body.split === 'dev') throw new AccessError(`${id} 在 app.json 的留出集名单里，要改成开发集需要先改契约`, 400)
    const writes: { path: string; bytes: Uint8Array | null }[] = []
    const input = await this.#adopt(app, id, body.input, writes)
    const folder = `${this.#casesDir(app)}/${id}`
    const encode = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`)
    const hasExpected = body.expected !== undefined && body.expected !== null
    let expected: unknown = hasExpected ? body.expected : undefined
    if (hasExpected && typeof was?.expected === 'string') {
      writes.push({ path: `${folder}/${String(was.expected).replace(/^\.\//, '')}`, bytes: encode(body.expected) })
      expected = was.expected
    }
    const tags = (body.tags ?? (Array.isArray(was?.tags) ? (was!.tags as string[]) : [])).map((t) => String(t).trim()).filter(Boolean)
    const capabilities = (body.capabilities ?? (Array.isArray(was?.capabilities) ? (was!.capabilities as string[]) : [])).map((t) => String(t).trim()).filter(Boolean)
    const difficulty = body.difficulty === undefined ? (was?.difficulty as Difficulty | undefined) : body.difficulty
    if (difficulty && !DIFFICULTIES.includes(difficulty)) throw new AccessError(`难度只能是 ${DIFFICULTIES.join('、')}`, 400)
    const why = (body.why ?? (typeof was?.why === 'string' ? was.why : '')).trim()
    let oracle: unknown = was?.oracle
    if (body.oracle === null) {
      if (typeof was?.oracle === 'string') writes.push({ path: `${folder}/${String(was.oracle).replace(/^\.\//, '')}`, bytes: null })
      oracle = undefined
    } else if (body.oracle) {
      if (typeof body.oracle.status !== 'string' || !('output' in body.oracle)) throw new AccessError('参考答案要写成 {status, output}', 400)
      const file = typeof was?.oracle === 'string' ? String(was.oracle).replace(/^\.\//, '') : 'expected/oracle.json'
      writes.push({ path: `${folder}/${file}`, bytes: encode(body.oracle) })
      oracle = file
    }
    const asked = body.validator === undefined ? (was && 'validator' in was ? (was.validator as string | null) : undefined) : body.validator
    const validator = asked === undefined ? undefined : asked === null || asked === '' ? null : asked
    const doc = {
      id,
      title: body.title.trim(),
      ...(tags.length ? { tags } : {}),
      ...(body.split === 'holdout' ? { split: 'holdout' } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(why ? { why } : {}),
      ...(capabilities.length ? { capabilities } : {}),
      source: body.source?.trim() || `${user.name} 维护`,
      ...(was?.scope ? { scope: was.scope } : {}),
      input,
      ...(expected !== undefined ? { expected } : {}),
      ...(rules.length ? { rules } : {}),
      ...(validator !== undefined && !(validator === 'judge' && hasExpected) ? { validator } : {}),
      ...(oracle !== undefined ? { oracle } : {}),
    }
    writes.push({ path: `${folder}/case.json`, bytes: encode(doc) })
    await this.write(app, user, writes, body.note?.trim() || `${isNew ? '新增' : '修改'}用例 ${id}：${doc.title}`)
    return this.cases(app, user)
  }

  async deleteCase(app: string, user: User, id: string) {
    await this.#console.demand(app, user, 'eval.manage')
    const loaded = this.#kernel.app(app)
    if (!loaded.cases.some((c) => c.id === id)) throw new AccessError(`没有用例 ${id}`, 404)
    if (loaded.manifest.evals.holdout.includes(id)) throw new AccessError(`${id} 在 app.json 的留出集名单里，删除前需要先改契约`, 400)
    const tree = loaded.source.evals
    const writes = (await tree.list()).filter((p) => p.startsWith(`${this.#casesDir(app)}/${id}/`)).map((path) => ({ path, bytes: null }))
    await this.write(app, user, writes, `删除用例 ${id}`)
    return this.cases(app, user)
  }

  /**
   * Draft a case from a real task: its input as is, and as expected either what `evals/expect.ts`
   * makes of the confirmed result or the confirmed result itself. People check it before saving.
   */
  async draftFromTask(app: string, user: User, taskId: string) {
    await this.#console.demand(app, user, 'eval.manage')
    const task = await this.#console.store.get<Task>('tasks', taskId)
    if (!task || task.app !== app) throw new AccessError(`没有单据 ${taskId}`, 404)
    if (!task.confirmed) throw new AccessError('只有人工确认过的单据才能作为期望值', 409)
    const expectFile = join(this.#root(app), 'expect.ts')
    let expected: unknown = task.working
    let via = '确认后的结果（请按裁判需要的格式整理）'
    if (existsSync(expectFile)) {
      expected = await runExpect(this.#root(app), { input: task.input, output: task.working })
      via = 'evals/expect.ts 从确认后的结果生成'
    }
    const taken = new Set(this.#kernel.app(app).cases.map((c) => c.id))
    let n = 1
    while (taken.has(`T${n}`)) n++
    const oracle = { status: task.outcome ?? 'result', output: task.working, provenance: { kind: 'confirmed-task', task: task.id, by: task.confirmed.by, at: task.confirmed.at, corrections: task.corrections.length } }
    return { id: `T${n}`, title: task.title, input: task.input, expected, oracle, source: `单据 ${task.id}（${task.confirmed.by} 确认）`, via, corrections: task.corrections.length }
  }

  // ── evaluation runs ───────────────────────────────────────────

  /** One case's results across finished runs, newest first. */
  async caseHistory(app: string, user: User, id: string) {
    await this.#console.demand(app, user, 'app.read')
    if (!this.#kernel.app(app).cases.some((c) => c.id === id)) throw new AccessError(`没有用例 ${id}`, 404)
    return (await this.#runs(app))
      .filter((r) => r.status === 'done')
      .flatMap((r) => {
        const s = [...(r.results.dev?.cases ?? []), ...(r.results.holdout?.cases ?? [])].find((c) => c.case === id)
        return s
          ? [
              {
                run: r.id,
                version: r.version,
                kind: r.kind,
                at: r.finishedAt ?? r.at,
                by: r.by,
                evalset: r.evalset,
                executor: r.executor,
                ok: s.ok,
                score: s.score,
                failed: s.checks.filter((c) => !c.ok).length,
                violations: s.violations.length,
                ms: s.ms ?? null,
                error: s.error ?? null,
                invalid: s.invalid ?? null,
                passRate: s.passRate ?? null,
                trials: r.trials ?? 1,
                ablate: r.ablate ?? null,
              },
            ]
          : []
      })
  }

  /**
   * For an ablation run: the latest full run of the same version on the same evaluation set,
   * and per case how much the score drops without what was taken away.
   */
  async #ablationOf(r: EvalRun) {
    if (!r.ablate) return null
    const scoresOf = (run: EvalRun) => new Map(run.splits.flatMap((s) => run.results[s]?.cases ?? []).map((c) => [c.case, c]))
    const mine = scoresOf(r)
    const full = (await this.#runs(r.app)).find((x) => x.status === 'done' && !x.ablate && x.version === r.version && x.evalset === r.evalset && [...mine.keys()].every((id) => scoresOf(x).has(id)))
    if (!full) return { mode: r.ablate, title: ABLATIONS[r.ablate], against: null, cases: [], delta: null }
    const theirs = scoresOf(full)
    const cases = [...mine.values()].flatMap((c) => {
      const f = theirs.get(c.case)!
      return unscored(c) || unscored(f) ? [] : [{ id: c.case, full: f.score, ablated: c.score, delta: f.score - c.score, fullOk: f.ok, ablatedOk: c.ok }]
    })
    const delta = cases.length ? cases.reduce((sum, c) => sum + c.delta, 0) / cases.length : null
    return { mode: r.ablate, title: ABLATIONS[r.ablate], against: full.id, cases, delta }
  }

  /**
   * The standard report of one run (`rsi-eval-report/1`): what ran, on what, and every case's
   * checks, violations and output; errored and invalid cases apart; capability coverage; for an
   * ablation run, what the removed part contributes. As JSON, or Markdown for people.
   */
  async report(app: string, user: User, id: string, format: 'json' | 'md' = 'json') {
    const r = await this.run(app, user, id)
    const loaded = this.#kernel.app(app)
    const titles = new Map(loaded.cases.map((c) => [c.id, c.title]))
    const cases = r.splits.flatMap((split) => (r.results[split]?.cases ?? []).map((c) => ({ ...c, title: titles.get(c.case) ?? c.case })))
    const summary = Object.fromEntries(
      r.splits.flatMap((split) => {
        const s = r.results[split]
        return s ? [[split, { passed: s.passed, total: s.total, score: s.score, errors: s.errors ?? [], invalid: s.invalid ?? [] }]] : []
      }),
    )
    const covered = coverage(loaded.cases.filter((c) => cases.some((x) => x.case === c.id)), cases, loaded.spec.capabilities)
    const ablation = r.ablation
    const report = {
      format: 'rsi-eval-report/1',
      app,
      run: r.id,
      version: r.version,
      kind: r.kind,
      evalset: r.evalset,
      executor: r.executor,
      by: r.by,
      startedAt: r.at,
      finishedAt: r.finishedAt,
      status: r.status,
      error: r.error,
      selection: r.cases ?? null,
      trials: r.trials ?? 1,
      ablate: r.ablate ?? null,
      summary,
      coverage: covered,
      ablation,
      cases: cases.map((c) => ({
        id: c.case,
        title: c.title,
        split: c.split,
        ok: c.ok,
        score: c.score,
        error: c.error ?? null,
        invalid: c.invalid ?? null,
        passRate: c.passRate ?? null,
        trials: c.trials ?? null,
        status: c.status ?? null,
        ms: c.ms ?? null,
        run: c.run,
        checks: c.checks,
        violations: c.violations,
        output: c.output ?? null,
      })),
    }
    if (format === 'json') return { bytes: new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`), name: `${app}-${r.id}.json`, type: 'application/json' }
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`
    const cell = (v: string) => v.replace(/\|/g, '\\|')
    const trials = r.trials ?? 1
    const lines = [
      `# 评测报告 ${r.id}`,
      '',
      `- 应用：${app}`,
      `- 版本：${r.version}（${r.kind === 'candidate' ? '候选版本' : '已发布版本'}）`,
      `- 评测集：${r.evalset ?? '—'}`,
      `- 执行：${r.executor}`,
      `- 范围：${r.cases ? `所选 ${r.cases.length} 个用例（部分用例，不作为发布依据）` : r.splits.map((s) => (s === 'dev' ? '开发集' : '留出集')).join('、')}`,
      ...(trials > 1 ? [`- 每个用例运行 ${trials} 次：检查项过半次数通过算通过，用例过半次数通过算通过`] : []),
      ...(r.ablate ? [`- 消融：${ABLATIONS[r.ablate]}（不代表这个版本的成绩）`] : []),
      `- 发起：${r.by}，${r.at}${r.finishedAt ? ` → ${r.finishedAt}` : ''}`,
      `- 状态：${r.status}${r.error ? `（${r.error}）` : ''}`,
      '',
      '## 汇总',
      '',
      '| 范围 | 通过 | 得分 | 执行出错（不计分） | 用例无效（不计分） |',
      '|---|---|---|---|---|',
      ...Object.entries(summary).map(([split, s]) => `| ${split === 'dev' ? '开发集' : '留出集'} | ${s.passed}/${s.total} | ${pct(s.score)} | ${s.errors.join('、') || '—'} | ${s.invalid.join('、') || '—'} |`),
      '',
    ]
    if (ablation) {
      lines.push('## 消融对比', '')
      if (!ablation.against) lines.push('同一版本、同一评测集上还没有完整运行，没法对比；先完整跑一次。', '')
      else {
        lines.push(
          ablation.delta === null ? `对照完整运行 ${ablation.against}，没有两边都打了分的用例。` : `对照完整运行 ${ablation.against}：去掉之后用例平均得分${ablation.delta >= 0 ? '低' : '反而高'} ${(Math.abs(ablation.delta) * 100).toFixed(1)} 个百分点。`,
          '',
          '| 用例 | 完整 | 消融 | 差 |',
          '|---|---|---|---|',
          ...ablation.cases.map((c) => `| ${c.id} | ${pct(c.full)} | ${pct(c.ablated)} | ${c.delta > 0 ? '-' : c.delta < 0 ? '+' : ''}${(Math.abs(c.delta) * 100).toFixed(1)} 个百分点 |`),
          '',
        )
      }
    }
    if (covered.length) {
      lines.push('## 能力覆盖', '', '| 能力 | 用例 | 通过 | 得分 |', '|---|---|---|---|')
      for (const c of covered) lines.push(`| ${c.capability}${c.title ? `（${cell(c.title)}）` : ''} | ${c.cases.join('、') || '没有用例'} | ${c.scored ? `${c.passed}/${c.scored}` : '—'} | ${c.score === null ? '—' : pct(c.score)} |`)
      lines.push('')
    }
    lines.push('## 用例', '')
    for (const c of report.cases) {
      const icon = c.error ? '⚠️' : c.invalid ? '🚫' : c.ok ? '✅' : '❌'
      lines.push(`### ${icon} ${c.id} ${c.title}`, '')
      if (c.error) {
        lines.push(`执行出错，不计分：${c.error}。不是智能体答错，请重新运行。`, '')
        continue
      }
      if (c.invalid) {
        lines.push(`用例无效，没有执行：${c.invalid}。请修正期望值或参考答案。`, '')
        continue
      }
      const rate = c.passRate === null ? '' : `；${c.trials?.filter((t) => !t.error).length ?? trials} 次里通过 ${pct(c.passRate)}`
      lines.push(`得分 ${pct(c.score)}${rate}；状态 ${c.status ?? '—'}；${c.run}`, '')
      const failed = c.checks.filter((x) => !x.ok || (x.rate !== undefined && x.rate < 1))
      if (failed.length) {
        const withRate = failed.some((x) => x.rate !== undefined)
        lines.push(
          withRate ? '| 检查项 | 期望 | 实际（没通过时） | 通过次数 |' : '| 检查项 | 期望 | 实际 |',
          withRate ? '|---|---|---|---|' : '|---|---|---|',
          ...failed.map((x) => `| ${x.path} | ${cell(x.expected)} | ${cell(x.actual)} |${withRate ? ` ${x.rate === undefined ? '—' : pct(x.rate)} |` : ''}`),
          '',
        )
      } else lines.push(`${c.checks.length} 项检查全部通过。`, '')
      if (c.violations.length) lines.push('违反的硬规则：', '', ...c.violations.map((v) => `- ${v}`), '')
    }
    return { bytes: new TextEncoder().encode(lines.join('\n')), name: `${app}-${r.id}.md`, type: 'text/markdown; charset=utf-8' }
  }

  async #runs(app: string): Promise<EvalRun[]> {
    return (await this.#console.store.list<EvalRun>('evalruns')).filter((r) => r.app === app).sort((a, b) => Number(b.id.slice(3)) - Number(a.id.slice(3)))
  }

  /** Runs left unfinished by a restart are marked failed. With a shared queue, the queue hands them to another instance instead. */
  async recover(): Promise<void> {
    if (this.#console.jobs.driver !== 'inline') return
    for (const r of await this.#console.store.list<EvalRun>('evalruns')) {
      if (r.status === 'running' || r.status === 'queued') await this.#console.store.put('evalruns', r.id, { ...r, status: 'failed', error: '服务重启，评测中断；请重新发起', finishedAt: this.#console.now() })
    }
  }

  async runs(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    return (await this.#runs(app)).map((r) => ({ ...r, results: { dev: lean(r.results.dev), holdout: lean(r.results.holdout) } }))
  }

  async run(app: string, user: User, id: string) {
    await this.#console.demand(app, user, 'app.read')
    const r = await this.#console.store.get<EvalRun>('evalruns', id)
    if (!r || r.app !== app) throw new AccessError(`没有评测 ${id}`, 404)
    return { ...r, ablation: await this.#ablationOf(r) }
  }

  /** One case's full result in a run: field checks, violations and the agent's output. */
  async caseResult(app: string, user: User, id: string, caseId: string): Promise<CaseScore & { expected: unknown; input: unknown; title: string }> {
    const r = await this.run(app, user, id)
    const score = [...(r.results.dev?.cases ?? []), ...(r.results.holdout?.cases ?? [])].find((c) => c.case === caseId)
    if (!score) throw new AccessError(`评测 ${id} 里没有用例 ${caseId}`, 404)
    const c = this.#kernel.app(app).cases.find((x) => x.id === caseId)
    return { ...score, expected: c?.expected ?? null, input: c?.input ?? null, title: c?.title ?? caseId }
  }

  /**
   * Start evaluating a version in the background. Runs of one app queue behind each other,
   * because they share the app's judge and executor.
   */
  async start(app: string, user: User, body: { version: string; splits?: Split[]; cases?: string[]; trials?: number; ablate?: Ablation | null }) {
    await this.#console.demand(app, user, 'eval.run')
    const trials = body.trials ?? 1
    if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) throw new AccessError(`每个用例运行次数应为 1 到 ${MAX_TRIALS}`, 400)
    if (body.ablate && !(body.ablate in ABLATIONS)) throw new AccessError(`消融方式只能是 ${Object.keys(ABLATIONS).join('、')}`, 400)
    const version = (await this.#kernel.version(app, body.version)).id
    const loaded = this.#kernel.app(app)
    const chosen = body.cases?.length ? [...new Set(body.cases)] : null
    const unknown = (chosen ?? []).filter((id) => !loaded.cases.some((c) => c.id === id))
    if (unknown.length) throw new AccessError(`没有用例 ${unknown.join('、')}`, 400)
    const splits: Split[] = chosen
      ? (['dev', 'holdout'] as const).filter((s) => chosen.some((id) => this.#kernel.splitOf(app, id) === s))
      : (body.splits?.length ? body.splits : (['dev', 'holdout'] as Split[])).filter((s): s is Split => s === 'dev' || s === 'holdout')
    const total = chosen ? chosen.length : loaded.cases.filter((c) => splits.includes(this.#kernel.splitOf(app, c.id))).length
    if (total === 0) throw new AccessError('所选范围里没有用例，先在“用例”里添加', 400)
    const store = this.#console.store
    let n: number
    if (store.next) n = await store.next('evalrun')
    else {
      n = ((await store.get<{ n: number }>('counters', 'evalrun'))?.n ?? 0) + 1
      await store.put('counters', 'evalrun', { n })
    }
    const run: EvalRun = {
      id: `EV-${n}`,
      app,
      version,
      kind: /^P-/.test(version) ? 'candidate' : 'release',
      splits,
      ...(chosen ? { cases: chosen } : {}),
      ...(trials > 1 ? { trials } : {}),
      ...(body.ablate ? { ablate: body.ablate } : {}),
      status: 'queued',
      progress: { done: 0, total, current: null },
      by: user.name,
      at: this.#console.now(),
      finishedAt: null,
      evalset: loaded.evalset,
      executor: this.#console.executorStatus.note,
      results: {},
      error: null,
    }
    await this.#console.store.put('evalruns', run.id, run)
    if (this.#console.jobs.driver === 'inline') {
      const previous = this.#queues.get(app) ?? Promise.resolve()
      const next = previous.then(() => this.#execute(run))
      this.#queues.set(app, next.catch(() => undefined))
    } else await this.#console.jobs.submit('eval.run', { run: run.id })
    return run
  }

  /** A queued run, on whichever instance took it; runs of one app still go one at a time. */
  async #queued(id: string, reclaimed: boolean): Promise<void> {
    const store = this.#console.store
    const run = await store.get<EvalRun>('evalruns', id)
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return
    if (reclaimed && run.status === 'running') {
      await store.put('evalruns', id, { ...run, status: 'failed', error: '执行评测的实例已停止，评测中断；请重新发起', finishedAt: this.#console.now() })
      return
    }
    const go = () => this.#execute(run)
    await (store.exclusive ? store.exclusive(`eval:${run.app}`, go) : go())
  }

  async #execute(run: EvalRun): Promise<void> {
    const save = () => this.#console.store.put('evalruns', run.id, run)
    run.status = 'running'
    await save()
    let base = 0
    let saving: Promise<void> = Promise.resolve()
    try {
      for (const split of run.splits) {
        const cases = this.#kernel.app(run.app).cases.filter((c) => this.#kernel.splitOf(run.app, c.id) === split && (!run.cases || run.cases.includes(c.id)))
        run.progress.current = cases[0]?.id ?? null
        run.results[split] = await this.#kernel.evaluate(
          run.app,
          run.version,
          split,
          (score, done) => {
            run.progress.done = base + done
            run.progress.current = cases[done]?.id ?? null
            saving = saving.then(save)
          },
          run.cases?.filter((id) => cases.some((c) => c.id === id)),
          { trials: run.trials ?? 1, ...(run.ablate ? { ablate: run.ablate } : {}) },
        )
        base += cases.length
      }
      await saving
      run.status = 'done'
      run.evalset = this.#kernel.app(run.app).evalset
    } catch (error) {
      await saving
      run.status = 'failed'
      run.error = (error as Error).message
    }
    run.progress.current = null
    run.finishedAt = this.#console.now()
    await save()
  }

  /** The latest finished run per version, for the version × case matrix. */
  async overview(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const versions = await this.#console.versions(app, user)
    const runs = await this.#runs(app)
    const latest: Record<string, { run: string; at: string; evalset: string | null; dev?: SuiteResult; holdout?: SuiteResult }> = {}
    for (const r of runs) {
      if (r.status !== 'done' || r.cases || r.ablate) continue
      const cur = latest[r.version] ?? { run: r.id, at: r.at, evalset: r.evalset }
      for (const s of r.splits) if (!cur[s]) cur[s] = lean(r.results[s])
      latest[r.version] = cur
    }
    const loaded = this.#kernel.app(app)
    return {
      versions,
      latest,
      running: runs.filter((r) => r.status === 'running' || r.status === 'queued').map((r) => ({ id: r.id, version: r.version, progress: r.progress, status: r.status })),
      cases: loaded.cases.map((c) => ({ id: c.id, title: c.title, split: this.#kernel.splitOf(app, c.id) })),
      evalset: loaded.evalset,
      executor: this.#console.executorStatus,
    }
  }

  /** How this app's evaluation works, as facts for the rules page. */
  async rules(app: string, user: User) {
    await this.#console.demand(app, user, 'app.read')
    const loaded = this.#kernel.app(app)
    const m = loaded.manifest
    return {
      cases: loaded.cases.length,
      dev: loaded.cases.filter((c) => this.#kernel.splitOf(app, c.id) === 'dev').length,
      holdout: loaded.cases.filter((c) => this.#kernel.splitOf(app, c.id) === 'holdout').map((c) => c.id),
      casesDir: m.evals.cases,
      trials: loaded.spec.trials,
      capabilities: loaded.spec.capabilities,
      oracles: loaded.cases.filter((c) => c.oracle).length,
      judge: `${m.judge.command} ${m.judge.args.join(' ')}`,
      tests: existsSync(join(this.#root(app), 'tests')),
      expect: existsSync(join(this.#root(app), 'expect.ts')),
      evalset: loaded.evalset,
      executor: this.#console.executorStatus,
      example: loaded.cases[0] ? { id: loaded.cases[0].id, expected: loaded.cases[0].expected } : null,
    }
  }
}

/** Run `evals/expect.ts` with `{ input, output }` on stdin; it prints the expected value as JSON. */
function runExpect(cwd: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['expect.ts'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
    child.stdout.on('data', (c: Buffer) => (out += c.toString()))
    child.stderr.on('data', (c: Buffer) => (err = (err + c.toString()).slice(-2000)))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new AccessError(`evals/expect.ts 失败：${err.trim().split('\n').slice(-2).join(' ') || `退出码 ${code}`}`, 500))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new AccessError('evals/expect.ts 没有输出 JSON', 500))
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}