/**
 * Tools for the app coding assistant, served over MCP and mounted into its harness session.
 * Usage: node builder/mcp/server.ts <workspace> [app-name]
 *
 * `run_tests` and `confirm_result` reach the platform through the loopback bridge named by
 * `RSI_BUILDER_BRIDGE` with the session's `RSI_BUILDER_TOKEN`; `request_files` records a request
 * beside the workspace, which the platform shows to the person as an upload card.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { serveMcpStdio } from '../../rsi-kernel/src/mcp-server.ts'
import { checkWorkspace, workspaceFiles } from '../../console/core/workspace.ts'

const [root, name] = process.argv.slice(2)
if (!root) throw new Error('usage: server.ts <workspace> [app-name]')

interface Check {
  path: string
  expected: string
  actual: string
  ok: boolean
}
interface Suite {
  passed: number
  total: number
  score: number
  cases: { case: string; ok: boolean; score: number; checks: Check[]; violations: string[]; status?: string; run: string }[]
}

/** What the assistant needs from a test: per case pass or fail and why, not every passing check. */
function summary(result: { error?: string; executor?: string; dev?: Suite; holdout?: Suite }) {
  if (result.error) return { ok: false, error: result.error }
  const split = (s: Suite | undefined) =>
    s && {
      passed: `${s.passed}/${s.total}`,
      score: Number(s.score.toFixed(3)),
      cases: s.cases.map((c) => ({
        id: c.case,
        ok: c.ok,
        status: c.status,
        failed: c.checks.filter((x) => !x.ok).slice(0, 12).map((x) => ({ check: x.path, expected: x.expected, actual: x.actual })),
        violations: c.violations,
      })),
    }
  return { ok: Boolean(result.dev && result.holdout && [...result.dev.cases, ...result.holdout.cases].every((c) => c.ok)), executor: result.executor, dev: split(result.dev), holdout: split(result.holdout) }
}

const REQUESTS = join(dirname(root), 'requests.json')

/** POST to the platform bridge; runs take minutes, longer than fetch waits for response headers. */
function bridge(path: string, body: unknown): Promise<Record<string, unknown>> {
  const base = process.env.RSI_BUILDER_BRIDGE
  const token = process.env.RSI_BUILDER_TOKEN
  if (!base || !token) return Promise.resolve({ error: '平台没有提供测试通道；请让用户在界面上操作' })
  return new Promise((resolve) => {
    const req = request(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
      let raw = ''
      res.on('data', (c: Buffer) => (raw += c.toString()))
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>)
        } catch {
          resolve({ error: `平台返回的不是 JSON：${raw.slice(0, 200)}` })
        }
      })
    })
    req.on('error', (error) => resolve({ error: error.message }))
    req.end(JSON.stringify(body))
  })
}

serveMcpStdio({ name: 'rsi-builder', version: '1.1.0' }, [
  {
    name: 'check_app',
    description:
      '用平台内核加载当前工作区里的应用并检查：清单、契约、技能、界面入口和改进入口、评测集（规范 rsi-eval/1：用例目录、材料、规则、验证程序）、疑似密钥。返回 problems（必须改）和 warnings（可以暂缓）。每改完一批文件都调用一次。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    handler: () => checkWorkspace(root, name || undefined),
  },
  {
    name: 'list_app_files',
    description: '列出工作区里应用的文件和级别：knowledge（知识级，可进化）、code（代码级，可进化）、contract（契约级，只由人改）、evals（评测，不进版本）。',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    handler: async () => ({ files: await workspaceFiles(root) }),
  },
  {
    name: 'run_tests',
    description:
      '用平台的执行器真实运行工作区里的应用并按评测用例打分（和界面上的“测试”按钮一样，结果也会显示给用户）。check_app 通过后调用。可以只跑部分用例（cases）以节省时间；改完再跑一次全部。返回每个用例是否通过、没通过的检查项和违反的硬规则。',
    inputSchema: {
      type: 'object',
      properties: { cases: { type: 'array', items: { type: 'string' }, description: '要跑的用例编号；不填则全部' } },
    },
    handler: async (args) => summary((await bridge('/test', { cases: args.cases })) as Parameters<typeof summary>[0]),
  },
  {
    name: 'confirm_result',
    description:
      '用平台的执行器在一个用例的真实输入上运行应用，把结果拿给用户确认“是不是你期望的”。用户确认（或改正不对的值）后，平台把结果写成这个用例的期望值；用户也可能只说明哪里不对，那时期望值还没定。期望值只能这样得到：不要让用户上传或手填期望值，也不要自己写。用例先写好 evals/cases/<id>/case.json（真实 input，expected 写 {}）。请求发出后照常结束这一轮，告诉用户在等他确认；用户回答后会在对话里告诉你。',
    inputSchema: {
      type: 'object',
      required: ['case'],
      properties: {
        case: { type: 'string', description: '用例编号，如 c1' },
        question: { type: 'string', description: '可选：问用户的话，如“这张样例的识别结果对吗？”' },
      },
    },
    handler: async (args) => {
      const result = await bridge('/confirm', { case: args.case, question: args.question })
      return result.error ? { ok: false, ...result } : result
    },
  },
  {
    name: 'request_files',
    description:
      '请用户上传你需要、但工作区里没有的真实文件（样例材料、参考资料）。期望值不要用它要，用 confirm_result。平台会在对话里给用户一张上传卡片，文件放进 target 目录，用户上传完会在对话里告诉你。不要编造这些文件；提出请求后照常结束这一轮，说明还缺什么。',
    inputSchema: {
      type: 'object',
      required: ['title', 'why', 'target'],
      properties: {
        title: { type: 'string', description: '一句话：要什么，如“3 份真实的进口发票 PDF”' },
        why: { type: 'string', description: '用来做什么，如“作为用例 c1 的输入”' },
        target: { type: 'string', description: '放到工作区哪个目录，如 evals/cases/c1/input/' },
        accept: { type: 'string', description: '可选：文件类型，如 .pdf,.xlsx' },
        multiple: { type: 'boolean', description: '是否可以多个文件，默认是' },
      },
    },
    handler: (args) => {
      const target = String(args.target ?? '').replace(/^\.?\//, '')
      if (!/^(code|evals)\/[^.][^]*$/.test(target) || target.includes('..')) return { ok: false, error: 'target 必须是工作区里 code/ 或 evals/ 下的目录' }
      const list = existsSync(REQUESTS) ? (JSON.parse(readFileSync(REQUESTS, 'utf8')) as { id: string; status: string; title: string }[]) : []
      const open = list.find((r) => r.status === 'open' && r.title === args.title)
      if (open) return { ok: true, id: open.id, note: '同样的请求已经在等用户上传' }
      const id = `R${list.length + 1}`
      list.push({
        id,
        at: new Date().toISOString(),
        title: String(args.title),
        why: String(args.why ?? ''),
        target: target.endsWith('/') ? target : `${target}/`,
        accept: typeof args.accept === 'string' && args.accept ? args.accept : null,
        multiple: args.multiple !== false,
        status: 'open',
        files: [],
      } as never)
      writeFileSync(REQUESTS, `${JSON.stringify(list, null, 2)}\n`)
      return { ok: true, id, note: '已请用户上传；这一轮结束时告诉用户你在等什么' }
    },
  },
])
