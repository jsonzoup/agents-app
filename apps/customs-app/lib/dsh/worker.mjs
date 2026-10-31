/** 进程内 DSH 运行时线程：home 上只有一个 runtime，每票一个 conversation。 */
import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRuntime } from "../../../adapters/dsh/embedded.mjs";

const harnessRoot = path.resolve(process.env.DSH_RUNTIME_ROOT || path.resolve(process.cwd(), "../../deepseek-harness"));
const adapterEntry = createRequire(path.resolve(harnessRoot, "packages/bundle/base/package.json")).resolve("@deepseek-ai/dsh-llm-pi-ai");
if (!readFileSync(adapterEntry, "utf8").includes("maxImagesPerRequest")) {
  throw new Error(`loaded llm adapter has no image cap: ${adapterEntry}`);
}
console.warn(`azure image cap module=${adapterEntry}`);

if (workerData?.dshHome) process.env.DSH_HOME = workerData.dshHome;
process.env.DSH_PERMISSION_MODE = "danger-full-access";
const brewBin = "/opt/homebrew/bin";
const runtimeRoot = path.resolve(process.cwd(), "data/runtime");
const installedBins = ["poppler/bin", "python/bin"]
  .map((dir) => path.join(runtimeRoot, dir))
  .filter((dir) => existsSync(dir));
const pathEntries = new Set(String(process.env.PATH || "").split(":").filter(Boolean));
if (!pathEntries.has(brewBin)) {
  process.env.PATH = `${brewBin}:${process.env.PATH || ""}`;
}
for (const dir of [...installedBins].reverse()) {
  if (!pathEntries.has(dir)) process.env.PATH = `${dir}:${process.env.PATH || ""}`;
}

const PERSONA =
  "语言规则（最高优先级）：始终使用与用户当前消息相同的语言回复；用户用中文时一律用简体中文。\n\n" +
  "你是报关灵的制单会话。业务技能从当前 home 的 skills 目录加载；用户以 /技能名 显式调用。字段结果只通过 MCP 工具 mcp__business__draft_commit 回写，不要在对话里另造一份草单存储。\n\n" +
  "已经能执行的命令和已经能 import 的库都视为已安装，直接复用 data/runtime。不要用 brew、micromamba、conda、uv 或 pip 再装一遍，也不要为新票重建虚拟环境。只有某条命令或某个 import 确实失败时，才把缺失的那一项补进 data/runtime。";

if (!process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_KEY) {
  process.env.AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_KEY;
}

const azureBase = (process.env.AZURE_OPENAI_BASE_URL || "https://baoguandan.openai.azure.com/openai/v1").replace(/\/+$/, "");
const fs = await import("node:fs/promises");
const os = await import("node:os");
const azureDir = await fs.mkdtemp(path.join(os.tmpdir(), "bgl-azure-"));
const azurePatch = path.join(azureDir, "azure.yml");
await fs.writeFile(azurePatch, [
  "- id: llm-pi-ai",
  "  config:",
  "    providers:",
  "      azure-openai-responses:",
  "        displayName: Azure OpenAI",
  "        apiKeyEnv: AZURE_OPENAI_API_KEY",
  "        maxImagesPerRequest: 30",
  `        baseURL: ${JSON.stringify(azureBase)}`,
  "        models:",
  "          - id: gpt-6.1-sol",
  "            name: gpt-6.1-sol",
  "            input: [text, image]",
].join("\n"));

const runtimePromise = createRuntime({
  cwd: process.cwd(),
  persona: PERSONA,
  dshHome: workerData?.dshHome,
  skillDirs: workerData?.skillDirs ?? [],
  mcpServers: workerData?.mcpServers ?? [],
  patchFiles: [azurePatch],
}).then((rt) => {
  const sandbox = rt.ctx.shell?.sandboxMode;
  const approval = rt.ctx.approval?.config?.policy;
  console.warn(`dsh permission default sandbox=${sandbox} approval=${approval}`);
  return rt;
});
const conversations = new Map();
const opening = new Map();
const gates = new Map();

function exclusive(key, fn) {
  const prev = gates.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  gates.set(key, run);
  return run;
}

function releaseSession(rt, sessionId) {
  if (!sessionId) return;
  try {
    const presets = rt.ctx.get("permissionPresets");
    const session = rt.ctx.sessions?.get?.(sessionId);
    if (!presets || !session) {
      console.warn(`permission release skipped session=${sessionId} presets=${Boolean(presets)} live=${Boolean(session)}`);
      return;
    }
    presets.set(session, "danger-full-access");
  } catch (error) {
    console.warn(`permission release failed: ${error instanceof Error ? error.message : error}`);
  }
}

function ownedHere(sessionId) {
  for (const cached of conversations.values()) {
    if (cached.conversation.sessionId === sessionId) return cached.conversation;
  }
  return null;
}

async function conversationFor(msg) {
  const rt = await runtimePromise;
  const model = msg.model || "";
  const provider = msg.provider || "";
  const cached = conversations.get(msg.key);
  if (cached && cached.model === model && cached.provider === provider) {
    releaseSession(rt, cached.conversation.sessionId);
    return cached.conversation;
  }
  if (cached) {
    conversations.delete(msg.key);
    await cached.conversation.close().catch(() => undefined);
  }
  const pending = opening.get(msg.key);
  if (pending) return pending;
  const job = openConversation(rt, msg, model, provider).finally(() => opening.delete(msg.key));
  opening.set(msg.key, job);
  return job;
}

async function openConversation(rt, msg, model, provider) {
  const open = async () => {
    const sessionId = msg.sessionId || `session-${msg.key}`;
    const held = ownedHere(sessionId);
    if (held) return held;
    if (msg.sessionId) {
      try {
        return await rt.resumeConversation({ sessionId: msg.sessionId, provider, model: msg.model });
      } catch (error) {
        const message = String(error?.message || error);
        const again = ownedHere(msg.sessionId);
        if (again && /already owned/i.test(message)) return again;
        if (!/not found|unknown session|no such/i.test(message)) throw error;
      }
    }
    try {
      return await rt.createConversation({ id: msg.key, cwd: msg.cwd || process.cwd(), provider, model: msg.model });
    } catch (error) {
      const message = String(error?.message || error);
      if (/already owned/i.test(message)) {
        const again = ownedHere(sessionId);
        if (again) return again;
      }
      if (!/already exists/i.test(message)) throw error;
      return rt.resumeConversation({ sessionId, provider, model: msg.model });
    }
  };
  const conversation = await open();
  releaseSession(rt, conversation.sessionId);
  if (!conversations.has(msg.key)) {
    conversation.on((message) => parentPort.postMessage({ type: "event", key: msg.key, message }));
    conversations.set(msg.key, { conversation, model, provider });
    parentPort.postMessage({ type: "started", key: msg.key, sessionId: conversation.sessionId });
  }
  return conversation;
}

parentPort.on("message", async (msg) => {
  try {
    if (msg.op === "models") {
      const rt = await runtimePromise;
      const llm = rt.ctx.get("llm");
      const groups = [];
      for (const provider of llm.listProviders()) {
        const models = await llm.listModels(provider.id);
        groups.push({
          id: provider.id,
          name: provider.name || provider.id,
          models: models.map((item) => ({ id: item.id, name: item.name || item.id })),
        });
      }
      groups.sort((left, right) => Number(right.id === "azure-openai-responses") - Number(left.id === "azure-openai-responses") || left.name.localeCompare(right.name));
      parentPort.postMessage({ type: "models", key: msg.key, groups });
      return;
    }
    if (msg.op === "prompt") {
      await exclusive(msg.key, async () => {
        const conversation = await conversationFor(msg);
        await conversation.prompt(msg.text);
      });
      return;
    }
    if (msg.op === "abort" || msg.op === "clear") {
      await exclusive(msg.key, async () => {
        const cached = conversations.get(msg.key);
        conversations.delete(msg.key);
        if (cached) await cached.conversation.abort();
        if (msg.op === "clear") parentPort.postMessage({ type: "cleared", key: msg.key });
      });
      return;
    }
    if (msg.op === "close") {
      const rt = await runtimePromise;
      for (const cached of conversations.values()) await cached.conversation.close().catch(() => undefined);
      conversations.clear();
      await rt.close();
    }
  } catch (error) {
    parentPort.postMessage({ type: "error", key: msg.key, message: String(error?.message || error) });
  }
});
