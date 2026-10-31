# Draft Studio 技术栈与架构

本文描述当前实现。产品操作与配置细节见 [README](./README.md)；工作区的源码修改边界见 [agents-app/AGENTS.md](../../AGENTS.md)。

## 工作区与边界

Draft Studio 位于 `apps/draft-studio`，是本机内容创作应用。`deepseek-harness` 其余目录提供上游 DSH CLI、技能工具及部分 UI 组件；应用调用或引用这些能力，但本工作区开发在根目录 `apps/` 内修改应用和适配层。根级 Harness 仓库的其他目录只读，已有本地改动不属于本应用的修改范围。

## 技术栈

| 层次 | 当前实现 |
| --- | --- |
| 页面 | Next.js 15 App Router、React 19、TypeScript、Tailwind CSS 4、Lucide 图标；主要页面在 `app/page.tsx` |
| 本地 API | Next.js 路由适配 Hono；业务入口 `server/app.ts`，路径位于 `/api` |
| 模型与研究 | DeepSeek HTTP 接口负责部分文本生成；DSH headless CLI 负责工具研究、技能加载、视频导演和审校 |
| 数据与知识 | `workspace.json` 本地工作区、Kuzu WASM 知识图谱、本地嵌入与可选 WeKnora 内置或外部服务 |
| 图像 | GPT Image 兼容接口异步任务、ManimGL 解释性插画、Sharp 与 SVG 本地排版 |
| 视频与语音 | DSH 生成 ManimGL Python；受限渲染、FFmpeg/ffprobe；Qwen TTS 合成语音和字时间戳 |
| 开发与测试 | Node.js 执行 Next.js 与 DSH，Bun 脚本及测试，Zod 运行时校验 |

主要版本以 `package.json` 为准。仓库 Harness CLI 的原生能力要求真实 Node/V8，运行时版本要求见 README；Bun 不替代 CLI 的 Node 运行环境。

## 模块关系

```text
浏览器：文章 / 选题 / 素材 / 知识库
    │ Next.js 页面与 /api 路由
    ▼
Hono 业务服务 server/app.ts
    ├─ lib/store.ts ── workspace.json、素材文件、状态镜像
    ├─ lib/knowledge-graph.ts / knowledge-plugins.ts ── Kuzu、WeKnora
    ├─ lib/harness.ts ── DSH CLI ── 搜索 / 抓取 / 技能 / 工具
    ├─ DeepSeek HTTP ── 选题、正文、视觉企划等
    ├─ server/quality-review.ts ── DSH 双技能审校、修复与复检
    ├─ 图片服务 / server/manim-illustration.ts ── 封面与插图
    └─ server/video*.ts ── DSH 分镜代码 → ManimGL → Qwen TTS → FFmpeg
```

`app/api/[[...route]]/route.ts` 将请求交给 Hono 并限制请求体；`middleware.ts` 将文章等客户端路径映射到工作台。`lib/types.ts` 定义工作区与草稿类型；`lib/store.ts` 使用 Zod 解析和本地持久化，`workspace.json` 是工作区数据的权威来源，其他实体文件是镜像。后台任务的阶段与结果写入工作区，页面轮询状态。

## 创作与交付

1. 素材归档、搜索和知识检索构成可追溯资料；选题关联资料，研究阶段记录来源和未知。不能把模型生成文本当作已核实来源。
2. 文章生成按渠道创建标题、正文和创作卡。`lib/writing-methods.ts` 与 `references/creative-method/SKILL.md` 提供以具体问题、证据和读者价值为核心的方法；不同渠道版本独立保存。
3. `server/quality-review.ts` 在隔离目录向 DSH 提供素材及 `grill-with-docs`、`humanizer-zh`，发现问题后进行有限次数修复并复检。缺少真实图片时记录目视检查限制，不应声称看过画面。
4. `lib/visual-plan.ts` 依据正文规划图片并检查证据；正文机制图可使用 ManimGL，复杂场景使用图片模型，文字卡由本地排版。封面单独由 GPT Image 服务生成并叠加标题。
5. `server/video-director.ts` 向 DSH 提供文章、研究资料和知识，加载上游 ManimGL 技能并读取创作方法，生成分镜与场景代码。`server/video.ts` 做代码检查、隔离渲染、预览审校和正式输出；`server/video-voice.ts`、`server/video-delivery.ts` 合成语音、按实际语音时长调整分幕并生成字幕。当前输出为竖屏 1080×1920、30 FPS、H.264/AAC；GPT Image 封面作为首段。字幕按字时间戳对齐，动画同步到幕级，不保证幕内动作逐字对齐。
6. 视频、字幕、分镜和工程包保存到 `media/`；文本、图片和视频的生成、失败及复检状态由各自任务记录展示。发布包下载与公众号草稿是独立交付动作，不等同自动发布。

## 数据、配置与运行

默认数据根目录 `~/xhs-home`，可通过 `DRAFT_STUDIO_HOME` 设置绝对路径：`workspace.json` 存工作区；`archive/` 保存来源与附件；`topics/`、`drafts/` 为实体镜像；`media/` 保存图片和视频；`runtime/` 存运行环境、临时任务和检索数据；`exports/` 存导出。`plugin-settings.json` 保存 WeKnora 连接设置。不要把这些目录当成可清理的构建缓存。

服务端从应用的 `.env.local` 或环境读取 DeepSeek、图片服务、Qwen TTS、WeKnora 和微信配置；具体变量见 `.env.example` 与 README，密钥不应进入仓库或 DSH 渲染产物。图片服务地址与模型权限取决于当前服务商和密钥，连接成功不等于账户有出图权限。

在应用目录运行 `bun run dev` 可启动开发服务；`bun run build` 后用 `bun run start` 启动生产服务。默认地址 `http://127.0.0.1:8794`。长时间生成任务依附服务进程，重启前检查运行状态；构建时可设置应用内独立 `DRAFT_STUDIO_DIST_DIR`，启动时使用同一值。已有 Harness CLI 构建产物是 DSH 功能的运行前提，本工作区不自动重建或修改上游仓库。

## 验证入口

在 `apps/draft-studio` 下执行：`bun run typecheck` 检查类型；`bun run test:topics` 覆盖研究与文章生成；`bun run test:quality` 覆盖审校及进度；`bun run test:video` 覆盖视频相关逻辑；`bun run test:graphics` 包含图像及实际渲染相关测试。真实 ManimGL 渲染测试依赖本地环境和 `MANIMGL_BIN`，模型、图片和语音的真实端到端调用还需要对应服务权限，可能产生费用；模拟测试通过不代表真实服务可用。
