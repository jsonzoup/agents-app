/**
 * An app workspace: an app folder (`code/`, `evals/`) being written before it is published.
 * `checkWorkspace` loads it with a scratch kernel, so the check is the same one installation
 * applies, plus the things installation leaves to runtime (missing skills, judge, UI entry).
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { FsAppSource, FsStore, RsiKernel, mcpJudge, parseManifest, systemClock, tierOf } from '../../rsi-kernel/src/index.ts'
import type { AppManifest, EvalCase, Executor, Tier } from '../../rsi-kernel/src/index.ts'

export interface WorkspaceFile {
  path: string
  /** Release tier for `code/` files; `evals` for the evaluation half. */
  tier: Tier | 'evals' | null
  size: number
}

export interface CheckReport {
  ok: boolean
  /** Must be fixed before the app can be published. */
  problems: string[]
  /** Worth fixing; do not block publishing. */
  warnings: string[]
  /** Cases whose expected value waits for the person to confirm a run result; skipped by tests, block publishing. */
  pending: string[]
  app: { name: string; title: string } | null
  cases: { id: string; title: string; holdout: boolean }[]
}

const SECRET = /\b(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})\b/

/** Same files a release snapshots (see `FsTree`): no dependencies or build output, only the dotfiles an app keeps. */
const skipped = (name: string) => ['node_modules', '__pycache__'].includes(name) || (name.startsWith('.') && !(name === '.mcp.json' || name === '.gitignore' || name === '.env' || name.startsWith('.env.')))

async function walk(root: string, dir = root): Promise<string[]> {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skipped(e.name)) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(root, abs)))
    else if (e.isFile()) out.push(relative(root, abs).split(sep).join('/'))
  }
  return out.sort()
}

/** Files of a workspace with their tiers (`code/...` by the manifest, `evals/...` as evals). */
export async function workspaceFiles(root: string): Promise<WorkspaceFile[]> {
  let manifest: AppManifest | null = null
  try {
    manifest = parseManifest(JSON.parse(await readFile(join(root, 'code/app.json'), 'utf8')))
  } catch {
    manifest = null
  }
  const out: WorkspaceFile[] = []
  for (const half of ['code', 'evals'] as const) {
    for (const p of await walk(join(root, half))) {
      const size = (await stat(join(root, half, p))).size
      out.push({ path: `${half}/${p}`, tier: half === 'evals' ? 'evals' : manifest ? tierOf(manifest, p) : null, size })
    }
  }
  return out
}

/**
 * Evaluation spec `rsi-eval/1` beyond what loading checks: each case's materials exist inside its
 * own folder, its input carries the contract's required fields, and nothing waits in the inbox.
 */
async function checkEvalSpec(root: string, manifest: AppManifest, cases: EvalCase[], problems: string[], warnings: string[]) {
  if (!existsSync(join(root, 'evals/eval.json'))) warnings.push('缺少 evals/eval.json（评测集清单，spec 写 rsi-eval/1）')
  let required: string[] = []
  try {
    required = (JSON.parse(await readFile(join(root, 'code', manifest.task.input), 'utf8')) as { required?: string[] }).required ?? []
  } catch {
    required = []
  }
  const prefix = `${manifest.name}/evals/`
  const casesDir = manifest.evals.cases.replace(/\/$/, '')
  for (const c of cases) {
    const missing = required.filter((k) => !(c.input && typeof c.input === 'object' && k in (c.input as object)))
    if (missing.length) problems.push(`用例 ${c.id} 的 input 缺少输入契约要求的字段：${missing.join('、')}`)
    const named: string[] = []
    const walkInput = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith(prefix)) named.push(v.slice(prefix.length))
      else if (Array.isArray(v)) v.forEach(walkInput)
      else if (v && typeof v === 'object') Object.values(v).forEach(walkInput)
    }
    walkInput(c.input)
    for (const rel of named) {
      if (!existsSync(join(root, 'evals', rel))) problems.push(`用例 ${c.id} 引用的材料 evals/${rel} 不存在：请用户上传（request_files），不要编造`)
      else if (!rel.startsWith(`${casesDir}/${c.id}/input/`)) warnings.push(`用例 ${c.id} 的材料 evals/${rel} 应放在 evals/${casesDir}/${c.id}/input/`)
    }
  }
  const inbox = await walk(join(root, 'evals/inbox'))
  if (inbox.length) warnings.push(`evals/inbox/ 里还有 ${inbox.length} 个用户上传的文件没有归位：${inbox.slice(0, 5).join('、')}`)
}

/**
 * The business UI must feed the improvement loop: people correct values (`EditableValue` or
 * `api.correct`), can suggest beyond one value, and see where their feedback went.
 */
/** The app's web application: a Next.js project people use, with the improvement entries planted in it. */
async function checkWeb(root: string, web: string, problems: string[], warnings: string[]) {
  const dir = join(root, 'code', web)
  if (!existsSync(dir)) return problems.push(`app.json 的 web 指向的 code/${web}/ 不存在`)
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string> } = {}
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return problems.push(`code/${web}/package.json 缺少或读不了`)
  }
  if (!pkg.dependencies?.next) problems.push(`code/${web}/package.json 的 dependencies 里没有 next：web 是一个 Next.js 项目`)
  if (!(await walk(dir)).some((f) => /^next\.config\.(ts|mjs|js)$/.test(f))) problems.push(`code/${web}/ 缺少 next.config.ts（basePath 要取 process.env.RSI_BASE_PATH）`)
  else {
    const config = await readFile(join(dir, ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) => existsSync(join(dir, f)))!), 'utf8')
    if (!config.includes('RSI_BASE_PATH')) problems.push(`code/${web}/next.config 的 basePath 要取 process.env.RSI_BASE_PATH，平台把应用挂在 /apps/<应用>/... 下`)
  }
  const ignore = await readFile(join(dir, '.gitignore'), 'utf8').catch(() => '')
  if (existsSync(join(dir, '.env')) && !/^\.env/m.test(ignore)) warnings.push(`code/${web}/.gitignore 没有忽略 .env：应用代码进 git 时密钥别跟着上去`)
  await checkFeedbackHooks(dir, problems, warnings)
}

async function checkFeedbackHooks(dir: string, problems: string[], warnings: string[]) {
  const platformCopies = /^(components\/(kit|ui)\/|sdk\/|lib\/(rsi|caller|utils)\.ts$)/
  const files = (await walk(dir)).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !platformCopies.test(f))
  const text = (await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8').catch(() => '')))).join('\n')
  if (!/\bEditableValue\b|\.correct\(/.test(text)) problems.push('业务界面没有植入改进入口：结果里的每个值要用 EditableValue（或 api.correct）让人修正，修正会成为改进信号')
  if (!/\bSuggestButton\b|\.suggest\(/.test(text)) warnings.push('业务界面没有改进建议入口：用 SuggestButton 让人对一块区域或整单提建议')
  if (!/\bContributionBanner\b|\.contributions\(/.test(text)) warnings.push('业务界面没有告诉用户修正的去向：在列表页放 ContributionBanner')
}

const idle: Executor = { name: 'none', run: async () => ({ status: 'failed', output: null, trace: [], ms: 0, executor: 'none' }) }

/**
 * Load and inspect a workspace.
 * @param name - required app name (the folder it will be published as), when known.
 */
export async function checkWorkspace(root: string, name?: string): Promise<CheckReport> {
  const problems: string[] = []
  const warnings: string[] = []
  const pending: string[] = []
  const report = (app: CheckReport['app'] = null, cases: CheckReport['cases'] = []): CheckReport => ({ ok: problems.length === 0, problems, warnings, pending, app, cases })
  if (!existsSync(join(root, 'code/app.json'))) {
    problems.push('缺少 code/app.json')
    return report()
  }
  const store = await mkdtemp(join(tmpdir(), 'rsi-check-'))
  try {
    const kernel = new RsiKernel({ store: new FsStore(store), clock: systemClock, executor: idle, judge: (app, v) => mcpJudge(app.source.evals.root, v.command, v.args) })
    let loaded
    try {
      loaded = (await kernel.install(new FsAppSource(root))).app
    } catch (error) {
      problems.push(`应用加载失败：${(error as Error).message}`)
      return report()
    }
    const { manifest, cases } = loaded
    if (name && manifest.name !== name) problems.push(`app.json 的 name 是 ${manifest.name}，应为 ${name}`)
    const code = (p: string) => join(root, 'code', p)
    if (!existsSync(code(manifest.agent.instructions))) problems.push(`缺少 code/${manifest.agent.instructions}`)
    for (const p of [manifest.task.input, manifest.task.output]) {
      try {
        const schema = JSON.parse(await readFile(code(p), 'utf8'))
        if (schema?.type !== 'object') warnings.push(`code/${p} 的顶层最好是 object`)
      } catch (error) {
        problems.push(`code/${p} 不是合法的 JSON Schema：${(error as Error).message}`)
      }
    }
    for (const skill of manifest.agent.skills) {
      const file = code(join(skill, 'SKILL.md'))
      if (!existsSync(file)) {
        problems.push(`缺少 code/${skill}/SKILL.md`)
        continue
      }
      const text = await readFile(file, 'utf8')
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
      const skillName = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim()
      if (!skillName) problems.push(`code/${skill}/SKILL.md 缺少 front matter 的 name`)
      else if (skillName !== skill.split('/').pop()) problems.push(`code/${skill}/SKILL.md 的 name 应与目录名 ${skill.split('/').pop()} 相同`)
      if (!/^description:\s*\S/m.test(front)) problems.push(`code/${skill}/SKILL.md 缺少 front matter 的 description`)
    }
    if (!manifest.agent.skills.some((s) => s.split('/').pop() === manifest.agent.entry)) problems.push(`入口技能 ${manifest.agent.entry} 不在 agent.skills 里`)
    if (!manifest.web) warnings.push('没有自己的 web 应用（app.json 的 web），将使用平台的通用任务界面')
    const judgeEntry = manifest.judge.args.find((a) => /\.(ts|js|mjs|py)$/.test(a))
    if (judgeEntry && !existsSync(join(root, 'evals', judgeEntry))) problems.push(`裁判文件 evals/${judgeEntry} 不存在`)
    const dev = cases.filter((c) => !manifest.evals.holdout.includes(c.id))
    if (dev.length === 0) problems.push('还没有开发集评测用例：请在 evals/cases/<id>/case.json 写入真实输入，期望值写 {} 等用户确认（不能编造）')
    for (const c of cases) {
      const empty = !c.expected || (typeof c.expected === 'object' && Object.keys(c.expected).length === 0)
      if (empty && !c.rules?.length) pending.push(c.id)
    }
    for (const h of manifest.evals.holdout) if (!cases.some((c) => c.id === h)) problems.push(`留出集用例 ${h} 不存在`)
    await checkEvalSpec(root, manifest, cases, problems, warnings)
    if (!judgeEntry || existsSync(join(root, 'evals', judgeEntry))) {
      const audit = await kernel.audit(manifest.name)
      for (const a of audit.cases) {
        for (const p of a.problems) problems.push(`用例 ${a.id}：${p}`)
        const rest = a.warnings.filter((w) => w !== '期望值待确认')
        if (rest.length) warnings.push(`用例 ${a.id}：${rest.join('；')}`)
      }
      warnings.push(...audit.warnings)
    }
    if (manifest.web) await checkWeb(root, manifest.web, problems, warnings)
    for (const f of await walk(join(root, 'code'))) {
      if (/(^|\/)\.env(\.[^/]*)?$/.test(f)) continue
      const text = await readFile(code(f), 'utf8').catch(() => '')
      if (SECRET.test(text)) problems.push(`code/${f} 里像是写了密钥；密钥只能写在 web/.env 里，或写成 \${环境变量名}`)
    }
    return report(
      { name: manifest.name, title: manifest.title },
      cases.map((c) => ({ id: c.id, title: c.title, holdout: manifest.evals.holdout.includes(c.id) })),
    )
  } finally {
    await rm(store, { recursive: true, force: true })
  }
}
