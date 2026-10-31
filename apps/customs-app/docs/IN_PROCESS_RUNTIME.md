# DSH 对象级接入（A 方案）

目标：报关灵进程内直接持有 DSH 运行时对象；每票一个 Conversation 对象；不启子进程、不做消息二次建模。

## DSH 侧新增 API（packages/sdk 或 boot）

```ts
const runtime = await createRuntime({ profile: "sdk", cwd, skills, tools, systemPrompt })
const conversation = await runtime.createConversation({ id: taskId, sessionId?: string })
conversation.on("event", (event) => { /* 原生事件：assistant/tool/reasoning/status */ })
await conversation.prompt(text)
await conversation.abort()
conversation.sessionId
```

- 一个 runtime 内多 conversation，session 隔离；
- 事件为 DSH 原生事件，前端 1:1 渲染；
- 停止 = abort 对象，不杀进程。

## 报关灵侧

- lib/dsh/runtime.ts：单例 runtime；
- lib/dsh/instances.ts：Map<taskId, conversation>；
- 任务创建时准备资料目录、MCP 工具、系统提示词（智能报关员 + customs-extraction skill）；
- 前端直连 conversation 事件流（SSE），刷新按 sessionId 重放；
- 删除 runner.mjs / 子进程 / 自建消息拼装。
