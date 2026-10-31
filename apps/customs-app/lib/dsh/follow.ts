/**
 * 宿主把可重试的模型超时记成整票失败后，DSH 会话仍会继续写日志。
 * 这里按会话日志把漏掉的工具调用补回任务，并保持工作台轮询，直到 turn/end。
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, nowIso, uid, updateDb } from "../db";
import { customsHome } from "../home";
import { recordTurnEvent } from "../transcript";
import type { Task } from "../types";
import { mapEvent } from "./agent";

const PING_FAILURE = "本票会话失败：ping timeout";

type SessionEvent = { type: string; data?: Record<string, unknown> };

const FOLLOW_VERSION = 2;

type FollowState = {
  version: number;
  started: boolean;
  done: boolean;
  cursor: number;
  mtimeMs: number;
  epoch: number;
  ids: Map<string, string>;
  stack: string[];
  timer: ReturnType<typeof setTimeout> | null;
};

const registry = globalThis as typeof globalThis & { __bglSessionFollow?: Map<string, FollowState> };

function states(): Map<string, FollowState> {
  if (!registry.__bglSessionFollow) registry.__bglSessionFollow = new Map();
  return registry.__bglSessionFollow;
}

/** 与 DSH `projectKey` 一致：分隔符折成 `-`，两侧用 `--` 包住。 */
function projectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (const ch of cwd) {
    if (ch === "/" || ch === "\\" || ch === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (ch !== "~" && /[A-Za-z0-9._-]/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

export function sessionLogPath(taskId: string): string {
  const cwd = path.join(DATA_DIR, "runs", taskId, "docs");
  return path.join(customsHome(), "sessions", projectKey(cwd), `session-${taskId}`, "session.v4.jsonl.zstd");
}

/** 会话文件仍在写入时，热更新不能把这票判成重启中断。 */
export function sessionRecentlyActive(taskId: string, withinMs = 15 * 60 * 1000): boolean {
  try {
    return Date.now() - statSync(sessionLogPath(taskId)).mtimeMs < withinMs;
  } catch {
    return false;
  }
}

function zstdBin(): string {
  if (existsSync("/opt/homebrew/bin/zstd")) return "/opt/homebrew/bin/zstd";
  if (existsSync("/usr/local/bin/zstd")) return "/usr/local/bin/zstd";
  return "zstd";
}

function readLines(file: string): Promise<{ lines: string[]; complete: boolean } | null> {
  return new Promise((resolve) => {
    execFile(zstdBin(), ["-dc", file], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      const text = stdout?.toString("utf8") ?? "";
      if (!text.trim()) {
        resolve(null);
        return;
      }
      resolve({ lines: text.split("\n").filter((line) => line.length > 0), complete: !error });
    });
  });
}

function parseLine(line: string): SessionEvent | null {
  try {
    return JSON.parse(line) as SessionEvent;
  } catch {
    return null;
  }
}

/** 已写入任务的工具调用是日志前缀。返回下一条尚未录入的行号；对不齐时返回 -1。 */
function alignCursor(lines: string[], task: Task): number {
  const tools = task.messages.filter((message) => message.kind === "tool" && message.tool);
  let matched = 0;
  let cursor = 0;
  for (let index = 0; index < lines.length && matched < tools.length; index += 1) {
    const event = parseLine(lines[index]);
    if (!event) return -1;
    if (event.type !== "tool/call") continue;
    const mapped = mapEvent(event);
    const tool = tools[matched]?.tool;
    if (!mapped || !tool || mapped.name !== tool.name || (mapped.args || "") !== (tool.args || "")) return -1;
    matched += 1;
    cursor = index + 1;
    const next = index + 1 < lines.length ? parseLine(lines[index + 1]) : null;
    if (next?.type === "tool/result") cursor = index + 2;
  }
  return matched === tools.length ? cursor : -1;
}

function turnError(event: SessionEvent): string | null {
  if (event.type !== "turn/end") return null;
  const reason = event.data?.reason as { kind?: string; error?: { message?: string } } | undefined;
  if (reason?.kind !== "error") return "";
  return reason.error?.message || "模型调用失败";
}

async function runOnce(state: FollowState, taskId: string): Promise<void> {
  if (state.done) return;
  const file = sessionLogPath(taskId);
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    return;
  }
  if (state.cursor >= 0 && mtimeMs === state.mtimeMs) return;
  const decoded = await readLines(file);
  if (!decoded) return;
  const lines = decoded.lines;
  if (!decoded.complete) mtimeMs = 0;

  const applied = await updateDb((db) => {
    const live = db.tasks.find((item) => item.id === taskId);
    if (!live) return null;
    if ((live.sessionEpoch ?? 0) !== state.epoch) return null;
    let cursor = state.cursor;
    if (cursor < 0) {
      const aligned = alignCursor(lines, live);
      if (aligned < 0) return null;
      cursor = aligned;
      const before = live.messages.length;
      live.messages = live.messages.filter((message) => message.text !== PING_FAILURE);
      if (live.messages.length !== before || live.progress?.text === "会话失败") {
        live.status = "处理中";
        live.progress = { stage: 64, pct: 64, text: "正在执行技能" };
        live.updatedAt = nowIso();
      }
    }
    let ended: string | null = null;
    let label = "";
    for (let index = cursor; index < lines.length; index += 1) {
      const event = parseLine(lines[index]);
      if (!event) break;
      cursor = index + 1;
      const terminal = turnError(event);
      if (terminal !== null) {
        ended = terminal;
        continue;
      }
      const mapped = mapEvent(event);
      if (!mapped) continue;
      if (mapped.kind === "tool/call" && mapped.name) label = mapped.name;
      recordTurnEvent(live, mapped, state.ids, state.stack);
    }
    if (ended !== null) {
      for (const message of live.messages) {
        if (message.tool?.status === "running") {
          message.tool.status = ended ? "error" : "done";
          if (ended && !message.tool.output) message.tool.output = ended;
        }
      }
      if (live.status === "处理中") {
        live.status = "待补充";
        live.progress = {
          stage: 100,
          pct: 100,
          text: ended ? "会话失败" : live.draft ? "草单已回写" : "会话结束，尚未收到草单",
        };
        if (ended) {
          live.messages.push({ id: uid("m"), role: "agent", kind: "text", text: `本票会话失败：${ended}`, at: nowIso() });
        }
        live.updatedAt = nowIso();
      }
    } else if (live.status === "处理中") {
      live.progress = { stage: 64, pct: 64, text: label || live.progress?.text || "正在执行技能" };
    } else if ((live.progress?.pct ?? 100) >= 100 && live.progress?.text !== "草单已回写") {
      live.progress = { stage: 64, pct: 99, text: label || "正在执行技能" };
    }
    return { cursor, done: ended !== null };
  });
  if (!applied) return;
  state.cursor = applied.cursor;
  state.mtimeMs = mtimeMs;
  state.done = applied.done;
}

function schedule(state: FollowState, taskId: string) {
  if (state.done || state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.done) return;
    void runOnce(state, taskId)
      .catch((error) => console.error("[session-follow]", error))
      .finally(() => schedule(state, taskId));
  }, 2000);
}

export function stopFollowing(taskId: string): void {
  const state = states().get(taskId);
  if (!state) return;
  state.done = true;
  if (state.timer) clearTimeout(state.timer);
}

/** 仅接回被 ping timeout 误判失败、但会话仍在写的那一票。返回 true 表示本次补写了任务。 */
export async function catchUpTaskSession(task: Task): Promise<boolean> {
  const current = states().get(task.id);
  if (current?.version === FOLLOW_VERSION && current.started) return false;
  if (!task.messages.some((message) => message.text === PING_FAILURE)) return false;
  if (current) {
    current.done = true;
    if (current.timer) clearTimeout(current.timer);
  }
  const state: FollowState = {
    version: FOLLOW_VERSION,
    started: true,
    done: false,
    cursor: -1,
    mtimeMs: 0,
    epoch: task.sessionEpoch ?? 0,
    ids: new Map(),
    stack: [],
    timer: null,
  };
  states().set(task.id, state);
  await runOnce(state, task.id);
  schedule(state, task.id);
  return state.cursor >= 0;
}
