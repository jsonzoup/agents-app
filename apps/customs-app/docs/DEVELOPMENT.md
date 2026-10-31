# 开发记录 · 2026-10-20

## 需求

按《报关灵 2.0 PRD v1.1》与交互原型 v0.3，实现制单工作台与任务中心：
上传与完备性校验 → 加载过渡 → 草单工作区（字段状态、⌖ 溯源定位、ⓘ 规则置信度、导出 Excel）→ Copilot 单任务单会话、追问、Ask 表单 → 任务中心指标/筛选/状态机。

## 技术栈

Bun 1.2.9 / Next.js 15.5.4（App Router）/ React 19 / Hono 4 / Tailwind CSS v4 / shadcn 风格组件（Radix）/ exceljs / pdf-lib。

## 主要文件

- `server/app.ts`：Hono API（上传、导入演示资料、任务、对话、字段、确认、Ask、复核、导出、资料文件）。
- `lib/store.ts`：任务流水线、演示提取适配器、状态重算、导出落盘。
- `lib/agent.ts`：演示 agent 意图（待办、来源、字段解释、改值、主体/原产地问答）与 Ask 表单应用。
- `lib/export.ts`：以 skill 产出的 20 行模板为基础填充表头/表体/附表，隐藏空行。
- `app/(app)/work`、`app/(app)/work/[taskId]`、`app/(app)/tasks`：三个页面。
- `components/workbench/*`、`components/copilot/*`、`components/docs/*`：草单、Copilot、资料定位。
- `tools/build_demo.py`：生成演示页图、合成委托书、`data/demo_ticket.json`（来自真实提取结果）。
- `tools/strip_template_drawing.py`：去掉模板说明图片（exceljs 无法稳定写回该 drawing）。

## 验证

- `bun run build` 通过（TypeScript 校验通过）。
- `bun run start` 后：`/work`、`/work/BG-20260623-001`、`/tasks` 均 200。
- API：上传 / 导入演示 8 份 / 创建任务 / 四阶段进度（12→38→64→86→100）/ 生成 14 行草单 / 对话 / 改值 / Ask 提交 / 状态重算 / 复核 / 导出。
- 导出文件用 openpyxl 复核：33 行 × 15 列、14 行商品、空行隐藏、附表 13 行原产地 + 1 行集装箱；关键字段（境内收发货人含 USCI、数量三行、原产国代码、境内目的地码对、征免代码、底部确认项）正确。
- Playwright（本机 Chrome）截图核对工作台、任务中心、加载页、⌖ 定位、ⓘ 规则弹窗，无 console/page 错误。

## 遗留与边界

- 真实模型提取未接入：`lib/store.ts#buildDraft` 为演示适配器（内置样例票输出真实结果，其他资料生成待补充空稿）。
- 来源高亮区域为人工标定，接入提取服务后应由服务返回页码/区域坐标。
- 经验库、历史库、质量与效率、团队与设置不在本期；未接单一窗口。
- 按仓库约定开发记录应放 `docs/development/`，本次会话工作区仅允许写 `skills/`，故记录暂存于本目录。

## 2026-10-20 追加 · v2 视觉与 Harness 能力展示

### 变更
- 全站视觉重做：深色导航（#080d15）+ 蓝色主色（#2c5be6）+ 浅色工作区；仅保留「制单工作台」「任务中心」两个菜单。
- 新增办公文档上传与预览：PDF/图片原样预览；DOCX（word/document.xml）、PPTX（ppt/slides）、XLSX/XLS/CSV（SheetJS）文本/表格预览；DOC/PPT 提示转换并可下载。
- Copilot 改为 DeepSeek Harness 对话样式：用户浅蓝气泡、助手无气泡正文、工具调用行可展开、输入框带 Harness/skill 标记。
- 新增 skill 能力展示：`/api/skill` 读取 `skills/customs-extraction` 的 VERSION、references/*.md 标题、data/*.xlsx 清单；Copilot 常驻 skill 卡 + 「技能」页 + 本票工具轨迹。
- 任务创建/流水线写入工具调用消息；对话查来源时追加 `source.locate` 工具行。

### 验证
- `bun run build` 通过；`/work`、`/tasks`、`/work/[id]` 200。
- `/api/skill` 返回 v1.0.0 / 19 篇规则 / 18 张码表。
- 上传 PRD.docx 后 `/preview` 返回正文 5212 字；上传模板.xlsx 返回 3 个工作表；Playwright 截图无 console/page 错误。
- 截图：docs/screenshots/{workbench,tasks,new-task,skill,tool-trace,docx-preview}.png

## 2026-10-20 追加 · 交互与配色微调

- 去掉「已上传 N/5 份 + 需备齐…」限制与阻断弹窗，改为仅显示「已上传 N 份资料 · 识别类型」，任意数量资料即可开始制单。
- 移除文案：侧栏「DeepSeek Harness」「本地演示 · 数据不离开本机」、顶栏「演示环境」、输入框「DeepSeek Harness」标记；侧栏底部保留 skill 加载状态。
- 团队名称由「澄信报关团队」改为「报关团队」（图标改为「关」）。
- 配色二次调整：亮蓝 → 深普鲁士蓝（#1E3A5F）；背景改为暖纸色（#F6F4F0）；边框/纸张转暖灰；侧栏品牌与选中态加入黄铜色（#C8A45C/#A9822F）；Copilot 气泡改为柔和蓝灰（#EEF2F7）。

## 2026-10-20 追加 · 实时提取对话 / 拖拽 / 预览放大

- `startPipeline` 改为分阶段写入工具消息与助手叙述：skill.load → materials.read → draft.extract → hs.query → draft.render → ask.user，状态 running/done 实时更新，`draft` 在 64% 阶段生成，100% 回写并追加收尾消息。
- 任务页轮询仅拉取任务详情（650ms），完成后刷新会话列表；移除前端合成进度消息，改为顶部进度条。
- 新增 `PanelResizer`：右侧面板拖拽 320–820px，双击复位 420px，宽度持久化。
- 资料预览：图片支持 50%–300% 缩放与全屏 Dialog；PDF 预览高度提升；溯源高亮同步。
- 修正文案：「草单已生成并自动回写到工作区」「正在解析资料」。

## 2026-10-20 追加 · 新建页精简 / 工作区资料展示

- 新建制单页去掉「客户 / 任务名称 / 制单方法」字段，只保留「本票特殊要求（选填）」；补资料清单提示与左置「开始制单」。
- 去掉「载入演示资料」按钮（导入接口保留但不在 UI 暴露）；新任务客户默认「待识别客户」，演示票在生成草单时回填「森林电器」。
- 工作区标题下新增元信息行（任务号 | 客户 | 监管方式·运输方式 | 版本），并在草单上方新增可折叠「本票资料」卡片区，点击任一文件直达右侧资料预览。
- 修复 Copilot 标签页图标与文字换行：TabsTrigger 改为 inline-flex + whitespace-nowrap + flex-none。

## 2026-10-20 追加 · 菜单收起 / 全屏 / 草单缩放

- 侧栏支持收起为 74px 图标栏（PanelLeftClose/Open，localStorage 持久化），折叠态用 tooltip 展示菜单名。
- 顶栏新增全屏按钮：隐藏侧栏与顶栏（必要时调用 Fullscreen API），右上角悬浮退出按钮，Esc 可退出；退出后恢复原布局。
- 草单新增缩放工具（62%–140%、适宽），使用 CSS zoom 使整张表单缩放；右侧面板默认 400px，可拖拽至 820px。
- 默认面板宽度与草单最小宽度微调（400 / 800）。

## 2026-10-20 修复 · Copilot 折叠后无法恢复

- 右侧面板折叠后，其自身的展开按钮随面板一起隐藏。新增 portal 到 body 的右侧竖排「Copilot」悬浮标签（固定右侧居中，z-40），点击即展开；展开后标签消失。工作台与新建页共用同一组件，均验证通过。

## 2026-10-20 修复 · 全屏宽度补偿 / 流程收尾 / 类型识别

- 全屏改为纯布局模式（不再调用 Fullscreen API）：隐藏侧栏与顶栏，并把侧栏宽度（232/74）补到 Copilot 面板（400→632），退出恢复 400；Esc 与右上悬浮按钮均可退出。
- 流水线收尾改为 `ask.user（不阻塞）→ draft.writeback（已完成）`，不再出现「等待用户」；收尾文案明确提取已完成、草单已回写。
- 修复文件名类型识别：归一化 `_`/`-` 后匹配 `bill of lading`、`certificate of origin`、`packing list` 等；完整资料集（合同/发票/箱单/提运单）按类型映射到内置样例草单，避免上传后出现空白草单。

## 2026-10-20 追加 · 业务域 / Harness MCP 解耦

- 新增 `lib/business.ts` 作为草单/任务/事件的唯一业务读写点；新增 MCP 服务 `/api/mcp`（Streamable HTTP，11 工具 + skill 资源）。
- 新增 `lib/harness.ts` 与 `lib/mcp/client.ts`：对话与 Ask 全部经 MCP 读取快照、回写字段、追加消息与事件；`/api/tasks/:id/chat`、`/ask` 不再直接调用 store。
- 任务事件增加 seq 与类型：`draft.progress`、`ask.created`、`draft.ready`、`harness.chat`、`harness.ask_answered`，可用 `events_poll` 增量消费。
- Copilot 轨迹新增 `mcp.connect`；技能页新增 MCP 服务区块（地址、传输、工具清单）。
- 验证：MCP 客户端 listTools 11 个；task_summary/events_poll 正常；chat 经 MCP 追加用户与助手消息；ask 经 MCP 回写字段；新任务事件含 4 条 progress + ask.created + draft.ready。

## 2026-10-20 修复 · 真实单据识别失败导致会话“秒完成”

- 现象：BG-20261020-015 上传 7 份真实资料，仅合同/申报要素被识别，`bl.pdf`、`IN+PL.pdf` 等类型为空，buildDraft 走空稿分支（3 行、54 项待补充），但流程仍输出“提取完成”和 3 个无关问题，约 5 秒结束。
- 修复：文件名类型识别支持 `bl`、`IN+PL`、`in pl` 等；新增 `materials.inspect` 逐份检查格式/类型/可读性并在会话中展示；缺少核心单证时走 incomplete 分支（`draft.validate` + 回写骨架 + 明确缺件与旧格式提示），不再伪造“完成”和固定问题。
- 新增 `POST /api/tasks/:id/rerun` 与工作区「重新解析」按钮：重新检测材料类型并按 skill 重跑，用于复核已上传任务。

## 2026-10-20 修复 · 缺件不再阻断，改为部分提取

- skill 未要求缺件阻断。移除 `extract.incomplete` 分支：只要存在任一核心单证，就基于现有资料生成草单；来源单证缺失的字段置空并标记「待补充」，其余字段正常回填。
- 表体：有可回填商品行则保留全部行并重排序号；完全无可回填行时保留 3 行空表体。
- 会话改为：缺件提示「不阻断，先抽取可回填字段」→ 输出 `filled/total` → `draft.validate (partial)` → `draft.writeback`（已回填字段）→ 收尾说明缺件影响的字段数与后续操作。
- 仅在核心单证齐备时才追加固定 3 项确认问题；部分提取不弹无关问题。
- 实测（7 份真实命名资料，缺装箱单）：14 项商品、312/343 字段回填、31 字段待补充，来源仍指向本次上传件。

## 2026-10-20 追加 · 真实字典查询与编码参考

- 新增 `lib/dictionaries.ts`：直接读取 skill `data/` 下 18 张 Excel，按表头识别代码/名称列，提供代码↔名称、HS→监管证件/法定单位/第二单位/CIQ、CIQ 编码查询。
- 新增 `lib/code-refs.ts`：遍历草单代码字段（HS、CIQ、监管方式、征免性质、成交方式、币制、国别、包装、运输方式、计量单位、随附单证、关区、口岸、境内货源地、行政区划、征免方式），产出「字段-代码-名称-来源表」；`Task.codeRefs` 随草单保存。
- 流水线：`hs.query` 改为真实查询（HS 2000 表 + CIQ 表 + 计量单位），`draft.validate` 输出 code_refs / unmatched_codes。
- 工作区新增「编码参考」卡片（可折叠、命中统计、来源表），供报关系统对接参考。
- 实测样例票：151 条编码全部命中，覆盖 15 张表（计量单位 42、国别 16、HS 14、CIQ 14、币制 14、境内货源地 14、行政区划 14、征免方式 14、包装 3、关区/口岸/运输/监管/征免/成交各 1）。

## 2026-10-20 追加 · 任务中心字段调整

- 明确持久化：任务（含草单、codeRefs、消息、事件）写入 `data/db.json`，任务中心读取 `/api/bootstrap` 的 `TaskSummary`；导出文件在 `data/exports`。
- `TaskSummary` 新增：total / filled / materialCount / missingDocs / codeTotal / codeUnmatched。
- 任务中心表格列调整为：任务/客户、状态（含步骤与版本）、制单进度（已回填/总字段 + 进度条 + 待补充/待确认）、商品/资料（项数、份数、缺件类型）、编码字典（总条数、命中/未命中）、负责人、最近活动、操作。
- 启动时 `backfillCodeRefs()` 为已有草单补齐编码参考，种子任务 001 补齐 151 条、其余 41 条。

## 2026-10-21 决策 · 暂不改为进程内 runtime（B）

- 现状：每票任务通过 `@deepseek-ai/dsh-sdk-client` 启动一个 DSH 运行时子进程，session 隔离。
- 目标：改为进程内单例 runtime + 每票一个 ConversationInstance 对象，互不影响、无子进程。
- 阻塞：DSH 未公开 in-process runtime API；`packages/session`、`packages/llm`、`packages/skill` 均为 cordis 插件，需自行装配整棵插件树，无稳定契约。
- 决策：等 DSH 提供正式 in-process runtime API 再迁移；当前保留 SDK 子进程方案，并保留停止闭环、启动自愈、每票独立 session。
- 迁移条件：DSH 暴露 createRuntime/createConversation 级别 API（或 SDK 支持自定义 transport）后，替换 `lib/dsh/runner.mjs` 与 `agent.ts` 即可，业务侧接口不变。
