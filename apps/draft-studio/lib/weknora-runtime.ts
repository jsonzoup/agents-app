import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { home } from "./store";

const WEKNORA_VERSION = "v0.8.3";
const WEKNORA_SOURCE_SHA256 =
  "1ce1017151d1ab929a7d799d91472e33ffd1910f6b674ba998b8e281fdb20f5c";
const GO_TOOLCHAIN_VERSION = "1.26.1";
const GO_TOOLCHAIN_SHA256: Record<string, string> = {
  "darwin-amd64": "65773dab2f8cc4cd23d93ba6d0a805de150ca0b78378879292be0b903b8cdd08",
  "darwin-arm64": "353df43a7811ce284c8938b5f3c7df40b7bfb6f56cb165b150bc40b5e2dd541f",
  "linux-amd64": "031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a",
  "linux-arm64": "a290581cfe4fe28ddd737dde3095f3dbeb7f2e4065cab4eae44dfc53b760c2f7",
};
const RUNTIME_PORT = 47821;
const RUNTIME_READY_TIMEOUT_MS = 90_000;
const RUNTIME_PREPARE_TIMEOUT_MS = 20 * 60_000;
const MODEL_NAME = "draft-studio-local-embedding-v1";
const KNOWLEDGE_BASE_NAME = "Draft Studio 内置知识库";
const runtimeRoot = path.join(home, "runtime", "weknora");
const settingsPath = path.join(runtimeRoot, "runtime.json");
const databasePath = path.join(runtimeRoot, "data", "weknora.db");
const storagePath = path.join(runtimeRoot, "data", "files");
const sourcePath = path.join(runtimeRoot, `source-${WEKNORA_VERSION}`);
const logPath = path.join(runtimeRoot, "weknora.log");
const toolchainRoot = path.join(runtimeRoot, "toolchain");

type RuntimeSettings = {
  version: string;
  setupToken: string;
  internalSecret: string;
  jwtSecret: string;
  aesKey: string;
  knowledgeBaseId?: string;
  embeddingModelId?: string;
  appPort?: number;
  updatedAt: string;
};
type RuntimeSession = {
  token: string;
  expiresAt: number;
  knowledgeBaseId: string;
  embeddingModelId: string;
  baseUrl: string;
};
type RuntimeStore = {
  child?: ChildProcess;
  prepare?: Promise<BuiltinWeKnoraState>;
  prepareGeneration?: number;
  session?: RuntimeSession;
  settings?: RuntimeSettings;
  abortController?: AbortController;
  generation: number;
  childGeneration?: number;
  stopping: boolean;
  state: BuiltinWeKnoraState;
};
type RuntimeGlobal = typeof globalThis & {
  __xhsWeKnoraRuntime?: RuntimeStore;
};

export type BuiltinWeKnoraState = {
  status:
    | "not_installed"
    | "preparing"
    | "starting"
    | "running"
    | "stopped"
    | "error";
  stage: string;
  detail: string;
  installed: boolean;
  version: string;
  port: number;
  pid?: number;
  startedAt?: string;
  nextRetryAt?: string;
  lastError?: string;
  knowledgeBaseId?: string;
  embeddingModelId?: string;
  logPath: string;
};

const runtimeGlobal = globalThis as RuntimeGlobal;
const runtimeStore: RuntimeStore = (runtimeGlobal.__xhsWeKnoraRuntime ??= {
  generation: 0,
  stopping: false,
  state: {
    status: "not_installed",
    stage: "等待初始化",
    detail: "首次启用时会自动准备 WeKnora Lite 与本机模型服务。",
    installed: false,
    version: WEKNORA_VERSION,
    port: RUNTIME_PORT,
    logPath,
  },
});

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function selectedEnvironment(keys: string[]): NodeJS.ProcessEnv {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  ) as NodeJS.ProcessEnv;
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  return selectedEnvironment([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
  ]);
}

function buildEnvironment(): NodeJS.ProcessEnv {
  return selectedEnvironment([
    ...Object.keys(runtimeEnvironment()),
    "USERPROFILE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SDKROOT",
    "DEVELOPER_DIR",
    "MACOSX_DEPLOYMENT_TARGET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "GOCACHE",
    "GOMODCACHE",
    "GOPATH",
    "GOROOT",
    "GOOS",
    "GOARCH",
    "GOPROXY",
    "GOSUMDB",
    "GOTOOLCHAIN",
    "GOFLAGS",
    "CGO_ENABLED",
    "CC",
    "CXX",
    "CGO_CFLAGS",
    "CGO_LDFLAGS",
    "PKG_CONFIG_PATH",
  ]);
}

function state(): BuiltinWeKnoraState {
  return { ...runtimeStore.state };
}

function updateState(patch: Partial<BuiltinWeKnoraState>): void {
  runtimeStore.state = { ...runtimeStore.state, ...patch };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function fileErrorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

async function loadSettings(): Promise<RuntimeSettings> {
  if (runtimeStore.settings) return runtimeStore.settings;
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    if (fileErrorCode(error) !== "ENOENT")
      throw new Error(
        `无法读取 WeKnora 运行时配置：${error instanceof Error ? error.message : "未知错误"}`,
      );
    if (await exists(databasePath))
      throw new Error(
        `WeKnora 数据库存在，但运行时配置 ${settingsPath} 丢失。为避免破坏已加密凭据，系统拒绝自动重建配置。`,
      );
    const settings: RuntimeSettings = {
      version: WEKNORA_VERSION,
      setupToken: randomBytes(32).toString("hex"),
      internalSecret: randomBytes(32).toString("hex"),
      jwtSecret: randomBytes(32).toString("hex"),
      aesKey: randomBytes(16).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    await persistSettings(settings);
    return settings;
  }
  let parsed: Partial<RuntimeSettings>;
  try {
    parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
  } catch {
    throw new Error(
      `WeKnora 运行时配置 ${settingsPath} 已损坏。请修复或恢复备份，系统不会覆盖现有密钥。`,
    );
  }
  if (
    !parsed.setupToken ||
    !parsed.internalSecret ||
    !parsed.jwtSecret ||
    !parsed.aesKey
  )
    throw new Error(
      `WeKnora 运行时配置 ${settingsPath} 缺少必要密钥。系统不会自动覆盖现有配置。`,
    );
  const settings: RuntimeSettings = {
    ...(parsed as RuntimeSettings),
    version: WEKNORA_VERSION,
    updatedAt: parsed.updatedAt || new Date().toISOString(),
  };
  runtimeStore.settings = settings;
  if (parsed.version !== WEKNORA_VERSION) await persistSettings(settings);
  return settings;
}

async function persistSettings(settings: RuntimeSettings): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const temp = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, settingsPath);
  runtimeStore.settings = settings;
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("操作已取消。", "AbortError"));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...buildEnvironment(), ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (
      error: Error | undefined,
      value?: CommandResult,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value ?? { stdout, stderr, code: -1 });
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(new DOMException("操作已取消。", "AbortError"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new Error(
          `${command} 执行超过 ${Math.round((options.timeoutMs ?? RUNTIME_PREPARE_TIMEOUT_MS) / 60_000)} 分钟。`,
        ),
      );
    }, options.timeoutMs ?? RUNTIME_PREPARE_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-12_000);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-12_000);
    });
    child.once("error", (error) => {
      finish(error);
    });
    child.once("close", (code) => {
      finish(undefined, { stdout, stderr, code: code ?? -1 });
    });
  });
}

async function patchLiteServerEntry(root: string): Promise<void> {
  const mainPath = path.join(root, "cmd", "server", "main.go");
  let source = await readFile(mainPath, "utf8");
  if (source.includes("handler.SetLiteSetupToken")) return;
  source = source.replace(
    '"github.com/Tencent/WeKnora/internal/config"',
    '"github.com/Tencent/WeKnora/internal/config"\n\t"github.com/Tencent/WeKnora/internal/handler"',
  );
  source = source.replace(
    "func main() {",
    'func main() {\n\thandler.Edition = "lite"\n\thandler.SetLiteSetupToken(os.Getenv("WEKNORA_LITE_SETUP_TOKEN"))',
  );
  if (
    !source.includes('"github.com/Tencent/WeKnora/internal/handler"') ||
    !source.includes('handler.Edition = "lite"') ||
    !source.includes("handler.SetLiteSetupToken")
  )
    throw new Error(
      "WeKnora 上游入口结构已变化，无法安全应用 Lite 自动初始化补丁。",
    );
  await writeFile(mainPath, source);
  const written = await readFile(mainPath, "utf8");
  if (
    !written.includes('handler.Edition = "lite"') ||
    !written.includes("handler.SetLiteSetupToken")
  )
    throw new Error("WeKnora Lite 初始化补丁写入校验失败。");
}

function goPlatform(): string {
  const architecture =
    process.arch === "arm64"
      ? "arm64"
      : process.arch === "x64"
        ? "amd64"
        : "";
  if (!architecture)
    throw new Error(`暂无适用于 ${process.arch} 的自动 Go 工具链。`);
  if (process.platform === "darwin") return `darwin-${architecture}`;
  if (process.platform === "linux") return `linux-${architecture}`;
  throw new Error("当前平台暂不支持自动安装 Go 工具链。");
}

async function resolveGoExecutable(signal: AbortSignal): Promise<string> {
  try {
    const installed = await runCommand("go", ["version"], {
      timeoutMs: 10_000,
    });
    if (installed.code === 0) return "go";
  } catch {
    /* Download the pinned toolchain below. */
  }
  const localGo = path.join(toolchainRoot, "go", "bin", "go");
  if (await exists(localGo)) return localGo;
  await mkdir(toolchainRoot, { recursive: true });
  const platform = goPlatform();
  const archiveName = `go${GO_TOOLCHAIN_VERSION}.${platform}.tar.gz`;
  const archivePath = path.join(toolchainRoot, archiveName);
  updateState({
    stage: "准备本地编译工具",
    detail: `正在下载 Go ${GO_TOOLCHAIN_VERSION} 工具链，仅首次需要。`,
  });
  const response = await fetch(`https://go.dev/dl/${encodeURIComponent(archiveName)}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
    redirect: "follow",
  });
  if (!response.ok)
    throw new Error(`下载 Go 工具链失败（HTTP ${response.status}）。`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== GO_TOOLCHAIN_SHA256[platform])
    throw new Error(
      `Go ${GO_TOOLCHAIN_VERSION} 工具链校验失败：期望 ${GO_TOOLCHAIN_SHA256[platform]}，实际 ${digest}。`,
    );
  await writeFile(archivePath, archive, {
    mode: 0o600,
  });
  const extract = await runCommand(
    "tar",
    ["-xzf", archivePath, "-C", toolchainRoot],
    { timeoutMs: 5 * 60_000, signal },
  );
  if (extract.code !== 0 || !(await exists(localGo)))
    throw new Error(
      `解压 Go 工具链失败：${extract.stderr || extract.stdout || "缺少 go 二进制"}`,
    );
  return localGo;
}

async function ensureSource(
  root: string,
  managed: boolean,
  signal: AbortSignal,
): Promise<void> {
  if (await exists(path.join(root, "go.mod"))) return;
  if (!managed)
    throw new Error(
      `WEKNORA_SOURCE_DIR=${root} 不包含 go.mod。系统不会修改或删除环境变量指定的外部目录。`,
    );
  updateState({
    stage: "下载 WeKnora Lite 源码",
    detail: `正在准备 ${WEKNORA_VERSION}，只需要首次执行。`,
  });
  const archiveName = `WeKnora-${WEKNORA_VERSION}.tar.gz`;
  const archivePath = path.join(runtimeRoot, archiveName);
  const response = await fetch(
    `https://github.com/Tencent/WeKnora/archive/refs/tags/${WEKNORA_VERSION}.tar.gz`,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
      redirect: "follow",
    },
  );
  if (!response.ok)
    throw new Error(`下载 WeKnora 源码失败（HTTP ${response.status}）。`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== WEKNORA_SOURCE_SHA256)
    throw new Error(
      `WeKnora ${WEKNORA_VERSION} 源码校验失败：期望 ${WEKNORA_SOURCE_SHA256}，实际 ${digest}。`,
    );
  await writeFile(archivePath, archive, {
    mode: 0o600,
  });
  const staging = `${root}.staging-${process.pid}-${randomUUID()}`;
  await mkdir(staging, { recursive: true });
  try {
    const extract = await runCommand(
      "tar",
      ["-xzf", archivePath, "-C", staging, "--strip-components=1"],
      { timeoutMs: 5 * 60_000, signal },
    );
    if (extract.code !== 0 || !(await exists(path.join(staging, "go.mod"))))
      throw new Error(
        `解压 WeKnora 源码失败：${extract.stderr || extract.stdout || "缺少 go.mod"}`,
      );
    if (await exists(root)) await rm(root, { recursive: true, force: true });
    await rename(staging, root);
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}

async function ensureBinary(
  signal: AbortSignal,
): Promise<{ binary: string; sourceDir: string }> {
  const configuredBinary = process.env.WEKNORA_LITE_BINARY?.trim();
  const configuredSource = process.env.WEKNORA_SOURCE_DIR?.trim();
  const sourceDir = configuredSource || sourcePath;
  const managedSource = !configuredSource;
  if (configuredBinary && (await exists(configuredBinary))) {
    const binary = configuredBinary;
    updateState({ installed: true });
    if (await exists(path.join(sourceDir, "config", "config.yaml")))
      return { binary, sourceDir };
  }
  await mkdir(runtimeRoot, { recursive: true });
  await ensureSource(sourceDir, managedSource, signal);
  const binary = path.join(sourceDir, "WeKnora-lite");
  if (!(await exists(binary))) {
    const go = await resolveGoExecutable(signal);
    updateState({
      installed: true,
      stage: "构建 WeKnora Lite",
      detail: "首次构建会下载依赖并编译官方 Lite 服务，通常需要 2–5 分钟。",
    });
    await patchLiteServerEntry(sourceDir);
    const build = await runCommand(
      go,
      ["build", "-tags", "sqlite_fts5", "-o", binary, "./cmd/server"],
      {
        cwd: sourceDir,
        env: { ...buildEnvironment(), CGO_ENABLED: "1" },
        timeoutMs: 20 * 60_000,
        signal,
      },
    );
    if (build.code !== 0)
      throw new Error(
        `构建 WeKnora 失败：${(build.stderr || build.stdout).slice(-1800)}`,
      );
  }
  updateState({ installed: true });
  return { binary, sourceDir };
}

function processRunning(child?: ChildProcess): boolean {
  return Boolean(
    child && child.exitCode === null && child.signalCode === null,
  );
}

async function serviceResponds(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/config`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForService(
  baseUrl: string,
  child: ChildProcess,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + RUNTIME_READY_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    if (signal.aborted)
      throw new DOMException("操作已取消。", "AbortError");
    if (!processRunning(child))
      throw new Error(`WeKnora 进程在服务就绪前退出。查看日志 ${logPath}`);
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/config`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "连接失败";
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`WeKnora 服务未就绪：${lastError}`);
}

async function weKnoraRequest<T>(
  baseUrl: string,
  pathname: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error(`WeKnora 返回非 JSON 响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const error = parsed.error;
    const message =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>).message
        : typeof error === "string"
          ? error
          : parsed.message;
    throw new Error(
      typeof message === "string" && message.trim()
        ? message
        : `WeKnora 返回 HTTP ${response.status}`,
    );
  }
  return parsed as T;
}

async function autoSetup(
  baseUrl: string,
  setupToken: string,
): Promise<string> {
  const response = await weKnoraRequest<{
    data?: { token?: string };
    token?: string;
  }>(baseUrl, "/auth/auto-setup", {
    method: "POST",
    body: "{}",
    headers: { "X-WeKnora-Desktop-Token": setupToken },
  });
  const token = response.token || response.data?.token;
  if (!token) throw new Error("WeKnora 免登录初始化没有返回访问令牌。");
  return token;
}

function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return Date.now() + 20 * 60 * 60_000;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof parsed.exp === "number"
      ? parsed.exp * 1_000
      : Date.now() + 20 * 60 * 60_000;
  } catch {
    return Date.now() + 20 * 60 * 60_000;
  }
}

async function ensureEmbeddingModel(
  baseUrl: string,
  token: string,
  internalSecret: string,
  appPort: number,
  settings: RuntimeSettings,
): Promise<string> {
  const expectedBaseUrl = `http://127.0.0.1:${appPort}/api/internal/embeddings/v1`;
  const expectedName = `${MODEL_NAME}-${appPort}`;
  const existing = await weKnoraRequest<{
    data?: Array<{
      id?: string;
      name?: string;
      parameters?: { base_url?: string };
    }>;
  }>(baseUrl, "/models", { token });
  const found = (existing.data ?? []).find(
    (model) =>
      (model.id === settings.embeddingModelId ||
        model.name === expectedName) &&
      model.parameters?.base_url === expectedBaseUrl,
  );
  if (found?.id) return found.id;
  const created = await weKnoraRequest<{ data?: { id?: string } }>(
    baseUrl,
    "/models",
    {
      method: "POST",
      token,
      body: JSON.stringify({
        name: expectedName,
        display_name: "Draft Studio 内置检索向量",
        type: "Embedding",
        source: "remote",
        description: "由 Draft Studio 托管的本地轻量检索向量服务。",
        parameters: {
          base_url: expectedBaseUrl,
          api_key: internalSecret,
          interface_type: "openai",
          provider: "openai",
          embedding_parameters: { dimension: 384 },
          spec: { api: "openai-embeddings" },
        },
      }),
    },
  );
  const id = created.data?.id;
  if (!id) throw new Error("创建 WeKnora 内置向量模型失败。");
  settings.embeddingModelId = id;
  settings.appPort = appPort;
  settings.updatedAt = new Date().toISOString();
  await persistSettings(settings);
  return id;
}

async function ensureKnowledgeBase(
  baseUrl: string,
  token: string,
  embeddingModelId: string,
  settings: RuntimeSettings,
  appPort: number,
): Promise<string> {
  const expectedName = `${KNOWLEDGE_BASE_NAME}-${appPort}`;
  const existing = await weKnoraRequest<{
    data?: Array<{
      id?: string;
      name?: string;
      embedding_model_id?: string;
    }>;
  }>(baseUrl, "/knowledge-bases", { token });
  const found = (existing.data ?? []).find(
    (knowledgeBase) =>
      (knowledgeBase.id === settings.knowledgeBaseId ||
        knowledgeBase.name === expectedName) &&
      knowledgeBase.embedding_model_id === embeddingModelId,
  );
  if (found?.id) return found.id;
  const created = await weKnoraRequest<{ data?: { id?: string } }>(
    baseUrl,
    "/knowledge-bases",
    {
      method: "POST",
      token,
      body: JSON.stringify({
        name: expectedName,
        description: "由 Draft Studio 自动创建和同步，不需要手工维护。",
        type: "document",
        embedding_model_id: embeddingModelId,
        summary_model_id: "",
        indexing_strategy: {
          vector_enabled: true,
          keyword_enabled: true,
          wiki_enabled: false,
          graph_enabled: false,
        },
      }),
    },
  );
  const id = created.data?.id;
  if (!id) throw new Error("创建 WeKnora 内置知识库失败。");
  settings.knowledgeBaseId = id;
  settings.updatedAt = new Date().toISOString();
  await persistSettings(settings);
  return id;
}

function assertCurrentGeneration(generation: number): void {
  if (runtimeStore.generation !== generation)
    throw new DOMException("启动已取消。", "AbortError");
}

async function prepareRuntime(
  appPort: number,
  generation: number,
  signal: AbortSignal,
): Promise<BuiltinWeKnoraState> {
  if (runtimeStore.prepare) return runtimeStore.prepare;
  const task = (async () => {
    try {
      assertCurrentGeneration(generation);
      updateState({
        status: "preparing",
        stage: "检查独立运行环境",
        detail: "工作台会自动构建并启动 WeKnora Lite。",
        lastError: undefined,
      });
      const settings = await loadSettings();
      assertCurrentGeneration(generation);
      await mkdir(path.dirname(databasePath), { recursive: true });
      await mkdir(storagePath, { recursive: true });
      const { binary, sourceDir } = await ensureBinary(signal);
      assertCurrentGeneration(generation);
      if (!processRunning(runtimeStore.child)) {
        const baseUrl = `http://127.0.0.1:${RUNTIME_PORT}`;
        if (await serviceResponds(baseUrl))
          throw new Error(
            `端口 ${RUNTIME_PORT} 已被其他服务占用。为避免误连到非工作台实例，本轮启动已取消。`,
          );
        updateState({
          status: "starting",
          stage: "启动知识引擎",
          detail: "正在启动本机 WeKnora Lite 与 SQLite 检索引擎。",
        });
        await mkdir(runtimeRoot, { recursive: true });
        const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
        const child = spawn(binary, [], {
          cwd: sourceDir,
          env: {
            ...runtimeEnvironment(),
            GIN_MODE: "release",
            LOG_LEVEL: "warn",
            SERVER_HOST: "127.0.0.1",
            SERVER_PORT: String(RUNTIME_PORT),
            DB_DRIVER: "sqlite",
            DB_PATH: databasePath,
            RETRIEVE_DRIVER: "sqlite",
            LOCAL_STORAGE_BASE_DIR: storagePath,
            STREAM_MANAGER_TYPE: "memory",
            NEO4J_ENABLE: "false",
            ENABLE_GRAPH_RAG: "false",
            WEKNORA_SANDBOX_MODE: "disabled",
            SSRF_WHITELIST_EXTRA: "127.0.0.1",
            SYSTEM_AES_KEY: settings.aesKey,
            JWT_SECRET: settings.jwtSecret,
            WEKNORA_LITE_SETUP_TOKEN: settings.setupToken,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        child.stdout?.pipe(log);
        child.stderr?.pipe(log);
        runtimeStore.child = child;
        runtimeStore.childGeneration = generation;
        const stopOnExit = () => {
          try {
            if (child.pid && process.platform !== "win32")
              process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            /* The runtime already exited. */
          }
        };
        process.once("exit", stopOnExit);
        updateState({ pid: child.pid, startedAt: new Date().toISOString() });
        child.once("exit", (code, signal) => {
          process.removeListener("exit", stopOnExit);
          if (runtimeStore.child === child) runtimeStore.child = undefined;
          runtimeStore.session = undefined;
          if (runtimeStore.generation !== generation) return;
          updateState({
            status: runtimeStore.stopping || code === 0 ? "stopped" : "error",
            stage:
              runtimeStore.stopping || code === 0
                ? "知识引擎已停止"
                : "知识引擎异常退出",
            detail:
              runtimeStore.stopping || code === 0
                ? "资料仍保存在本机，下次启用会继续使用。"
                : `WeKnora 进程退出（${signal || (code ?? "unknown")}）。`,
            lastError:
              runtimeStore.stopping || code === 0
                ? undefined
                : `WeKnora 进程退出（${signal || (code ?? "unknown")}），查看日志 ${logPath}`,
          });
        });
        log.once("error", () => undefined);
      }
      const baseUrl = `http://127.0.0.1:${RUNTIME_PORT}`;
      const child = runtimeStore.child;
      if (!child) throw new Error("WeKnora 进程没有成功创建。");
      await waitForService(baseUrl, child, signal);
      assertCurrentGeneration(generation);
      updateState({
        stage: "初始化本机知识库",
        detail: "正在校验免登录令牌、向量模型和默认知识库。",
      });
      const token = await autoSetup(baseUrl, settings.setupToken);
      assertCurrentGeneration(generation);
      const embeddingModelId = await ensureEmbeddingModel(
        baseUrl,
        token,
        settings.internalSecret,
        appPort,
        settings,
      );
      assertCurrentGeneration(generation);
      const knowledgeBaseId = await ensureKnowledgeBase(
        baseUrl,
        token,
        embeddingModelId,
        settings,
        appPort,
      );
      assertCurrentGeneration(generation);
      runtimeStore.session = {
        token,
        expiresAt: jwtExpiry(token),
        knowledgeBaseId,
        embeddingModelId,
        baseUrl,
      };
      updateState({
        status: "running",
        stage: "知识引擎运行中",
        detail: "内置检索、资料同步与原文引用已就绪。",
        installed: true,
        port: RUNTIME_PORT,
        knowledgeBaseId,
        embeddingModelId,
        lastError: undefined,
      });
      return state();
    } catch (error) {
      if (runtimeStore.generation !== generation) {
        if (error instanceof DOMException && error.name === "AbortError")
          return state();
        return state();
      }
      const message = error instanceof Error ? error.message : "未知错误";
      runtimeStore.settings = undefined;
      updateState({
        status: "error",
        stage: "知识引擎初始化失败",
        detail: message.slice(0, 1200),
        lastError: message.slice(0, 2000),
        nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
      });
      throw error;
    } finally {
      if (
        runtimeStore.prepareGeneration === generation
      ) {
        runtimeStore.prepare = undefined;
        runtimeStore.prepareGeneration = undefined;
      }
    }
  })();
  runtimeStore.prepare = task;
  runtimeStore.prepareGeneration = generation;
  return task;
}

export async function ensureBuiltinWeKnora(
  appPort: number,
  options: { force?: boolean } = {},
): Promise<BuiltinWeKnoraState> {
  if (runtimeStore.state.status === "running" && runtimeStore.session)
    return state();
  if (
    !options.force &&
    runtimeStore.state.status === "error" &&
    runtimeStore.state.nextRetryAt &&
    Date.parse(runtimeStore.state.nextRetryAt) > Date.now()
  )
    return state();
  if (runtimeStore.prepare) return state();
  runtimeStore.generation += 1;
  runtimeStore.stopping = false;
  updateState({ nextRetryAt: undefined });
  const controller = new AbortController();
  runtimeStore.abortController = controller;
  const task = prepareRuntime(
    appPort,
    runtimeStore.generation,
    controller.signal,
  );
  void task.catch(() => undefined);
  return state();
}

export function builtinWeKnoraState(): BuiltinWeKnoraState {
  if (runtimeStore.state.status !== "running" && processRunning(runtimeStore.child)) {
    return {
      ...runtimeStore.state,
      status: runtimeStore.prepare ? "preparing" : "starting",
    };
  }
  return state();
}

export async function builtinWeKnoraConnection(): Promise<
  RuntimeSession | undefined
> {
  if (
    runtimeStore.session &&
    runtimeStore.session.expiresAt - Date.now() > 60_000
  )
    return runtimeStore.session;
  if (runtimeStore.state.status === "running") return refreshBuiltinSession();
  return runtimeStore.session;
}

export async function refreshBuiltinSession(): Promise<
  RuntimeSession | undefined
> {
  if (runtimeStore.state.status !== "running") return runtimeStore.session;
  const settings = await loadSettings();
  if (!settings.knowledgeBaseId || !settings.embeddingModelId)
    throw new Error("内置 WeKnora 的知识库或向量模型尚未初始化。");
  const baseUrl = `http://127.0.0.1:${RUNTIME_PORT}`;
  const token = await autoSetup(baseUrl, settings.setupToken);
  runtimeStore.session = {
    token,
    expiresAt: jwtExpiry(token),
    knowledgeBaseId: settings.knowledgeBaseId,
    embeddingModelId: settings.embeddingModelId,
    baseUrl,
  };
  return runtimeStore.session;
}

export async function internalEmbeddingSecret(): Promise<string> {
  return (await loadSettings()).internalSecret;
}

export async function stopBuiltinWeKnora(): Promise<BuiltinWeKnoraState> {
  runtimeStore.generation += 1;
  runtimeStore.stopping = true;
  runtimeStore.abortController?.abort();
  runtimeStore.abortController = undefined;
  runtimeStore.prepare = undefined;
  runtimeStore.prepareGeneration = undefined;
  runtimeStore.settings = undefined;
  const child = runtimeStore.child;
  runtimeStore.session = undefined;
  if (processRunning(child)) {
    if (child?.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    } else child?.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise<boolean>((resolve) =>
        child?.once("exit", () => resolve(true)),
      ),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 3_000),
      ),
    ]);
    if (!exited && processRunning(child)) {
      try {
        if (child?.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child?.kill("SIGKILL");
      } catch {
        /* The runtime exited between the timeout and the force-kill. */
      }
      await Promise.race([
        new Promise<void>((resolve) =>
          child?.once("exit", () => resolve()),
        ),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  }
  runtimeStore.child = undefined;
  runtimeStore.childGeneration = undefined;
  updateState({
    status: "stopped",
    stage: "知识引擎已停止",
    detail: "数据已保留，下次启用会直接恢复。",
    pid: undefined,
    lastError: undefined,
  });
  runtimeStore.stopping = false;
  return state();
}
