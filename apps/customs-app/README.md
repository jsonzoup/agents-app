# 报关灵 2.0 · 工作台 + 任务中心

依据《报关灵 2.0 产品需求文档》与交互原型重建的可运行原型，只保留 **制单工作台** 与 **任务中心** 两个菜单；视觉重做为适配报关业务的深色导航 + 蓝色工作区风格，右侧 Copilot 按 **DeepSeek Harness** 的对话样式实现，并展示 Harness 加载 `customs-extraction` skill 的规则、码表与工具调用轨迹。

技术栈：**Bun + Next.js 15（App Router）+ React 19 + Hono + Tailwind CSS v4 + shadcn/ui（Radix）**，Excel 导出使用 exceljs，Office 文档预览使用 fflate + SheetJS。

## 运行

```bash
cd apps/customs-app
bun install
bun run dev                 # http://127.0.0.1:8790
# 或
bun run build && bun run start
```

首次启动自动写入演示数据（一票 14 项商品的真实提取结果 + 3 票不同状态任务）。删除 `data/db.json` 并重启即可恢复初始状态。

## 本轮完成的内容

### 1. 办公文档上传

- 支持 **PDF / DOC / DOCX / PPT / PPTX / XLS / XLSX / XLSM / CSV / TXT / JPG / PNG / WEBP** 多选、拖拽上传，单文件 ≤ 45MB。
- 上传即识别文档类型（合同、商业发票、装箱单、提运单、报关委托书、原产地证、申报要素、其他），未识别可手动指定。
- **在线预览**（右侧「资料」）：
  - PDF：浏览器内嵌分页预览；图片：原图预览（演示票带区域高亮）。
  - DOCX：解析 `word/document.xml` 输出段落与表格文本。
  - PPTX：解析 `ppt/slides/*.xml` 按页展示文本。
  - XLSX / XLS / CSV：SheetJS 读取多工作表，表格化预览（行号 + 单元格）。
  - DOC / PPT 旧版二进制：给出「另存为 docx/pptx」提示并可下载原文件。

### 2. 视觉与布局（本票资料与精简新建页）

- 只显示两个菜单：制单工作台、任务中心（无经验库/历史库等占位）。
- 深色导航（含 DeepSeek Harness 连接状态与当前 skill 版本）、浅色工作区、蓝色主色与琥珀告警色。
- 新建制单页只保留「本票特殊要求（选填）」与上传区（客户 / 任务名称 / 制单方法已移除），并提示需上传完整资料；不强制资料份数。
- 工作区在草单上方展示「本票资料」卡片（类型 / 页数 / 大小），点击直达右侧预览；标题下展示任务号、客户、监管方式·运输方式与版本。
- 报关单纸张细化：纸张阴影、标题栏、斑马纹表体、更紧凑的表头网格；任务中心使用指标卡 + 状态胶囊 + 负责人头像。

### 3. 布局与全屏

- 左侧菜单可收起为 74px 图标栏（悬停显示名称），状态写入 localStorage。
- 顶栏右侧「全屏」按钮：隐藏左侧菜单与顶栏，左栏宽度（232px / 收起态 74px）自动补给 Copilot 面板（400 → 632 / 474），退出后恢复原宽度；Esc 或右上悬浮按钮退出。
- 草单缩放工具（62%–140% + 适宽），配合可拖拽的右侧面板（320–820px），便于整张草单与资料预览同屏；折叠 Copilot 后右侧会保留竖排「Copilot」入口，点击即可展开。
- 工作区标题下展示任务号、客户、监管方式·运输方式与版本。

### 4. Copilot（DeepSeek Harness 对话样式）

- 用户消息：右侧浅蓝气泡（22px 圆角）；助手消息：无气泡整栏正文（14/24）。
- **工具调用行**：`skill.load`、`materials.read`、`draft.extract`、`hs.query`、`draft.render`、`ask.user`、`source.locate`，带状态点、耗时/规模标签，点击展开参数与真实输出（材料页数、字段统计、HS 查询结果、草单版本）。
- 会话：一任务一会话，顶部会话条可切换最近会话；输入框带 `DeepSeek Harness` / `customs-extraction` 标记。
- 追问：待办清单、字段来源（会追加 `source.locate` 工具行）、字段解释、按指令改值。
- Ask 表单：主体 / 进口日期 / 原产地证第 14 项，提交后回写字段并重算任务状态。

### 5. Harness 加载 skill 的展示

- Copilot 顶部常驻 **已加载 skill 卡片**：`customs-extraction v1.0.0`、19 篇规则、18 张标准表，点击进入「技能」页。
- 「技能」页展示：
  - 能力清单（材料接入、表头表体抽取、标准表依赖查询、风险校验、草单渲染）；
  - 实际读取的 `references/*.md` 与标题（19 篇）；
  - `data/*.xlsx` 标准码表（18 张）；
  - 本票运行记录（工具调用与输出）。
- 数据来自运行时的 skill 目录（`CUSTOMS_SKILL_ROOT`，默认 `skills/customs-extraction`），不是硬编码文案。

### 6. 边提取边对话、可拖拽与放大预览

- 提交资料后 Copilot 按 skill 步骤实时推进：`skill.load → materials.read → draft.extract → hs.query → draft.render → ask.user（不阻塞）→ draft.writeback`，每步有运行中/完成状态、规模标签与展开输出；同时穿插助手叙述（读取页数、识别类型、字段统计、标准表核对），草单生成后自动回写并刷新工作区（前端轮询任务详情，无需手动刷新）。
- 对话栏与工作台之间新增拖拽分隔条（默认 400px，双击复位），宽度写入 localStorage；全屏模式下自动加宽并随退出恢复。
- 资料预览支持缩放（50%–300%）与全屏查看；PDF 预览高度提升，溯源定位时高亮区域同步显示。

### 7. 原有业务闭环

- 不限资料份数：上传任意数量资料即可开始制单（仅提示已上传份数与识别类型），四阶段后端进度、字段四态与留痕、⌖ 溯源定位、ⓘ 规则置信度、导出标准 Excel（20 行模板 + 附表）。
- 任务中心：指标、三条件筛选、状态机（待补充 → 待确认 → 待复核 → 可交付 → 已交付，含审核角色复核/退回）；表格展示制单进度（已回填/总字段）、商品项数与资料份数/缺件、编码字典命中情况，草单与编码参考持久化在 `data/db.json`。

## 编码字典与参考展示

- `lib/dictionaries.ts` 直接读取 skill `data/` 下 18 张 Excel（HS编码2026、CIQ代码表、监管方式、成交方式、币制、国别、包装种类、计量单位、征免性质、运输方式、随附单证、关区代码、口岸代码、境内货源地、行政区划代码、征免方式等），进程内缓存。
- 草单生成时逐字段解析代码：HS → 监管证件/法定单位/第二单位/CIQ；其余代码字段 → 代码+中文名称+来源表，写入 `task.codeRefs`。
- 工作区「编码参考」卡片展示 字段 / 代码 / 名称 / 字典来源，并统计命中数，可直接对照报关系统代码。
- `draft.validate` 工具输出 `code_refs` 与 `unmatched_codes`，未命中代码在卡片中标记。

## 业务域 / Harness 解耦（MCP）

对话与草单数据不再由页面或 Harness 直接读写，统一经过一个业务 MCP 服务：

```
Copilot UI ──► /api/tasks/:id/chat ──► lib/harness.ts（Harness 适配层）
                                             │  MCP (Streamable HTTP)
                                             ▼
                                   /api/mcp · business-draft v1.0.0
                                             │
                                             ▼
                          lib/business.ts（业务域唯一读写点：草单/任务/事件）
```

- **MCP 服务**：`app/api/mcp/route.ts`，无状态 Streamable HTTP（`enableJsonResponse`），暴露 11 个工具与 1 个资源：
  `task_snapshot`、`task_summary`、`draft_get_field`、`draft_set_field`、`draft_confirm_field`、`draft_apply_answers`、
  `materials_list`、`messages_append`、`events_poll`、`events_append`、`skill_info`；资源 `skill://customs-extraction`。
- **Harness 适配层**：`lib/harness.ts` 只通过 MCP 客户端读取快照、回写字段、追加消息与事件；`server/app.ts` 的 chat/ask 路由不再调用业务存储，改为调用 Harness。
- **业务事件**：任务 `events` 带自增 `seq`；流水线写入 `draft.progress`、`ask.created`、`draft.ready`，Harness 写入 `harness.chat`、`harness.ask_answered`，可用 `events_poll(taskId, after)` 增量消费。
- **可观测**：Copilot 工具轨迹首行为 `mcp.connect`；「技能」页展示 MCP 地址、传输方式、工具清单与本票调用记录。
- 独立接入 Harness 时，无需依赖 Next 页面，只要有 MCP 客户端即可：先 `initialize`，再按需调用上述工具。

## 目录

| 模块 | 位置 |
| --- | --- |
| Hono API | `server/app.ts`、`app/api/[[...route]]/route.ts` |
| skill 元数据与工具轨迹 | `lib/skill.ts`、`components/copilot/tool-row.tsx`、`components/copilot/skill-panel.tsx` |
| Office 预览 | `lib/preview.ts`、`components/docs/viewer.tsx` |
| MCP 服务与客户端 | `app/api/mcp/route.ts`、`lib/mcp/server.ts`、`lib/mcp/client.ts`、`lib/mcp/meta.ts` |
| 业务域服务 / Harness | `lib/business.ts`、`lib/harness.ts` |
| 任务/状态/agent | `lib/store.ts`、`lib/status.ts`、`lib/agent.ts` |
| 导出 | `lib/export.ts`、`assets/export-template.xlsx` |
| 截图 | `docs/screenshots/` |
| 开发记录 | `docs/DEVELOPMENT.md` |

## 边界

- 真实模型提取尚未接入：`lib/store.ts#buildDraft` 为演示适配器——上传合同/发票/箱单/提运单等资料后输出内置样例票的完整 14 项草单（来源按单证类型映射到本次上传件）。缺少核心单证时**不阻断**：先按现有资料抽取可回填字段，缺件相关字段置空标记「待补充」，会话输出已回填/待补充计数与缺件影响；核心单证齐备时才追加固定 3 项确认问题。工作区「重新解析」可重跑。
- 演示票的来源高亮区域为人工标定；上传件的 DOCX/PPTX/表格为文本/表格预览，不是版面还原。
- 不连接海关单一窗口，不发起真实申报；演示用报关委托书为合成资料。
