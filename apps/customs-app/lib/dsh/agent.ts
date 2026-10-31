/**
 * 报关灵宿主：进程内一个 DSH runtime。每票一个 conversation，home 由 CUSTOMS_HOME 指定。
 */
import { Worker } from "node:worker_threads";
import path from "node:path";
import { customsHome, skillsDir } from "../home";
import { parseModelSelection } from "./route";

export interface DshModelGroup {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

type Listener = (event: { kind: string; text: string; name: string; id?: string; args?: string; isError?: boolean }) => void;
/** 整票硬上限。单次模型调用或工具之间的空闲另计，进行中的制单不会在 20 分钟被掐断。 */
export const DSH_TURN_BUDGET_MS = 3 * 60 * 60 * 1000;
const IDLE_MS = 15 * 60 * 1000;

type Waiter = {
  final: string;
  sessionId: string;
  onEvent?: Listener;
  resolve: (value: { text: string; sessionId: string }) => void;
  started?: boolean;
  error?: string;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  idle: ReturnType<typeof setTimeout>;
  /** 目标仍在执行时，一轮结束不能关掉会话，否则后续目标轮无法继续。 */
  goalActive?: boolean;
};

type ModelWaiter = { resolve: (groups: DshModelGroup[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

type ClearWaiter = { resolve: () => void; timer: ReturnType<typeof setTimeout> };

type Bridge = {
  worker: Worker | null;
  revision: number;
  waiters: Map<string, Waiter>;
  modelWaiters: Map<string, ModelWaiter>;
  clearWaiters: Map<string, ClearWaiter>;
};

/** 换过运行时实现后，空闲时关掉旧 worker。两条运行时同时在会抢同一票会话的写锁。 */
const WORKER_REVISION = 3;

function bridge(): Bridge {
  const slot = globalThis as typeof globalThis & { __bglDsh?: Bridge };
  if (!slot.__bglDsh) slot.__bglDsh = { worker: null, revision: WORKER_REVISION, waiters: new Map(), modelWaiters: new Map(), clearWaiters: new Map() };
  if (!slot.__bglDsh.clearWaiters) slot.__bglDsh.clearWaiters = new Map();
  if (slot.__bglDsh.revision !== WORKER_REVISION && slot.__bglDsh.waiters.size === 0) {
    slot.__bglDsh.worker?.terminate();
    slot.__bglDsh.worker = null;
    slot.__bglDsh.revision = WORKER_REVISION;
  }
  return slot.__bglDsh;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && (item as { type?: string }).type === "text")
    .map((item) => String((item as { text?: string }).text ?? ""))
    .join("");
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageContext(data: Record<string, unknown>) {
  let usage: Record<string, unknown> | undefined;
  if (data.usage && typeof data.usage === "object") usage = data.usage as Record<string, unknown>;
  if (Array.isArray(data.stream)) {
    for (const item of data.stream) {
      const chunk = item && typeof item === "object" ? (item as { chunk?: { type?: string; usage?: unknown } }).chunk : undefined;
      if (chunk?.type === "usage" && chunk.usage && typeof chunk.usage === "object") usage = chunk.usage as Record<string, unknown>;
    }
  }
  if (!usage) return undefined;
  const inputTokens = numeric(usage.inputTokens);
  const outputTokens = numeric(usage.outputTokens);
  const cacheReadTokens = numeric(usage.cacheReadTokens);
  const cacheWriteTokens = numeric(usage.cacheWriteTokens);
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    pressureTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

/** 这些失败码由 DSH 自己重试，宿主不能当成整票结束。 */
const RETRYABLE_ATTEMPT = new Set(["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"]);

export function mapEvent(event: { type: string; data?: Record<string, unknown> }) {
  const data = event.data ?? {};
  const usage = usageContext(data);
  if (event.type === "request/context") {
    return {
      kind: "context",
      text: "",
      name: "context",
      context: {
        provider: typeof data.provider === "string" ? data.provider : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
        contextWindow: typeof data.contextWindow === "number" ? data.contextWindow : undefined,
      },
    };
  }
  if (event.type === "goal/change") {
    const operation = String(data.operation ?? "");
    const labels: Record<string, string> = {
      create: "已建立目标，继续制单",
      resume: "目标继续执行",
      edit: "目标已更新",
      complete: "目标已完成",
      pause: "目标已暂停",
      block: "目标受阻",
      clear: "目标已清除",
    };
    return { kind: "goal", text: labels[operation] ?? "目标更新", name: "goal" };
  }
  if (event.type === "image/offload") {
    const targets = Array.isArray(data.targets) ? data.targets.length : 0;
    if (!targets) return null;
    return { kind: "context", text: "", name: "offload", context: { imageOffloadDelta: targets } };
  }
  if (event.type === "compaction/prune") {
    const seqs = Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs : [];
    const range = data.shadowedRange as { start?: number; end?: number } | undefined;
    return {
      kind: "compaction",
      text: "",
      name: "prune",
      compaction: {
        id: `${range?.start ?? "x"}-${range?.end ?? seqs.length}-${numeric(data.shadowedTokenCount)}`,
        mode: "prune" as const,
        status: "done" as const,
        shadowedItemCount: seqs.length,
        shadowedTokenCount: numeric(data.shadowedTokenCount),
      },
    };
  }
  if (event.type === "compaction/start" || event.type === "compaction/summary" || event.type === "compaction/end") {
    const phase = event.type.slice("compaction/".length);
    return {
      kind: "compaction",
      text: "",
      name: phase,
      compaction: {
        id: String(data.compactionId ?? "compact"),
        mode: "summary" as const,
        status: phase === "end" ? (data.error ? "error" as const : "done" as const) : "running" as const,
        summary: phase === "summary" ? textOf(data.summary).slice(0, 12_000) : undefined,
        shadowedItemCount: Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : undefined,
        shadowedTokenCount: typeof data.shadowedTokenCount === "number" ? data.shadowedTokenCount : undefined,
        error: typeof data.error === "string" ? data.error : undefined,
      },
    };
  }
  if (event.type === "assistant/message") {
    const text = textOf((data.message as { content?: unknown } | undefined)?.content ?? data.content);
    if (!text && !usage) return null;
    return { kind: text ? "assistant/message" : "usage", text, name: "", context: usage };
  }
  if (event.type === "assistant/attempt" && usage) {
    return { kind: "usage", text: "", name: "usage", context: usage };
  }
  if (event.type === "tool/call") {
    return {
      kind: "tool/call",
      text: "",
      name: String((data.name as string) ?? ""),
      id: String((data.callId as string) ?? ""),
      args: typeof data.arguments === "string" ? data.arguments : JSON.stringify(data.arguments ?? {}),
    };
  }
  if (event.type === "reasoning" || event.type === "assistant/reasoning") {
    const text = textOf(data.content) || textOf((data.message as { content?: unknown } | undefined)?.content) || String(data.text ?? "");
    return text ? { kind: "reasoning", text, name: "reasoning" } : null;
  }
  if (event.type === "tool/result") {
    const message = (data.message ?? {}) as { content?: unknown; toolCallId?: string; name?: string; source?: { callId?: string; name?: string } };
    return {
      kind: "tool/result",
      text: textOf(data.content) || textOf(message.content) || String(data.output ?? data.result ?? ""),
      name: String((data.tool as { name?: string } | undefined)?.name ?? data.name ?? message.name ?? message.source?.name ?? ""),
      id: String((data.toolCallId as string) ?? message.toolCallId ?? message.source?.callId ?? ""),
      isError: Boolean(data.isError),
    };
  }
  return null;
}

function failureOf(event: { type: string; data?: Record<string, unknown> }): string | null {
  if (event.type === "turn/end") {
    const reason = event.data?.reason as { kind?: string; error?: { message?: string } } | undefined;
    if (reason?.kind !== "error") return null;
    return reason.error?.message || "模型调用失败";
  }
  if (event.type !== "assistant/attempt" || !Array.isArray(event.data?.stream)) return null;
  for (const item of event.data.stream as Array<{ chunk?: { type?: string; reason?: { kind?: string; failure?: { message?: string; code?: string }; error?: { message?: string; code?: string } } } }>) {
    const reason = item.chunk?.type === "finish" ? item.chunk.reason : undefined;
    if (reason?.kind !== "error") continue;
    const failure = reason.failure ?? reason.error;
    const message = failure?.message || "模型调用失败";
    const code = failure?.code || "";
    if (code === "IMAGE_OFFLOAD_REQUIRED" || RETRYABLE_ATTEMPT.has(code) || /ping timeout/i.test(message)) return null;
    return message;
  }
  return null;
}

function clearWaiterTimers(waiter: Waiter) {
  clearTimeout(waiter.timer);
  clearTimeout(waiter.idle);
}

function settle(key: string) {
  const waiter = bridge().waiters.get(key);
  if (!waiter) return;
  bridge().waiters.delete(key);
  clearWaiterTimers(waiter);
  bridge().worker?.postMessage({ op: "abort", key });
  waiter.resolve({ text: waiter.final, sessionId: waiter.sessionId });
}

function expire(key: string, message: string) {
  const waiter = bridge().waiters.get(key);
  if (!waiter) return;
  bridge().waiters.delete(key);
  clearWaiterTimers(waiter);
  bridge().worker?.postMessage({ op: "abort", key });
  waiter.reject(new Error(message));
}

function noteGoal(waiter: Waiter, event: { type: string; data?: Record<string, unknown> }) {
  if (event.type !== "goal/change") return;
  const operation = String(event.data?.operation ?? "");
  const phase = (event.data?.goal as { phase?: string } | undefined)?.phase;
  if (operation === "clear" || operation === "complete" || operation === "pause" || operation === "block") {
    waiter.goalActive = false;
    return;
  }
  if (phase === "complete" || phase === "paused" || phase === "blocked") {
    waiter.goalActive = false;
    return;
  }
  if (phase === "active" || operation === "create" || operation === "resume" || operation === "edit") {
    waiter.goalActive = true;
  }
}

function touchIdle(key: string) {
  const waiter = bridge().waiters.get(key);
  if (!waiter) return;
  clearTimeout(waiter.idle);
  waiter.idle = setTimeout(() => expire(key, "对话长时间没有新进展"), IDLE_MS);
}

function fail(key: string, message: string) {
  const waiter = bridge().waiters.get(key);
  if (!waiter) return;
  bridge().waiters.delete(key);
  clearWaiterTimers(waiter);
  waiter.reject(new Error(message));
}

function getWorker(): Worker {
  const slot = bridge();
  if (slot.worker) return slot.worker;
  const created = new Worker(path.join(process.cwd(), "lib", "dsh", "worker.mjs"), {
    workerData: {
      dshHome: customsHome(),
      skillDirs: [skillsDir()],
      mcpServers: [
        { serverName: "business", url: process.env.BGL_MCP_URL || "http://127.0.0.1:8790/api/mcp" },
      ],
    },
  });
  slot.worker = created;
  slot.revision = WORKER_REVISION;
  created.on("message", (message: { type: string; key?: string; sessionId?: string; message?: unknown; groups?: DshModelGroup[] }) => {
    const key = message.key ?? "";
    const live = bridge();
    if (message.type === "cleared") {
      const pending = live.clearWaiters.get(key);
      if (!pending) return;
      live.clearWaiters.delete(key);
      clearTimeout(pending.timer);
      pending.resolve();
      return;
    }
    if (message.type === "models") {
      const pending = live.modelWaiters.get(key);
      if (!pending) return;
      live.modelWaiters.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(message.groups ?? []);
      return;
    }
    if (message.type === "error" && live.modelWaiters.has(key)) {
      const pending = live.modelWaiters.get(key)!;
      live.modelWaiters.delete(key);
      clearTimeout(pending.timer);
      pending.reject(new Error(String(message.message ?? "列出模型失败")));
      return;
    }
    const waiter = live.waiters.get(key);
    if (!waiter) return;
    touchIdle(key);
    if (message.type === "started") {
      waiter.sessionId = message.sessionId ?? "";
      return;
    }
    if (message.type === "error") {
      fail(key, String(message.message ?? "对话运行时错误"));
      return;
    }
    if (message.type !== "event") return;
    const payload = message.message as { type: string; status?: string; event?: { type: string; data?: Record<string, unknown> } };
    if (payload.type === "status") {
      if (payload.status === "running") waiter.started = true;
      else if (payload.status === "idle" && waiter.started) {
        if (waiter.error) fail(key, waiter.error);
        else if (!waiter.goalActive) settle(key);
      }
      return;
    }
    if (!payload.event) return;
    noteGoal(waiter, payload.event);
    if (payload.event.type === "llm/retry" || payload.event.type === "llm/retry-started") {
      waiter.error = undefined;
      waiter.started = true;
      return;
    }
    const failure = failureOf(payload.event);
    if (failure) {
      waiter.error = failure;
      fail(key, failure);
      return;
    }
    waiter.started = true;
    const mapped = mapEvent(payload.event);
    if (!mapped) return;
    if (mapped.kind === "assistant/message") waiter.final = mapped.text;
    waiter.onEvent?.(mapped);
  });
  const failModels = (message: string) => {
    for (const [key, pending] of bridge().modelWaiters) {
      bridge().modelWaiters.delete(key);
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  };
  created.on("error", (error) => {
    for (const key of [...bridge().waiters.keys()]) fail(key, String(error?.message || error));
    failModels(String(error?.message || error));
    if (bridge().worker === created) bridge().worker = null;
  });
  created.on("exit", () => {
    for (const key of [...bridge().waiters.keys()]) fail(key, "对话运行时已退出");
    failModels("对话运行时已退出");
    if (bridge().worker === created) bridge().worker = null;
  });
  return created;
}

function ask(options: {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  sessionId?: string;
  model?: string;
  provider?: string;
  mode?: string;
  key: string;
  onEvent?: Listener;
}): Promise<{ text: string; sessionId: string }> {
  getWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => expire(options.key, "对话调用超时"), options.timeoutMs);
    const idle = setTimeout(() => expire(options.key, "对话长时间没有新进展"), IDLE_MS);
    const route = parseModelSelection(options.model);
    bridge().waiters.set(options.key, { final: "", sessionId: options.sessionId ?? "", onEvent: options.onEvent, resolve, reject, timer, idle });
    bridge().worker?.postMessage({
      op: "prompt",
      key: options.key,
      text: options.prompt,
      cwd: options.cwd,
      sessionId: options.sessionId,
      model: route.model,
      provider: options.provider || route.provider,
      mode: options.mode,
    });
  });
}

export function listDshModels(): Promise<DshModelGroup[]> {
  const key = `models-${Date.now()}`;
  getWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge().modelWaiters.delete(key);
      reject(new Error("列出模型超时"));
    }, 60_000);
    bridge().modelWaiters.set(key, { resolve, reject, timer });
    bridge().worker?.postMessage({ op: "models", key });
  });
}

export async function runDsh(prompt: string, cwd: string, timeoutMs = DSH_TURN_BUDGET_MS, sessionId?: string, model?: string, mode?: string) {
  return ask({ prompt, cwd, timeoutMs, sessionId, model, mode, key: sessionId || `run-${Date.now()}` });
}

export async function runDshStream(
  prompt: string,
  cwd: string,
  sessionId: string | undefined,
  key: string,
  onEvent: Listener,
  timeoutMs = DSH_TURN_BUDGET_MS,
  model?: string,
  mode?: string,
) {
  return ask({ prompt, cwd, timeoutMs, sessionId, model, mode, key, onEvent });
}

export function stopDsh(key: string) {
  const waiter = bridge().waiters.get(key);
  if (waiter) {
    bridge().waiters.delete(key);
    clearTimeout(waiter.timer);
    waiter.resolve({ text: waiter.final, sessionId: waiter.sessionId });
  }
  bridge().worker?.postMessage({ op: "abort", key });
}

/** 关掉这一票的对话句柄，等运行时释放写锁后再删会话文件。 */
export function clearDsh(key: string): Promise<void> {
  getWorker();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bridge().clearWaiters.delete(key);
      resolve();
    }, 8_000);
    bridge().clearWaiters.set(key, {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      timer,
    });
    bridge().worker?.postMessage({ op: "clear", key });
  });
}
