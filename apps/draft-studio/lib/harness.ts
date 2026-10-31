import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";

function locateRepoRoot(): string {
  const candidates = [process.env.DSH_RUNTIME_ROOT, path.resolve(process.cwd(), "../../deepseek-harness"), path.resolve(process.cwd(), "deepseek-harness")].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(candidate, "package.json"), "utf8"),
      ) as { name?: string };
      if (
        manifest.name === "@deepseek-ai/dsh-root" &&
        existsSync(path.join(candidate, "pnpm-workspace.yaml"))
      )
        return candidate;
    } catch {
      /* Keep looking from the app's supported launch directories. */
    }
  }
  return path.resolve(process.cwd(), "../../deepseek-harness");
}
const repoRoot = locateRepoRoot();
const activeHarnessChildren = new Set<ReturnType<typeof spawn>>();

process.once("exit", () => {
  for (const child of activeHarnessChildren) {
    try {
      if (child.pid && process.platform !== "win32")
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* The child already exited. */
    }
  }
});

export type HarnessProgressEvent = {
  kind: "tool_call" | "tool_result";
  callId: string;
  tool: string;
  input?: Record<string, unknown>;
  status?: string;
  result?: string;
};
export type HarnessMessageEvent = {
  kind: "text" | "reasoning" | "start" | "end";
  text?: string;
  status?: string;
};
export type HarnessRunOptions = {
  /** Isolated cwd used by the headless session and workspace-write policy. */
  cwd?: string;
  patchFiles?: string[];
  env?: Record<string, string>;
  onMessage?: (event: HarnessMessageEvent) => void;
};

function resolveNodeBinary(): string {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [
    ...(process.versions.bun ? [] : [process.execPath]),
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, executable)),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const resolved = realpathSync(candidate);
      if (/[/\\]bun(?:\.exe)?$/i.test(resolved)) continue;
      const runtime = execFileSync(
        resolved,
        ["-p", "process.versions.bun ?? ''"],
        {
          encoding: "utf8",
          timeout: 3_000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      if (runtime) continue;
      return resolved;
    } catch {
      /* Try the next Node candidate. */
    }
  }
  throw new Error(
    "找不到可用的 Node.js。DeepSeek Harness 依赖真实 Node/V8 上下文，不能用 Bun 代替；请安装 Node.js 22.19+ 或 24+ 后重启工作台。",
  );
}

/** Runs a named Harness headless profile so model turns use the repository's real web_search/web_fetch tools. */
export async function runHarnessResearch(
  prompt: string,
  onProgress?: (event: HarnessProgressEvent) => void,
  signal?: AbortSignal,
  options: HarnessRunOptions = {},
): Promise<string> {
  const cliEntry = path.join(repoRoot, "apps/cli/lib/bin.js");
  if (!existsSync(cliEntry)) {
    throw new Error(
      "缺少 DeepSeek Harness CLI 构建产物。请在独立目录准备兼容的 Harness 运行环境，并设置 DSH_RUNTIME_ROOT；不要在只读子模块中安装或构建。",
    );
  }
  const nodeBinary = resolveNodeBinary();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const childEnv = { ...process.env };
    for (const key of [
      "QWEN_TTS_API_KEY",
      "DASHSCOPE_API_KEY",
      "OPENAI_API_KEY",
      "OPENAI_IMAGE_GENERATIONS_URL",
      "OPENAI_IMAGE_TASKS_URL",
      "OPENAI_IMAGE_MODEL",
      "OPENAI_IMAGE_SIZE",
    ])
      delete childEnv[key];
    delete childEnv.BUN_BE_BUN;
    Object.assign(childEnv, options.env);
    const patchArgs = (options.patchFiles ?? []).flatMap((patchFile) => [
      "--patch",
      patchFile,
    ]);
    const child = spawn(
      nodeBinary,
      [cliEntry, "--profile", "headless", ...patchArgs, "--json", prompt],
      {
        cwd: options.cwd ?? repoRoot,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    activeHarnessChildren.add(child);
    let stdout = "";
    let stderr = "";
    let stdoutRemainder = "";
    const toolsByCall = new Map<string, string>();
    const maxOutput = 4_000_000;
    let terminating = false;
    let settled = false;
    let terminationError: Error | undefined;
    const terminateTree = (reason?: Error) => {
      if (reason && !terminationError) terminationError = reason;
      if (terminating) return;
      terminating = true;
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        /* It already exited. */
      }
      setTimeout(() => {
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          /* It already exited. */
        }
      }, 5_000).unref();
    };
    const timeout = setTimeout(
      () =>
        terminateTree(
          new Error("DeepSeek Harness 运行超过 12 分钟，已自动终止。"),
        ),
      12 * 60_000,
    );
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeHarnessChildren.delete(child);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value ?? "");
    };
    const onAbort = () => {
      terminateTree();
      finish(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length + chunk.length > maxOutput) {
        terminateTree(
          new Error(
            "DeepSeek Harness 输出超过本地处理上限，已终止本次任务。",
          ),
        );
        return;
      }
      stdout += chunk;
      const lines = `${stdoutRemainder}${chunk}`.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines)
        reportHarnessProgress(line, toolsByCall, onProgress, options.onMessage);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-12_000);
    });
    child.on("error", () => {
      finish(
        new Error(
          "无法启动 DeepSeek Harness headless profile；请确认仓库依赖已安装。",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      if (stdoutRemainder)
        reportHarnessProgress(stdoutRemainder, toolsByCall, onProgress, options.onMessage);
      if (signal?.aborted) {
        finish(abortError());
        return;
      }
      if (terminationError) {
        finish(terminationError);
        return;
      }
      if (code !== 0) {
        const detail = humanizeHarnessError(stderr)
          .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[已隐藏]")
          .slice(-1200);
        finish(
          new Error(
            detail || `DeepSeek Harness 执行失败（${code ?? "terminated"}）。`,
          ),
        );
        return;
      }
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const candidate =
            event.result ?? event.response ?? event.finalResponse ?? event.text;
          if (typeof candidate === "string" && candidate.trim()) {
            finish(undefined, candidate.trim());
            return;
          }
          if (candidate && typeof candidate === "object") {
            const text =
              (candidate as Record<string, unknown>).text ??
              (candidate as Record<string, unknown>).content;
            if (typeof text === "string" && text.trim()) {
              finish(undefined, text.trim());
              return;
            }
          }
        } catch {
          /* Ignore non-result JSON stream lines. */
        }
      }
      finish(
        new Error(
          "Harness 没有返回可解析的最终结果；请查看本地 Harness 运行记录。",
        ),
      );
    });
  });
}

function abortError(): Error {
  const error = new Error("用户已停止收集。");
  error.name = "AbortError";
  return error;
}

export function reportHarnessProgress(
  line: string,
  toolsByCall: Map<string, string>,
  onProgress?: (event: HarnessProgressEvent) => void,
  onMessage?: (event: HarnessMessageEvent) => void,
): void {
  if ((!onProgress && !onMessage) || !line.trim()) return;
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    const callId = typeof event.callId === "string" ? event.callId : "";
    if (onMessage) {
      // The headless JSON projection emits committed DSH assistant blocks as
      // `thinking`/`text` records and lifecycle records as `status`. Keep the
      // older `stream` shape accepted for local harness fixtures.
      if (event.type === "thinking" || event.type === "text") {
        if (typeof event.text === "string" && event.text) {
          onMessage({
            kind: event.type === "thinking" ? "reasoning" : "text",
            text: event.text,
          });
        }
        return;
      }
      if (event.type === "status") {
        const phase = typeof event.phase === "string" ? event.phase : "";
        if (phase === "step_start" || phase === "turn_start") {
          onMessage({ kind: "start", status: phase });
        } else if (phase === "step_end" || phase === "turn_end") {
          onMessage({ kind: "end", status: phase });
        }
        return;
      }
      if (event.type === "stream") {
        const kind = event.kind;
        if (kind === "text" || kind === "reasoning") {
          if (typeof event.text === "string" && event.text) onMessage({ kind, text: event.text });
        } else if (kind === "start" || kind === "end") {
          onMessage({ kind, status: typeof event.status === "string" ? event.status : undefined });
        }
        return;
      }
    }
    if (
      onProgress &&
      event.type === "tool_call" &&
      callId &&
      typeof event.tool === "string"
    ) {
      toolsByCall.set(callId, event.tool);
      onProgress({
        kind: "tool_call",
        callId,
        tool: event.tool,
        input:
          event.input && typeof event.input === "object"
            ? (event.input as Record<string, unknown>)
            : undefined,
      });
    } else if (onProgress && event.type === "tool_result" && callId) {
      onProgress({
        kind: "tool_result",
        callId,
        tool: toolsByCall.get(callId) ?? "",
        status: typeof event.status === "string" ? event.status : undefined,
        result: typeof event.result === "string" ? event.result : undefined,
      });
    }
  } catch {
    /* Only structured tool events update progress. */
  }
}

function humanizeHarnessError(stderr: string): string {
  if (
    /node-addon-require-builtin unsupported: Unsupported\/no-context|required V8 current-context symbols were not found/.test(
      stderr,
    )
  ) {
    return "DeepSeek Harness 启动到了不兼容的 JavaScript 运行时。资料研究必须使用 Node.js 22.19+ 或 24+，不能通过 Bun 运行 Harness。请升级 Node.js 后重启工作台。";
  }
  return stderr.trim();
}
