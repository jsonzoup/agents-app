import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { Cell, Db, Draft, Material, Message, PendingUpload, Task } from "./types";
import { DATA_DIR, UPLOAD_DIR, nowIso, readDb, uid, updateDb, writeDb } from "./db";
import { agentReply, applyAsk, attachAsk, updateCell } from "./agent";
import { adoptConsignee, counts, findCell, recomputeStatus, taskSummary } from "./status";
import { modelSelection } from "./dsh/route";
import { startTaskSession } from "./session-turn";
import { sessionLogPath, sessionRecentlyActive, stopFollowing } from "./dsh/follow";
import { clearDsh, stopDsh } from "./dsh/agent";


const TYPE_RULES: Array<[string, string[]]> = [
  ["报关委托书", ["委托", "entrust", "授权", "power of attorney"]],
  ["提运单", ["提单", "提运单", "运单", "waybill", "awb", "bill of lading", "billoflading", "b l", "b/l"]],
  ["装箱单", ["箱单", "装箱", "packing list", "packing", "p l"]],
  ["商业发票", ["发票", "invoice", "in+pl", "inv pl", "in pl"]],
  ["合同", ["合同", "contract", "sales contract"]],
  ["原产地证", ["原产地", "产地证", "form e", "certificate of origin"]],
  ["申报要素", ["申报要素", "要素", "declaration elements"]],
];

const CORE_TYPES = ["合同", "商业发票", "装箱单", "提运单"];
const EXT_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX · 可解析正文",
  doc: "DOC · 旧版二进制，无法解析，请另存为 docx",
  ppt: "PPT · 旧版二进制，无法解析，请另存为 pptx",
  pptx: "PPTX · 可解析",
  xlsx: "XLSX · 可解析工作表",
  xls: "XLS · 建议转 xlsx 后解析",
  xlsm: "XLSM · 可解析工作表",
  csv: "CSV · 可解析",
  jpg: "图片 · 需多模态阅读",
  jpeg: "图片 · 需多模态阅读",
  png: "图片 · 需多模态阅读",
  webp: "图片 · 需多模态阅读",
  txt: "文本 · 可解析",
};

export function detectType(filename: string): { type: string; confidence: "high" | "medium" | "low" } {
  const name = filename.toLowerCase().replace(/[_.\-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/(^| )bl( |$)/.test(name)) return { type: "提运单", confidence: "medium" };
  for (const [label, keys] of TYPE_RULES) {
    if (keys.some((key) => name.includes(key))) {
      const medium = label === "原产地证" || label === "申报要素" || /in\+?pl/.test(name);
      return { type: label, confidence: medium ? "medium" : "high" };
    }
  }
  return { type: "", confidence: "low" };
}

export function missingCoreTypes(task: Task): string[] {
  const have = new Set(task.materials.map((material) => material.type));
  return CORE_TYPES.filter((type) => !have.has(type));
}

export function inspectMaterials(task: Task) {
  const unreadable: string[] = [];
  const lines = task.materials.map((material) => {
    const ext = material.name.split(".").pop()?.toLowerCase() ?? "";
    const note = EXT_LABEL[ext] ?? "未知格式";
    if (ext === "doc" || ext === "ppt") unreadable.push(material.name);
    const hints: string[] = [];
    if (/in\+?pl|invoice.*pack/i.test(material.name)) hints.push("疑似发票+箱单合并件，建议拆分上传");
    if (/校对|proof/i.test(material.name)) hints.push("校对稿，非申报单证");
    if (/到通|arrival/i.test(material.name)) hints.push("到货通知，非核心单证");
    if (/运费|freight/i.test(material.name)) hints.push("运费证明，非核心单证");
    return `${material.name} | ${material.type || "未识别"} | ${note}${hints.length ? ` | ${hints.join("；")}` : ""}`;
  });
  return { lines, unreadable, missing: missingCoreTypes(task) };
}

export async function pageCount(file: string): Promise<number> {
  if (!file.toLowerCase().endsWith(".pdf")) return 1;
  try {
    const bytes = await fs.readFile(file);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return 1;
  }
}

export const humanSize = (size: number) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

function summaryOf(pending: PendingUpload) {
  return { ...pending, sizeLabel: humanSize(pending.size) };
}

export async function uploadFile(name: string, data: Buffer) {
  const safeName = path.basename(name);
  const id = uid("up");
  const dir = path.join(UPLOAD_DIR, "_pending", id);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, safeName);
  await fs.writeFile(target, data);
  const guess = detectType(safeName);
  const record: PendingUpload = {
    id,
    name: safeName,
    size: data.length,
    pages: await pageCount(target),
    type: guess.type,
    typeGuess: guess.type,
    confidence: guess.confidence,
    at: nowIso(),
  };
  return updateDb((db) => {
    db.pending.push(record);
    return summaryOf(record);
  });
}

export async function createTask(input: {
  uploadIds: string[];
  customer?: string;
  name?: string;
  owner?: string;
  prompt?: string;
  method?: string;
  types?: Record<string, string>;
  model?: string;
}): Promise<Task> {
  return updateDb(async (db) => {
    const selected = db.pending.filter((item) => input.uploadIds.includes(item.id));
    if (selected.length === 0) throw new Error("请先上传资料");
    db.seq += 1;
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const id = `BG-${stamp}-${String(db.seq).padStart(3, "0")}`;
    const dir = path.join(UPLOAD_DIR, id);
    await fs.mkdir(dir, { recursive: true });
    const materials: Material[] = [];
    for (const upload of selected) {
      const source = path.join(UPLOAD_DIR, "_pending", upload.id, upload.name);
      await fs.copyFile(source, path.join(dir, upload.name));
      materials.push({
        id: upload.id,
        name: upload.name,
        type: input.types?.[upload.id] || upload.type || upload.typeGuess,
        size: upload.size,
        sizeLabel: humanSize(upload.size),
        pages: upload.pages,
      });
    }
    const task: Task = {
      id,
      title: `${input.customer || "待识别客户"} · ${input.name || "进口制单"}`,
      customer: input.customer || "待识别客户",
      name: input.name || "进口制单",
      owner: input.owner || "林岚",
      status: "处理中",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      version: 1,
      sessionId: id,
      materials,
      prompt: input.prompt ?? "",
      method: input.method ?? "智能制单",
      ...(input.model ? { model: modelSelection(input.model) } : {}),
      progress: { stage: 0, pct: 1, text: "正在打开本票会话" },
      draft: null,
      messages: [],
      events: [],
    };
    db.tasks.push(task);
    const used = new Set(selected.map((item) => item.id));
    db.pending = db.pending.filter((item) => !used.has(item.id));
    return task;
  });
}


export async function recoverStuckTasks(): Promise<void> {
  await updateDb((db) => {
    for (const task of db.tasks) {
      if (task.status !== "处理中") continue;
      if (sessionRecentlyActive(task.id)) continue;
      task.status = "待补充";
      task.progress = { stage: 100, pct: 100, text: "执行中断" };
      task.messages.push({
        id: uid("m"),
        role: "agent",
        kind: "text",
        text: "上次执行因服务重启中断，未写入任何数据；请点「重新解析」重试。",
        at: nowIso(),
      });
      task.updatedAt = nowIso();
    }
  });
}

export async function rerunTask(taskId: string): Promise<Task> {
  const task = await updateDb((db) => {
    const item = db.tasks.find((entry) => entry.id === taskId);
    if (!item) throw new Error("任务不存在");
    item.progress = { stage: 0, pct: 1, text: "正在同一会话里重新执行技能" };
    item.status = "处理中";
    for (const material of item.materials) {
      if (!material.type) {
        const detected = detectType(material.name);
        if (detected.type) material.type = detected.type;
      }
    }
    item.updatedAt = nowIso();
    return item;
  });
  startPipeline(taskId);
  return task;
}

export function startPipeline(taskId: string): void {
  startTaskSession(taskId);
}

export async function setTaskModel(taskId: string, model: string): Promise<void> {
  const selection = modelSelection(model);
  await updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (task) task.model = selection;
  });
}

export async function clearTaskSession(taskId: string): Promise<Task | null> {
  await updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.sessionEpoch = (task.sessionEpoch ?? 0) + 1;
  });
  stopFollowing(taskId);
  stopDsh(taskId);
  stopDsh(`extract:${taskId}`);
  await clearDsh(taskId);
  await fs.rm(path.dirname(sessionLogPath(taskId)), { recursive: true, force: true }).catch(() => undefined);
  return updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    task.messages = [];
    task.context = undefined;
    if (task.status === "处理中") {
      task.status = "待补充";
      task.progress = { stage: 100, pct: 100, text: "会话已清空" };
    }
    task.updatedAt = nowIso();
    return task;
  });
}

export async function stopTask(taskId: string): Promise<void> {
  await updateDb((db) => {
    const task = db.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.status === "处理中") {
      task.status = "待补充";
      task.progress = { stage: 100, pct: 100, text: "已停止" };
      task.messages.push({ id: uid("m"), role: "agent", kind: "text", text: "已停止本次执行，未写入数据；可点「重新解析」重试。", at: nowIso() });
      task.updatedAt = nowIso();
    }
  });
}

export async function listState() {
  const peek = await readDb();
  const stale = peek.tasks.some((task) => {
    const company = task.draft?.header["境内收发货人-企业名称"]?.value?.trim() ?? "";
    const current = task.customer.trim();
    return Boolean(company) && company !== task.customer && (current === "" || current === "待识别客户" || current === "未识别客户");
  });
  const db = stale
    ? await updateDb((current) => {
        for (const task of current.tasks) adoptConsignee(task);
        return current;
      })
    : peek;
  const tasks = [...db.tasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return {
    tasks: tasks.map(taskSummary),
    sessions: tasks.slice(0, 8).map((task) => ({
      ...taskSummary(task),
      lastText: [...task.messages].reverse().find((m) => m.kind === "text")?.text ?? "",
    })),
    metrics: {
      all: tasks.length,
      todo: tasks.filter((t) => ["待补充", "待确认", "待复核"].includes(t.status)).length,
      deliverable: tasks.filter((t) => t.status === "可交付").length,
      delivered: tasks.filter((t) => t.status === "已交付").length,
    },
  };
}

export async function chat(taskId: string, text: string, selected?: string | null, actor = "林岚") {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("任务不存在");
    const userMessage: Message = { id: uid("m"), role: "user", kind: "text", text, at: nowIso(), by: actor };
    task.messages.push(userMessage);
    const replies = agentReply(task, text, selected);
    task.messages.push(...replies);
    task.updatedAt = nowIso();
    return { task, replies };
  });
}

export async function changeField(taskId: string, cellPath: string, value: string, actor = "林岚") {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("任务不存在");
    const cell = updateCell(task, cellPath, value, { actor });
    if (!cell) throw new Error("字段不存在");
    return { task, cell };
  });
}

export async function confirmField(taskId: string, cellPath: string, actor = "林岚") {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("任务不存在");
    const cell = findCell(task, cellPath);
    if (!cell) throw new Error("字段不存在");
    if (!cell.value) throw new Error("空值不能确认");
    cell.state = "normal";
    cell.confidence = 100;
    cell.history = [...(cell.history ?? []), { by: actor, at: nowIso(), before: cell.value, after: cell.value }];
    task.events.push({ at: nowIso(), type: "field_confirm", path: cellPath, actor });
    task.version += 1;
    task.updatedAt = nowIso();
    recomputeStatus(task);
    return { task, cell };
  });
}

export async function answerAsk(taskId: string, askId: string, answers: Record<string, string>) {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("任务不存在");
    const note = applyAsk(task, answers);
    task.messages.push({
      id: uid("m"),
      role: "agent",
      kind: "text",
      text: note || "已记录你的选择。",
      at: nowIso(),
    });
    task.events.push({ at: nowIso(), type: "ask_answer", askId, answers, actor: "林岚" });
    task.updatedAt = nowIso();
    return task;
  });
}

export async function reviewTask(taskId: string, action: "pass" | "return") {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("任务不存在");
    if (task.status !== "待复核") throw new Error("仅待复核任务可执行复核动作");
    task.status = action === "pass" ? "可交付" : "处理中";
    task.updatedAt = nowIso();
    task.events.push({ at: nowIso(), type: "review", action, actor: "陈宁" });
    return task;
  });
}

export async function markDelivered(taskId: string) {
  return updateDb((db) => {
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === "可交付") {
      task.status = "已交付";
      task.deliveredAt = nowIso();
    }
    task.updatedAt = nowIso();
    task.events.push({ at: nowIso(), type: "export", actor: "林岚" });
  });
}

export async function deleteTask(taskId: string) {
  return updateDb((db) => {
    db.tasks = db.tasks.filter((t) => t.id !== taskId);
  });
}

export async function findMaterial(taskId: string, docId: string) {
  const db = await readDb();
  const task = db.tasks.find((t) => t.id === taskId);
  return task?.materials.find((m) => m.id === docId);
}

/** 会话工作区里的相对路径，限制在本票 run 目录内。cwd 是 docs。 */
export async function workspaceFile(taskId: string, rawPath: string): Promise<string | null> {
  if (!taskId || !rawPath || rawPath.includes("\0")) return null;
  const root = path.resolve(DATA_DIR, "runs", taskId);
  const target = path.resolve(root, "docs", rawPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const stat = await fs.stat(target);
    return stat.isFile() ? target : null;
  } catch {
    return null;
  }
}

export async function materialFile(taskId: string, docId: string): Promise<string | null> {
  const material = await findMaterial(taskId, docId);
  if (!material) return null;
  const uploaded = path.join(UPLOAD_DIR, taskId, material.name);
  try {
    await fs.access(uploaded);
    return uploaded;
  } catch {
    return null;
  }
}

export function statuses() {
  return ["待补充", "待确认", "待复核", "处理中", "可交付", "已交付"];
}



