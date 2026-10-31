# Draft Studio

内容创作工作台。架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)，创作方法见 [EDITORIAL_METHOD.md](./EDITORIAL_METHOD.md)。

## 启动

在此目录使用 Node.js 22.19+ 或 24+：

```bash
bun install
bun run build
bun run start
```

服务默认监听 `127.0.0.1:8794`。开发模式使用 `bun run dev`。文章、知识和生成素材默认保存到 `~/xhs-home/`，可通过 `DRAFT_STUDIO_HOME` 指定；该目录是用户数据，请勿为测试清空。模型和其他服务的配置变量见 `.env.example`，密钥只放本地环境中。

## Harness

工作区 `deepseek-harness/` 是只读子模块，不在其中安装或构建。资料搜索、生成及 Copilot 等 Harness 功能需要独立目录中的兼容构建，设置 `DSH_RUNTIME_ROOT` 指向其根目录；需要真实 Node.js，不能用 Bun 直接运行 Harness CLI。纯净源码不包含 CLI 产物，未配置时这些功能不可用。

视频封面由配置的图片服务生成并作为视频首帧；视频生成的依赖可通过 `bun run setup:video` 准备。真实生成可能调用外部服务并产生费用。

## 验证

`bun run typecheck`、`bun run test:quality`、`bun run test:topics`、`bun run test:video`。端到端测试请查看 `tests/` 和对应 package scripts；测试应使用隔离的临时数据目录。


测试和排障变量使用 `DRAFT_STUDIO_` 前缀：`DRAFT_STUDIO_E2E_LIVE`、`DRAFT_STUDIO_E2E_REAL_IMAGE`、`DRAFT_STUDIO_E2E_KEEP`、`DRAFT_STUDIO_E2E_IMAGE_MOCK` 和 `DRAFT_STUDIO_DEBUG_MODEL`。真实全流程测试会请求外部模型，只有明确设置 `DRAFT_STUDIO_E2E_LIVE=1` 才会执行，可能产生费用。Copilot 工具与内部请求使用 Draft Studio 命名。
