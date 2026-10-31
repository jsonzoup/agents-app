# 评测用例（规范 rsi-eval/1）

一个用例一个文件夹，放齐它需要的一切：

```
evals/
├── eval.json                {"spec": "rsi-eval/1", "validators": {}, "tags": {"smoke": "冒烟"}, "capabilities": {"多币种": "……"}, "trials": 1}
├── cases/<id>/
│   ├── case.json            用例
│   ├── input/               输入材料（用户上传的真实文件）
│   └── expected/            可选：期望结果写成文件；oracle.json 是参考答案（平台写）
└── judge/server.ts          默认验证程序
```

## case.json

```json
{
  "id": "c1",
  "title": "一句话说明考什么",
  "tags": ["smoke"],
  "split": "dev",
  "difficulty": "medium",
  "why": "难在哪里：比如两张发票币制不同，要按发票分别换算",
  "capabilities": ["多币种"],
  "source": "出处：用户 2026-10-10 在对话里给出 / 上传的某某单据",
  "input": { "text": "……" },
  "expected": { "summary": "……" },
  "rules": [{ "path": "status", "op": "equals", "value": "result" }]
}
```

- `id` 和文件夹同名；`input` 必须满足 `code/contract/input.schema.json`。
- 材料在 `input` 里写成 `<应用标识>/evals/cases/<id>/input/<文件名>`（相对平台 home）。
- `expected` 是期望输出里要比对的部分，交给验证程序（默认 `judge`）：键是输出里的路径（`total`、`items[0].name`），值是期望的值。用户确认运行结果后由平台写入，你不要写。
- 还没确认的用例写 `"expected": {}`：它是“待确认”的，`run_tests` 跳过它，发布前必须确认完。
- `rules` 是声明式检查，不用写程序。只有规则、没有期望值时写 `"validator": null`。
- `split` 默认 `dev`；留出集写 `holdout`。
- `difficulty`（easy、medium、hard）、`why`、`capabilities` 是给人看覆盖面的：每个用例都写。`capabilities` 的词表写在 `eval.json` 的 `capabilities`（能力 → 一句话含义），按业务能力命名，不按文件或字段命名；`check_app` 会列出还没有用例的能力。
- `oracle`（参考答案）是一次完整、正确的运行 `{status, output, provenance}`，裁判必须给它满分，否则用例判为无效、不参与评测。用户确认运行结果时平台自动写 `expected/oracle.json`；**你不要写或改它**。它不满分时说明期望值或裁判有问题，告诉用户，由他决定。
- `eval.json` 的 `trials` 是提案验证时每个用例跑几次（1–5，默认 1）。

## 规则

路径从 `{status, output}` 开始：`status`、`output.total`、`output.rows[0].price`、`output.items[name=重量].value`。

| op | 参数 | 通过条件 |
|---|---|---|
| `equals` | `value` | 等于 |
| `number` | `value`，`tolerance` 或 `relative` | 数值在误差内 |
| `oneOf` | `values` | 是其中之一 |
| `contains` | `value` | 文本包含 / 数组含有 |
| `matches` | `pattern` | 匹配正则 |
| `count` | `value` 或 `min`/`max` | 数组长度 |
| `present` / `absent` | — | 非空 / 为空 |

## 写用例的规矩

- 材料只来自用户上传的真实文件：没有就调用 `request_files`，目标目录写 `evals/cases/<id>/input/`。
- 期望值只来自用户对运行结果的确认：应用能在这个用例上跑出结果后调用 `confirm_result({case})`。不要请他上传或手填期望值。
- 还可以加 `rules`（如状态、必填字段非空、条数），它们不需要等确认。
- 每个用例考一件事，`title` 说清楚；常跑的打上 `smoke` 标签。
- 覆盖要有难度梯度：常见的 easy 单据、需要判断的 medium、容易错的 hard（缺材料、跨单据不一致、边界条件）都要有，不要全是一眼能做对的。
- 写完 `check_app`，再 `run_tests`。
