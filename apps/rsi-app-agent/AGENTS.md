# AGENTS.md

做任何改动前先读 `documents/原则.md`，它是本工程唯一的指导。

## 布局

本工程是自进化应用平台，只有 Node / TypeScript 代码。应用不在这里，在 home 目录里。

- `rsi-kernel/`：自进化内核，TypeScript，零依赖。不得出现行业词汇或 harness 词汇（测试会查）。
- `rsi-harness/`：把内核接到 deepseek-harness 的驱动。不得出现行业词汇。
- `console/core/`：平台用例（home、权限、应用、单据、AI 编码会话、HTTP）；`console/web/`：平台界面（Next.js + shadcn/ui）。不得出现行业词汇。
- `builder/`：AI 编码助手的定义（`AGENTS.md`、技能、检查用 MCP 服务），跑在 harness 上。不得出现行业词汇。
- home 目录：`RSI_HOME` 或 `rsi.config.json` 的 `home`（现为 `../../testhome`），缺省 `~/.rsi-app-agent`。每个应用一个文件夹，`code/` 进版本，`evals/` 不进版本；平台状态在 `.rsi/`。改了 home 里的 `code/`，在管理页“导入人工变更”成为新版本。

## 命令

需要 Node ≥ 22.18（直接运行 `.ts`）。本目录位于根目录 `apps/`，与只读 Harness 子模块分离；依赖装在 `console/web`，脚本使用 `--prefix`。

```bash
npm run setup       # 安装 console/web 的依赖
RSI_PASSWORD=… npm run passwd -- <账号>… | --all   # 运维设置密码（不写进文件）
npm run dev         # 控制台 http://localhost:8765
npm test            # 内核、驱动、平台
npm run typecheck
```

harness：通过 `RSI_DSH_COMMAND` 指定独立目录中准备好的兼容 CLI。根目录 `deepseek-harness` 子模块只读，不在其中安装依赖或构建；找不到 CLI 时执行如实失败。改了 `console/core` 或 `rsi-harness` 要重启 `npm run dev`。

可选环境变量：`RSI_ADMIN_PASSWORD`（home 里还没有用户时，启动即创建管理员 `admin`）、`RSI_DSH_COMMAND`（指定 harness 命令）、`RSI_DSH_NODE`（运行本仓库 harness 的 node）、`DEEPSEEK_API_KEY`（提案器）、`RSI_HOME`。

存储默认是本机文件。改用 MinIO：`rsi.config.json` 的 `storage.driver` 设为 `minio`（或环境变量 `RSI_STORAGE=minio`），再给 `RSI_S3_ENDPOINT`、`RSI_S3_BUCKET`，可选 `RSI_S3_REGION`、`RSI_S3_PREFIX`。密钥只放 `RSI_S3_ACCESS_KEY` 和 `RSI_S3_SECRET_KEY`，不进配置文件。本机试 MinIO：`brew install minio/stable/minio && minio server /tmp/rsi-minio --address 127.0.0.1:9000`。

## 规矩

- 密钥只走环境变量，不进模型上下文、不进文件。
- 只用真实材料和真实期望值；分数只由裁判算。没有模拟执行：测试里的确定性执行器只在 `rsi-kernel/test/notes-double.ts`。
- 期望值、裁判、契约只由人改。界面在清单 `evolve.code` 里声明后属于代码级，可以走提案，仍要人批准。
