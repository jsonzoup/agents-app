import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import sharp from "sharp";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "http://127.0.0.1:8795";
const tempHome = await mkdtemp(path.join(os.tmpdir(), "draft-studio-api-"));
let serverOutput = "";
let server;
let token = "";
let weknoraServer;
let builtinMockBinary = "";
let builtinMockSource = "";
let builtinObservedPath = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(
  pathname,
  { method = "GET", body, auth = true, raw = false } = {},
) {
  const response = await fetch(`${baseUrl}/api${pathname}`, {
    method,
    headers: {
      Origin: baseUrl,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(auth && token ? { "X-Draft-Studio-Token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${pathname} 失败（${response.status}）：${text}`);
  if (raw) return { response, text };
  return text ? JSON.parse(text) : {};
}

async function startServer() {
  const entry = path.join(appRoot, "node_modules/next/dist/bin/next");
  server = spawn(
    process.execPath,
    [entry, "dev", "-H", "127.0.0.1", "-p", "8795"],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        DRAFT_STUDIO_HOME: tempHome,
        PORT: "8795",
        DRAFT_STUDIO_DIST_DIR: ".next-api",
        WEKNORA_LITE_BINARY: builtinMockBinary,
        WEKNORA_SOURCE_DIR: builtinMockSource,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
    });
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/session`)).ok) return;
    } catch {
      /* Retry startup. */
    }
    await sleep(300);
  }
  throw new Error(`服务启动失败。\n${serverOutput}`);
}

async function prepareBuiltinRuntimeMock() {
  builtinMockBinary = path.join(tempHome, "mock-weknora-lite.mjs");
  builtinMockSource = path.join(tempHome, "mock-weknora-source");
  builtinObservedPath = path.join(tempHome, "mock-weknora-env.json");
  await mkdir(path.join(builtinMockSource, "config"), { recursive: true });
  await writeFile(
    path.join(builtinMockSource, "config", "config.yaml"),
    "server: {}\n",
  );
  const script = `#!/usr/bin/env node
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(builtinObservedPath)}, JSON.stringify({
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  openai: Boolean(process.env.OPENAI_API_KEY),
  wechat: Boolean(process.env.WECHAT_APP_SECRET),
  setup: Boolean(process.env.WEKNORA_LITE_SETUP_TOKEN),
  proxy: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
  goProxy: Boolean(process.env.GOPROXY),
}));
let modelId = "";
let knowledgeBaseId = "";
let sequence = 0;
const documents = new Map();
async function body(request) {
  let value = "";
  request.setEncoding("utf8");
  for await (const chunk of request) value += chunk;
  return value ? JSON.parse(value) : {};
}
function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  if (pathname === "/api/v1/auth/config") return send(response, 200, { success: true, registration_mode: "self_serve" });
  if (pathname === "/api/v1/auth/auto-setup") {
    if (request.headers["x-weknora-desktop-token"] !== process.env.WEKNORA_LITE_SETUP_TOKEN)
      return send(response, 401, { error: { message: "desktop token mismatch" } });
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 2 })).toString("base64url");
    return send(response, 200, { success: true, token: header + "." + payload + ".mock" });
  }
  if (pathname === "/api/v1/models" && request.method === "GET")
    return send(response, 200, { success: true, data: modelId ? [{ id: modelId, name: "draft-studio-local-embedding-v1-8795", parameters: { base_url: "http://127.0.0.1:8795/api/internal/embeddings/v1" } }] : [] });
  if (pathname === "/api/v1/models" && request.method === "POST") {
    const payload = await body(request);
    modelId = "model-mock";
    return send(response, 201, { success: true, data: { id: modelId, name: payload.name, parameters: payload.parameters } });
  }
  if (pathname === "/api/v1/knowledge-bases" && request.method === "GET")
    return send(response, 200, { success: true, data: knowledgeBaseId ? [{ id: knowledgeBaseId, name: "draft studio 内置知识库-8795", embedding_model_id: modelId }] : [] });
  if (pathname === "/api/v1/knowledge-bases" && request.method === "POST") {
    knowledgeBaseId = "kb-mock";
    return send(response, 201, { success: true, data: { id: knowledgeBaseId, name: "draft studio 内置知识库-8795", embedding_model_id: modelId } });
  }
  const manual = pathname.match(/^\\/api\\/v1\\/knowledge-bases\\/[^/]+\\/knowledge\\/manual$/);
  if (manual && request.method === "POST") {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const payload = await body(request);
    const id = "doc-builtin-" + (++sequence);
    documents.set(id, payload);
    return send(response, 200, { success: true, data: { id, title: payload.title, content: payload.content } });
  }
  const docPath = pathname.match(/^\\/api\\/v1\\/knowledge\\/([^/]+)$/);
  if (docPath) {
    const id = decodeURIComponent(docPath[1]);
    const document = documents.get(id);
    if (request.method === "DELETE") {
      documents.delete(id);
      return send(response, 200, { success: true });
    }
    if (request.method === "PUT") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!document) return send(response, 404, {});
      const payload = await body(request);
      documents.set(id, payload);
      return send(response, 200, { success: true, data: { id } });
    }
    if (!document) return send(response, 404, {});
    return send(response, 200, { success: true, data: { id, title: document.title, description: "", knowledge_base_id: knowledgeBaseId, knowledge_base_name: "内置" } });
  }
  const chunksPath = pathname.match(/^\\/api\\/v1\\/chunks\\/([^/]+)$/);
  if (chunksPath) {
    const document = documents.get(decodeURIComponent(chunksPath[1]));
    return send(response, 200, { success: true, data: document ? [{ id: "chunk-1", content: document.content, chunk_index: 0 }] : [], total: document ? 1 : 0 });
  }
  if (pathname === "/api/v1/knowledge-search") {
    const payload = await body(request);
    return send(response, 200, {
      success: true,
      data: [...documents.entries()].map(([id, document], index) => ({
        id: "hit-" + index,
        content: document.content,
        knowledge_id: id,
        knowledge_title: document.title,
        knowledge_base_id: knowledgeBaseId,
        score: 0.9,
      })),
    });
  }
  send(response, 404, {});
});
setTimeout(
  () => server.listen(Number(process.env.SERVER_PORT), "127.0.0.1"),
  500,
);
`;
  await writeFile(builtinMockBinary, script, { mode: 0o755 });
  await chmod(builtinMockBinary, 0o755);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    sleep(5_000),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function waitForBuiltinRuntime(status, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await request("/knowledge/plugins");
    if (state.runtime.status === status) return state;
    if (state.runtime.status === "error")
      throw new Error(`内置 WeKnora 失败：${state.runtime.lastError}`);
    await sleep(250);
  }
  throw new Error(`内置 WeKnora 未进入 ${status} 状态。`);
}

async function waitForKnowledgeSync(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await request("/knowledge/sync");
    if (result.run?.status !== "运行中") return result.run;
    await sleep(200);
  }
  throw new Error("内置知识同步未在超时内结束。");
}

async function startWeKnoraMock() {
  weknoraServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:8796");
    const send = (payload) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (url.pathname === "/api/v1/knowledge-bases") {
      send({
        success: true,
        data: [{ id: "kb-test", name: "研究库" }],
      });
      return;
    }
    if (url.pathname === "/api/v1/knowledge-search") {
      send({
        success: true,
        data: [
          {
            id: "chunk-hit-1",
            content: "WeKnora 命中的原文事实。",
            knowledge_id: "doc-test-1",
            knowledge_title: "WeKnora 集成测试文档",
            knowledge_base_id: "kb-test",
            knowledge_base_name: "研究库",
            score: 0.91,
          },
        ],
      });
      return;
    }
    if (url.pathname === "/api/v1/knowledge/doc-test-1") {
      send({
        success: true,
        data: {
          id: "doc-test-1",
          title: "WeKnora 集成测试文档",
          description: "用于验证外部知识导入、去重和本地图谱接入。",
          knowledge_base_id: "kb-test",
          knowledge_base_name: "研究库",
          created_at: "2026-10-26T00:00:00.000Z",
        },
      });
      return;
    }
    if (url.pathname === "/api/v1/chunks/doc-test-1") {
      send({
        success: true,
        data: [
          {
            id: "chunk-1",
            knowledge_id: "doc-test-1",
            chunk_index: 0,
            content: "WeKnora 命中的原文事实。这里保留完整上下文。",
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      });
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) =>
    weknoraServer.listen(8796, "127.0.0.1", resolve),
  );
}

try {
  await startWeKnoraMock();
  await prepareBuiltinRuntimeMock();
  await startServer();
  const session = await request("/session", { auth: false });
  token = session.token;
  assert.ok(token);
  assert.equal(session.visualPromptLibrary.templateCount, 22);
  assert.deepEqual(
    session.knowledgePlugins.map((plugin) => plugin.id),
    ["kuzu-local", "weknora"],
  );

  const unauthenticated = await fetch(`${baseUrl}/api/sources`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "unauthorized", direction: "科研" }),
  });
  assert.equal(unauthenticated.status, 403);

  let workspace = await request("/workspace");
  assert.equal(workspace.sources.length, 0);
  assert.ok(workspace.sites.length >= 20);
  assert.ok(workspace.sites.every((site) => site.maxArticles === 10));
  assert.equal(workspace.settings.topicMix["商业化"], 25);
  assert.equal(workspace.settings.topicMix["AI 人文视角"], 15);
  assert.equal(workspace.settings.topicMix["学术前沿"], 10);
  assert.equal(workspace.settings.topicsPerRun, 6);
  const pluginCatalog = await request("/knowledge/plugins");
  assert.equal(pluginCatalog.weknora.mode, "builtin");
  assert.equal(pluginCatalog.weknora.enabled, false);
  assert.equal(pluginCatalog.runtime.version, "v0.8.3");
  assert.equal(pluginCatalog.embeddingDimensions, 384);
  const stoppedBuiltin = await request("/knowledge/plugins/weknora/stop", {
    method: "POST",
    body: {},
  });
  assert.equal(stoppedBuiltin.config.mode, "builtin");
  assert.equal(stoppedBuiltin.config.enabled, false);
  assert.equal(stoppedBuiltin.runtime.status, "stopped");
  const afterStopSession = await request("/session", { auth: false });
  const afterStopPlugins = await request("/knowledge/plugins");
  assert.equal(afterStopSession.weknoraRuntime.status, "stopped");
  assert.equal(afterStopPlugins.weknora.enabled, false);
  assert.equal(afterStopPlugins.runtime.status, "stopped");
  await request("/knowledge/plugins/weknora", {
    method: "PUT",
    body: {
      mode: "builtin",
      enabled: true,
      baseUrl: "",
      tenantId: "",
      knowledgeBaseIds: [],
    },
  });
  const stopWhilePreparing = await request(
    "/knowledge/plugins/weknora/stop",
    { method: "POST", body: {} },
  );
  assert.equal(stopWhilePreparing.config.enabled, false);
  assert.equal(stopWhilePreparing.runtime.status, "stopped");
  await sleep(500);
  assert.equal((await request("/knowledge/plugins")).runtime.status, "stopped");
  await request("/knowledge/plugins/weknora", {
    method: "PUT",
    body: {
      mode: "builtin",
      enabled: true,
      baseUrl: "",
      tenantId: "",
      knowledgeBaseIds: [],
    },
  });
  const builtinRunning = await waitForBuiltinRuntime("running");
  assert.equal(builtinRunning.weknora.enabled, true);
  assert.ok(builtinRunning.runtime.knowledgeBaseId);
  assert.ok(builtinRunning.runtime.embeddingModelId);
  const observedEnv = JSON.parse(
    await readFile(builtinObservedPath, "utf8"),
  );
  assert.deepEqual(observedEnv, {
    deepseek: false,
    openai: false,
    wechat: false,
    setup: true,
    proxy: false,
    goProxy: false,
  });
  const builtinSource = await request("/sources", {
    method: "POST",
    body: {
      title: "内置 WeKnora 自动同步测试",
      kind: "资料摘录",
      direction: "科研",
      url: "https://example.com/builtin-sync",
      excerpt: "审核能力与生成速度需要同步扩容，才能改善团队交付。",
      facts: "这段资料应由后台同步任务写入内置知识库。",
      interpretation: "工作台应该自动建立向量和关键词索引。",
      unknowns: "仍需验证大规模资料库。",
    },
  });
  const [startedSync, duplicateSync] = await Promise.all([
    request("/knowledge/sync", { method: "POST", body: {} }),
    request("/knowledge/sync", { method: "POST", body: {} }),
  ]);
  assert.equal(startedSync.run.status, "运行中");
  assert.equal(duplicateSync.run.startedAt, startedSync.run.startedAt);
  const stoppedDuringSync = await fetch(
    `${baseUrl}/api/knowledge/plugins/weknora/stop`,
    {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Draft-Studio-Token": token,
      },
      body: "{}",
    },
  );
  assert.equal(stoppedDuringSync.status, 409);
  const completedSync = await waitForKnowledgeSync();
  assert.equal(completedSync.status, "完成");
  assert.equal(completedSync.created, 1);
  const syncedWorkspace = await request("/workspace");
  assert.ok(
    syncedWorkspace.sources.find(
      (source) => source.id === builtinSource.source.id,
    )?.externalKnowledgeId,
  );
  await sleep(2_500);
  const refreshedSearch = await request("/knowledge/search", {
    method: "POST",
    body: { query: "审核能力与生成速度" },
  });
  assert.ok(
    refreshedSearch.hits.some(
      (hit) =>
        hit.pluginId === "weknora" &&
        hit.title === "内置 WeKnora 自动同步测试",
    ),
  );
  syncedWorkspace.sources.find(
    (source) => source.id === builtinSource.source.id,
  ).externalKnowledgeId = "doc-missing";
  await writeFile(
    path.join(tempHome, "workspace.json"),
    `${JSON.stringify(syncedWorkspace, null, 2)}\n`,
    { mode: 0o600 },
  );
  const repairSync = await request("/knowledge/sync", {
    method: "POST",
    body: {},
  });
  assert.equal(repairSync.run.status, "运行中");
  const repairedSync = await waitForKnowledgeSync();
  assert.equal(repairedSync.status, "完成");
  assert.equal(repairedSync.created, 1);
  const repairedWorkspace = await request("/workspace");
  assert.notEqual(
    repairedWorkspace.sources.find(
      (source) => source.id === builtinSource.source.id,
    )?.externalKnowledgeId,
    "doc-missing",
  );
  const stoppedAfterSync = await request(
    "/knowledge/plugins/weknora/stop",
    { method: "POST", body: {} },
  );
  assert.equal(stoppedAfterSync.config.enabled, false);
  assert.equal(stoppedAfterSync.runtime.status, "stopped");
  const noAutoRestartSession = await request("/session", { auth: false });
  const noAutoRestartPlugins = await request("/knowledge/plugins");
  assert.equal(noAutoRestartSession.weknoraRuntime.status, "stopped");
  assert.equal(noAutoRestartPlugins.runtime.status, "stopped");
  await request(`/sources/${builtinSource.source.id}`, {
    method: "DELETE",
  });
  const externalMarker = path.join(builtinMockSource, "keep.txt");
  await rm(path.join(builtinMockSource, "config", "config.yaml"));
  await writeFile(externalMarker, "keep\n");
  await request("/knowledge/plugins/weknora", {
    method: "PUT",
    body: {
      mode: "builtin",
      enabled: true,
      baseUrl: "",
      tenantId: "",
      knowledgeBaseIds: [],
    },
  });
  const sourceGuardDeadline = Date.now() + 5_000;
  let sourceGuardState;
  while (Date.now() < sourceGuardDeadline) {
    sourceGuardState = await request("/knowledge/plugins");
    if (sourceGuardState.runtime.status === "error") break;
    await sleep(100);
  }
  assert.equal(sourceGuardState.runtime.status, "error");
  assert.match(sourceGuardState.runtime.lastError, /不会修改或删除/);
  assert.equal(await readFile(externalMarker, "utf8"), "keep\n");
  const runtimeSettingsPath = path.join(
    tempHome,
    "runtime",
    "weknora",
    "runtime.json",
  );
  await writeFile(runtimeSettingsPath, "not-json\n", { mode: 0o600 });
  await request("/knowledge/plugins/weknora", {
    method: "PUT",
    body: {
      mode: "builtin",
      enabled: true,
      baseUrl: "",
      tenantId: "",
      knowledgeBaseIds: [],
    },
  });
  const corruptDeadline = Date.now() + 5_000;
  let corruptState;
  while (Date.now() < corruptDeadline) {
    corruptState = await request("/knowledge/plugins");
    if (corruptState.runtime.status === "error") break;
    await sleep(100);
  }
  assert.equal(corruptState.runtime.status, "error");
  assert.match(corruptState.runtime.lastError, /损坏|不会覆盖/);
  assert.equal(await readFile(runtimeSettingsPath, "utf8"), "not-json\n");
  const savedWeKnora = await request("/knowledge/plugins/weknora", {
    method: "PUT",
    body: {
      mode: "external",
      enabled: true,
      baseUrl: "http://127.0.0.1:8796",
      apiKey: "test-key",
      tenantId: "tenant-test",
      knowledgeBaseIds: ["kb-test"],
    },
  });
  assert.equal(savedWeKnora.config.mode, "external");
  assert.equal(savedWeKnora.config.apiKeyConfigured, true);
  assert.equal(savedWeKnora.plugins.find((plugin) => plugin.id === "weknora").enabled, true);
  const externalSearch = await request("/knowledge/search", {
    method: "POST",
    body: { query: "WeKnora 集成了什么？" },
  });
  assert.ok(
    externalSearch.hits.some(
      (hit) =>
        hit.pluginId === "weknora" &&
        hit.documentId === "doc-test-1" &&
        hit.knowledgeBase === "研究库",
    ),
  );
  const importedKnowledge = await request("/knowledge/import", {
    method: "POST",
    body: {
      knowledgeId: "doc-test-1",
      direction: "科研",
    },
  });
  assert.equal(importedKnowledge.source.knowledgePluginId, "weknora");
  assert.match(importedKnowledge.source.excerpt, /完整上下文/);
  const duplicateKnowledge = await request("/knowledge/import", {
    method: "POST",
    body: {
      knowledgeId: "doc-test-1",
      direction: "科研",
    },
  });
  assert.equal(duplicateKnowledge.source.id, importedKnowledge.source.id);
  const hybridSearch = await request("/knowledge/search", {
    method: "POST",
    body: { query: "WeKnora 集成测试文档" },
  });
  assert.ok(
    hybridSearch.hits.some((hit) => hit.pluginId === "kuzu-local"),
  );
  assert.ok(hybridSearch.hits.some((hit) => hit.pluginId === "weknora"));
  await request(`/sources/${importedKnowledge.source.id}`, {
    method: "DELETE",
  });
  const emptyGraph = await request("/knowledge");
  assert.equal(emptyGraph.engine, "Kuzu");
  assert.equal(emptyGraph.counts.sources, 0);
  const invalidMix = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
      "X-Draft-Studio-Token": token,
    },
    body: JSON.stringify({
      topicMix: Object.fromEntries(
        Object.keys(workspace.settings.topicMix).map((direction) => [
          direction,
          0,
        ]),
      ),
    }),
  });
  assert.equal(invalidMix.status, 400);
  const savedMix = await request("/settings", {
    method: "PUT",
    body: {
      ...workspace.settings,
      topicMix: {
        ...workspace.settings.topicMix,
        "AI 边界": 0,
        学术前沿: 20,
      },
    },
  });
  assert.equal(savedMix.settings.topicMix["学术前沿"], 20);
  const noEvidenceResearch = await fetch(
    `${baseUrl}/api/topics/generate-batch`,
    {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Draft-Studio-Token": token,
      },
      body: JSON.stringify({ count: 1 }),
    },
  );
  assert.equal(noEvidenceResearch.status, 400);
  assert.match((await noEvidenceResearch.json()).error, /结构化资料/);

  const candidateId = "src_00000000-0000-4000-8000-000000000001";
  workspace.sources.unshift({
    id: candidateId,
    title: "待清理候选",
    kind: "候选链接",
    eventDate: "",
    url: "https://arxiv.org/abs/2601.00001",
    publisher: "错误的历史信源",
    publishedAt: "",
    capturedAt: new Date().toISOString(),
    direction: "前沿理论 / 论文",
    excerpt: "",
    facts: "",
    interpretation: "",
    unknowns: "等待阅读",
    verification: "待核实",
    contentFile: "fetched-api-test.txt",
  });
  await writeFile(
    path.join(tempHome, "workspace.json"),
    `${JSON.stringify(workspace, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    path.join(tempHome, "archive", "fetched-api-test.txt"),
    "候选原文",
    { mode: 0o600 },
  );
  workspace = await request("/workspace");
  const migratedCandidate = workspace.sources.find(
    (source) => source.id === candidateId,
  );
  assert.equal(migratedCandidate.sourceSiteId, "arxiv");
  assert.equal(migratedCandidate.publisher, "arXiv cs.AI");
  assert.equal(migratedCandidate.direction, "学术前沿");
  const cleared = await request("/sources/candidates", {
    method: "DELETE",
  });
  assert.equal(cleared.removed, 1);
  await assert.rejects(
    access(path.join(tempHome, "archive", "fetched-api-test.txt")),
  );
  workspace = await request("/workspace");
  assert.equal(workspace.sources.length, 0);

  const invalidSites = await fetch(`${baseUrl}/api/sites`, {
    method: "PUT",
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
      "X-Draft-Studio-Token": token,
    },
    body: JSON.stringify({ sites: [{ ...workspace.sites[0], name: "" }] }),
  });
  assert.equal(invalidSites.status, 400);

  const sourceBody = {
    title: "API 回归资料",
    kind: "资料摘录",
    eventDate: "2026-10-24",
    url: "https://example.com/research/",
    publisher: "API Test",
    publishedAt: "2026-10-24",
    direction: "科研",
    excerpt: "一段可核实的测试原文。",
    facts: "测试事实。",
    interpretation: "测试推断。",
    unknowns: "测试未知。",
  };
  const createdSource = await request("/sources", {
    method: "POST",
    body: sourceBody,
  });
  const duplicateSource = await request("/sources", {
    method: "POST",
    body: { ...sourceBody, url: "https://example.com/research" },
  });
  assert.equal(duplicateSource.source.id, createdSource.source.id);

  const form = new FormData();
  form.set(
    "file",
    new Blob(["本地附件内容"], { type: "text/plain" }),
    "attachment.txt",
  );
  const upload = await fetch(
    `${baseUrl}/api/sources/${createdSource.source.id}/file`,
    {
      method: "POST",
      headers: { Origin: baseUrl, "X-Draft-Studio-Token": token },
      body: form,
    },
  );
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  const secondForm = new FormData();
  secondForm.set(
    "file",
    new Blob(["重复附件"], { type: "text/plain" }),
    "attachment.txt",
  );
  const duplicateUpload = await fetch(
    `${baseUrl}/api/sources/${createdSource.source.id}/file`,
    {
      method: "POST",
      headers: { Origin: baseUrl, "X-Draft-Studio-Token": token },
      body: secondForm,
    },
  );
  assert.equal(duplicateUpload.status, 409);
  const attachment = await fetch(
    `${baseUrl}/api/sources/${createdSource.source.id}/file`,
  );
  assert.equal(attachment.status, 200);
  assert.equal(await attachment.text(), "本地附件内容");

  const topic = await request("/topics", {
    method: "POST",
    body: {
      title: "API 回归选题",
      direction: "科研",
      thesis: "测试判断",
      readerValue: "测试读者价值",
      sourceIds: [createdSource.source.id],
    },
  });
  const invalidStatus = await fetch(
    `${baseUrl}/api/topics/${topic.topic.id}`,
    {
      method: "PATCH",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Draft-Studio-Token": token,
      },
      body: JSON.stringify({ status: "invalid" }),
    },
  );
  assert.equal(invalidStatus.status, 400);
  await request(`/topics/${topic.topic.id}`, {
    method: "PATCH",
    body: { status: "准备写作" },
  });
  workspace = await request("/workspace");
  workspace.entities = [
    {
      id: "entity_00000000-0000-4000-8000-000000000001",
      name: "OpenAI",
      type: "公司",
      summary: "OpenAI 发布测试模型。",
      sourceIds: [createdSource.source.id],
      updatedAt: new Date().toISOString(),
    },
    {
      id: "entity_00000000-0000-4000-8000-000000000002",
      name: "open ai",
      type: "公司/产品",
      summary: "同一实体的重复抽取。",
      sourceIds: [createdSource.source.id],
      updatedAt: new Date().toISOString(),
    },
    {
      id: "entity_00000000-0000-4000-8000-000000000003",
      name: "GPT 测试模型",
      type: "AI模型",
      summary: "用于验证实体类型规范化。",
      sourceIds: [createdSource.source.id],
      updatedAt: new Date().toISOString(),
    },
  ];
  workspace.relations = [
    {
      id: "edge_00000000-0000-4000-8000-000000000001",
      fromId: "entity_00000000-0000-4000-8000-000000000001",
      toId: "entity_00000000-0000-4000-8000-000000000003",
      label: "发布研究预览",
      sourceIds: [createdSource.source.id],
    },
    {
      id: "edge_00000000-0000-4000-8000-000000000002",
      fromId: "entity_00000000-0000-4000-8000-000000000002",
      toId: "entity_00000000-0000-4000-8000-000000000003",
      label: "发布",
      sourceIds: [createdSource.source.id],
    },
  ];
  await writeFile(
    path.join(tempHome, "workspace.json"),
    `${JSON.stringify(workspace, null, 2)}\n`,
    { mode: 0o600 },
  );
  const indexedGraph = await request("/knowledge");
  assert.equal(indexedGraph.engine, "Kuzu");
  assert.equal(indexedGraph.counts.sources, 1);
  assert.equal(indexedGraph.counts.topics, 1);
  assert.equal(indexedGraph.normalization.rawEntities, 3);
  assert.equal(indexedGraph.normalization.canonicalEntities, 2);
  assert.equal(indexedGraph.normalization.rawRelations, 2);
  assert.equal(indexedGraph.normalization.canonicalRelations, 1);
  assert.ok(
    indexedGraph.entities.some(
      (entity) => entity.name === "OpenAI" && entity.type === "公司",
    ),
  );
  const orphanTopic = await request("/topics", {
    method: "POST",
    body: {
      title: "缺少来源的选题",
      direction: "科研",
      sourceIds: ["src_00000000-0000-4000-8000-000000000099"],
    },
  });
  const orphanGeneration = await fetch(
    `${baseUrl}/api/topics/${orphanTopic.topic.id}/generate`,
    {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Draft-Studio-Token": token,
      },
      body: "{}",
    },
  );
  assert.equal(orphanGeneration.status, 400);
  assert.match((await orphanGeneration.json()).error, /结构化资料/);
  await request(`/topics/${orphanTopic.topic.id}`, { method: "DELETE" });

  const blankDraft = await request(`/topics/${topic.topic.id}/draft`, {
    method: "POST",
    body: { channel: "wechat" },
  });
  assert.equal(blankDraft.draft.channel, "wechat");
  const savedDraft = await request(`/drafts/${blankDraft.draft.id}`, {
    method: "PUT",
    body: {
      ...blankDraft.draft,
      title: "T".repeat(120),
      body: "完整测试正文",
      creativeBrief: {
        ...blankDraft.draft.creativeBrief,
        commonBelief: "测试默认认知",
        counterAngle: "测试反常识判断",
        emotionalArc: "焦虑 → 释然",
        readerMirror: "测试读者",
        opening: "测试开头",
        development: "测试展开",
        turn: "测试转折",
        landing: "测试落点",
        shareLine: "测试传播句",
      },
    },
  });
  assert.equal(savedDraft.draft.title.length, 80);
  const invalidCopilot = await fetch(
    `${baseUrl}/api/drafts/${blankDraft.draft.id}/copilot`,
    {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Draft-Studio-Token": token,
      },
      body: JSON.stringify({ message: "", target: "title" }),
    },
  );
  assert.equal(invalidCopilot.status, 400);
  const xhsVariant = await request(
    `/drafts/${blankDraft.draft.id}/channel`,
    { method: "POST", body: { channel: "xiaohongshu" } },
  );
  assert.equal(xhsVariant.draft.channel, "xiaohongshu");
  assert.equal(xhsVariant.draft.title, "");
  assert.equal(xhsVariant.draft.channelVariants.wechat.body, "完整测试正文");
  await request(`/drafts/${blankDraft.draft.id}`, {
    method: "PUT",
    body: {
      ...xhsVariant.draft,
      title: "小红书版本标题",
      body: "小红书版本正文",
    },
  });
  const restoredWechat = await request(
    `/drafts/${blankDraft.draft.id}/channel`,
    { method: "POST", body: { channel: "wechat" } },
  );
  assert.equal(restoredWechat.draft.channel, "wechat");
  assert.equal(restoredWechat.draft.body, "完整测试正文");
  assert.equal(
    restoredWechat.draft.channelVariants.xiaohongshu.body,
    "小红书版本正文",
  );
  const exported = await request(`/drafts/${blankDraft.draft.id}/export`, {
    raw: true,
  });
  assert.match(exported.text, /完整测试正文/);
  const packageWithoutImages = await fetch(
    `${baseUrl}/api/drafts/${blankDraft.draft.id}/package`,
    { headers: { "X-Draft-Studio-Token": token } },
  );
  assert.equal(packageWithoutImages.status, 400);

  const pixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const packageImages = [
    {
      id: "image_00000000-0000-4000-8000-000000000001",
      role: "封面主视觉",
      title: "封面",
      fileName:
        "draft_00000000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000001.png",
    },
    {
      id: "image_00000000-0000-4000-8000-000000000002",
      role: "机制展开",
      title: "开头机制",
      fileName:
        "draft_00000000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000002.png",
    },
    {
      id: "image_00000000-0000-4000-8000-000000000003",
      role: "证据细节",
      title: "第二节证据",
      fileName:
        "draft_00000000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000003.png",
    },
  ].map((image) => ({
    ...image,
    prompt: "",
    createdAt: new Date().toISOString(),
  }));
  for (const image of packageImages)
    await writeFile(path.join(tempHome, "media", image.fileName), pixelPng);
  workspace = await request("/workspace");
  const wechatDraft = workspace.drafts.find(
    (draft) => draft.id === blankDraft.draft.id,
  );
  Object.assign(wechatDraft, {
    channel: "wechat",
    body: "# 第一节\n\n正文段落。\n\n> 这是一段引用。",
    wechatAuthor: "测试作者",
    wechatSummary: "测试摘要",
    images: packageImages,
    wechatCoverImageId: packageImages[0].id,
    imagePlacements: {
      [packageImages[1].id]: 0,
      [packageImages[2].id]: 1,
    },
  });
  await writeFile(
    path.join(tempHome, "workspace.json"),
    `${JSON.stringify(workspace, null, 2)}\n`,
    { mode: 0o600 },
  );
  const wechatPackage = await fetch(
    `${baseUrl}/api/drafts/${blankDraft.draft.id}/package`,
    { headers: { "X-Draft-Studio-Token": token } },
  );
  assert.equal(wechatPackage.status, 200);
  const packed = await JSZip.loadAsync(await wechatPackage.arrayBuffer());
  const articleHtml = await packed.file("article.html").async("string");
  assert.match(articleHtml, /<h2>第一节<\/h2>/);
  assert.match(articleHtml, /<blockquote>这是一段引用。<\/blockquote>/);
  assert.match(articleHtml, /正文图\/01-开头机制\.png/);
  assert.match(articleHtml, /正文图\/02-第二节证据\.png/);
  assert.match(
    articleHtml,
    /<figcaption[^>]*>开头机制<\/figcaption>/,
  );
  assert.doesNotMatch(
    articleHtml,
    /<figcaption[^>]*>机制展开<\/figcaption>/,
  );
  const cover = await packed
    .file("封面图/封面-1080x460.png")
    .async("nodebuffer");
  const coverMetadata = await sharp(cover).metadata();
  assert.equal(coverMetadata.width, 1080);
  assert.equal(coverMetadata.height, 460);
  const bodyImage = await packed
    .file("正文图/01-开头机制.png")
    .async("nodebuffer");
  const bodyMetadata = await sharp(bodyImage).metadata();
  assert.equal(bodyMetadata.width, 1080);
  assert.equal(bodyMetadata.height, 1440);
  const publishData = JSON.parse(
    await packed.file("发布数据.json").async("string"),
  );
  assert.equal(publishData.channel, "wechat");
  assert.deepEqual(
    publishData.bodyImages.map((image) => image.insertAfterBlock),
    [0, 1],
  );
  const xhsSharedVisuals = await request(
    `/drafts/${blankDraft.draft.id}/channel`,
    { method: "POST", body: { channel: "xiaohongshu" } },
  );
  assert.equal(xhsSharedVisuals.draft.images.length, packageImages.length);
  assert.equal(xhsSharedVisuals.draft.wechatCoverImageId, undefined);
  const wechatRestoredVisuals = await request(
    `/drafts/${blankDraft.draft.id}/channel`,
    { method: "POST", body: { channel: "wechat" } },
  );
  assert.equal(wechatRestoredVisuals.draft.images.length, packageImages.length);
  assert.equal(
    wechatRestoredVisuals.draft.wechatCoverImageId,
    packageImages[0].id,
  );

  await request(`/sources/${createdSource.source.id}`, { method: "DELETE" });
  workspace = await request("/workspace");
  assert.equal(workspace.sources.length, 0);
  assert.deepEqual(
    workspace.topics.find((entry) => entry.id === topic.topic.id)?.sourceIds,
    [],
  );
  const missingAttachment = await fetch(
    `${baseUrl}/api/sources/${createdSource.source.id}/file`,
  );
  assert.equal(missingAttachment.status, 404);
  await assert.rejects(access(path.join(tempHome, "archive", uploaded.source.fileName)));

  await request(`/drafts/${blankDraft.draft.id}`, { method: "DELETE" });
  await request(`/topics/${topic.topic.id}/draft`, {
    method: "POST",
    body: {},
  });
  await request(`/topics/${topic.topic.id}`, { method: "DELETE" });
  workspace = await request("/workspace");
  assert.equal(workspace.drafts.length, 0);
  assert.equal(workspace.topics.length, 0);

  const bulkCandidates = Array.from({ length: 25 }, (_, index) => ({
    id: `src_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `批量补偿候选 ${index + 1}`,
    kind: "候选链接",
    eventDate: "",
    url: `https://127.0.0.1/candidate-${index + 1}`,
    publisher: "本地回归测试",
    publishedAt: "",
    capturedAt: new Date().toISOString(),
    direction: "科研",
    excerpt: "",
    facts: "",
    interpretation: "",
    unknowns: "等待读取原文",
    verification: "待核实",
  }));
  workspace.sources.unshift(...bulkCandidates);
  await writeFile(
    path.join(tempHome, "workspace.json"),
    `${JSON.stringify(workspace, null, 2)}\n`,
    { mode: 0o600 },
  );
  const bulkRun = await request("/sources/process-candidates", {
    method: "POST",
    body: {},
  });
  assert.equal(bulkRun.run.totalSources, bulkCandidates.length);
  assert.equal(bulkRun.run.found, bulkCandidates.length);

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks: [
          "authentication",
          "defaults",
          "plugin configuration",
          "built-in runtime lifecycle",
          "prepare cancellation",
          "child environment isolation",
          "background knowledge sync",
          "sync repair retry",
          "expired session refresh",
          "external source directory protection",
          "corrupt runtime settings protection",
          "hybrid knowledge search",
          "external document import",
          "site validation",
          "canonical duplicate",
          "attachment validation",
          "candidate cleanup",
          "topic validation",
          "draft limits",
          "channel variants",
          "shared visuals",
          "export",
          "wechat package",
          "cascade delete",
          "file cleanup",
          "all candidates selected",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (serverOutput) console.error(`\n服务日志：\n${serverOutput.slice(-12_000)}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (weknoraServer)
    await new Promise((resolve) => weknoraServer.close(resolve));
  await rm(tempHome, { recursive: true, force: true });
  await rm(path.join(appRoot, ".next-api"), {
    recursive: true,
    force: true,
  });
}
