# 验证程序（裁判）

验证程序是一个 MCP stdio 服务，跑在 `evals/` 目录里，只给平台内核用，执行任务的智能体看不到它。平台在新工作区里已经放好 `evals/judge/mcp.ts`（零依赖的 MCP 服务实现），裁判只需要写 `evals/judge/server.ts`。

两个工具：

- `score({case, run})` → `{checks: [{path, ok, expected, actual}]}`：逐项比对，平台据此算分。
- `check({run})` → `{violations: string[]}`：硬规则，任何一条违例都会挡住发布。

默认模板（`expected` 的每个键是输出里的路径，如 `items[0].name`，值要完全相等）：

```ts
import { serveMcpStdio } from './mcp.ts'

const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? null))

function at(root: unknown, path: string): unknown {
  let node = root
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
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
      return { checks: Object.entries(expected).map(([path, want]) => ({ path, expected: text(want), actual: text(at(output, path)), ok: text(at(output, path)) === text(want) })) }
    },
  },
  {
    name: 'check',
    description: '硬规则：必须有输出',
    inputSchema: { type: 'object', required: ['run'] },
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const run = args.run as { output: unknown }
      return { violations: run.output === null ? ['没有输出'] : [] }
    },
  },
])
```

- `case.expected` 已由平台从用例读好（写成文件的也读出来了）。
- 能用声明式规则说清的检查（数值误差、必填非空、取值范围、条数）写进用例的 `rules`，不必改程序，见 `references/evals.md`。
- 规则做不到的比对（跨字段核对、按业务口径归一化）才改程序，并在回答里告诉用户。
- 需要另一种比对方法时，可以另写一个验证程序放在 `evals/validators/<名>/`，在 `evals/eval.json` 的 `validators` 里声明 `{"command":"node","args":["validators/<名>/server.ts"]}`，用例里写 `"validator": "<名>"`。
