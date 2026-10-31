---
name: app-package
description: 应用包规范。创建或修改自进化应用（code/ 与 evals/ 两半、app.json 清单、契约、技能、界面、验证程序、评测用例）时使用。
---

# 应用包规范

一个应用是一个文件夹，分两半：

| 目录 | 是什么 | 谁改 |
|---|---|---|
| `code/` | 应用本身：清单、说明、技能、契约、界面。发布后成为不可变的版本快照 | 知识级、代码级文件可由进化循环提议；契约级只由人 |
| `evals/` | 评测用例（每个用例带自己的材料、期望、规则）、验证程序。不进版本 | 人；AI 起草的改动在发布时由人确认 |

## code/ 的文件

```
code/
├── app.json                    清单（契约级），字段见 references/manifest.md
├── AGENTS.md                   给执行任务的智能体的总说明（知识级）
├── scopes/<键>/<值>/AGENTS.md   某个范围（如某个客户、某个团队）的专门知识（知识级）
├── skills/<名>/SKILL.md         怎么做（知识级）；references/ 参考资料（知识级）；scripts/ 脚本（代码级）
├── .mcp.json                   外部系统，标准 MCP 配置；密钥写成 ${环境变量名}（契约级）
├── contract/input.schema.json  任务输入（契约级）
├── contract/output.schema.json 任务输出（契约级）
└── web/                       可选：应用自己的 web 应用（全栈 Next.js，契约级），规范见 references/web.md
```

技能的 `SKILL.md` 开头必须有 front matter：

```markdown
---
name: <和目录名相同>
description: <一句话：什么时候用这个技能>
---
```

## 任务怎么跑

平台把任务输入交给智能体，智能体读 `AGENTS.md`、用入口技能完成任务，最后给出 `{"status": <task.statuses 之一>, "output": <符合输出契约>}`。所以：

- 输出契约要能被逐字段比对：优先用扁平的字符串、数字字段。
- `status` 一般只有 `result`；需要人补充信息才能继续时加 `pause`。

## evals/ 的文件（规范 rsi-eval/1）

```
evals/
├── eval.json              {"spec": "rsi-eval/1", "validators": {}, "tags": {}}
├── cases/<id>/            一个用例一个文件夹
│   ├── case.json          {"id","title","tags","split","source","input","expected","rules","validator"}
│   ├── input/             这个用例的输入材料（路径写成 <应用名>/evals/cases/<id>/input/...）
│   └── expected/          可选：期望结果文件
├── inbox/                 用户随手上传的文件，归位到用例后清空
└── judge/server.ts        默认验证程序：MCP 服务，提供 score 与 check，模板见 references/judge.md
```

- 用例的完整写法和声明式规则见 `references/evals.md`。
- `expected` 只能来自用户给出的真实值；没有就先写 `rules`，并请用户补。
- 至少一个开发集用例；可以把一部分标成 `"split": "holdout"` 作留出集。

## 自检

改完文件调用 `check_app`（MCP 服务 `rsi-builder`）。它用平台内核真实加载这个工作区，返回问题（必须改）和提醒（可以暂缓），包括界面有没有植入改进入口、用例的材料在不在。

通过后调用 `run_tests`，用平台的执行器真实运行并按用例打分；可以用 `cases` 只跑一部分。缺真实材料时调用 `request_files` 请用户上传；用例的期望值用 `confirm_result` 请用户确认运行结果得到。
