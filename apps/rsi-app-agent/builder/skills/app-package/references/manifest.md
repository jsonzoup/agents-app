# app.json

```json
{
  "kind": "App",
  "name": "<小写字母、数字、连字符；与应用文件夹同名>",
  "title": "<中文名称>",
  "version": "1.0.0",
  "description": "<一句话说明>",
  "task": {
    "input": "contract/input.schema.json",
    "output": "contract/output.schema.json",
    "statuses": ["result"]
  },
  "agent": {
    "instructions": "AGENTS.md",
    "skills": ["skills/<技能名>"],
    "entry": "<技能名>",
    "mcp": ".mcp.json"
  },
  "scopes": [{ "key": "<范围键>", "title": "<范围名>", "from": "input.<输入字段>" }],
  "evolve": {
    "knowledge": ["AGENTS.md", "scopes/*/*/AGENTS.md", "skills/*/SKILL.md", "skills/*/references/**"],
    "code": ["skills/*/scripts/**"]
  },
  "evals": { "cases": "cases", "holdout": [] },
  "judge": { "command": "node", "args": ["judge/server.ts"] },
  "web": "web"
}
```

| 字段 | 说明 |
|---|---|
| `scopes` | 人修正结果时可以选“只对这个范围生效”。`from` 是任务输入里的路径。没有就写 `[]` |
| `evolve` | 允许进化的文件。不能把 `app.json`、`.mcp.json`、`contract/**`、`web/**` 划进来；`.env` 无论怎么写都是契约 |
| `evals.holdout` | 留出集用例 id，只在发布前看一次 |
| `judge` | 在 `evals/` 目录里启动裁判的命令 |
| `web` | 应用自己的 web 应用目录（全栈 Next.js 项目），见 references/web.md；没有就删掉这一项，平台用通用任务界面 |
| `actions` | 可选：单据确认后可以执行的动作，如生成文件：`{"<名>": {"title","command","args":["{input}","{output}"],"input":"<输出里的路径>","output":"<文件名>","requiresConfirmed":true}}` |
