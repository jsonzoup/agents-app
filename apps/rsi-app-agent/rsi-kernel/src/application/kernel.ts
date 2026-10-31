/**
 * Kernel use cases. Orchestrates domain objects through ports; holds no I/O of its own.
 *
 * Loop: collect signals → group into issues → learners draft proposals → verify
 * (dev twice, holdout once, invariants, app tests) → humans approve by tier → move the pointer.
 */

import { applyChanges, ChangeError, touchedPaths } from '../domain/change.ts'
import type { FileContent } from '../domain/change.ts'
import type { CaseScore, Difficulty, EvalCase, EvalSet, EvalSpecFile, FieldCheck, Oracle, Split, SuiteResult, TrialRun, ValidatorSpec } from '../domain/evaluation.ts'
import { DEFAULT_VALIDATOR, DIFFICULTIES, MAX_TRIALS, aggregateTrials, compare, coverage, parseEvalSpec, summarize, unscored } from '../domain/evaluation.ts'
import type { Rule } from '../domain/rules.ts'
import { applyRules, ruleProblems } from '../domain/rules.ts'
import type { Ablation, AppManifest, Tier } from '../domain/manifest.ts'
import { ablatedPaths, instructionsFor, isWebPath, maxTier, parseManifest, scopeOf, tierOf } from '../domain/manifest.ts'
import type { Approval, Proposal, Role, Verification } from '../domain/proposal.ts'
import { requiredRoles } from '../domain/proposal.ts'
import type { Channels, Release } from '../domain/release.ts'
import { fingerprint, hashContent } from '../domain/release.ts'
import type { Issue, Signal } from '../domain/signal.ts'
import { groupSignals } from '../domain/signal.ts'
import type { Gate } from '../extensions/gates.ts'
import { DEFAULT_GATES } from '../extensions/gates.ts'
import type { AppSource, AppTests, Clock, Executor, Judge, Learner, ProposalDraft, RunResult, Store } from '../ports.ts'

export interface LoadedApp {
  manifest: AppManifest
  source: AppSource
  cases: EvalCase[]
  /** `evals/eval.json`, or defaults when the app has none. */
  spec: EvalSpecFile
  /** Hash of the evaluation tree outside the case folders (validators, eval.json); a change rescores every case. */
  judgeHash: string
  /** Latest snapshot of the evaluation tree. */
  evalset: string | null
}

/** `case.json` as written: `expected` and `oracle` may name files under the case folder. */
type RawCase = Omit<Partial<EvalCase>, 'oracle'> & { expected?: unknown; oracle?: unknown }

/** Versions a task or an evaluation can run on: a release (`r3`) or a proposal's candidate (`P-7`). */
const CANDIDATE = /^P-\d+$/

export interface Run {
  id: string
  app: string
  release: string
  at: string
  caseId: string | null
  input: unknown
  scope: Record<string, string>
  instructions: string[]
  result: RunResult
}

/** How an evaluation runs: runs per case, and what to take away from the agent. */
export interface EvaluateOptions {
  trials?: number
  /** Ablation runs measure what knowledge or skills contribute; they never verify a proposal. */
  ablate?: Ablation
}

/** One case as the case check sees it. */
export interface CaseAudit {
  id: string
  title: string
  split: Split
  difficulty: Difficulty | null
  capabilities: string[]
  /** Must be fixed: the case cannot be trusted as it is. */
  problems: string[]
  /** Worth fixing. */
  warnings: string[]
  /** The reference run scored by the case's own rules and validator; `null` when the case has none. */
  oracle: { ok: boolean; score: number; failed: FieldCheck[]; violations: string[] } | null
}

export interface KernelOptions {
  store: Store
  clock: Clock
  executor: Executor
  /** Opens one validator program of the app (`judge` from the manifest, or one named in `eval.json`); the kernel closes it after each evaluation batch. */
  judge: (app: LoadedApp, validator: ValidatorSpec) => Judge
  learners?: Learner[]
  gates?: Gate[]
  appTests?: AppTests
}

const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

function asText(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KernelError'
  }
}

export class RsiKernel {
  readonly #store: Store
  readonly #clock: Clock
  readonly #executor: Executor
  readonly #judge: KernelOptions['judge']
  readonly #learners: Map<string, Learner>
  readonly #gates: Gate[]
  readonly #appTests: AppTests | undefined
  readonly #apps = new Map<string, LoadedApp>()

  constructor(options: KernelOptions) {
    this.#store = options.store
    this.#clock = options.clock
    this.#executor = options.executor
    this.#judge = options.judge
    this.#learners = new Map((options.learners ?? []).map((l) => [l.name, l]))
    this.#gates = options.gates ?? DEFAULT_GATES
    this.#appTests = options.appTests
  }

  // ── apps and releases ────────────────────────────────────────────

  /**
   * Load an app from source. The first install snapshots the source as `r1` and points `stable` at it.
   * @returns the loaded app and its stable release.
   */
  async install(source: AppSource, note = '从源目录安装'): Promise<{ app: LoadedApp; release: Release }> {
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await source.read('app.json'))))
    const app = await this.#load(manifest, source)
    this.#apps.set(manifest.name, app)
    return this.#locked(manifest.name, async () => {
      const channels = await this.#store.get<Channels>('channels', manifest.name)
      await this.snapshotEvals(manifest.name, { by: 'kernel', note: channels ? '启动时发现评测集有变化' : '随应用安装' })
      if (channels) return { app: this.app(manifest.name), release: await this.release(manifest.name, channels.stable) }
      const files: Record<string, string> = {}
      for (const path of await source.list()) files[path] = await this.#store.putBlob(await source.read(path))
      const release = await this.#newRelease(manifest.name, null, files, 'source', null, note)
      const initial: Channels = { app: manifest.name, stable: release.id, history: [{ at: release.createdAt, from: null, to: release.id, reason: note }] }
      await this.#store.put('channels', manifest.name, initial)
      return { app: this.app(manifest.name), release }
    })
  }

  /**
   * Snapshot the current source as a new release and point `stable` at it. This is the
   * human path for every change, including contract changes the loop may not make.
   * @returns the new release.
   */
  async importSource(name: string, note: string): Promise<Release> {
    return this.#locked(name, async () => {
      const { source } = this.app(name)
      const stable = await this.stable(name)
      const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await source.read('app.json'))))
      const files: Record<string, string> = {}
      for (const path of await source.list()) files[path] = await this.#store.putBlob(await source.read(path))
      this.#apps.set(name, await this.#load(manifest, source))
      await this.snapshotEvals(name, { by: 'kernel', note: '随人工导入' })
      const release = await this.#newRelease(name, stable.id, files, 'source', null, note)
      await this.#movePointer(name, release.id, note)
      return release
    })
  }

  /**
   * Reload an installed app from its source after another process changed it (a new release,
   * a new evaluation set). Creates nothing: snapshots are taken by whoever made the change.
   */
  async reload(source: AppSource): Promise<LoadedApp> {
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await source.read('app.json'))))
    const app = await this.#load(manifest, source)
    const latest = (await this.evalSets(manifest.name)).at(-1)
    const loaded = { ...app, evalset: latest?.id ?? app.evalset }
    this.#apps.set(manifest.name, loaded)
    return loaded
  }

  app(name: string): LoadedApp {
    const app = this.#apps.get(name)
    if (!app) throw new KernelError(`应用 ${name} 未安装`)
    return app
  }

  async channels(name: string): Promise<Channels> {
    const channels = await this.#store.get<Channels>('channels', name)
    if (!channels) throw new KernelError(`应用 ${name} 没有发布渠道`)
    return channels
  }

  async stable(name: string): Promise<Release> {
    return this.release(name, (await this.channels(name)).stable)
  }

  async release(name: string, id: string): Promise<Release> {
    const release = await this.#store.get<Release>('releases', `${name}.${id}`)
    if (!release) throw new KernelError(`${name} 没有版本 ${id}`)
    return release
  }

  async releases(name: string): Promise<Release[]> {
    const all = await this.#store.list<Release>('releases')
    return all.filter((r) => r.app === name).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  }

  /** Text content of every UTF-8 file in a release. Binary files are skipped. */
  async textFiles(release: Release): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const [path, hash] of Object.entries(release.files)) {
      const text = asText(await this.#store.getBlob(hash))
      if (text !== null) out.set(path, text)
    }
    return out
  }

  /** Every file of a release: text as text, anything else as a blob reference. */
  async contents(release: Release): Promise<Map<string, FileContent>> {
    const out = new Map<string, FileContent>()
    for (const [path, hash] of Object.entries(release.files)) out.set(path, asText(await this.#store.getBlob(hash)) ?? { blob: hash })
    return out
  }

  /** Store content (e.g. an uploaded spreadsheet) so a proposal can `put` it. @returns its hash. */
  putBlob(content: Uint8Array): Promise<string> {
    return this.#store.putBlob(content)
  }

  blob(hash: string): Promise<Uint8Array> {
    return this.#store.getBlob(hash)
  }

  /** A release (`r3`) or a proposal's candidate (`P-7`): anything a task or an evaluation can run on. */
  async version(name: string, id: string): Promise<Release> {
    return CANDIDATE.test(id) ? this.candidate(name, id) : this.release(name, id)
  }

  /** The release a proposal would become: its changes on top of its base. Not a release until approved. */
  async candidate(name: string, proposalId: string): Promise<Release> {
    const proposal = await this.proposal(name, proposalId)
    if (proposal.status === 'rejected') throw new KernelError(`提案 ${proposalId} 已驳回，没有候选版本`)
    if (proposal.release) return this.release(name, proposal.release)
    return this.#candidate(proposal, await this.release(name, proposal.base))
  }

  /** Directory holding a version's files, for executors and people browsing it. */
  async materialize(name: string, id: string): Promise<string> {
    return this.#store.materialize(await this.version(name, id))
  }

  // ── evaluation sets ─────────────────────────────────────────────

  /**
   * Reload the evaluation tree from source and snapshot it when it changed. People change
   * cases, materials and judges; every change gets its own snapshot so scores stay traceable.
   * @returns the latest snapshot.
   */
  async snapshotEvals(name: string, by: { by: string; note: string }): Promise<EvalSet> {
    return this.#locked(name, () => this.#snapshotEvals(name, by))
  }

  async #snapshotEvals(name: string, by: { by: string; note: string }): Promise<EvalSet> {
    const app = this.app(name)
    const fresh = await this.#load(app.manifest, app.source)
    const files: Record<string, string> = {}
    for (const path of await app.source.evals.list()) files[path] = await this.#store.putBlob(await app.source.evals.read(path))
    const sets = await this.evalSets(name)
    const last = sets.at(-1) ?? null
    const print = fingerprint(files)
    let set = last
    if (!last || last.fingerprint !== print) {
      set = { id: `e${sets.length + 1}`, app: name, parent: last?.id ?? null, at: this.#clock.now(), by: by.by, note: by.note, files, fingerprint: print }
      await this.#store.put('evalsets', `${name}.${set.id}`, set)
    }
    this.#apps.set(name, { ...fresh, evalset: set!.id })
    return set!
  }

  async evalSets(name: string): Promise<EvalSet[]> {
    return (await this.#store.list<EvalSet>('evalsets')).filter((s) => s.app === name).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  }

  /**
   * Point `stable` back at an earlier release. Running tasks keep the release they started on.
   * @returns the updated channels.
   */
  async rollback(name: string, to: string, reason: string): Promise<Channels> {
    await this.release(name, to)
    return this.#locked(name, () => this.#movePointer(name, to, reason))
  }

  // ── tasks ────────────────────────────────────────────────────────

  /**
   * Run one task on the stable release, or on a given release or proposal candidate (a trial), and record it.
   * @returns the stored run.
   */
  async runTask(name: string, request: { input: unknown; scope?: Record<string, string>; caseId?: string; release?: string }): Promise<Run> {
    const app = this.app(name)
    const release = request.release ? await this.version(name, request.release) : await this.stable(name)
    const scope = request.scope ?? scopeOf(app.manifest, request.input)
    const result = await this.#execute(app, this.#agentView(app, release), request.input, scope, request.caseId)
    const run: Run = {
      id: await this.#nextId('run', 'run-'),
      app: name,
      release: release.id,
      at: this.#clock.now(),
      caseId: request.caseId ?? null,
      input: request.input,
      scope,
      instructions: instructionsFor(app.manifest, Object.keys(release.files), scope),
      result,
    }
    await this.#store.put('runs', run.id, run)
    return run
  }

  async runs(name: string): Promise<Run[]> {
    return (await this.#store.list<Run>('runs')).filter((r) => r.app === name)
  }

  // ── signals and issues ──────────────────────────────────────────

  /**
   * Record one human or system signal. The release must exist.
   * @returns the stored signal.
   */
  async recordSignal(name: string, signal: Omit<Signal, 'id' | 'app' | 'at'>): Promise<Signal> {
    await this.version(name, signal.release)
    const stored: Signal = { ...signal, id: await this.#nextId('signal', 'S-'), app: name, at: this.#clock.now() }
    await this.#store.put('signals', stored.id, stored)
    return stored
  }

  async signals(name: string): Promise<Signal[]> {
    return (await this.#store.list<Signal>('signals')).filter((s) => s.app === name)
  }

  async issues(name: string): Promise<Issue[]> {
    return groupSignals(await this.signals(name))
  }

  // ── proposals ───────────────────────────────────────────────────

  /**
   * Ask a learner for drafts on one issue. Holdout results are never part of the context.
   * @returns validated proposals; drafts touching contract files come back `rejected`.
   */
  async propose(name: string, issueId: string, learnerName: string): Promise<Proposal[]> {
    const learner = this.#learners.get(learnerName)
    if (!learner) throw new KernelError(`没有提案器 ${learnerName}`)
    const app = this.app(name)
    const issue = (await this.issues(name)).find((i) => i.id === issueId)
    if (!issue) throw new KernelError(`没有问题 ${issueId}`)
    const signals = (await this.signals(name)).filter((s) => issue.signals.includes(s.id))
    const base = await this.stable(name)
    const files: Record<string, { text: string; tier: Tier }> = {}
    for (const [path, text] of await this.textFiles(base)) {
      const tier = tierOf(app.manifest, path)
      if (tier !== 'contract') files[path] = { text, tier }
    }
    const drafts = await learner.propose({ app: app.manifest, issue, signals, files, base })
    const out: Proposal[] = []
    for (const draft of drafts) out.push(await this.submit(name, draft, learner.name, issue.id))
    return out
  }

  /**
   * Submit a draft directly (humans use this; learners go through {@link propose}).
   * @returns the stored proposal, `draft` if valid, `rejected` if it touches contract files or its anchors fail.
   */
  async submit(name: string, draft: ProposalDraft, author: string, issueId: string | null = null): Promise<Proposal> {
    const app = this.app(name)
    const base = await this.stable(name)
    const paths = touchedPaths(draft.changes)
    const tier = maxTier(paths.map((p) => tierOf(app.manifest, p)))
    const proposal: Proposal = {
      id: await this.#nextId('proposal', 'P-'),
      app: name,
      issue: issueId,
      title: draft.title,
      author,
      base: base.id,
      changes: draft.changes,
      tier,
      record: draft.record,
      status: 'draft',
      createdAt: this.#clock.now(),
      verification: null,
      approvals: [],
      release: null,
    }
    const problems: string[] = []
    if (paths.length === 0) problems.push('没有任何改动')
    if (tier === 'contract') problems.push(`改到了契约文件：${paths.filter((p) => tierOf(app.manifest, p) === 'contract').join('、')}`)
    if (problems.length === 0) {
      try {
        applyChanges(await this.contents(base), draft.changes)
      } catch (error) {
        if (!(error instanceof ChangeError)) throw error
        problems.push(error.message)
      }
      for (const change of draft.changes.filter((c) => c.op === 'put')) {
        if (!(await this.#store.getBlob(change.blob!).then(() => true, () => false))) problems.push(`${change.path} 的内容 ${change.blob} 没有存进来`)
      }
    }
    if (problems.length > 0) {
      proposal.status = 'rejected'
      proposal.approvals.push({ role: 'owner', by: 'kernel', at: proposal.createdAt, ok: false, note: problems.join('；') })
    }
    await this.#store.put('proposals', proposal.id, proposal)
    return proposal
  }

  async proposal(name: string, id: string): Promise<Proposal> {
    const p = await this.#store.get<Proposal>('proposals', id)
    if (!p || p.app !== name) throw new KernelError(`${name} 没有提案 ${id}`)
    return p
  }

  async proposals(name: string): Promise<Proposal[]> {
    return (await this.#store.list<Proposal>('proposals')).filter((p) => p.app === name)
  }

  /**
   * Verify a proposal: baseline and candidate on the dev split, holdout at most once,
   * judge invariants, app tests for code tier, then every gate.
   * @returns the verification, also stored on the proposal.
   */
  async verify(name: string, id: string): Promise<Verification> {
    const proposal = await this.proposal(name, id)
    if (proposal.status === 'rejected' || proposal.status === 'released') throw new KernelError(`提案 ${id} 状态为 ${proposal.status}，不能验证`)
    const app = this.app(name)
    const base = await this.release(name, proposal.base)
    const candidate = await this.#candidate(proposal, base)
    const judges = this.#validators(app)
    const options = { trials: app.spec.trials }
    try {
      const devBase = await this.#suite(app, judges, base, 'dev', undefined, undefined, options)
      const devCand = await this.#suite(app, judges, candidate, 'dev', undefined, undefined, options)
      const looked = proposal.verification?.holdout ?? null
      const complete = (s: SuiteResult) => !s.cases.some(unscored)
      // Holdout is looked at once; a look that did not score every case does not count, and cached scores keep a second look identical.
      let holdout = looked && complete(looked.baseline) && complete(looked.candidate) ? looked : null
      if (holdout === null) {
        const hBase = await this.#suite(app, judges, base, 'holdout', undefined, undefined, options)
        const hCand = await this.#suite(app, judges, candidate, 'holdout', undefined, undefined, options)
        holdout = { baseline: hBase, candidate: hCand, comparison: compare(hBase, hCand) }
      }
      const violations = [...devCand.cases, ...holdout.candidate.cases].flatMap((c) => c.violations.map((v) => `${c.case}：${v}`))
      let appTests: Verification['appTests'] = null
      if (proposal.tier === 'code' && this.#appTests) appTests = await this.#appTests.run(await this.#store.materialize(candidate), app.source.evals.root)
      const dev = { baseline: devBase, candidate: devCand, comparison: compare(devBase, devCand) }
      const viewOnly = touchedPaths(proposal.changes).every((p) => isWebPath(app.manifest, p))
      const gates = this.#gates.map((g) => g.check({ proposal, dev, holdout, violations, appTests, viewOnly }))
      const verification: Verification = {
        baseline: base.id,
        at: this.#clock.now(),
        dev,
        holdout,
        violations,
        appTests,
        gates,
        passed: gates.every((g) => g.ok),
      }
      return await this.#locked(name, async () => {
        const fresh = await this.proposal(name, id)
        if (fresh.status === 'rejected' || fresh.status === 'released') throw new KernelError(`提案 ${id} 在验证期间已${fresh.status === 'released' ? '发布' : '驳回'}`)
        fresh.verification = verification
        fresh.status = verification.passed ? 'verified' : 'failed'
        await this.#store.put('proposals', fresh.id, fresh)
        return verification
      })
    } finally {
      await judges.close()
    }
  }

  /**
   * Record one approval. When every role the tier requires has approved a verified proposal
   * whose base is still stable, the kernel creates the release and moves the pointer.
   * @param required - roles the host's policy requires instead of the tier default; never empty, never for contract tier.
   * @returns the updated proposal.
   */
  async decide(name: string, id: string, approval: Approval, required?: Role[]): Promise<Proposal> {
    return this.#locked(name, () => this.#decide(name, id, approval, required))
  }

  async #decide(name: string, id: string, approval: Approval, required?: Role[]): Promise<Proposal> {
    const proposal = await this.proposal(name, id)
    if (proposal.status === 'released' || proposal.status === 'rejected') throw new KernelError(`提案 ${id} 已${proposal.status === 'released' ? '发布' : '驳回'}`)
    const tierRoles = requiredRoles(proposal.tier)
    if (required?.length === 0) throw new KernelError('至少需要一位审批人')
    const roles = required ?? tierRoles
    if (!roles.includes(approval.role)) throw new KernelError(`${proposal.tier} 级提案不需要 ${approval.role} 审批`)
    proposal.approvals.push(approval)
    if (!approval.ok) {
      proposal.status = 'rejected'
      await this.#store.put('proposals', proposal.id, proposal)
      return proposal
    }
    const approved = roles.every((role) => proposal.approvals.some((a) => a.role === role && a.ok))
    if (approved) {
      if (proposal.status !== 'verified') throw new KernelError(`提案 ${id} 尚未通过验证，不能发布`)
      const stable = await this.stable(name)
      if (stable.id !== proposal.base) throw new KernelError(`基线已从 ${proposal.base} 变为 ${stable.id}，需要重新提案`)
      const candidate = await this.#candidate(proposal, stable)
      const release = await this.#newRelease(name, stable.id, candidate.files, 'proposal', proposal.id, proposal.title)
      await this.#movePointer(name, release.id, `发布 ${proposal.id}：${proposal.title}`)
      proposal.status = 'released'
      proposal.release = release.id
    }
    await this.#store.put('proposals', proposal.id, proposal)
    return proposal
  }

  /**
   * Evaluate one version (a release or a proposal's candidate) on one split.
   * @param onCase - called after each case, for progress.
   * @param only - case ids to run; the rest of the split is skipped and the result says so.
   * @returns the suite result; per-case results are cached by the content that decides them.
   */
  async evaluate(
    name: string,
    versionId: string,
    split: Split,
    onCase?: (score: CaseScore, done: number, total: number) => void,
    only?: string[],
    options: EvaluateOptions = {},
  ): Promise<SuiteResult> {
    const app = this.app(name)
    const release = await this.version(name, versionId)
    const judges = this.#validators(app)
    try {
      return await this.#suite(app, judges, release, split, onCase, only, options)
    } finally {
      await judges.close()
    }
  }

  /**
   * Check the evaluation set without running the agent: every reference run must get full marks
   * from its own case, materials must match their recorded hashes, and cases should say where
   * they came from, how hard they are and what they test.
   * @returns per-case findings, set-level findings and capability coverage.
   */
  async audit(name: string): Promise<{ cases: CaseAudit[]; problems: string[]; warnings: string[]; coverage: ReturnType<typeof coverage> }> {
    const app = this.app(name)
    const vocabulary = app.spec.capabilities
    const judges = this.#validators(app)
    const prefix = `${name}/evals/`
    const tree = new Set(await app.source.evals.list())
    try {
      const cases: CaseAudit[] = []
      for (const c of app.cases) {
        const problems: string[] = []
        const warnings: string[] = []
        let oracle: CaseAudit['oracle'] = null
        try {
          oracle = await this.#oracleCheck(c, judges)
        } catch (error) {
          problems.push(`参考答案打分失败：${(error as Error).message}`)
        }
        if (oracle && !oracle.ok) problems.push(`参考答案没有得满分：${[...oracle.failed.map((f) => `${f.path} 期望 ${f.expected}，参考答案 ${f.actual}`), ...oracle.violations].slice(0, 4).join('；')}`)
        if (!c.oracle) warnings.push('没有参考答案（oracle）：无法证明期望值和裁判对正确答案给满分')
        const pending = (!c.expected || (typeof c.expected === 'object' && Object.keys(c.expected as object).length === 0)) && !c.rules?.length
        if (pending) warnings.push('期望值待确认')
        if (c.source.endsWith('/case.json')) warnings.push('没有写 source：期望值和材料的出处')
        if (!c.difficulty) warnings.push('没有写 difficulty（easy、medium、hard）')
        else if (!c.why) warnings.push('写了难度但没有写 why：难在哪里')
        if (!c.capabilities?.length) warnings.push('没有写 capabilities：这个用例考什么')
        const unknownCaps = Object.keys(vocabulary).length ? (c.capabilities ?? []).filter((k) => !(k in vocabulary)) : []
        if (unknownCaps.length) problems.push(`capabilities 不在 eval.json 的词表里：${unknownCaps.join('、')}`)
        for (const m of materialsOf(c.input)) {
          if (!m.path.startsWith(prefix)) continue
          const rel = m.path.slice(prefix.length)
          if (!tree.has(rel)) problems.push(`材料 ${rel} 不存在`)
          else if (m.sha256 && hashContent(await app.source.evals.read(rel)) !== m.sha256) problems.push(`材料 ${rel} 的内容和记录的 sha256 不一致`)
        }
        cases.push({ id: c.id, title: c.title, split: this.splitOf(name, c.id), difficulty: c.difficulty ?? null, capabilities: c.capabilities ?? [], problems, warnings, oracle })
      }
      const problems: string[] = []
      const warnings: string[] = []
      const covered = coverage(app.cases, [], vocabulary)
      const empty = covered.filter((x) => x.cases.length === 0).map((x) => x.capability)
      if (empty.length) warnings.push(`这些能力还没有用例：${empty.join('、')}`)
      if (!cases.some((c) => c.split === 'holdout')) warnings.push('没有留出集用例：发布前没有一次性的独立检验')
      if (app.cases.length > 0 && app.cases.every((c) => c.difficulty === 'easy')) warnings.push('用例都是 easy：评测区分不出好坏')
      return { cases, problems, warnings, coverage: covered }
    } finally {
      await judges.close()
    }
  }

  /** The split a case belongs to: holdout when the manifest lists it or the case file says so. */
  splitOf(name: string, caseId: string): Split {
    const app = this.app(name)
    return app.manifest.evals.holdout.includes(caseId) || app.cases.find((c) => c.id === caseId)?.split === 'holdout' ? 'holdout' : 'dev'
  }

  // ── internals ───────────────────────────────────────────────────

  async #load(manifest: AppManifest, source: AppSource): Promise<LoadedApp> {
    const prefix = `${manifest.evals.cases.replace(/\/$/, '')}/`
    const paths = await source.evals.list()
    const read = async (path: string) => source.evals.read(path)
    let spec: EvalSpecFile
    try {
      spec = parseEvalSpec(paths.includes('eval.json') ? JSON.parse(new TextDecoder().decode(await read('eval.json'))) : undefined)
    } catch (error) {
      throw new KernelError((error as Error).message)
    }
    const folders = new Map<string, Record<string, string>>()
    const others: Record<string, string> = {}
    for (const path of paths) {
      const hash = hashContent(await read(path))
      const id = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : null
      if (id && path.slice(prefix.length).includes('/')) folders.set(id, { ...folders.get(id), [path]: hash })
      else others[path] = hash
    }
    const cases: EvalCase[] = []
    for (const [id, files] of folders) {
      const path = `${prefix}${id}/case.json`
      if (!(path in files)) continue
      let raw: RawCase
      try {
        raw = JSON.parse(new TextDecoder().decode(await read(path))) as RawCase
      } catch (error) {
        throw new KernelError(`${path} 不是合法 JSON：${(error as Error).message}`)
      }
      cases.push(await this.#caseOf(manifest, spec, raw, path, `${prefix}${id}/`, paths, read, fingerprint(files)))
    }
    const missing = manifest.evals.holdout.filter((id) => !cases.some((c) => c.id === id))
    if (missing.length > 0) throw new KernelError(`留出集用例不存在：${missing.join('、')}`)
    const evalset = this.#apps.get(manifest.name)?.evalset ?? null
    return { manifest, source, cases: cases.sort((a, b) => a.id.localeCompare(b.id)), spec, judgeHash: fingerprint(others), evalset }
  }

  /** Validate one `case.json` and resolve what it names (expected file, validator). */
  async #caseOf(
    manifest: AppManifest,
    spec: EvalSpecFile,
    raw: RawCase,
    path: string,
    folder: string,
    paths: string[],
    read: (path: string) => Promise<Uint8Array>,
    hash: string,
  ): Promise<EvalCase> {
    if (typeof raw.id !== 'string' || raw.input === undefined) throw new KernelError(`${path} 缺少 id 或 input`)
    if (raw.id !== folder.split('/').at(-2)) throw new KernelError(`${path} 的 id 应与目录名相同`)
    const fromFile = async (key: string, value: unknown): Promise<unknown> => {
      if (typeof value !== 'string' || !/\.json$/.test(value)) return value
      const file = `${folder}${value.replace(/^\.\//, '')}`
      if (!paths.includes(file)) throw new KernelError(`${path} 的 ${key} 指向的 ${file} 不存在`)
      try {
        return JSON.parse(new TextDecoder().decode(await read(file)))
      } catch (error) {
        throw new KernelError(`${file} 不是合法 JSON：${(error as Error).message}`)
      }
    }
    const expected = await fromFile('expected', raw.expected)
    const oracle = (await fromFile('oracle', raw.oracle)) as Oracle | undefined
    if (oracle !== undefined && (!oracle || typeof oracle !== 'object' || typeof oracle.status !== 'string' || !('output' in oracle))) {
      throw new KernelError(`${path} 的 oracle（参考答案）要写成 {status, output}`)
    }
    if (raw.difficulty !== undefined && !DIFFICULTIES.includes(raw.difficulty as Difficulty)) throw new KernelError(`${path} 的 difficulty 只能是 ${DIFFICULTIES.join('、')}`)
    if (raw.capabilities !== undefined && !(Array.isArray(raw.capabilities) && raw.capabilities.every((t) => typeof t === 'string'))) throw new KernelError(`${path} 的 capabilities 必须是字符串数组`)
    const rules = raw.rules
    if (rules !== undefined && !Array.isArray(rules)) throw new KernelError(`${path} 的 rules 必须是数组`)
    const problems = (rules ?? []).flatMap((r, i) => ruleProblems(r, `规则 ${i + 1}`))
    if (problems.length) throw new KernelError(`${path}：${problems.join('；')}`)
    const validator = raw.validator === undefined ? (expected === undefined ? null : DEFAULT_VALIDATOR) : raw.validator
    if (validator !== null && validator !== DEFAULT_VALIDATOR && !(validator in spec.validators)) throw new KernelError(`${path} 的验证程序 ${validator} 没有在 eval.json 里声明`)
    if (validator !== null && expected === undefined) throw new KernelError(`${path} 用验证程序打分，需要 expected`)
    if (validator === null && !rules?.length) throw new KernelError(`${path} 既没有验证程序也没有规则，无法打分`)
    if (raw.tags !== undefined && !(Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === 'string'))) throw new KernelError(`${path} 的 tags 必须是字符串数组`)
    return {
      id: raw.id,
      title: raw.title ?? raw.id,
      input: raw.input,
      expected: expected ?? null,
      ...(rules?.length ? { rules: rules as Rule[] } : {}),
      validator,
      ...(raw.tags?.length ? { tags: raw.tags } : {}),
      scope: raw.scope ?? scopeOf(manifest, raw.input),
      source: raw.source ?? path,
      hash,
      split: raw.split === 'holdout' ? 'holdout' : undefined,
      ...(raw.difficulty ? { difficulty: raw.difficulty } : {}),
      ...(typeof raw.why === 'string' && raw.why.trim() ? { why: raw.why.trim() } : {}),
      ...(raw.capabilities?.length ? { capabilities: raw.capabilities } : {}),
      ...(oracle ? { oracle } : {}),
    }
  }

  /** Validator programs of one app, opened on first use and closed together. */
  #validators(app: LoadedApp): { get(name: string): Judge; close(): Promise<void> } {
    const open = new Map<string, Judge>()
    return {
      get: (name) => {
        let judge = open.get(name)
        if (!judge) {
          judge = this.#judge(app, name === DEFAULT_VALIDATOR ? app.manifest.judge : app.spec.validators[name])
          open.set(name, judge)
        }
        return judge
      },
      close: async () => {
        await Promise.all([...open.values()].map((j) => j.close()))
      },
    }
  }

  /** The release as the agent gets it: without the web application, which may hold secrets in its `.env`, and without what an ablation takes away. */
  #agentView(app: LoadedApp, release: Release, ablate?: Ablation): Release {
    if (!app.manifest.web && !ablate) return release
    const dropped = new Set(ablate ? ablatedPaths(app.manifest, Object.keys(release.files), ablate) : [])
    const files = Object.fromEntries(Object.entries(release.files).filter(([p]) => !isWebPath(app.manifest, p) && !dropped.has(p)))
    return { ...release, files, fingerprint: fingerprint(files) }
  }

  /** Score a case's reference run with its own rules and validator; anything short of full marks means the case is wrong. */
  async #oracleCheck(testCase: EvalCase, judges: { get(name: string): Judge }): Promise<CaseAudit['oracle']> {
    if (!testCase.oracle) return null
    const run = { status: testCase.oracle.status, output: testCase.oracle.output, trace: [], ms: 0, executor: 'oracle' }
    const judge = testCase.validator ? judges.get(testCase.validator) : null
    const checks = [...applyRules(testCase.rules, run), ...(judge ? await judge.score(testCase, run) : [])]
    const violations = judge ? await judge.check(run) : []
    const failed = checks.filter((c) => !c.ok)
    return { ok: failed.length === 0 && violations.length === 0, score: checks.length ? (checks.length - failed.length) / checks.length : 1, failed, violations }
  }

  async #suite(
    app: LoadedApp,
    judges: { get(name: string): Judge },
    release: Release,
    split: Split,
    onCase?: (score: CaseScore, done: number, total: number) => void,
    only?: string[],
    options: EvaluateOptions = {},
  ): Promise<SuiteResult> {
    const holdout = new Set([...app.manifest.evals.holdout, ...app.cases.filter((c) => c.split === 'holdout').map((c) => c.id)])
    const inSplit = app.cases.filter((c) => (split === 'holdout') === holdout.has(c.id))
    const unknown = (only ?? []).filter((id) => !app.cases.some((c) => c.id === id))
    if (unknown.length) throw new KernelError(`没有用例 ${unknown.join('、')}`)
    const trials = options.trials ?? 1
    if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) throw new KernelError(`每个用例运行次数应为 1 到 ${MAX_TRIALS}`)
    const cases = only ? inSplit.filter((c) => only.includes(c.id)) : inSplit
    const scores: CaseScore[] = []
    const seen = this.#agentView(app, release, options.ablate)
    const exec = seen.fingerprint.slice(0, 16)
    for (const testCase of cases) {
      const done = (score: CaseScore) => {
        scores.push(score)
        onCase?.(score, scores.length, cases.length)
      }
      const oracle = await this.#oracleCheck(testCase, judges)
      if (oracle && !oracle.ok) {
        const why = [...oracle.failed.map((c) => `${c.path}（期望 ${c.expected}，参考答案 ${c.actual}）`), ...oracle.violations].slice(0, 3).join('；')
        done({ case: testCase.id, split, ok: false, score: 0, checks: [], violations: [], run: '没有执行', invalid: `参考答案没有得满分：${why}` })
        continue
      }
      const runs: TrialRun[] = []
      for (let t = 0; t < trials; t++) {
        const key = `${app.manifest.name}.${exec}.${testCase.id}.${(testCase.hash ?? '').slice(0, 12)}.${app.judgeHash.slice(0, 12)}.${this.#executor.name}${t ? `.t${t}` : ''}`
        const cached = await this.#store.get<CaseScore>('scores', key)
        if (cached) {
          runs.push({ checks: cached.checks, violations: cached.violations, status: cached.status ?? '', output: cached.output, ms: cached.ms ?? 0, run: cached.run })
          continue
        }
        const result = await this.#execute(app, seen, testCase.input, testCase.scope, testCase.id)
        const run = `${result.executor}${result.note ? `：${result.note}` : ''}`
        if (result.error) {
          runs.push({ checks: [], violations: [], status: result.status, output: null, ms: result.ms, run, error: result.error })
          continue
        }
        const judge = testCase.validator ? judges.get(testCase.validator) : null
        const checks = [...applyRules(testCase.rules, result), ...(judge ? await judge.score(testCase, result) : [])]
        const violations = judge ? await judge.check(result) : []
        await this.#store.put('scores', key, aggregateTrials(testCase.id, split, [{ checks, violations, status: result.status, output: result.output, ms: result.ms, run }]))
        runs.push({ checks, violations, status: result.status, output: result.output, ms: result.ms, run })
      }
      done(aggregateTrials(testCase.id, split, runs))
    }
    return { ...summarize(release.id, split, scores, trials), evalset: app.evalset ?? undefined, ...(only ? { selection: cases.map((c) => c.id) } : {}) }
  }

  /** Run a task on a view the caller already prepared with {@link #agentView}. */
  async #execute(app: LoadedApp, seen: Release, input: unknown, scope: Record<string, string>, caseId?: string): Promise<RunResult> {
    const dir = await this.#store.materialize(seen)
    const instructions = instructionsFor(app.manifest, Object.keys(seen.files), scope)
    return this.#executor.run({ app: app.manifest, release: seen, dir, input, scope, instructions, caseId })
  }

  async #candidate(proposal: Proposal, base: Release): Promise<Release> {
    const contents = applyChanges(await this.contents(base), proposal.changes)
    const files = { ...base.files }
    for (const path of touchedPaths(proposal.changes)) {
      const content = contents.get(path)
      if (content === undefined) delete files[path]
      else files[path] = typeof content === 'string' ? await this.#store.putBlob(encoder.encode(content)) : content.blob
    }
    return {
      id: proposal.id,
      app: proposal.app,
      parent: base.id,
      createdAt: proposal.createdAt,
      files,
      fingerprint: fingerprint(files),
      origin: 'proposal',
      proposal: proposal.id,
      note: proposal.title,
    }
  }

  async #newRelease(name: string, parent: string | null, files: Record<string, string>, origin: Release['origin'], proposal: string | null, note: string): Promise<Release> {
    const seq = (await this.releases(name)).length + 1
    const release: Release = { id: `r${seq}`, app: name, parent, createdAt: this.#clock.now(), files, fingerprint: fingerprint(files), origin, proposal, note }
    await this.#store.put('releases', `${name}.${release.id}`, release)
    return release
  }

  async #movePointer(name: string, to: string, reason: string): Promise<Channels> {
    const channels = await this.channels(name)
    channels.history.push({ at: this.#clock.now(), from: channels.stable, to, reason })
    channels.stable = to
    await this.#store.put('channels', name, channels)
    return channels
  }

  async #nextId(counter: string, prefix: string): Promise<string> {
    let n: number
    if (this.#store.next) n = await this.#store.next(counter)
    else {
      n = ((await this.#store.get<{ n: number }>('counters', counter))?.n ?? 0) + 1
      await this.#store.put('counters', counter, { n })
    }
    return `${prefix}${String(n).padStart(prefix === 'run-' ? 4 : 1, '0')}`
  }

  /** Changes to one app's channels, releases, evaluation sets and proposal states happen one at a time, in every process. */
  #locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.#store.exclusive ? this.#store.exclusive(`app:${name}`, fn) : fn()
  }
}

/** File references in a task input: every `{path, sha256?}` object and every bare path string. */
function materialsOf(input: unknown): { path: string; sha256?: string }[] {
  const out: { path: string; sha256?: string }[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push({ path: v })
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.path === 'string') {
        out.push({ path: o.path, ...(typeof o.sha256 === 'string' ? { sha256: o.sha256 } : {}) })
        for (const [k, x] of Object.entries(o)) if (k !== 'path') walk(x)
      } else Object.values(o).forEach(walk)
    }
  }
  walk(input)
  return out
}

/** Content hash helper re-exported for drivers that pre-hash sources. */
export { hashContent }
