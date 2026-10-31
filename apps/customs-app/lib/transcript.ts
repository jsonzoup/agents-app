import { nowIso, uid } from "./db";
import type { CompactionView, SessionContext, Task } from "./types";

export type TurnEvent = {
  kind: string;
  text: string;
  name: string;
  id?: string;
  args?: string;
  isError?: boolean;
  context?: Partial<SessionContext> & { imageOffloadDelta?: number };
  compaction?: CompactionView;
};

function mergeContext(task: Task, patch: NonNullable<TurnEvent["context"]>): void {
  const { imageOffloadDelta, ...rest } = patch;
  const prev = task.context ?? {};
  const defined = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
  task.context = {
    ...prev,
    ...defined,
    imageOffloads: (prev.imageOffloads ?? 0) + (imageOffloadDelta ?? 0),
    updatedAt: nowIso(),
  };
}

/** 把 DSH 会话事件按到达顺序写进任务转录。助手正文按快照覆盖，不另起一条。 */
export function recordTurnEvent(task: Task, event: TurnEvent, ids: Map<string, string>, stack: string[]): void {
  task.updatedAt = nowIso();
  if (event.context) mergeContext(task, event.context);
  if (event.kind === "compaction" && event.compaction) {
    const info = event.compaction;
    const messageId = info.mode === "prune" ? `cmp-prune-${info.id}` : `cmp-${info.id}`;
    let target = task.messages.find((message) => message.id === messageId);
    if (!target) {
      target = { id: messageId, role: "agent", kind: "compaction", text: "", at: nowIso(), compaction: { ...info } };
      task.messages.push(target);
    }
    const current = target.compaction ?? info;
    target.compaction = {
      ...current,
      ...Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined)),
    };
    return;
  }
  if (event.kind === "goal" && event.text) {
    task.messages.push({ id: uid("m"), role: "agent", kind: "text", text: event.text, at: nowIso() });
    return;
  }
  if (event.kind === "context" || event.kind === "usage") return;
  if (event.kind === "tool/call") {
    const id = uid("m");
    if (event.id) ids.set(event.id, id);
    stack.push(id);
    task.messages.push({
      id,
      role: "agent",
      kind: "tool",
      text: "",
      at: nowIso(),
      tool: { name: event.name || "tool", title: event.name || "工具", status: "running", args: event.args },
    });
    return;
  }
  if (event.kind === "tool/result") {
    const id = (event.id && ids.get(event.id)) || stack.pop();
    const target = (id && task.messages.find((message) => message.id === id))
      || [...task.messages].reverse().find((message) => message.tool?.status === "running");
    if (target?.tool) {
      target.tool.status = event.isError ? "error" : "done";
      target.tool.output = event.text || "（无输出）";
      if (event.name) target.tool.name = event.name;
    }
    return;
  }
  if (event.kind !== "assistant/message" && event.kind !== "reasoning") return;
  const text = event.text?.trim();
  if (!text) return;
  const last = task.messages[task.messages.length - 1];
  if (last?.kind === "text" && last.role === "agent" && (text === last.text || text.startsWith(last.text) || last.text.startsWith(text))) {
    if (text.length >= last.text.length) last.text = text;
    return;
  }
  task.messages.push({ id: uid("m"), role: "agent", kind: "text", text, at: nowIso() });
}
