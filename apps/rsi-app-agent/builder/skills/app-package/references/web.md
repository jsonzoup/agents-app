# web 应用 code/web/

应用自己的 web 应用是一个完整的 Next.js 项目（前端 + 服务端），在 `app.json` 里写 `"web": "web"`。平台按版本安装依赖、`next build`、`next start`，挂在 `/apps/<应用>/v/<版本>/` 下，嵌在“使用”页里；构建工作区预览时挂在 `/apps/<应用>/w/<会话>/`。处理任务的智能体看不到 `web/`。

## 目录

```
web/
├── package.json / package-lock.json   依赖；加依赖就改这里（平台用 npm ci 安装）
├── next.config.ts                     basePath 取 process.env.RSI_BASE_PATH，不要改掉
├── .env                               这个应用的配置和密钥（契约：只有人改）
├── app/
│   ├── [[...path]]/page.tsx           所有页面：取平台上下文，交给 views/
│   └── api/**/route.ts                服务端接口：连数据库、调外部接口、调大模型、存 MinIO
├── views/index.tsx                    业务页面（默认导出，收到 AppUiProps）
├── lib/rsi.ts / lib/caller.ts         平台客户端 / 服务端取调用人
├── lib/server/db.ts、redis.ts、        本应用自己的数据库、缓存、对象存储、队列（平台开通，见下）
│   storage.ts、queue.ts、jobs.ts
├── lib/server/**                      其他服务端代码放这里
├── instrumentation.ts                 服务启动时启动 lib/server/jobs.ts 里的后台任务
└── components/kit、components/ui、sdk   平台组件和类型的副本，不要改
```

## 业务页面 views/index.tsx

```ts
import type { AppUiProps } from "@/sdk";
export default function App({ app, user, path, navigate, api }: AppUiProps) { … }
```

| 属性 | 含义 |
|---|---|
| `app` | `{name, title, description, stable, permissions, actions, scopes}` |
| `user` | 当前用户 `{id, name, title}` |
| `path` / `navigate(sub)` | 应用内的子页面：`navigate("new")`、`navigate(id)`、`navigate("")` |
| `api.tasks()` / `api.task(id)` | 单据列表 / 一张单据（`input`、`working` 当前结果、`state`、`corrections`、`run`） |
| `api.createTask({title, input})` | 新建单据并执行，返回单据 |
| `api.rerun(id, input?)` | 重新执行 |
| `api.correct(id, {path, field, value, note?, scope})` | 人改一个值：`path` 是 `working` 里的点路径，`field` 是信号里的字段名，`scope` 选范围 |
| `api.suggest(id, {target, note, scope})` | 对一块区域或整单提建议（通常用 `SuggestButton`） |
| `api.suggestApp({target, note, task?})` | 对界面（`target.level: "ui"`，`path` 是应用里的页面）或新功能（`"feature"`）提建议，不需要单据、不分范围（`SuggestButton` 里选“界面”“新功能”时调用） |
| `api.confirm(id)` | 确认结果 |
| `api.action(id, name)` | 执行 `app.json` 声明的动作 |
| `api.upload(file)` | 上传材料，返回 `{path, sha256, name, size}`，放进任务输入 |
| `api.contributions()` | 本人修正的去向 |
| `api.fileUrl(path)` / `api.artifactUrl(taskId, artifactId)` | 材料与产物的地址 |
| `api.version` | 平时 `null`（稳定版）；试用候选版本时是那个版本 |

组件：`@/components/ui/*`（shadcn/ui）；`@/components/kit` 的 `EditableValue`、`scopeOptions`、`SuggestButton`、`SuggestionList`、`ContributionBanner`；图标 `lucide-react`；提示 `sonner` 的 `toast`。

## 服务端

- 接口写在 `app/api/<名>/route.ts`，浏览器里用 `appUrl("api/<名>")` 调（`@/lib/rsi`，会带上 basePath）。
- 谁在调用：`caller(req.headers)`（`@/lib/caller`）。平台先检查这个人能不能用这个应用，再转发请求；应用拿不到平台的登录凭证。
- 配置和密钥从 `process.env.<名>` 读。需要新的配置时，在 `.env` 里写上变量名和注释，值留空，并在回答里请用户填；不要编造值，不要写进别的文件（`check_app` 会查）。给浏览器用的值以 `NEXT_PUBLIC_` 开头，它们会打进页面，不能放密钥。

## 数据、文件、后台任务

平台为每个应用开通自己的一套资源，运行时以环境变量交给服务端（不写进 `.env`，版本和导出包里没有凭证）。已发布版本用 `prod` 一套，工作区预览用另一套 `dev`，试改动不会碰真实数据。

| 要做的事 | 用 | 变量 |
|---|---|---|
| 结构化数据 | `sql()`、`migrate()`（`@/lib/server/db`，PostgreSQL） | `DATABASE_URL` |
| 缓存、计数、短期共享状态 | `redis()`、`cached()`（`@/lib/server/redis`，键自动加前缀） | `REDIS_URL`、`REDIS_PREFIX` |
| 文件（上传、生成的文档） | `putFile`、`getFile`、`fileUrl`（`@/lib/server/storage`，MinIO） | `S3_*` |
| 耗时的工作（批量处理、调外部接口、生成报告） | 接口里 `enqueue("名", 数据)`，在 `lib/server/jobs.ts` 里 `work("名", 处理函数)`（Redis Streams） | `QUEUE_PREFIX` |

应用会同时跑多份（平台多实例、多台机器），所以：

- 数据只放数据库、文件只放对象存储；不要存进内存变量、模块级 Map 或本地磁盘，另一份看不到，重启就没了。
- 表结构用 `migrate([{ id: "001-建表", sql: "…" }])` 按顺序加，跑过的步骤不要再改，加新的。
- 后台任务可能被执行两次（某一份中途停了，另一份会接手）：处理前先查是否已经做完。
- 接口里只做快的事；超过几秒的放进队列，接口立即返回，页面轮询结果。
- 某个变量没有（比如平台没开通对象存储），对应函数会抛出清楚的错误；在本机单独开发时可以在 `.env` 里写一份自己的。

## 写法

- 第一屏就是业务：列表 + 新建；点进去看结果、改值、确认。信息密度高，不要大段说明文字。
- **必须植入改进入口**（`check_app` 会检查 `views/` 和 `app/`）：每个可修正的值都用 `EditableValue` 并调 `api.correct`；单据页放 `SuggestButton`（它同时能提对结果、界面和新功能的建议；列表等没有单据的页面也可以放，`taskId` 不传时只提界面和功能）；列表页顶部放 `ContributionBanner`。
- 单据数据只经 `api` 访问；自己的数据走自己的 `app/api/**`。
- 能在本地验证：`cd code/web && npm ci && npm run build`（`node_modules`、`.next` 不进版本）。
