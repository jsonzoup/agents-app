/** 业务域服务：只有这里可以读写草单/任务数据，Harness 通过 MCP 调用这些能力。 */
import { readDb, updateDb, nowIso, uid } from "./db";
import { adoptConsignee, counts, findCell, recomputeStatus, taskSummary } from "./status";
import { applyAsk } from "./agent";
import { loadSkillInfo } from "./skill";
import { buildCodeRefs } from "./code-refs";
import { draftFromResult } from "./draft-commit";
import type { Message, Task } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function find(taskId: string): Promise<Task> {
  const db = await readDb();
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("任务不存在");
  return task;
}

export async function snapshot(taskId: string): Promise<Task> {
  return clone(await find(taskId));
}

export async function summary(taskId: string) {
  const task = await find(taskId);
  return { ...taskSummary(task), counts: counts(task.draft), progress: task.progress };
}

export async function materials(taskId: string) {
  const task = await find(taskId);
  return task.materials;
}

export async function getField(taskId: string, path: string) {
  const task = await find(taskId);
  const cell = findCell(task, path);
  if (!cell) throw new Error("字段不存在");
  return { path, cell };
}

export async function setField(taskId: string, path: string, value: string, actor = "林岚", state?: string) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const cell = findCell(task, path);
    if (!cell) throw new Error("字段不存在");
    const before = cell.value;
    cell.value = value;
    if (before !== value) {
      cell.history = [...(cell.history ?? []), { by: actor, at: nowIso(), before, after: value }];
      task.events.push({ seq: task.events.length + 1, at: nowIso(), type: "field.updated", path, before, after: value, actor });
      task.version += 1;
    }
    cell.state = (state as typeof cell.state) ?? (value ? "edited" : "missing");
    cell.confidence = value ? 100 : 0;
    if (path === "header|境内收发货人-企业名称") adoptConsignee(task);
    task.updatedAt = nowIso();
    recomputeStatus(task);
    return { cell, status: task.status, version: task.version };
  });
}

export async function confirmField(taskId: string, path: string, actor = "林岚") {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const cell = findCell(task, path);
    if (!cell) throw new Error("字段不存在");
    if (!cell.value) throw new Error("空值不能确认");
    cell.state = "normal";
    cell.confidence = 100;
    cell.history = [...(cell.history ?? []), { by: actor, at: nowIso(), before: cell.value, after: cell.value }];
    task.events.push({ seq: task.events.length + 1, at: nowIso(), type: "field.confirmed", path, actor });
    task.version += 1;
    task.updatedAt = nowIso();
    recomputeStatus(task);
    return { cell, status: task.status, version: task.version };
  });
}

export async function applyAnswers(taskId: string, askId: string, answers: Record<string, string>) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const note = applyAsk(task, answers);
    task.events.push({ seq: task.events.length + 1, at: nowIso(), type: "ask.answered", askId, answers, actor: "林岚" });
    task.updatedAt = nowIso();
    return { note, status: task.status };
  });
}

export async function appendMessage(taskId: string, message: Message & { epoch?: number }) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const epoch = message.epoch;
    const { epoch: _epoch, ...clean } = message;
    if (epoch !== undefined && (task.sessionEpoch ?? 0) !== epoch) return { count: task.messages.length, skipped: true };
    const exists = clean.id && task.messages.some((item) => item.id === clean.id);
    if (!exists) task.messages.push({ ...clean, id: clean.id || uid("m") });
    task.updatedAt = nowIso();
    return { count: task.messages.length };
  });
}

export async function setDshSession(taskId: string, dshSessionId: string) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    task.dshSessionId = dshSessionId;
    return { dshSessionId };
  });
}

export async function updateMessage(taskId: string, messageId: string, patch: Record<string, unknown>) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const message = task.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("消息不存在");
    Object.assign(message, patch);
    return { ok: true };
  });
}

export async function pollEvents(taskId: string, after = 0) {
  const task = await find(taskId);
  return { cursor: task.events.length, events: task.events.slice(Math.max(0, after)) };
}

export async function appendEvent(taskId: string, type: string, payload: Record<string, unknown> = {}) {
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    const event = { seq: task.events.length + 1, at: nowIso(), type, ...payload };
    task.events.push(event);
    return event;
  });
}

export async function skillInfo() {
  return loadSkillInfo();
}

const CODED_HEADER = ["进境关别", "申报地海关", "运输方式", "监管方式", "征免性质", "成交方式", "贸易国别（地区）", "启运国（地区）", "启运港", "经停港", "入境口岸", "包装种类", "其他包装（额外包装种类）"];

/** 已回写的草单补上栏位编码。已有的不重复查表。 */
export async function ensureFormCodes(task: Task): Promise<Task> {
  if (!task.draft) return task;
  const headerMissing = CODED_HEADER.some((field) => {
    const value = task.draft?.header[field]?.value?.trim();
    if (!value) return false;
    return !(task.codeRefs ?? []).some((item) => item.path === `header|${field}` && item.matched);
  });
  const rowMissing = (task.draft.rows ?? []).some((row, index) => {
    const value = row["最终目的国（地区）"]?.value?.trim();
    if (!value) return false;
    return !(task.codeRefs ?? []).some((item) => item.path === `row|${index + 1}|最终目的国（地区）` && item.matched);
  });
  const named = adoptConsignee(task);
  const missing = headerMissing || rowMissing;
  if (!missing && !named) return task;
  const codeRefs = missing ? await buildCodeRefs(task) : task.codeRefs;
  await updateDb((db) => {
    const live = db.tasks.find((item) => item.id === task.id);
    if (!live) return;
    adoptConsignee(live);
    if (missing && codeRefs) live.codeRefs = codeRefs;
  });
  return { ...task, codeRefs };
}

/** Harness 把技能最终 JSON 交回业务层，工作台只读这份草单。 */
export async function commitResult(taskId: string, result: unknown): Promise<Task> {
  const payload = result && typeof result === "object" ? result as Record<string, unknown> : null;
  if (!payload) throw new Error("草单结果必须是 JSON 对象");
  const task = await find(taskId);
  const draft = draftFromResult(payload, task.materials);
  return updateDb(async (db) => {
    const live = db.tasks.find((item) => item.id === taskId);
    if (!live) throw new Error("任务不存在");
    live.draft = draft;
    adoptConsignee(live);
    live.codeRefs = await buildCodeRefs(live);
    live.version += 1;
    live.progress = { stage: 100, pct: 100, text: "草单已回写" };
    live.events.push({ seq: live.events.length + 1, at: nowIso(), type: "draft.ready", rows: draft.rows.length, version: live.version });
    live.updatedAt = nowIso();
    if (live.status === "处理中") live.status = "待补充";
    recomputeStatus(live);
    return clone(live);
  });
}
