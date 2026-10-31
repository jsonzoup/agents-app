/**
 * 从会话日志补一次上下文占用和压缩事件。进行中的票由实时事件继续更新，避免每次轮询都解压。
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { nowIso, readDb, updateDb } from "../db";
import { recordTurnEvent, type TurnEvent } from "../transcript";
import { mapEvent } from "./agent";
import { sessionLogPath } from "./follow";

const inflight = new Map<string, Promise<boolean>>();

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

function asObservation(event: TurnEvent): TurnEvent | null {
  if (event.kind === "context" || event.kind === "usage" || event.kind === "compaction") return event;
  if (!event.context) return null;
  return { ...event, kind: "usage", text: "" };
}

async function hydrateOnce(taskId: string): Promise<boolean> {
  const task = (await readDb()).tasks.find((item) => item.id === taskId);
  if (!task || task.context?.hydrated) return false;
  if (task.status === "处理中" && task.context?.pressureTokens !== undefined) {
    await updateDb((db) => {
      const live = db.tasks.find((item) => item.id === taskId);
      if (live?.context) live.context.hydrated = true;
    });
    return false;
  }
  const decoded = await readLines(sessionLogPath(taskId)).catch(() => null);
  const applied = await updateDb((db) => {
    const live = db.tasks.find((item) => item.id === taskId);
    if (!live || live.context?.hydrated) return false;
    const ids = new Map<string, string>();
    const stack: string[] = [];
    for (const line of decoded?.lines ?? []) {
      let raw: { type: string; data?: Record<string, unknown> };
      try {
        raw = JSON.parse(line) as { type: string; data?: Record<string, unknown> };
      } catch {
        continue;
      }
      const mapped = mapEvent(raw);
      const observation = mapped ? asObservation(mapped) : null;
      if (observation) recordTurnEvent(live, observation, ids, stack);
    }
    if (decoded?.complete || live.status === "处理中" || !decoded) {
      live.context = { ...(live.context ?? {}), hydrated: true, updatedAt: nowIso() };
    }
    return true;
  });
  return Boolean(applied);
}

export function hydrateSessionView(taskId: string): Promise<boolean> {
  const existing = inflight.get(taskId);
  if (existing) return existing;
  const job = hydrateOnce(taskId).finally(() => inflight.delete(taskId));
  inflight.set(taskId, job);
  return job;
}
