/**
 * App manifest (`app.json`): what the kernel needs to know about one vertical app.
 * The manifest is the only place where evolution vocabulary meets an app.
 */

/** How far a file is from the app's contract; decides who may change it and which gates apply. */
export type Tier = 'knowledge' | 'code' | 'contract'

/** One scope dimension an app offers for scoped knowledge, e.g. a customer identified by the task input. */
export interface ScopeDimension {
  key: string
  title: string
  /** Dotted path into the task input whose value identifies the scope, e.g. `input.customer.code`. Known before the run starts. */
  from: string
}

export interface AppManifest {
  kind: 'App'
  name: string
  title: string
  /** Contract version; bumps only by human review. */
  version: string
  description: string
  task: {
    /** JSON Schema path for task input. */
    input: string
    /** JSON Schema path for task output. */
    output: string
    /** Terminal statuses a run may end in, e.g. `result`, `pause`. */
    statuses: string[]
  }
  agent: {
    /** Root instructions file, normally `AGENTS.md`. */
    instructions: string
    /** Skill directories, each containing `SKILL.md`. */
    skills: string[]
    /** Entry skill name the executor invokes. */
    entry: string
    /** Optional MCP server config visible to the agent. */
    mcp?: string
  }
  scopes: ScopeDimension[]
  evolve: {
    knowledge: string[]
    code: string[]
  }
  /** Paths here are relative to the app's evaluation tree, which releases never contain. */
  evals: {
    /** Directory holding one `<id>/case.json` per case. */
    cases: string
    /** Case ids reserved for the one-look holdout split. */
    holdout: string[]
  }
  /** Kernel-only MCP stdio server exposing `score` and `check`, started in the evaluation tree. */
  judge: {
    command: string
    args: string[]
  }
  /**
   * Directory of the app's own web application (a full-stack Next.js project, e.g. `web`).
   * It serves people, never the agent's task: the agent does not see it.
   */
  web?: string
}

/** Paths that are contract no matter what the manifest says; `.env` files hold the app's configuration and secrets. */
export const ALWAYS_CONTRACT = ['app.json', '.mcp.json', 'contract/**', '**/.env', '**/.env.*']

export class ManifestError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`app.json 无效：${problems.join('；')}`)
    this.name = 'ManifestError'
    this.problems = problems
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Validate a parsed `app.json`.
 * @param raw - parsed JSON value.
 * @returns the typed manifest.
 * @throws ManifestError listing every problem found.
 */
export function parseManifest(raw: unknown): AppManifest {
  const problems: string[] = []
  if (!isObject(raw)) throw new ManifestError(['不是 JSON 对象'])
  if (raw.kind !== 'App') problems.push('kind 必须是 App')
  for (const key of ['name', 'title', 'version', 'description']) {
    if (typeof raw[key] !== 'string' || raw[key] === '') problems.push(`缺少 ${key}`)
  }
  if (typeof raw.name === 'string' && !/^[a-z][a-z0-9-]{1,48}$/.test(raw.name)) problems.push('name 只能用小写字母、数字和连字符')

  const task = raw.task
  if (!isObject(task) || typeof task.input !== 'string' || typeof task.output !== 'string' || !stringList(task.statuses) || task.statuses.length === 0) {
    problems.push('task 需要 input、output 和非空 statuses')
  }
  const agent = raw.agent
  if (!isObject(agent) || typeof agent.instructions !== 'string' || !stringList(agent.skills) || typeof agent.entry !== 'string') {
    problems.push('agent 需要 instructions、skills 和 entry')
  } else if (agent.mcp !== undefined && typeof agent.mcp !== 'string') {
    problems.push('agent.mcp 必须是路径')
  }
  const scopes = raw.scopes ?? []
  if (!Array.isArray(scopes) || !scopes.every((s) => isObject(s) && typeof s.key === 'string' && typeof s.title === 'string' && typeof s.from === 'string')) {
    problems.push('scopes 每项需要 key、title、from')
  }
  const evolve = raw.evolve
  if (!isObject(evolve) || !stringList(evolve.knowledge) || !stringList(evolve.code)) problems.push('evolve 需要 knowledge 和 code 两个路径列表')
  const evals = raw.evals
  if (!isObject(evals) || typeof evals.cases !== 'string' || !stringList(evals.holdout)) {
    problems.push('evals 需要 cases 和 holdout')
  }
  const judge = raw.judge
  if (!isObject(judge) || typeof judge.command !== 'string' || !stringList(judge.args)) problems.push('judge 需要 command 和 args')
  const web = raw.web
  if (web !== undefined && (typeof web !== 'string' || !/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(web))) problems.push('web 是应用里的一个目录，如 web')

  if (problems.length > 0) throw new ManifestError(problems)
  const manifest = { ...raw, scopes } as unknown as AppManifest
  for (const glob of [...manifest.evolve.knowledge, ...manifest.evolve.code]) {
    for (const fixed of contractPaths(manifest)) {
      if (globToRegExp(glob).test(fixed)) problems.push(`可进化范围 ${glob} 覆盖了契约文件 ${fixed}`)
    }
  }
  if (problems.length > 0) throw new ManifestError(problems)
  return manifest
}

/** Concrete code files the manifest itself names as contract (schemas, MCP config). */
export function contractPaths(manifest: AppManifest): string[] {
  const paths = ['app.json', manifest.task.input, manifest.task.output]
  if (manifest.agent.mcp) paths.push(manifest.agent.mcp)
  return paths
}

/**
 * Translate a path glob (`*` within a segment, `**` across segments) to a RegExp.
 * @param glob - forward-slash glob.
 * @returns an anchored RegExp.
 */
export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (ch === '*') {
      source += '[^/]*'
    } else if (ch === '?') {
      source += '[^/]'
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * Classify one app-relative path. Contract wins over every evolve glob.
 * @param manifest - validated manifest.
 * @param path - app-relative forward-slash path.
 * @returns the tier.
 */
export function tierOf(manifest: AppManifest, path: string): Tier {
  if (ALWAYS_CONTRACT.some((glob) => globToRegExp(glob).test(path))) return 'contract'
  if (contractPaths(manifest).includes(path)) return 'contract'
  if (manifest.evolve.knowledge.some((glob) => globToRegExp(glob).test(path))) return 'knowledge'
  if (manifest.evolve.code.some((glob) => globToRegExp(glob).test(path))) return 'code'
  return 'contract'
}

/**
 * Whether a path belongs to the app's web application (`web/**`). It serves people and never
 * runs in the agent's task, so it does not change what the agent outputs.
 */
export function isWebPath(manifest: AppManifest, path: string): boolean {
  return Boolean(manifest.web) && path.startsWith(`${manifest.web}/`)
}

/**
 * What an ablation run takes away from the agent, to measure what it contributes:
 * `knowledge` drops the evolvable knowledge files but keeps the root instructions and each
 * skill's `SKILL.md`; `skills` drops the skill directories entirely.
 */
export type Ablation = 'knowledge' | 'skills'

export const ABLATIONS: Record<Ablation, string> = {
  knowledge: '去掉知识：保留根说明和各技能的 SKILL.md，去掉参考资料、范围知识等可进化的知识文件',
  skills: '去掉技能：整个技能目录都不给智能体',
}

/**
 * Paths an ablation removes from a release.
 * @param paths - app-relative paths of the release.
 * @returns the subset to drop.
 */
export function ablatedPaths(manifest: AppManifest, paths: string[], mode: Ablation): string[] {
  const inSkill = (p: string) => manifest.agent.skills.some((s) => p.startsWith(`${s.replace(/\/$/, '')}/`))
  if (mode === 'skills') return paths.filter(inSkill)
  const kept = new Set([manifest.agent.instructions, ...manifest.agent.skills.map((s) => `${s.replace(/\/$/, '')}/SKILL.md`)])
  return paths.filter((p) => !kept.has(p) && tierOf(manifest, p) === 'knowledge')
}

const TIER_RANK: Record<Tier, number> = { knowledge: 0, code: 1, contract: 2 }

/** The highest tier among several paths. */
export function maxTier(tiers: Tier[]): Tier {
  return tiers.reduce<Tier>((acc, t) => (TIER_RANK[t] > TIER_RANK[acc] ? t : acc), 'knowledge')
}

/**
 * Scope values of a task, read from its input along each dimension's `from` path.
 * Values that could escape the `scopes/` directory are ignored.
 */
export function scopeOf(manifest: AppManifest, input: unknown): Record<string, string> {
  const scope: Record<string, string> = {}
  for (const dim of manifest.scopes) {
    let value: unknown = { input }
    for (const key of dim.from.split('.')) value = isObject(value) ? value[key] : undefined
    if (typeof value === 'string' && value !== '' && !value.includes('/') && !value.startsWith('.')) scope[dim.key] = value
  }
  return scope
}

/**
 * Instruction files that apply to a task, root first, then each matching scope's `AGENTS.md`.
 * @param manifest - validated manifest.
 * @param files - paths present in the release.
 * @param scope - scope values for this task, keyed by dimension.
 * @returns ordered app-relative paths; later files refine earlier ones.
 */
export function instructionsFor(manifest: AppManifest, files: string[], scope: Record<string, string>): string[] {
  const out = [manifest.agent.instructions]
  for (const dim of manifest.scopes) {
    const value = scope[dim.key]
    if (!value) continue
    const path = `scopes/${dim.key}/${value}/AGENTS.md`
    if (files.includes(path)) out.push(path)
  }
  return out
}
