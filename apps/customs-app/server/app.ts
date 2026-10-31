import { Hono } from "hono";
import { promises as fs } from "node:fs";
import path from "node:path";
import { EXPORT_DIR, ensureDirs, getTask, readDb } from "@/lib/db";
import { ensureFormCodes } from "@/lib/business";
import { buildDraftWorkbook } from "@/lib/export";
import { loadSkillInfo } from "@/lib/skill";
import { harnessAnswer, harnessChat } from "@/lib/harness";
import { listDshModels, stopDsh } from "@/lib/dsh/agent";
import { catchUpTaskSession } from "@/lib/dsh/follow";
import { hydrateSessionView } from "@/lib/dsh/session-view";
import { MCP_SERVER } from "@/lib/mcp/meta";
import { buildPreview } from "@/lib/preview";
import {
  changeField,
  confirmField,
  createTask,
  deleteTask,
  listState,
  markDelivered,
  materialFile,
  workspaceFile,
  reviewTask,
  startPipeline,
  rerunTask,
  recoverStuckTasks,
  clearTaskSession,
  stopTask,
  setTaskModel,
  statuses,
  uploadFile,
} from "@/lib/store";
import { backfillCodeRefs } from "@/lib/seed";
import { counts, stepName, taskSummary } from "@/lib/status";
import type { Task } from "@/lib/types";

export const app = new Hono().basePath("/api");
export const REQUIRED_TYPES = ["合同", "商业发票", "装箱单", "提运单", "报关委托书"];

let bootstrapped: Promise<void> | null = null;
async function boot() {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      await ensureDirs();
      await backfillCodeRefs();
      await recoverStuckTasks();
    })();
  }
  return bootstrapped;
}

app.use("*", async (c, next) => {
  await boot();
  await next();
});

app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err.message || "服务内部错误" }, 500);
});

const publicTask = (task: Task) => ({
  ...task,
  counts: counts(task.draft),
  step: stepName(task.status),
});

app.get("/skill", async (c) => {
  return c.json({ skill: await loadSkillInfo(), mcp: MCP_SERVER });
});

app.get("/models", async (c) => {
  return c.json({ groups: await listDshModels() });
});

app.get("/bootstrap", async (c) => {
  const state = await listState();
  return c.json({ ...state, requiredTypes: REQUIRED_TYPES, statuses: statuses() });
});

app.post("/tasks/:id/rerun", async (c) => {
  const body = await c.req.json().catch(() => ({} as { model?: string }));
  if (body.model) await setTaskModel(c.req.param("id"), body.model);
  const task = await rerunTask(c.req.param("id"));
  return c.json({ task: publicTask(task) });
});

app.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  let task = await getTask(id);
  if (!task) return c.json({ error: "任务不存在" }, 404);
  if (await hydrateSessionView(id)) task = (await getTask(id)) ?? task;
  if (await catchUpTaskSession(task)) task = (await getTask(id)) ?? task;
  task = await ensureFormCodes(task);
  return c.json({ task: publicTask(task) });
});

app.post("/tasks/:id/session/clear", async (c) => {
  const task = await clearTaskSession(c.req.param("id"));
  if (!task) return c.json({ error: "任务不存在" }, 404);
  return c.json({ task: publicTask(task) });
});

app.post("/upload", async (c) => {
  const body = await c.req.json<{ name?: string; data?: string }>();
  const name = String(body.name || "").trim();
  if (!name) return c.json({ error: "缺少文件名" }, 400);
  const base64 = String(body.data || "").replace(/^data:[^;]+;base64,/, "");
  if (!base64) return c.json({ error: "文件内容为空" }, 400);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 45 * 1024 * 1024) return c.json({ error: "单个文件不能超过 45MB" }, 413);
  const upload = await uploadFile(name, buffer);
  return c.json({ upload }, 201);
});


app.get("/pending", async (c) => {
  const db = await readDb();
  return c.json({ pending: db.pending });
});

app.post("/tasks", async (c) => {
  const body = await c.req.json<{
    uploadIds?: string[];
    customer?: string;
    name?: string;
    owner?: string;
    prompt?: string;
    method?: string;
    types?: Record<string, string>;
    model?: string;
  }>();
  const task = await createTask({
    uploadIds: body.uploadIds ?? [],
    customer: body.customer,
    name: body.name,
    owner: body.owner,
    prompt: body.prompt,
    method: body.method,
    types: body.types,
    model: body.model,
  });
  if (!task.draft) startPipeline(task.id);
  return c.json({ task: publicTask(task) }, 201);
});

app.post("/tasks/:id/chat", async (c) => {
  const body = await c.req.json<{ text?: string; selected?: string; actor?: string }>();
  const text = String(body.text || "").trim();
  if (!text) return c.json({ error: "消息不能为空" }, 400);
  // 业务域与 Harness 解耦：对话只走 MCP
  const task = await harnessChat(new URL(c.req.url).origin, c.req.param("id"), text, body.selected, body.actor);
  return c.json({ replies: [], task: publicTask(task) });
});

app.post("/tasks/:id/field", async (c) => {
  const body = await c.req.json<{ path?: string; value?: string; actor?: string }>();
  if (!body.path) return c.json({ error: "缺少字段路径" }, 400);
  const { task, cell } = await changeField(c.req.param("id"), body.path, String(body.value ?? ""), body.actor);
  return c.json({ cell, task: taskSummary(task) });
});

app.post("/tasks/:id/confirm", async (c) => {
  const body = await c.req.json<{ path?: string; actor?: string }>();
  if (!body.path) return c.json({ error: "缺少字段路径" }, 400);
  const { task, cell } = await confirmField(c.req.param("id"), body.path, body.actor);
  return c.json({ cell, task: taskSummary(task) });
});

app.post("/tasks/:id/chat/stop", async (c) => {
  stopDsh(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/tasks/:id/model", async (c) => {
  const body = await c.req.json<{ model?: string }>();
  await setTaskModel(c.req.param("id"), String(body.model || ""));
  return c.json({ ok: true });
});

app.post("/tasks/:id/stop", async (c) => {
  const id = c.req.param("id");
  stopDsh(id);
  stopDsh(`extract:${id}`);
  await stopTask(id);
  return c.json({ ok: true });
});

app.post("/tasks/:id/chat/stream", async (c) => {
  const body = await c.req.json<{ text?: string; selected?: string; actor?: string; model?: string }>();
  const text = String(body.text || "").trim();
  const taskId = c.req.param("id");
  if (!text) return c.json({ error: "消息不能为空" }, 400);
  const origin = new URL(c.req.url).origin;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
      try {
        const task = await harnessChat(origin, taskId, text, body.selected, body.actor, (event) => send({ type: "event", ...event }), body.model);
        send({ type: "done", task: publicTask(task) });
      } catch (error) {
        send({ type: "error", message: (error as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
});

app.post("/tasks/:id/ask", async (c) => {
  const body = await c.req.json<{ askId?: string; answers?: Record<string, string> }>();
  const task = await harnessAnswer(new URL(c.req.url).origin, c.req.param("id"), String(body.askId || ""), body.answers ?? {});
  return c.json({ task: publicTask(task) });
});

app.post("/tasks/:id/review", async (c) => {
  const body = await c.req.json<{ action?: "pass" | "return" }>();
  const task = await reviewTask(c.req.param("id"), body.action === "return" ? "return" : "pass");
  return c.json({ task: publicTask(task) });
});

app.post("/tasks/:id/export", async (c) => {
  const task = await getTask(c.req.param("id"));
  if (!task) return c.json({ error: "任务不存在" }, 404);
  if (!task.draft) return c.json({ error: "草单尚未生成" }, 409);
  if (task.status === "处理中") return c.json({ error: "任务仍在处理中" }, 409);
  const buffer = await buildDraftWorkbook(task);
  await fs.mkdir(EXPORT_DIR, { recursive: true });
  const filename = `${task.id}_v${task.version}_进口报关草单.xlsx`;
  await fs.writeFile(path.join(EXPORT_DIR, filename), buffer);
  await markDelivered(task.id);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
});

app.get("/tasks/:id/preview/:docId", async (c) => {
  const taskId = c.req.param("id");
  const docId = c.req.param("docId");
  const file = await materialFile(taskId, docId);
  if (!file) return c.json({ error: "资料不存在" }, 404);
  try {
    const preview = await buildPreview(file, path.basename(file));
    return c.json({ preview });
  } catch (error) {
    return c.json({ preview: { kind: "unsupported", note: `解析失败：${(error as Error).message}` } });
  }
});

app.get("/tasks/:id/workspace", async (c) => {
  const file = await workspaceFile(c.req.param("id"), c.req.query("path") ?? "");
  if (!file) return c.json({ error: "文件不存在" }, 404);
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".py": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/plain; charset=utf-8",
    ".ts": "text/plain; charset=utf-8",
    ".js": "text/plain; charset=utf-8",
    ".mjs": "text/plain; charset=utf-8",
    ".html": "text/plain; charset=utf-8",
    ".xml": "text/plain; charset=utf-8",
    ".yml": "text/plain; charset=utf-8",
    ".yaml": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
  };
  const filename = path.basename(file);
  const download = c.req.query("download") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Content-Disposition": download
        ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        : "inline",
      "Cache-Control": "no-store",
    },
  });
});

app.get("/tasks/:id/file/:docId", async (c) => {
  const file = await materialFile(c.req.param("id"), c.req.param("docId"));
  if (!file) return c.json({ error: "资料不存在" }, 404);
  const data = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const type = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": type, "Cache-Control": "max-age=300" },
  });
});

app.delete("/tasks/:id", async (c) => {
  await deleteTask(c.req.param("id"));
  return c.json({ ok: true });
});
