/**
 * Harness 适配层：对话就是这一票的 DSH 会话。业务读写只走 MCP。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, uid, updateDb } from "./db";
import { runDshStream } from "./dsh/agent";
import { modelSelection } from "./dsh/route";
import { recordTurnEvent } from "./transcript";
import type { Client } from "@modelcontextprotocol/client";
import { callTool, withBusinessMcp } from "./mcp/client";
import type { TurnEvent } from "./transcript";
import type { Message, Task } from "./types";

function followUpPrompt(task: Task, text: string): string {
  return `任务 ${task.id}。改字段、读资料、回写草单请使用 mcp__business__*。需要重跑提取时，消息里保留 /customs-extraction。回复最后用一段话说明这次做了什么、草单现在怎样、还要复核什么。\n\n${text}`;
}

async function ingestAnswer(client: Client, taskId: string, cwd: string) {
  const file = path.join(cwd, "answer.json");
  try {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    if (payload && typeof payload === "object") await callTool(client, "draft_commit", { taskId, result: payload });
  } catch {
    /* 技能未必把 answer.json 写在工作目录根上；会话内的 draft_commit 已经回写 */
  }
}

export async function harnessChat(
  origin: string,
  taskId: string,
  text: string,
  _selected?: string | null,
  actor = "林岚",
  onEvent?: (event: TurnEvent) => void,
  model?: string,
): Promise<Task> {
  return withBusinessMcp(origin, async (client) => {
    const before = await callTool<Task>(client, "task_snapshot", { taskId });
    const epoch = before.sessionEpoch ?? 0;
    const ids = new Map<string, string>();
    const stack: string[] = [];
    let finalText = "";
    const userMessage: Message = { id: uid("m"), role: "user", kind: "text", text, at: nowIso(), by: actor };
    await callTool(client, "messages_append", { taskId, message: { ...userMessage, epoch } });
    const runDir = path.join(process.cwd(), "data", "runs", taskId, "docs");
    const cwd = await fs.access(runDir).then(() => runDir).catch(() => process.cwd());
    let sessionId = before.dshSessionId;
    const selection = model ? modelSelection(model) : before.model;
    if (selection && selection !== before.model) {
      await updateDb((db) => {
        const live = db.tasks.find((item) => item.id === taskId);
        if (live && (live.sessionEpoch ?? 0) === epoch) live.model = selection;
      });
    }
    try {
      const result = await runDshStream(
        followUpPrompt(before, text),
        cwd,
        before.dshSessionId,
        taskId,
        (event) => {
          onEvent?.(event);
          if (event.kind === "context" || event.kind === "usage" || event.kind === "compaction" || event.context) {
            void updateDb((db) => {
              const live = db.tasks.find((item) => item.id === taskId);
              if (!live || (live.sessionEpoch ?? 0) !== epoch) return;
              recordTurnEvent(live, event.kind === "assistant/message" && event.context ? { ...event, kind: "usage", text: "" } : event, ids, stack);
            }).catch(() => undefined);
          }
          if (event.kind === "tool/call") {
            const messageId = uid("m");
            ids.set(event.id || event.name, messageId);
            stack.push(messageId);
            void callTool(client, "messages_append", {
              taskId,
              message: { id: messageId, role: "agent", kind: "tool", text: "", at: nowIso(), epoch, tool: { name: event.name || "tool", title: event.name || "工具", status: "running", args: event.args } },
            }).catch(() => undefined);
            return;
          }
          if (event.kind === "tool/result") {
            const messageId = (event.id && ids.get(event.id)) || stack.pop();
            if (!messageId) return;
            void callTool(client, "messages_update", {
              taskId,
              messageId,
              patch: { tool: { name: event.name || "tool", title: event.name || "工具", status: event.isError ? "error" : "done", output: event.text || "（无输出）" } },
            }).catch(() => undefined);
            return;
          }
          if ((event.kind === "assistant/message" || event.kind === "reasoning") && event.text.trim()) {
            finalText = event.text.trim();
          }
        },
        1_200_000,
        selection,
      );
      sessionId = result.sessionId || sessionId;
      const reply = (result.text || finalText).trim();
      await callTool(client, "messages_append", {
        taskId,
        message: { id: uid("m"), role: "agent", kind: "text", text: reply || "（本轮没有文本回复）", at: nowIso(), epoch },
      });
    } catch (error) {
      await callTool(client, "messages_append", {
        taskId,
        message: { id: uid("m"), role: "agent", kind: "text", text: `会话调用失败：${(error as Error).message}`, at: nowIso(), epoch },
      });
    }
    if (sessionId) await callTool(client, "task_set_session", { taskId, sessionId });
    await ingestAnswer(client, taskId, cwd);
    await callTool(client, "events_append", { taskId, type: "harness.chat", payload: { text, sessionId } });
    return callTool<Task>(client, "task_snapshot", { taskId });
  });
}

export async function harnessAnswer(
  origin: string,
  taskId: string,
  askId: string,
  answers: Record<string, string>,
): Promise<Task> {
  return withBusinessMcp(origin, async (client) => {
    const result = await callTool<{ note?: string }>(client, "draft_apply_answers", { taskId, askId, answers });
    if (result.note) {
      await callTool(client, "messages_append", {
        taskId,
        message: { id: uid("m"), role: "agent", kind: "text", text: result.note, at: nowIso() },
      });
    }
    await callTool(client, "events_append", { taskId, type: "harness.ask_answered", payload: { askId } });
    return callTool<Task>(client, "task_snapshot", { taskId });
  });
}

export async function harnessSkill(origin: string) {
  return withBusinessMcp(origin, (client) => callTool(client, "skill_info"));
}
