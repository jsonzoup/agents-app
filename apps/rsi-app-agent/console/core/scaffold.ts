/**
 * The starting point of a new app workspace: a minimal, loadable app folder built from a
 * name, a title and a goal. The coding assistant (or a person) fills it in. Pure: returns
 * path → text. Evaluation cases are never generated; expectations come from people. The
 * evaluation half follows spec `rsi-eval/1` (documents/评测规范.md).
 */

export interface AppSeed {
  name: string
  title: string
  goal: string
}

export const APP_NAME = /^[a-z][a-z0-9-]{1,48}$/

/** Names taken by console routes (`/manage/new`, `/manage/build/…`). */
const RESERVED = new Set(['new', 'build'])

/** @returns problems with a seed; empty when it is usable. */
export function seedProblems(seed: Partial<AppSeed>): string[] {
  const problems: string[] = []
  if (!APP_NAME.test(seed.name ?? '')) problems.push('应用标识只能用小写字母、数字和连字符，以字母开头，2–49 位')
  else if (RESERVED.has(seed.name!)) problems.push(`应用标识 ${seed.name} 是保留字`)
  if (!seed.title?.trim()) problems.push('请填写应用名称')
  if (!seed.goal?.trim()) problems.push('请描述应用的目标和需求')
  return problems
}

export function judgeSource(): string {
  return `/**
 * Judge: every entry in \`expected\` is a path into the output (\`total\`, \`items[0].name\`) and must equal it exactly.
 * Change it through human review when the app needs other comparisons.
 */

import { serveMcpStdio } from './mcp.ts'

const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? null))

function at(root: unknown, path: string): unknown {
  let node = root
  for (const key of path.replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean)) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

serveMcpStdio({ name: 'judge', version: '1.0.0' }, [
  {
    name: 'score',
    description: '逐字段比对期望值',
    inputSchema: { type: 'object', required: ['case', 'run'] },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const expected = (args.case as { expected: Record<string, unknown> }).expected
      const output = (args.run as { output: unknown }).output ?? {}
      const checks = Object.entries(expected).map(([path, want]) => ({ path, expected: text(want), actual: text(at(output, path)), ok: text(at(output, path)) === text(want) }))
      return { checks }
    },
  },
  {
    name: 'check',
    description: '硬规则：必须有输出',
    inputSchema: { type: 'object', required: ['run'] },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const run = args.run as { status: string; output: unknown }
      return { violations: run.output === null ? ['没有输出'] : [] }
    },
  },
])
`
}

const schema = (title: string, field: string, description: string) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title,
  type: 'object',
  required: [field],
  properties: { [field]: { type: 'string', description } },
  additionalProperties: false,
})

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

/**
 * Render the skeleton of a new app.
 * @param mcpHelper - source of the zero-dependency MCP server the judge runs on.
 * @returns app-folder-relative path → file text (`code/...`, `evals/...`).
 */
export function skeletonApp(seed: AppSeed, mcpHelper: string): Record<string, string> {
  const goal = seed.goal.trim()
  const manifest = {
    kind: 'App',
    name: seed.name,
    title: seed.title.trim(),
    version: '1.0.0',
    description: goal.split('\n')[0].slice(0, 120),
    task: { input: 'contract/input.schema.json', output: 'contract/output.schema.json', statuses: ['result'] },
    agent: { instructions: 'AGENTS.md', skills: ['skills/main'], entry: 'main', mcp: '.mcp.json' },
    scopes: [],
    evolve: { knowledge: ['AGENTS.md', 'scopes/*/*/AGENTS.md', 'skills/*/SKILL.md', 'skills/*/references/**'], code: ['skills/*/scripts/**'] },
    evals: { cases: 'cases', holdout: [] },
    judge: { command: 'node', args: ['judge/server.ts'] },
    web: 'web',
  }
  return {
    'code/app.json': json(manifest),
    'code/AGENTS.md': `# ${seed.title.trim()}\n\n## 目标\n\n${goal}\n`,
    'code/.mcp.json': json({ mcpServers: {} }),
    'code/skills/main/SKILL.md': `---\nname: main\ndescription: 完成「${seed.title.trim()}」的任务。\n---\n\n# 做法\n\n（待补充）\n`,
    'code/contract/input.schema.json': json(schema(`${seed.title.trim()} 输入`, 'text', '任务内容')),
    'code/contract/output.schema.json': json(schema(`${seed.title.trim()} 输出`, 'result', '任务结果')),
    'evals/eval.json': json({ spec: 'rsi-eval/1', validators: {}, tags: {} }),
    'evals/judge/server.ts': judgeSource(),
    'evals/judge/mcp.ts': mcpHelper,
  }
}
