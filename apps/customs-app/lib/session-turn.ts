import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, UPLOAD_DIR, nowIso, readDb, uid, updateDb } from "./db";
import { describeToolCall } from "./activity";
import { DSH_TURN_BUDGET_MS, runDshStream } from "./dsh/agent";
import { commitResult } from "./business";
import { recordTurnEvent } from "./transcript";
import type { Task } from "./types";

export function skillPrompt(task: Task): string {
  const note = task.prompt?.trim() ? `\n本票特殊要求：${task.prompt.trim()}` : "";
  const runRoot = path.join(DATA_DIR, "runs", task.id);
  return [
    "/customs-extraction",
    `请处理任务 ${task.id} 的进口报关原件，并生成草单。`,
    "用目标模式执行：先调用 create_goal。目标是完成本票草单，并通过 mcp__business__draft_commit 回写。草单回写成功之前不要把目标标成 complete。",
    "资料在当前工作目录。缺件不阻断，读不到的字段留空。",
    `本票目录只使用 ${runRoot}。工作区是 ${path.join(runRoot, "work")}，产物是 ${path.join(runRoot, "output")}。不要读取或写入其他单据的目录。`,
    "若本票 work 里已经有保存过的批次，从当前进度继续，不要把已保存的核对推倒重来。",
    "data/runtime 里已经装好的程序和 Python 库直接用，包括 PDF 转页工具以及其他已能 import 的库。命令或 import 成功就不要再安装，也不要为本票重建环境。",
    `完成后调用 mcp__business__draft_commit，taskId 为 ${task.id}，result 为技能最终 JSON（含 header 与 table_body）。`,
    "最后用一段话作总陈述：本票终态、草单是否已回写、产物在本票 output 的哪些文件、还要复核什么。这段话放在回复最后，不要停在工具调用上。",
    note,
  ].filter(Boolean).join("\n");
}

export async function prepareRunDir(task: Task): Promise<string> {
  const dir = path.join(DATA_DIR, "runs", task.id, "docs");
  await fs.mkdir(dir, { recursive: true });
  for (const material of task.materials) {
    const source = path.join(UPLOAD_DIR, task.id, material.name);
    try {
      await fs.copyFile(source, path.join(dir, material.name));
    } catch {
      /* 资料不在上传目录时，技能仍可使用目录里已有文件 */
    }
  }
  return dir;
}

async function latestAnswer(dir: string): Promise<unknown | null> {
  const hits: string[] = [];
  const walk = async (current: string, depth: number) => {
    if (depth > 3) return;
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name === "answer.json") hits.push(full);
    }
  };
  await walk(dir, 0);
  if (!hits.length) return null;
  const ranked = await Promise.all(hits.map(async (file) => ({ file, mtime: (await fs.stat(file)).mtimeMs })));
  ranked.sort((a, b) => b.mtime - a.mtime);
  try {
    return JSON.parse(await fs.readFile(ranked[0].file, "utf8"));
  } catch {
    return null;
  }
}

/** 一票一个 DSH 会话：显式调用 customs-extraction，过程写入转录，结果回写草单。 */
export function startTaskSession(taskId: string): void {
  setTimeout(() => {
    void run(taskId).catch((error) => console.error("[session]", error));
  }, 200);
}

async function run(taskId: string): Promise<void> {
  const task = (await readDb()).tasks.find((item) => item.id === taskId);
  if (!task) return;
  const epoch = task.sessionEpoch ?? 0;
  const sameEpoch = (live: Task) => (live.sessionEpoch ?? 0) === epoch;
  const prompt = skillPrompt(task);
  const cwd = await prepareRunDir(task);
  const ids = new Map<string, string>();
  const stack: string[] = [];
  await updateDb((current) => {
    const live = current.tasks.find((item) => item.id === taskId);
    if (!live || !sameEpoch(live)) return;
    live.status = "处理中";
    live.dshSessionId = live.dshSessionId || `session-${taskId}`;
    live.progress = { stage: 12, pct: 12, text: "正在打开本票会话" };
    live.messages.push({ id: uid("m"), role: "user", kind: "text", text: prompt, at: nowIso() });
    live.updatedAt = nowIso();
  });
  try {
    const result = await runDshStream(
      prompt,
      cwd,
      task.dshSessionId || `session-${taskId}`,
      taskId,
      (event) => {
        void updateDb((current) => {
          const live = current.tasks.find((item) => item.id === taskId);
          if (!live || !sameEpoch(live)) return;
          if (event.kind === "goal" && event.text) {
            live.progress = { stage: 40, pct: Math.max(live.progress?.pct ?? 12, 40), text: event.text };
          }
          if (event.kind === "tool/call" && event.name) {
            live.progress = { stage: 64, pct: Math.max(live.progress?.pct ?? 12, 64), text: describeToolCall(event.name, event.args) };
          }
          recordTurnEvent(live, event, ids, stack);
        });
      },
      DSH_TURN_BUDGET_MS,
      task.model,
    );
    if (result.sessionId) {
      await updateDb((current) => {
        const live = current.tasks.find((item) => item.id === taskId);
        if (!live || !sameEpoch(live)) return;
        if (result.sessionId) live.dshSessionId = result.sessionId;
      });
    }
    const answer = await latestAnswer(cwd);
    if (answer && typeof answer === "object") {
      await commitResult(taskId, answer).catch((error) => console.error("[draft-commit]", error));
    }
    await updateDb((current) => {
      const live = current.tasks.find((item) => item.id === taskId);
      if (!live || !sameEpoch(live)) return;
      for (const message of live.messages) {
        if (message.tool?.status === "running") message.tool.status = "done";
      }
      if (live.status !== "处理中") return;
      live.progress = { stage: 100, pct: 100, text: live.draft ? "草单已回写" : "会话结束，尚未收到草单" };
      live.status = "待补充";
      live.updatedAt = nowIso();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDb((current) => {
      const live = current.tasks.find((item) => item.id === taskId);
      if (!live || !sameEpoch(live)) return;
      for (const item of live.messages) {
        if (item.tool?.status === "running") item.tool = { ...item.tool, status: "error", output: item.tool.output || message };
      }
      live.status = "待补充";
      live.progress = { stage: 100, pct: 100, text: "会话失败" };
      live.messages.push({ id: uid("m"), role: "agent", kind: "text", text: `本票会话失败：${message}`, at: nowIso() });
      live.updatedAt = nowIso();
    });
  }
}
