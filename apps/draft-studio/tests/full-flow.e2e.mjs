import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const baseUrl = "http://127.0.0.1:8794";
const live = process.env.DRAFT_STUDIO_E2E_LIVE === "1";
const realImage = process.env.DRAFT_STUDIO_E2E_REAL_IMAGE === "1";

if (!live) {
  console.log(
    "跳过真实全流程测试。设置 DRAFT_STUDIO_E2E_LIVE=1 后会调用搜索、DeepSeek 和图片服务并产生费用。",
  );
  process.exit(0);
}

const tempHome = await mkdtemp(path.join(os.tmpdir(), "draft-studio-e2e-"));
let serverOutput = "";
let server;
let imageMock;
let imageMockPort;
let imageMockRequests = 0;
let imageMockActive = 0;
let imageMockMaxActive = 0;
let token = "";
const startedAt = Date.now();

function log(step, detail = "") {
  console.log(
    `[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${step}${detail ? ` · ${detail}` : ""}`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(
  pathname,
  { method = "GET", body, headers = {}, raw = false } = {},
) {
  const response = await fetch(`${baseUrl}/api${pathname}`, {
    method,
    headers: {
      Origin: baseUrl,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Draft-Studio-Token": token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${method} ${pathname} 失败（${response.status}）：${text.slice(0, 1500)}`,
    );
  if (raw) return { response, text };
  return text ? JSON.parse(text) : {};
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.ok) return;
    } catch {
      /* The next poll retries startup. */
    }
    await sleep(300);
  }
  throw new Error(`工作台未能在 30 秒内启动。\n${serverOutput.slice(-5000)}`);
}

async function waitForRun(runId, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let sawProgress = false;
  while (Date.now() < deadline) {
    const workspace = await request("/workspace");
    const run = workspace.runs.find((entry) => entry.id === runId);
    if (
      run &&
      ((run.checkedSources ?? 0) > 0 ||
        (run.found ?? 0) > 0 ||
        (run.fetchCalls ?? 0) > 0)
    )
      sawProgress = true;
    if (run?.status === "完成") return { run, workspace, sawProgress };
    if (run?.status === "已停止")
      throw new Error("采集任务被手动停止，完整流程测试无法继续。");
    if (run?.status === "失败")
      throw new Error(`采集任务失败：${run.error ?? "未知错误"}`);
    await sleep(5_000);
  }
  throw new Error("采集任务在 15 分钟内未完成。");
}

async function waitForTopicRun(runId, timeoutMs = 15 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workspace = await request("/workspace");
    const run = workspace.topicRuns.find((entry) => entry.id === runId);
    if (run?.status === "完成") return { run, workspace };
    if (run?.status === "失败")
      throw new Error(`选题研究失败：${run.error ?? "未知错误"}`);
    await sleep(5_000);
  }
  throw new Error("选题研究任务在 15 分钟内未完成。");
}

async function waitForVisualRun(draftId, timeoutMs = 20 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workspace = await request("/workspace");
    const draft = workspace.drafts.find((entry) => entry.id === draftId);
    const run = draft?.visualRun;
    if (run?.status === "完成")
      return { draft, images: draft.images };
    if (run?.status === "失败")
      throw new Error(`配图组生成失败：${run.error ?? "未知错误"}`);
    if (run?.status === "运行中") {
      log(
        "配图生成中",
        `${run.stage} · ${run.completed}/${run.total}`,
      );
    }
    await sleep(2_000);
  }
  throw new Error("配图组在 20 分钟内未完成。");
}
async function waitForDraftGeneration(draftId, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workspace = await request("/workspace");
    const draft = workspace.drafts.find((entry) => entry.id === draftId);
    const run = draft?.generationRun;
    if (run?.status === "完成") return draft;
    if (run?.status === "失败")
      throw new Error(`初稿生成失败：${run.error ?? "未知错误"}`);
    if (run?.status === "运行中") log("初稿生成中", run.stage);
    await sleep(1_000);
  }
  throw new Error("初稿生成在 5 分钟内未完成。");
}

async function uploadTextFile(sourceId) {
  const form = new FormData();
  form.set(
    "file",
    new Blob(["端到端测试附件：只用于验证本地文件读取链路。"], {
      type: "text/plain",
    }),
    "e2e-source.txt",
  );
  const response = await fetch(`${baseUrl}/api/sources/${sourceId}/file`, {
    method: "POST",
    headers: { Origin: baseUrl, "X-Draft-Studio-Token": token },
    body: form,
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function startServer() {
  const entry = path.join(appRoot, "node_modules/next/dist/bin/next");
  const imageEnv = realImage
    ? {}
    : {
        DRAFT_STUDIO_E2E_IMAGE_MOCK: "1",
        OPENAI_IMAGE_GENERATIONS_URL: `http://127.0.0.1:${imageMockPort}/v1/images/generations`,
        OPENAI_IMAGE_TASKS_URL: `http://127.0.0.1:${imageMockPort}/v1/tasks`,
      };
  server = spawn(
    process.execPath,
    [entry, "start", "-H", "127.0.0.1", "-p", "8794"],
    {
      cwd: appRoot,
      env: { ...process.env, DRAFT_STUDIO_HOME: tempHome, ...imageEnv },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${chunk}`.slice(-30_000);
    });
  }
  server.once("error", (error) => {
    serverOutput += `\n${error.stack ?? error.message}`;
  });
  await waitForServer();
}

async function startImageMock() {
  if (realImage) return;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  imageMock = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/images/generations"
    ) {
      response.writeHead(404).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      imageMockRequests += 1;
      imageMockActive += 1;
      imageMockMaxActive = Math.max(imageMockMaxActive, imageMockActive);
      const payload = JSON.parse(body);
      assert.ok(payload.prompt);
      assert.match(payload.prompt, /GPT-Image2 风格库模板/);
      assert.match(payload.prompt, /【模板】/);
      assert.ok(payload.model);
      assert.equal(payload.async, true);
      assert.equal(payload.quality, "medium");
      setTimeout(() => {
        imageMockActive -= 1;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: png }] }));
      }, 250);
    });
  });
  await new Promise((resolve, reject) => {
    imageMock.once("error", reject);
    imageMock.listen(0, "127.0.0.1", resolve);
  });
  const address = imageMock.address();
  if (!address || typeof address === "string")
    throw new Error("无法启动图片 mock");
  imageMockPort = address.port;
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

try {
  log("启动隔离测试服务", tempHome);
  await startImageMock();
  await startServer();
  const session = await request("/session");
  token = session.token;
  assert.ok(token, "会话令牌缺失");

  let workspace = await request("/workspace");
  assert.equal(workspace.sources.length, 0);
  assert.equal(workspace.topics.length, 0);
  assert.equal(workspace.drafts.length, 0);
  const emptyResearch = await fetch(`${baseUrl}/api/topics/generate-batch`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      "Content-Type": "application/json",
      "X-Draft-Studio-Token": token,
    },
    body: JSON.stringify({ count: 1 }),
  });
  assert.equal(emptyResearch.status, 400);

  log("验证首页与资料归档");
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AI 深度内容工作台/);
  const sourceResult = await request("/sources", {
    method: "POST",
    body: {
      title: "端到端测试：AI 编程协作变化",
      kind: "资料摘录",
      eventDate: "2026-10-24",
      url: "https://openai.com/codex/",
      publisher: "E2E fixture",
      publishedAt: "2026-10-24",
      direction: "AI 产品",
      excerpt:
        "这是一条本地端到端测试资料，只用于验证归档、采集、选题和草稿流程。",
      facts: "测试资料由本地脚本创建。",
      interpretation: "个人提效需要与团队交付链路一起观察。",
      unknowns: "真实发布前必须替换为可核实的一手来源。",
    },
  });
  const sourceId = sourceResult.source.id;
  assert.match(sourceId, /^src_/);
  const uploaded = await uploadTextFile(sourceId);
  assert.match(uploaded.source.fileName, /^src_[0-9a-f-]+\.txt$/i);
  const attachment = await fetch(`${baseUrl}/api/sources/${sourceId}/file`);
  assert.equal(attachment.status, 200);
  assert.match(await attachment.text(), /端到端测试附件/);
  await request(`/sources/${sourceId}`, {
    method: "PATCH",
    body: { verification: "已核对" },
  });

  log("验证信源设置与自动采集");
  const researchSite = workspace.sites.find((site) => site.id === "arxiv");
  assert.ok(researchSite, "缺少内置 arXiv 信源");
  await request("/sites", {
    method: "PUT",
    body: {
      sites: workspace.sites.map((site) =>
        site.id === researchSite.id
          ? {
              ...site,
              enabled: true,
              query: "site:arxiv.org AI agent research paper",
              maxArticles: 1,
            }
          : { ...site, enabled: false },
      ),
    },
  });
  await request("/settings", {
    method: "PUT",
    body: {
      frequencyHours: 24,
      topicsPerRun: 2,
      topicMix: {
        商业化: 40,
        科研: 20,
        "AI 产品": 15,
        "AI 新趋势": 10,
        "AI 边界": 10,
        学术前沿: 5,
      },
      autoCollect: false,
    },
  });
  const collection = await request("/collect", { method: "POST", body: {} });
  const collected = await waitForRun(collection.run.id);
  assert.ok(collected.workspace.sources.length >= 1);
  assert.equal(collected.run.status, "完成");
  assert.ok(collected.sawProgress, "采集运行期间没有写入任何实时进度");
  assert.ok(collected.run.found > 0, "采集没有发现任何候选来源");
  assert.ok(collected.run.archived > 0, "采集发现候选来源但全部未归档");
  assert.ok(
    collected.workspace.sources.filter(
      (source) => source.collectionRunId === collection.run.id,
    ).length <= 1,
    "单个信源超过 maxArticles 上限",
  );
  assert.ok(
    collected.workspace.sources
      .filter(
        (source) =>
          source.collectionRunId === collection.run.id &&
          source.kind !== "候选链接",
      )
      .every((source) => source.contentFile && source.sourceSiteId),
    "结构化资料缺少本地原文或信源归属",
  );
  assert.equal(
    collected.workspace.sources.filter(
      (source) =>
        source.collectionRunId === collection.run.id &&
        source.kind === "候选链接",
    ).length,
    0,
    "正常收集结束后仍有候选没有读取原文",
  );

  log(
    "验证知识图谱",
    `实体 ${collected.workspace.entities.length}，关系 ${collected.workspace.relations.length}`,
  );
  assert.ok(collected.workspace.entities.length > 0, "采集后没有生成知识实体");
  assert.ok(
    collected.workspace.entities.some((entity) => entity.sourceIds.length > 0),
    "知识实体无法追溯到来源",
  );
  assert.ok(collected.workspace.relations.length > 0, "采集后没有生成实体关系");

  log("验证从已归档证据研究选题");
  const research = await request("/topics/generate-batch", {
    method: "POST",
    body: { count: 1 },
  });
  const researched = await waitForTopicRun(research.run.id);
  workspace = researched.workspace;
  assert.ok(
    researched.run.createdTopicIds.length > 0,
    "研究任务完成但没有生成选题",
  );
  assert.match(researched.run.stage ?? "", /选题/);
  const topic = workspace.topics.find(
    (entry) => entry.id === researched.run.createdTopicIds[0],
  );
  assert.ok(topic, "生成的选题未持久化");
  assert.ok(
    topic.title && topic.thesis && topic.readerValue,
    "选题缺少标题、判断或读者价值",
  );
  assert.ok(topic.sourceIds.length > 0, "生成选题没有关联任何证据来源");
  await request(`/topics/${topic.id}`, {
    method: "PATCH",
    body: { status: "准备写作" },
  });

  log("验证空白草稿分支");
  const blank = await request(`/topics/${topic.id}/draft`, {
    method: "POST",
    body: {},
  });
  assert.ok(blank.draft.creativeBrief);
  assert.equal(blank.draft.body, "");
  log("验证系统自动生成创作卡");
  const planned = await request(`/drafts/${blank.draft.id}/plan`, {
    method: "POST",
    body: {},
  });
  for (const key of [
    "commonBelief",
    "counterAngle",
    "emotionalArc",
    "readerMirror",
    "opening",
    "development",
    "turn",
    "landing",
    "shareLine",
  ]) {
    assert.ok(planned.draft.creativeBrief[key], `自动创作卡缺少 ${key}`);
  }

  log("验证 DeepSeek 完整初稿");
  const generated = await request(`/topics/${topic.id}/generate`, {
    method: "POST",
    body: {},
  });
  assert.equal(generated.started, true);
  const draft = await waitForDraftGeneration(generated.draft.id);
  assert.ok(draft.title && draft.body, "初稿缺少标题或正文");
  log("验证正文完成后自动生成视觉组");
  const automaticVisualSet = await waitForVisualRun(draft.id);
  assert.ok(
    automaticVisualSet.images.length <= 7,
    "正文生成后的视觉组超过价值上限",
  );
  assert.ok(
    automaticVisualSet.draft.wechatCover,
    "自动视觉组没有生成独立公众号封面",
  );
  for (const key of [
    "commonBelief",
    "counterAngle",
    "emotionalArc",
    "readerMirror",
    "opening",
    "development",
    "turn",
    "landing",
    "shareLine",
  ]) {
    assert.ok(draft.creativeBrief[key], `初稿创作卡缺少 ${key}`);
  }

  log("验证创作卡编辑与持久化");
  const creativeBrief = {
    ...draft.creativeBrief,
    commonBelief: "测试：AI 更快，所以团队一定交付更快。",
    counterAngle:
      "测试：只有当审核与协作能力同步扩容，个人提速才会转成团队交付。",
    emotionalArc: "被替代的焦虑 → 看清瓶颈后的释然",
    readerMirror: "每天写得更快、却仍在等审查的开发者",
    sceneAnchor: "测试材料中的本地附件与采集来源",
    voiceAnchor: "待补充：替换为作者亲自观察到的真实细节",
    opening: "代码写得更快，为什么交付没有更快？",
    development: "生成速度提高后，审查、测试和协调成为新的瓶颈。",
    turn: "如果下游没有扩容，上游提速只会增加在制品。",
    landing: "先测量交付链路，再决定优化哪一段。",
    shareLine: "AI 提效，不该只算写代码那一段。",
  };
  const saved = await request(`/drafts/${draft.id}`, {
    method: "PUT",
    body: { ...draft, creativeBrief },
  });
  assert.deepEqual(saved.draft.creativeBrief, creativeBrief);

  log("验证按创作卡重写正文");
  const rewritten = await request(`/drafts/${draft.id}/rewrite`, {
    method: "POST",
    body: {},
  });
  assert.ok(rewritten.draft.body.length > 80, "重写正文过短");
  assert.deepEqual(
    rewritten.draft.creativeBrief,
    creativeBrief,
    "重写修改了已确认的创作卡",
  );

  log("验证 Markdown 导出");
  const exported = await request(`/drafts/${draft.id}/export`, { raw: true });
  assert.match(exported.text, /## 创作卡/);
  assert.match(exported.text, /## 起承转合/);
  assert.match(exported.text, /## 正文/);
  assert.match(exported.text, /AI 提效，不该只算写代码那一段/);

  log("验证自动视觉组与本地读取");
  const requestsBeforeManualVisual = imageMockRequests;
  const visualStart = await request(`/drafts/${draft.id}/images`, {
    method: "POST",
    body: { model: session.imageModel },
  });
  assert.equal(visualStart.started, true);
  const visualSet = await waitForVisualRun(draft.id);
  assert.ok(visualSet.images.length <= 7, "自动视觉组超过 7 页上限");
  assert.equal(
    new Set(visualSet.images.map((image) => image.role)).size,
    visualSet.images.length,
    "自动视觉组的叙事角色重复",
  );
  const informationCards = visualSet.images.filter(
    (image) => image.kind === "slide" || image.kind === "chart",
  );
  assert.ok(
    visualSet.images.length === 0 || informationCards.length >= 1,
    "有配图时至少应有一张信息页",
  );
  assert.ok(visualSet.draft.visualStyleGuide, "自动视觉组缺少统一风格规范");
  assert.ok(
    visualSet.draft.imagePromptTemplateId,
    "自动视觉组没有记录 Prompt-as-Code 模板",
  );
  for (const image of visualSet.images) {
    assert.equal(
      image.promptTemplateId,
      visualSet.draft.imagePromptTemplateId,
      "视觉组页面的模板与整篇模板不一致",
    );
    assert.ok(image.promptTemplateName, "图片缺少模板名称");
    assert.ok(image.promptSpec, "图片缺少结构化提示词");
    assert.match(image.prompt, /【模板】/);
  }
  assert.ok(visualSet.draft.wechatCover, "视觉组没有生成独立公众号封面");
  assert.equal(visualSet.draft.wechatCover.origin, "ai");
  const coverResponse = await fetch(
    `${baseUrl}/api/media/${visualSet.draft.wechatCover.fileName}`,
  );
  assert.equal(coverResponse.status, 200);
  const coverBytes = new Uint8Array(await coverResponse.arrayBuffer());
  assert.equal(new DataView(coverBytes.buffer).getUint32(16), 1080);
  assert.equal(new DataView(coverBytes.buffer).getUint32(20), 460);
  let imageBytes = new Uint8Array();
  for (const image of visualSet.images) {
    assert.match(image.fileName, /\.png$/);
    const imageResponse = await fetch(
      `${baseUrl}/api/media/${image.fileName}`,
    );
    assert.equal(imageResponse.status, 200);
    imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    assert.deepEqual(
      [...imageBytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(
      new DataView(imageBytes.buffer).getUint32(16),
      1024,
      "配图宽度不是 1024",
    );
    assert.equal(
      new DataView(imageBytes.buffer).getUint32(20),
      1365,
      "配图没有裁切为 3:4",
    );
  }
  if (!realImage)
    assert.equal(
      imageMockRequests - requestsBeforeManualVisual,
      visualSet.images.length + 1,
      "图片 mock 请求数与视觉组页数及公众号封面不一致",
    );
  if (!realImage)
    assert.ok(
      imageMockMaxActive >= 3,
      "配图任务没有并行提交",
    );

  const finalState = await request("/workspace");
  const finalDraft = finalState.drafts.find((entry) => entry.id === draft.id);
  assert.deepEqual(
    finalDraft.images.map((image) => image.fileName),
    visualSet.images.map((image) => image.fileName),
  );
  assert.equal(finalDraft.imageFile, visualSet.images[0].fileName);
  assert.ok(
    finalState.sources.some(
      (entry) =>
        entry.id === sourceId &&
        /^src_[0-9a-f-]+\.txt$/i.test(entry.fileName ?? ""),
    ),
  );
  log(
    "全流程通过",
    `资料 ${finalState.sources.length}，选题 ${finalState.topics.length}，草稿 ${finalState.drafts.length}，实体 ${finalState.entities.length}，关系 ${finalState.relations.length}`,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        sourceId,
        topicId: topic.id,
        draftId: draft.id,
        exportedBytes: Buffer.byteLength(exported.text),
        imageBytes: imageBytes.length,
        visualImages: visualSet.images.length,
        illustrationImages: illustrations.length,
        informationCards: informationCards.length,
        imageMode: realImage ? "live" : "mock",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    `\n全流程测试失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  if (serverOutput)
    console.error(`\n服务日志：\n${serverOutput.slice(-12_000)}`);
  process.exitCode = 1;
} finally {
  await stopServer();
  if (imageMock) await new Promise((resolve) => imageMock.close(resolve));
  if (process.env.DRAFT_STUDIO_E2E_KEEP === "1")
    console.log(`保留测试工作区：${tempHome}`);
  else await rm(tempHome, { recursive: true, force: true });
}
