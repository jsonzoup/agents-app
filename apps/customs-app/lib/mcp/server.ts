import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as business from "../business";
import { MCP_SERVER } from "./meta";
import type { Message } from "../types";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
});

const wrap = <T>(fn: () => Promise<T>) => fn().then(ok).catch(fail);

export function createBusinessMcpServer(): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER.name, version: MCP_SERVER.version, description: MCP_SERVER.description },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    "task_snapshot",
    { title: "任务快照", description: MCP_SERVER.tools[0].description, inputSchema: { taskId: z.string() } },
    ({ taskId }) => wrap(() => business.snapshot(taskId)),
  );
  server.registerTool(
    "task_summary",
    { title: "任务摘要", description: MCP_SERVER.tools[1].description, inputSchema: { taskId: z.string() } },
    ({ taskId }) => wrap(() => business.summary(taskId)),
  );
  server.registerTool(
    "draft_get_field",
    { title: "读取字段", description: MCP_SERVER.tools[2].description, inputSchema: { taskId: z.string(), path: z.string() } },
    ({ taskId, path }) => wrap(() => business.getField(taskId, path)),
  );
  server.registerTool(
    "draft_set_field",
    {
      title: "写入字段",
      description: MCP_SERVER.tools[3].description,
      inputSchema: {
        taskId: z.string(),
        path: z.string(),
        value: z.string(),
        actor: z.string().optional(),
        state: z.enum(["normal", "low", "missing", "edited"]).optional(),
      },
    },
    ({ taskId, path, value, actor, state }) => wrap(() => business.setField(taskId, path, value, actor, state)),
  );
  server.registerTool(
    "draft_confirm_field",
    {
      title: "确认字段",
      description: MCP_SERVER.tools[4].description,
      inputSchema: { taskId: z.string(), path: z.string(), actor: z.string().optional() },
    },
    ({ taskId, path, actor }) => wrap(() => business.confirmField(taskId, path, actor)),
  );
  server.registerTool(
    "draft_apply_answers",
    {
      title: "提交确认答案",
      description: MCP_SERVER.tools[5].description,
      inputSchema: { taskId: z.string(), askId: z.string(), answers: z.record(z.string(), z.string()) },
    },
    ({ taskId, askId, answers }) => wrap(() => business.applyAnswers(taskId, askId, answers)),
  );
  server.registerTool(
    "materials_list",
    { title: "资料清单", description: MCP_SERVER.tools[6].description, inputSchema: { taskId: z.string() } },
    ({ taskId }) => wrap(() => business.materials(taskId)),
  );
  server.registerTool(
    "task_set_session",
    { title: "绑定对话会话", description: "记录任务对应的对话 sessionId", inputSchema: { taskId: z.string(), sessionId: z.string() } },
    ({ taskId, sessionId }) => wrap(() => business.setDshSession(taskId, sessionId)),
  );
  server.registerTool(
    "messages_append",
    {
      title: "追加消息",
      description: MCP_SERVER.tools[7].description,
      inputSchema: { taskId: z.string(), message: z.record(z.string(), z.unknown()) },
    },
    ({ taskId, message }) => wrap(() => business.appendMessage(taskId, message as unknown as Message)),
  );
  server.registerTool(
    "messages_update",
    { title: "更新消息", description: "更新工具消息状态与输出", inputSchema: { taskId: z.string(), messageId: z.string(), patch: z.record(z.string(), z.unknown()) } },
    ({ taskId, messageId, patch }) => wrap(() => business.updateMessage(taskId, messageId, patch)),
  );
  server.registerTool(
    "events_poll",
    {
      title: "拉取事件",
      description: MCP_SERVER.tools[8].description,
      inputSchema: { taskId: z.string(), after: z.number().int().min(0).optional() },
    },
    ({ taskId, after }) => wrap(() => business.pollEvents(taskId, after)),
  );
  server.registerTool(
    "events_append",
    {
      title: "追加事件",
      description: MCP_SERVER.tools[9].description,
      inputSchema: { taskId: z.string(), type: z.string(), payload: z.record(z.string(), z.unknown()).optional() },
    },
    ({ taskId, type, payload }) => wrap(() => business.appendEvent(taskId, type, payload)),
  );
  server.registerTool(
    "skill_info",
    { title: "技能信息", description: MCP_SERVER.tools[11].description, inputSchema: {} },
    () => wrap(() => business.skillInfo()),
  );
  server.registerTool(
    "draft_commit",
    {
      title: "回写草单",
      description: "把 customs-extraction 的最终 JSON 写入工作台草单",
      inputSchema: { taskId: z.string(), result: z.record(z.string(), z.unknown()) },
    },
    ({ taskId, result }) => wrap(() => business.commitResult(taskId, result)),
  );

  server.registerResource(
    "skill",
    "skill://customs-extraction",
    { title: "customs-extraction skill", description: "规则、码表与能力清单", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, text: JSON.stringify(await business.skillInfo()) }] }),
  );

  return server;
}
