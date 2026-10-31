import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { home, id, now, updateWorkspace } from "./store";
import { queryKnowledgeGraph } from "./knowledge-graph";
import {
  normalizeKnowledgeCategory,
  summarizeKnowledge,
} from "./knowledge-model";
import {
  builtinWeKnoraConnection,
  builtinWeKnoraState,
  refreshBuiltinSession,
} from "./weknora-runtime";
import type {
  Direction,
  KnowledgePluginSearchResult,
  KnowledgePluginStatus,
  KnowledgeSearchHit,
  Source,
  Workspace,
} from "./types";

const WEKNORA_SOURCE_URL = "https://github.com/Tencent/WeKnora";
const WEKNORA_DEFAULT_TIMEOUT_MS = 30_000;
const WEKNORA_MAX_RESULTS = 8;
const WEKNORA_CHUNK_PAGE_SIZE = 100;
const WEKNORA_MAX_CHUNK_PAGES = 10;

type JsonRecord = Record<string, unknown>;
type WeKnoraEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string | { message?: string };
  total?: number;
  page?: number;
  page_size?: number;
};
type WeKnoraDocument = {
  id?: string;
  title?: string;
  file_name?: string;
  description?: string;
  knowledge_base_id?: string;
  knowledge_base_name?: string;
  source_url?: string;
  url?: string;
  published_at?: string;
  created_at?: string;
  [key: string]: unknown;
};
type WeKnoraChunk = {
  id?: string;
  content?: string;
  chunk_index?: number;
  [key: string]: unknown;
};
type WeKnoraSearchHit = {
  id?: string;
  content?: string;
  knowledge_id?: string;
  chunk_index?: number;
  knowledge_title?: string;
  knowledge_filename?: string;
  score?: number;
  source_url?: string;
  url?: string;
  [key: string]: unknown;
};
export type WeKnoraPluginConfig = {
  mode: "builtin" | "external";
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  knowledgeBaseIds: string[];
  updatedAt?: string;
};
export type WeKnoraPluginPublicConfig = Omit<
  WeKnoraPluginConfig,
  "apiKey"
> & {
  apiKeyConfigured: boolean;
};

let knowledgeBaseIdsPromise:
  | Promise<{ endpoint: string; ids: string[] }>
  | undefined;
const weknoraSettingsPath = path.join(home, "plugin-settings.json");
let pluginConfigPromise: Promise<WeKnoraPluginConfig> | undefined;

function textField(value: unknown, limit = 20_000): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalizeWeKnoraBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("WeKnora 地址不是有效的 URL。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("WeKnora 地址必须是 http 或 https，且不能包含账号密码。");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/api/v1"))
    url.pathname = `${url.pathname}/api/v1`.replace(/\/{2,}/g, "/");
  return url.toString().replace(/\/$/, "");
}

function environmentWeKnoraConfig(): WeKnoraPluginConfig {
  const raw = process.env.WEKNORA_BASE_URL?.trim() ?? "";
  let baseUrl = "";
  try {
    baseUrl = normalizeWeKnoraBaseUrl(raw);
  } catch {
    baseUrl = "";
  }
  return {
    mode:
      process.env.WEKNORA_MODE === "external" || baseUrl
        ? "external"
        : "builtin",
    enabled: Boolean(baseUrl),
    baseUrl,
    apiKey: process.env.WEKNORA_API_KEY?.trim() ?? "",
    tenantId: process.env.WEKNORA_TENANT_ID?.trim() ?? "",
    knowledgeBaseIds: (process.env.WEKNORA_KNOWLEDGE_BASE_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 100),
  };
}

async function readWeKnoraPluginConfig(): Promise<WeKnoraPluginConfig> {
  if (pluginConfigPromise) return pluginConfigPromise;
  pluginConfigPromise = (async () => {
    try {
      const parsed = jsonRecord(
        JSON.parse(await readFile(weknoraSettingsPath, "utf8")),
      );
      return {
        mode:
          parsed.mode === "builtin"
            ? "builtin"
            : parsed.mode === "external"
              ? "external"
              : textField(parsed.baseUrl, 2048)
                ? "external"
                : "builtin",
        enabled: parsed.enabled === true,
        baseUrl: textField(parsed.baseUrl, 2048),
        apiKey: textField(parsed.apiKey, 4096),
        tenantId: textField(parsed.tenantId, 200),
        knowledgeBaseIds: Array.isArray(parsed.knowledgeBaseIds)
          ? parsed.knowledgeBaseIds
              .filter(
                (value): value is string =>
                  typeof value === "string" && value.trim().length > 0,
              )
              .map((value) => value.trim().slice(0, 200))
              .slice(0, 100)
          : [],
        updatedAt: textField(parsed.updatedAt, 40) || undefined,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return environmentWeKnoraConfig();
      console.warn(
        "[draft-studio] WeKnora plugin settings are unreadable; using environment configuration",
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      );
      return environmentWeKnoraConfig();
    }
  })();
  return pluginConfigPromise;
}

export async function weKnoraPluginPublicConfig(): Promise<WeKnoraPluginPublicConfig> {
  const config = await readWeKnoraPluginConfig();
  return {
    mode: config.mode,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    tenantId: config.tenantId,
    knowledgeBaseIds: config.knowledgeBaseIds,
    apiKeyConfigured: Boolean(config.apiKey),
    updatedAt: config.updatedAt,
  };
}

export async function saveWeKnoraPluginConfig(input: {
  mode: "builtin" | "external";
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  tenantId?: string;
  knowledgeBaseIds?: string[];
}): Promise<WeKnoraPluginPublicConfig> {
  const current = await readWeKnoraPluginConfig();
  const baseUrl = normalizeWeKnoraBaseUrl(input.baseUrl);
  if (input.mode === "external" && input.enabled && !baseUrl)
    throw new Error("启用 WeKnora 前请填写服务地址。");
  await mkdir(home, { recursive: true });
  const next: WeKnoraPluginConfig = {
    mode: input.mode,
    enabled: input.enabled,
    baseUrl,
    apiKey: input.clearApiKey
      ? ""
      : textField(input.apiKey, 4096) || current.apiKey,
    tenantId: textField(input.tenantId, 200),
    knowledgeBaseIds: (input.knowledgeBaseIds ?? [])
      .map((value) => value.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 100),
    updatedAt: now(),
  };
  const temp = `${weknoraSettingsPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, weknoraSettingsPath);
  pluginConfigPromise = Promise.resolve(next);
  knowledgeBaseIdsPromise = undefined;
  return weKnoraPluginPublicConfig();
}

function weknoraBaseUrl(config: WeKnoraPluginConfig): URL | undefined {
  if (!config.baseUrl) return undefined;
  try {
    const url = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    url.pathname = url.pathname.replace(/\/+$/, "");
    if (!url.pathname.endsWith("/api/v1"))
      url.pathname = `${url.pathname}/api/v1`.replace(/\/{2,}/g, "/");
    return url;
  } catch {
    return undefined;
  }
}

function weknoraHeaders(config: WeKnoraPluginConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    if (config.mode === "builtin")
      headers.Authorization = `Bearer ${config.apiKey}`;
    else headers["X-API-Key"] = config.apiKey;
  }
  if (config.tenantId) headers["X-Tenant-ID"] = config.tenantId;
  return headers;
}

function weknoraFailureMessage(body: string, status: number): string {
  try {
    const parsed = jsonRecord(JSON.parse(body));
    const error = parsed.error;
    if (typeof error === "string" && error.trim()) return error.trim();
    const nested = jsonRecord(error);
    if (typeof nested.message === "string" && nested.message.trim())
      return nested.message.trim();
    if (typeof parsed.message === "string" && parsed.message.trim())
      return parsed.message.trim();
  } catch {
    /* A proxy may return HTML; use the bounded status message below. */
  }
  return `WeKnora 返回 HTTP ${status}`;
}

async function weknoraJson<T>(
  config: WeKnoraPluginConfig,
  endpoint: URL,
  pathname: string,
  init: RequestInit = {},
): Promise<WeKnoraEnvelope<T>> {
  const targetUrl = new URL(
    `${endpoint.toString().replace(/\/$/, "")}${pathname}`,
  );
  const request = (authConfig: WeKnoraPluginConfig) =>
    fetch(targetUrl, {
      ...init,
      headers: { ...weknoraHeaders(authConfig), ...init.headers },
      signal: AbortSignal.timeout(WEKNORA_DEFAULT_TIMEOUT_MS),
      redirect: "error",
    });
  let response = await request(config);
  if (response.status === 401 && config.mode === "builtin") {
    const refreshed = await refreshBuiltinSession();
    if (refreshed)
      response = await request({
        ...config,
        apiKey: refreshed.token,
      });
  }
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${pathname}：${weknoraFailureMessage(body, response.status)}`,
    );
  try {
    return JSON.parse(body) as WeKnoraEnvelope<T>;
  } catch {
    throw new Error("WeKnora 返回了无法解析的 JSON。");
  }
}

async function resolveWeKnoraKnowledgeBaseIds(
  config: WeKnoraPluginConfig,
  endpoint: URL,
): Promise<string[]> {
  const configured = config.knowledgeBaseIds;
  if (configured.length) return configured;
  const key = endpoint.toString();
  knowledgeBaseIdsPromise ??= weknoraJson<JsonRecord[]>(
    config,
    endpoint,
    "/knowledge-bases",
  )
    .then((envelope) => ({
      endpoint: key,
      ids: (Array.isArray(envelope.data) ? envelope.data : [])
        .map((base) => textField(base.id, 200))
        .filter(Boolean),
    }))
    .catch((error) => {
      knowledgeBaseIdsPromise = undefined;
      throw error;
    });
  const resolved = await knowledgeBaseIdsPromise;
  if (resolved.endpoint === key) return resolved.ids;
  const fresh = await weknoraJson<JsonRecord[]>(
    config,
    endpoint,
    "/knowledge-bases",
  );
  knowledgeBaseIdsPromise = Promise.resolve({
    endpoint: key,
    ids: (Array.isArray(fresh.data) ? fresh.data : [])
      .map((base) => textField(base.id, 200))
      .filter(Boolean),
  });
  return (await knowledgeBaseIdsPromise).ids;
}

function localPluginStatus(): KnowledgePluginStatus {
  return {
    id: "kuzu-local",
    label: "Kuzu 本地图谱",
    description: "在本地资料、实体、关系和选题之间做规范化检索。",
    configured: true,
    enabled: true,
    mode: "嵌入式属性图",
    detail: "资料保存在本机，不经过第三方知识库。",
    capabilities: ["本地检索", "证据邻域", "实体关系"],
  };
}

export async function knowledgePluginStatuses(): Promise<
  KnowledgePluginStatus[]
> {
  const config = await readWeKnoraPluginConfig();
  const runtime = builtinWeKnoraState();
  const baseUrl = weknoraBaseUrl(config);
  const mode = process.env.WEKNORA_AGENT_ID?.trim()
    ? "混合检索与 Agent 问答"
    : "混合检索与引用";
  return [
    localPluginStatus(),
    {
      id: "weknora",
      label: "WeKnora",
      description:
        "连接组织知识库，使用向量与关键词混合召回，可把命中文档导入本地资料库。",
      configured:
        config.mode === "builtin"
          ? runtime.status === "running"
          : Boolean(baseUrl),
      enabled:
        config.enabled &&
        (config.mode === "builtin"
          ? runtime.status === "running"
          : Boolean(baseUrl)),
      mode,
      detail:
        config.mode === "builtin"
          ? runtime.detail
          : baseUrl
            ? `${config.enabled ? "已连接" : "已暂停"} ${baseUrl.origin}${baseUrl.pathname}${config.knowledgeBaseIds.length ? ` · ${config.knowledgeBaseIds.length} 个知识库` : " · 自动发现知识库"}`
            : "可在页面一键启用内置引擎，或切换到外部 WeKnora 部署。",
      capabilities: ["跨库检索", "原文引用", "文档导入"],
      sourceUrl: WEKNORA_SOURCE_URL,
    },
  ];
}

async function activeWeKnoraConfig(): Promise<WeKnoraPluginConfig> {
  const config = await readWeKnoraPluginConfig();
  if (config.mode !== "builtin") return config;
  const connection = await builtinWeKnoraConnection();
  if (!connection) return config;
  return {
    ...config,
    enabled: config.enabled,
    baseUrl: connection.baseUrl,
    apiKey: connection.token,
    knowledgeBaseIds: [connection.knowledgeBaseId],
  };
}

async function searchLocalKnowledge(
  workspace: Workspace,
  query: string,
): Promise<KnowledgeSearchHit[]> {
  const graph = await queryKnowledgeGraph(workspace, query);
  const hits: KnowledgeSearchHit[] = graph.sources.map((source) => ({
    id: `local:source:${source.id}`,
    pluginId: "kuzu-local",
    pluginLabel: "Kuzu 本地图谱",
    title: source.title,
    excerpt: source.summary || "已归档资料",
    documentId: source.id,
    knowledgeBase: source.category,
    url: source.url,
    sourceIds: [source.id],
  }));
  for (const entity of graph.entities.slice(0, 8)) {
    hits.push({
      id: `local:entity:${entity.id}`,
      pluginId: "kuzu-local",
      pluginLabel: "Kuzu 本地图谱",
      title: `${entity.name} · ${entity.type}`,
      excerpt: entity.summary || "知识实体",
      knowledgeBase: `${entity.sourceCount} 份本地资料`,
      sourceIds: entity.sources.map((source) => source.id),
    });
  }
  return hits;
}

async function searchWeKnora(
  config: WeKnoraPluginConfig,
  query: string,
): Promise<KnowledgeSearchHit[]> {
  const endpoint = weknoraBaseUrl(config);
  if (!endpoint) return [];
  const knowledgeBaseIds = await resolveWeKnoraKnowledgeBaseIds(
    config,
    endpoint,
  );
  if (!knowledgeBaseIds.length)
    throw new Error("WeKnora 当前凭据看不到可检索的知识库。");
  const body = {
    query,
    knowledge_base_ids: knowledgeBaseIds,
    match_count: WEKNORA_MAX_RESULTS,
    rerank: { enabled: false },
  };
  const request = async (includePublicResources: boolean) => {
    const suffix = includePublicResources
      ? "/knowledge-search?resource_urls=public"
      : "/knowledge-search";
    return weknoraJson<WeKnoraSearchHit[]>(config, endpoint, suffix, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });
  };
  let envelope: WeKnoraEnvelope<WeKnoraSearchHit[]>;
  try {
    envelope = await request(true);
  } catch {
    envelope = await request(false);
  }
  return (Array.isArray(envelope.data) ? envelope.data : [])
    .slice(0, WEKNORA_MAX_RESULTS)
    .map((result, index) => {
      const resultRecord = jsonRecord(result);
      const knowledgeId = textField(result.knowledge_id, 200);
      const title =
        textField(result.knowledge_title, 240) ||
        textField(result.knowledge_filename, 240) ||
        knowledgeId ||
        "WeKnora 资料";
      return {
        id: `weknora:${textField(result.id, 200) || `${knowledgeId}:${index}`}`,
        pluginId: "weknora",
        pluginLabel: "WeKnora",
        title,
        excerpt: textField(result.content, 2400),
        score: numberField(result.score),
        documentId: knowledgeId,
        knowledgeBase:
          textField(resultRecord.knowledge_base_name, 160) ||
          textField(resultRecord.knowledge_base_id, 160) ||
          "WeKnora",
        url:
          textField(result.source_url, 2048) ||
          textField(result.url, 2048) ||
          undefined,
      } satisfies KnowledgeSearchHit;
    });
}

export async function searchKnowledgePlugins(
  workspace: Workspace,
  rawQuery: string,
): Promise<KnowledgePluginSearchResult> {
  const query = rawQuery.trim().slice(0, 200);
  if (!query) throw new Error("请输入要在资料库中检索的问题。");
  const config = await activeWeKnoraConfig();
  const statuses = await knowledgePluginStatuses();
  const enabled = statuses.filter((status) => status.enabled);
  const settled = await Promise.allSettled(
    enabled.map((status) =>
      status.id === "weknora"
        ? searchWeKnora(config, query)
        : searchLocalKnowledge(workspace, query),
    ),
  );
  const warnings: string[] = [];
  const hits: KnowledgeSearchHit[] = [];
  for (const [index, result] of settled.entries()) {
    const plugin = enabled[index];
    if (result.status === "fulfilled") hits.push(...result.value);
    else
      warnings.push(
        `${plugin.label}：${result.reason instanceof Error ? result.reason.message : "检索失败"}`,
      );
  }
  const seen = new Set<string>();
  return {
    query,
    searchedPlugins: enabled.map((plugin) => plugin.id),
    warnings,
    hits: hits.filter((hit) => {
      if (!hit.documentId || seen.has(hit.id)) return false;
      seen.add(hit.id);
      return true;
    }),
  };
}

async function readWeKnoraDocument(
  config: WeKnoraPluginConfig,
  knowledgeId: string,
): Promise<{
  document: WeKnoraDocument;
  content: string;
}> {
  const endpoint = weknoraBaseUrl(config);
  if (!endpoint) throw new Error("WeKnora 尚未配置。");
  const documentResponse = await weknoraJson<WeKnoraDocument>(
    config,
    endpoint,
    `/knowledge/${encodeURIComponent(knowledgeId)}`,
  );
  const document = documentResponse.data ?? {};
  const chunks: WeKnoraChunk[] = [];
  let total = 0;
  for (let page = 1; page <= WEKNORA_MAX_CHUNK_PAGES; page += 1) {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(WEKNORA_CHUNK_PAGE_SIZE),
    });
    const response = await weknoraJson<WeKnoraChunk[]>(
      config,
      endpoint,
      `/chunks/${encodeURIComponent(knowledgeId)}?${query}`,
    );
    const pageChunks = Array.isArray(response.data) ? response.data : [];
    chunks.push(...pageChunks);
    total = numberField(response.total) ?? pageChunks.length;
    if (!pageChunks.length || chunks.length >= total) break;
  }
  chunks.sort(
    (left, right) =>
      (numberField(left.chunk_index) ?? 0) -
      (numberField(right.chunk_index) ?? 0),
  );
  const content = chunks
    .map((chunk) => textField(chunk.content, 20_000))
    .filter(Boolean)
    .join("\n\n");
  if (!content) throw new Error("WeKnora 文档没有可导入的正文分块。");
  return { document, content };
}

export async function importWeKnoraKnowledge(
  knowledgeId: string,
  direction: Direction,
): Promise<Source> {
  const externalId = knowledgeId.trim().slice(0, 200);
  if (!externalId) throw new Error("缺少 WeKnora 文档 ID。");
  const config = await activeWeKnoraConfig();
  if (!config.enabled || !weknoraBaseUrl(config))
    throw new Error("WeKnora 插件未启用，请先在知识图谱页面配置并开启。");
  const { document, content } = await readWeKnoraDocument(config, externalId);
  const title =
    textField(document.title, 160) ||
    textField(document.file_name, 160) ||
    `WeKnora 文档 ${externalId}`;
  const knowledgeBase =
    textField(document.knowledge_base_name, 120) ||
    textField(document.knowledge_base_id, 120) ||
    "WeKnora";
  const knowledgeBaseId = textField(document.knowledge_base_id, 200);
  const excerpt = content.slice(0, 80_000);
  const summary =
    textField(document.description, 1200) ||
    summarizeKnowledge({ excerpt });
  const sourceUrl =
    textField(document.source_url, 2048) || textField(document.url, 2048);
  return updateWorkspace((workspace) => {
    const existing = workspace.sources.find(
      (source) =>
        source.knowledgePluginId === "weknora" &&
        source.externalKnowledgeId === externalId,
    );
    if (existing) return existing;
    const source: Source = {
      id: id("src"),
      title,
      kind: "资料摘录",
      eventDate: "",
      url: sourceUrl,
      publisher: knowledgeBase,
      publishedAt:
        textField(document.published_at, 40) ||
        textField(document.created_at, 40),
      capturedAt: now(),
      direction,
      excerpt,
      facts: "",
      interpretation: "",
      unknowns:
        "这是从 WeKnora 导入的外部知识库原文。创作前请核对文档版本、上下文、引用出处和事实边界。",
      summary,
      category: normalizeKnowledgeCategory("", direction, `${title} ${summary}`),
      verification: "待核实",
      knowledgePluginId: "weknora",
      externalKnowledgeId: externalId,
      externalKnowledgeBase: knowledgeBase,
      externalKnowledgeBaseId: knowledgeBaseId,
      importedAt: now(),
    };
    workspace.sources.unshift(source);
    return source;
  });
}

export type WeKnoraSyncResult = {
  knowledgeBaseId: string;
  attempted: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errors: string[];
};
export type WeKnoraSyncRun = WeKnoraSyncResult & {
  status: "运行中" | "完成" | "失败";
  stage: string;
  startedAt: string;
  finishedAt?: string;
};

let activeSyncPromise: Promise<void> | undefined;
let syncStarting = false;
let latestSyncRun: WeKnoraSyncRun | undefined;

function sourceKnowledgeContent(source: Source): string {
  return [
    `# ${source.title}`,
    source.summary ? `> ${source.summary}` : "",
    source.excerpt,
    source.facts ? `## 已确认事实\n\n${source.facts}` : "",
    source.interpretation
      ? `## 分析与解释\n\n${source.interpretation}`
      : "",
    source.unknowns
      ? `## 未知与边界\n\n${source.unknowns}`
      : "",
    source.url ? `来源链接：${source.url}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 80_000);
}

async function createBuiltinKnowledge(
  config: WeKnoraPluginConfig,
  endpoint: URL,
  knowledgeBaseId: string,
  source: Source,
): Promise<string> {
  const created = await weknoraJson<{ id?: string }>(
    config,
    endpoint,
    `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/knowledge/manual`,
    {
      method: "POST",
      body: JSON.stringify({
        title: source.title.slice(0, 160),
        content: sourceKnowledgeContent(source),
        status: "publish",
      }),
    },
  );
  const knowledgeId = textField(created.data?.id, 200);
  if (!knowledgeId) throw new Error("WeKnora 没有返回知识文档 ID。");
  return knowledgeId;
}

async function runWorkspaceSync(
  workspace: Workspace,
  run: WeKnoraSyncRun,
): Promise<void> {
  const config = await activeWeKnoraConfig();
  const endpoint = weknoraBaseUrl(config);
  const knowledgeBaseId = config.knowledgeBaseIds[0] ?? "";
  if (config.mode !== "builtin" || !config.enabled || !endpoint || !knowledgeBaseId)
    throw new Error("请先一键启用内置 WeKnora 知识引擎。");
  const sources = workspace.sources
    .filter(
      (source) =>
        source.kind !== "候选链接" &&
        Boolean(
          source.excerpt.trim() ||
            source.facts.trim() ||
            source.interpretation.trim(),
        ),
    );
  run.knowledgeBaseId = knowledgeBaseId;
  run.attempted = sources.length;
  run.stage = `正在同步 ${sources.length} 份资料`;
  for (const [index, source] of sources.entries()) {
    run.stage = `正在同步 ${index + 1}/${sources.length}：${source.title}`;
    try {
      const payload = {
        title: source.title.slice(0, 160),
        content: sourceKnowledgeContent(source),
        status: "publish",
      };
      const ownedExternalId =
        source.externalKnowledgeBaseId === knowledgeBaseId
          ? source.externalKnowledgeId
          : undefined;
      let knowledgeId = ownedExternalId;
      if (knowledgeId) {
        try {
          await weknoraJson<unknown>(
            config,
            endpoint,
            `/knowledge/${encodeURIComponent(knowledgeId)}`,
            { method: "PUT", body: JSON.stringify(payload) },
          );
          run.updated += 1;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes("HTTP 404")
          )
            throw error;
          knowledgeId = await createBuiltinKnowledge(
            config,
            endpoint,
            knowledgeBaseId,
            source,
          );
          run.created += 1;
        }
      } else {
        knowledgeId = await createBuiltinKnowledge(
          config,
          endpoint,
          knowledgeBaseId,
          source,
        );
        run.created += 1;
      }
      await updateWorkspace((current) => {
        const found = current.sources.find((item) => item.id === source.id);
        if (!found) return;
        found.knowledgePluginId = "weknora";
        found.externalKnowledgeId = knowledgeId;
        found.externalKnowledgeBase = "Draft Studio 内置知识库";
        found.externalKnowledgeBaseId = knowledgeBaseId;
        found.externalSyncedAt = now();
      });
    } catch (error) {
      run.failed += 1;
      if (run.errors.length < 12)
        run.errors.push(
          `${source.title}：${error instanceof Error ? error.message : "同步失败"}`,
        );
    } finally {
      run.processed = index + 1;
    }
  }
  run.stage = run.failed
    ? `同步完成，${run.failed} 份失败`
    : "所有资料已同步";
}

export async function startWorkspaceToBuiltinWeKnora(
  workspace: Workspace,
): Promise<WeKnoraSyncRun> {
  if ((activeSyncPromise || syncStarting) && latestSyncRun)
    return { ...latestSyncRun };
  syncStarting = true;
  const run: WeKnoraSyncRun = {
    knowledgeBaseId: "",
    status: "运行中",
    stage: "准备同步资料",
    startedAt: now(),
    attempted: workspace.sources.filter(
      (source) =>
        source.kind !== "候选链接" &&
        Boolean(
          source.excerpt.trim() ||
            source.facts.trim() ||
            source.interpretation.trim(),
        ),
    ).length,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
  latestSyncRun = run;
  try {
    const config = await activeWeKnoraConfig();
    if (
      config.mode !== "builtin" ||
      !config.enabled ||
      !weknoraBaseUrl(config)
    )
      throw new Error("请先一键启用内置 WeKnora 知识引擎。");
    run.knowledgeBaseId = config.knowledgeBaseIds[0] ?? "";
    activeSyncPromise = runWorkspaceSync(workspace, run)
    .then(() => {
      run.status = run.failed ? "失败" : "完成";
      run.finishedAt = now();
    })
    .catch((error) => {
      run.status = "失败";
      run.stage = "资料同步失败";
      run.finishedAt = now();
      if (run.errors.length < 12)
        run.errors.push(
          error instanceof Error ? error.message.slice(0, 1200) : "未知错误",
        );
    })
    .finally(() => {
      activeSyncPromise = undefined;
    });
    syncStarting = false;
    return { ...run };
  } catch (error) {
    run.status = "失败";
    run.stage = "资料同步启动失败";
    run.finishedAt = now();
    run.errors.push(
      error instanceof Error ? error.message.slice(0, 1200) : "未知错误",
    );
    syncStarting = false;
    throw error;
  }
}

export function weKnoraSyncState(): WeKnoraSyncRun | undefined {
  return latestSyncRun ? { ...latestSyncRun, errors: [...latestSyncRun.errors] } : undefined;
}

export function isWeKnoraSyncRunning(): boolean {
  return Boolean(activeSyncPromise || syncStarting);
}

export async function deleteManagedBuiltinKnowledge(
  source: Source,
): Promise<boolean> {
  const config = await activeWeKnoraConfig();
  const endpoint = weknoraBaseUrl(config);
  const knowledgeBaseId = config.knowledgeBaseIds[0] ?? "";
  if (
    config.mode !== "builtin" ||
    !config.enabled ||
    !endpoint ||
    !knowledgeBaseId ||
    source.externalKnowledgeBaseId !== knowledgeBaseId ||
    !source.externalKnowledgeId
  )
    return false;
  try {
    await weknoraJson<unknown>(
      config,
      endpoint,
      `/knowledge/${encodeURIComponent(source.externalKnowledgeId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("HTTP 404"))
      return false;
    throw error;
  }
  return true;
}
