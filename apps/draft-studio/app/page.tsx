"use client";
import { GenerationFlow } from "./GenerationFlow";
import { generationWorkflowChanged } from "@/lib/generation-flow";
import { videoSourceText } from "@/lib/video";
import { channelDownloadName } from "@/lib/download-names";
import { channelVisuals } from "@/lib/channel-visuals";

import { topicPoolStage, topicPoolStages } from "@/lib/topic-pool";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Compass,
  Copy,
  FileText,
  FlaskConical,
  Lightbulb,
  LoaderCircle,
  PenLine,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  ContentChannel,
  CopilotTarget,
  CopilotMessage,
  Direction,
  Draft,
  KnowledgeGraphResult,
  KnowledgePluginSearchResult,
  KnowledgePluginStatus,
  KnowledgeSearchHit,
  Source,
  Topic,
  Workspace,
} from "@/lib/types";
import CopilotMessageView from "./CopilotMessageView";
import { craftGroups } from "@/lib/editorial";
import {
  allocateTopicSlots,
  defaultTopicMix,
  directions,
  topicMixTotal,
} from "@/lib/topics";
import { contentChannels } from "@/lib/channels";
import { MAX_CONCURRENT_DRAFT_GENERATIONS } from "@/lib/limits";
import {
  applyCopilotMessages,
  applyCopilotResponse,
  sameCopilotMessages,
  submitCopilotRequest,
} from "@/lib/copilot-session";
import { useArticleCopilot } from "./useArticleCopilot";
import {
  articleBlocks,
  channelLabel,
  renderWechatArticleHtml,
  sortedWechatBodyImages,
  WECHAT_BODY_HEIGHT,
  WECHAT_BODY_WIDTH,
  WECHAT_COVER_HEIGHT,
  WECHAT_COVER_WIDTH,
} from "@/lib/wechat";
import { visualThemeById } from "@/lib/visual-themes";
import {
  imagePromptTemplates,
  selectVisualPromptTemplate,
  visualPromptLibraryInfo,
  visualPromptTemplateById,
  visualPromptTemplateSource,
} from "@/lib/visual-prompt-library";
import type {
  WeKnoraPluginPublicConfig,
  WeKnoraSyncRun,
} from "@/lib/knowledge-plugins";
import type { BuiltinWeKnoraState } from "@/lib/weknora-runtime";
const checks = [
  "标题判断没有超过证据",
  "开头三行有具体变化、场景或冲突",
  "至少有一处可指认的动作、器物或数字",
  "情绪有转折，没有靠焦虑和恐吓硬推",
  "结尾落到读者选择，没有空泛说教",
  "关键事实、数字与时间能追溯到来源",
  "推断、未知和反方观点已明确区分",
  "没有把相关性写成因果",
  "没有模板化三连、抽象套话和总结腔",
  "没有仿写具体博主的标志性文风或个人经历",
  "素材版权和图片真实性已检查",
];
const KnowledgeGraphExplorer = dynamic(
  () => import("./KnowledgeGraphExplorer"),
  {
    ssr: false,
    loading: () => (
      <div className="knowledge-graph-stage knowledge-graph-empty">
        <LoaderCircle className="spin" size={22} />
        <b>正在绘制知识关系图</b>
        <p>计算实体布局与证据邻域…</p>
      </div>
    ),
  },
);
type Tab =
  | "概览"
  | "资料归档"
  | "选题池"
  | "内容草稿"
  | "信源与自动化"
  | "知识图谱";
type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};
type ConfirmDialogState = ConfirmDialogOptions & { id: number };
type WeKnoraPluginForm = {
  mode: "builtin" | "external";
  enabled: boolean;
  baseUrl: string;
  tenantId: string;
  knowledgeBaseIds: string;
  apiKey: string;
  clearApiKey: boolean;
};
const emptyWeKnoraPluginForm: WeKnoraPluginForm = {
  mode: "builtin",
  enabled: false,
  baseUrl: "",
  tenantId: "",
  knowledgeBaseIds: "",
  apiKey: "",
  clearApiKey: false,
};
const tabNames: Tab[] = [
  "概览",
  "资料归档",
  "选题池",
  "内容草稿",
  "信源与自动化",
  "知识图谱",
];
const tabPaths: Record<Tab, string> = {
  "概览": "/",
  "资料归档": "/sources/",
  "选题池": "/topics/",
  "内容草稿": "/articles/",
  "信源与自动化": "/settings/",
  "知识图谱": "/knowledge/",
};
function routeForTab(tab: Tab, draftId?: string): string {
  return tab === "内容草稿" && draftId
    ? `${tabPaths[tab]}${encodeURIComponent(draftId)}`
    : tabPaths[tab];
}
function tabFromPath(pathname: string): { tab: Tab; draftId?: string } {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return { tab: "概览" };
  if (clean.startsWith("/articles/")) return { tab: "内容草稿", draftId: decodeURIComponent(clean.slice("/articles/".length)) };
  const match = Object.entries(tabPaths).find(([, path]) => (path === "/" ? false : path.replace(/\/$/, "") === clean));
  return { tab: (match?.[0] as Tab | undefined) ?? "概览" };
}
const blank: Workspace = {
  sources: [],
  topics: [],
  drafts: [],
  sites: [],
  runs: [],
  topicRuns: [],
  entities: [],
  relations: [],
  settings: {
    frequencyHours: 24,
    topicsPerRun: 6,
    topicMix: defaultTopicMix,
    autoCollect: false,
  },
};

export default function Page() {
  // Read the route during the first client render so a deep link does not
  // briefly paint the dashboard before the URL-sync effect runs.
  const [tab, setTabState] = useState<Tab>(() =>
    typeof window === "undefined"
      ? "概览"
      : tabFromPath(window.location.pathname).tab,
  );
  const [workspace, setWorkspace] = useState<Workspace>(blank);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [channelSwitching, setChannelSwitching] = useState(false);
  const [notice, setNotice] = useState("");
  const [direction, setDirection] = useState<Direction>(directions[0]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [articleListTab, setArticleListTab] = useState<"草稿" | "已发">("草稿");
  const [topicPoolTab, setTopicPoolTab] = useState<(typeof topicPoolStages)[number]>("待选");
  const [submittingTopicIds, setSubmittingTopicIds] = useState<string[]>([]);
  const [topicBatchCount, setTopicBatchCount] = useState(5);
  const [topicResearchStarting, setTopicResearchStarting] = useState(false);
  const [topicResearchRequest, setTopicResearchRequest] = useState("");
  const [topicResearchFeedback, setTopicResearchFeedback] = useState<{
    tone: "working" | "running" | "error";
    message: string;
  } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const copilotMessagesRef = useRef<HTMLDivElement | null>(null);
  const {
    copilotTarget, setCopilotTarget, copilotInput, setCopilotInput,
    copilotMentions, setCopilotMentions, copilotMentionOpen, setCopilotMentionOpen,
    copilotOpen, setCopilotOpen, copilotSubmitting, setCopilotSubmitting,
  } = useArticleCopilot(editing?.id ?? "");
  const editingIdRef = useRef(editing?.id);
  editingIdRef.current = editing?.id;
  const [editorSection, setEditorSection] = useState("write");
  const [urlReady, setUrlReady] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const restoredDraft = useRef(false);
  const settledTopicRun = useRef("");
  const settledKnowledgeSync = useRef("");
  const watchedCollectionRun = useRef("");
  const [imageModel, setImageModel] = useState("gpt-image-2.5-flare");
  const [imageSize, setImageSize] = useState("1024x1536");
  const [imageQuality, setImageQuality] = useState("medium");
  const [imageEnabled, setImageEnabled] = useState(false);
  const [wechatConfigured, setWechatConfigured] = useState(false);
  const [xhsImageIndex, setXhsImageIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceKindFilter, setSourceKindFilter] = useState("全部");
  const [sourceDirectionFilter, setSourceDirectionFilter] = useState("全部");
  const [visibleSourceCount, setVisibleSourceCount] = useState(20);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [sitesDirty, setSitesDirty] = useState(false);
  const topicMix = workspace.settings.topicMix ?? defaultTopicMix;
  const [knowledgeGraph, setKnowledgeGraph] =
    useState<KnowledgeGraphResult | null>(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgePlugins, setKnowledgePlugins] = useState<
    KnowledgePluginStatus[]
  >([]);
  const [weKnoraConfig, setWeKnoraConfig] =
    useState<WeKnoraPluginPublicConfig | null>(null);
  const [weKnoraRuntime, setWeKnoraRuntime] =
    useState<BuiltinWeKnoraState | null>(null);
  const [weKnoraSync, setWeKnoraSync] =
    useState<WeKnoraSyncRun | null>(null);
  const [weKnoraForm, setWeKnoraForm] = useState<WeKnoraPluginForm>(
    emptyWeKnoraPluginForm,
  );
  const [weKnoraConfigDirty, setWeKnoraConfigDirty] = useState(false);
  const [weKnoraManaging, setWeKnoraManaging] = useState(false);
  const weKnoraFormDirtyRef = useRef(false);
  const [pluginQuery, setPluginQuery] = useState("");
  const [pluginSearchResult, setPluginSearchResult] =
    useState<KnowledgePluginSearchResult | null>(null);
  const [pluginSearching, setPluginSearching] = useState(false);
  const [knowledgeImportDirection, setKnowledgeImportDirection] =
    useState<Direction>(directions[0]);
  const [selectedKnowledgeEntityId, setSelectedKnowledgeEntityId] =
    useState("");
  const [regenerateDialog, setRegenerateDialog] = useState<Draft | null>(null);
  const [regenerateSelections, setRegenerateSelections] = useState<Partial<Record<ContentChannel, { content: boolean; cover: boolean; images: boolean }>>>({});
  const [confirmDialog, setConfirmDialog] =
    useState<ConfirmDialogState | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [sourceForm, setSourceForm] = useState({
    title: "",
    kind: "资料摘录",
    eventDate: "",
    url: "",
    publisher: "",
    publishedAt: "",
    direction: directions[0] as Direction,
    excerpt: "",
    facts: "",
    interpretation: "",
    unknowns: "",
    summary: "",
    category: "",
  });
  const savedDraft = editing
    ? workspace.drafts.find((draft) => draft.id === editing.id)
    : undefined;
  const draftDirty = Boolean(
    editing &&
      savedDraft &&
      JSON.stringify(editing) !== JSON.stringify(savedDraft),
  );

  function askConfirm(options: ConfirmDialogOptions): Promise<boolean> {
    confirmResolver.current?.(false);
    return new Promise((resolve) => {
      confirmResolver.current = resolve;
      setConfirmDialog({ ...options, id: Date.now() });
    });
  }

  function settleConfirm(value: boolean) {
    const resolve = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmDialog(null);
    resolve?.(value);
  }

  function setTab(next: Tab) {
    if (next === tab) {
      // Clicking the active Article menu item returns from an open editor to the list.
      if (next === "内容草稿" && editing) closeDraft();
      return;
    }
    const unsaved = [
      draftDirty ? "当前草稿" : "",
      settingsDirty || sitesDirty ? "信源或自动化设置" : "",
      weKnoraConfigDirty ? "WeKnora 插件设置" : "",
    ].filter(Boolean);
    if (unsaved.length) {
      void askConfirm({
        title: "离开当前页面？",
        message: `${unsaved.join("和")}还有未保存的修改，离开后这些修改会丢失。`,
        confirmLabel: "放弃修改并离开",
        tone: "danger",
      }).then((confirmed) => {
        if (!confirmed) return;
        setTabState(next);
        if (next !== "内容草稿") setEditing(null);
      });
      return;
    }
    setTabState(next);
    if (next !== "内容草稿") setEditing(null);
  }
  function closeDraft() {
    if (draftDirty) {
      void askConfirm({
        title: "返回草稿列表？",
        message: "当前草稿还有未保存的修改，返回后这些修改会丢失。",
        confirmLabel: "放弃修改并返回",
        tone: "danger",
      }).then((confirmed) => {
        if (confirmed) setEditing(null);
      });
      return;
    }
    setEditing(null);
  }

  const load = useCallback(async () => {
    const session = await fetch("/api/session", { cache: "no-store" }).then(
      (r) => r.json(),
    );
    setToken(session.token);
    setImageModel(session.imageModel || "gpt-image-2.5-flare");
    setImageSize(session.imageSize || "1024x1536");
    setImageQuality(session.imageQuality || "medium");
    setImageEnabled(Boolean(session.imageEnabled));
    setWechatConfigured(Boolean(session.wechatConfigured));
    setKnowledgePlugins(
      Array.isArray(session.knowledgePlugins)
        ? (session.knowledgePlugins as KnowledgePluginStatus[])
        : [],
    );
    if (session.weknoraRuntime)
      setWeKnoraRuntime(session.weknoraRuntime as BuiltinWeKnoraState);
    const pluginState = await fetch("/api/knowledge/plugins", {
      cache: "no-store",
    }).then((response) => response.json());
    if (Array.isArray(pluginState.plugins))
      setKnowledgePlugins(pluginState.plugins as KnowledgePluginStatus[]);
    if (pluginState.weknora) {
      const config = pluginState.weknora as WeKnoraPluginPublicConfig;
      setWeKnoraConfig(config);
      if (!weKnoraFormDirtyRef.current) {
        setWeKnoraForm({
          mode: config.mode,
          enabled: config.enabled,
          baseUrl: config.baseUrl,
          tenantId: config.tenantId,
          knowledgeBaseIds: config.knowledgeBaseIds.join(", "),
          apiKey: "",
          clearApiKey: false,
        });
      }
    }
    if (pluginState.runtime)
      setWeKnoraRuntime(pluginState.runtime as BuiltinWeKnoraState);
    if (pluginState.sync)
      setWeKnoraSync(pluginState.sync as WeKnoraSyncRun);
    const state = await fetch("/api/workspace", { cache: "no-store" }).then(
      (r) => r.json(),
    );
    setWorkspace({ ...blank, ...state });
    if (!restoredDraft.current) {
      restoredDraft.current = true;
      const draftId = tabFromPath(window.location.pathname).draftId;
      if (draftId)
        setEditing(
          (state.drafts as Draft[]).find((draft) => draft.id === draftId) ??
            null,
        );
    }
  }, []);
  useEffect(() => {
    const requested = tabFromPath(window.location.pathname);
    if (requested.tab !== "概览" || window.location.pathname === "/")
      setTabState(requested.tab);
    if (requested.draftId && requested.tab === "内容草稿") {
      const draft = workspace.drafts.find((entry) => entry.id === requested.draftId);
      // Keep the original detail URL while the initial workspace request is
      // still loading. Otherwise the URL sync effect can replace
      // `/articles/{id}` with `/articles/` before the draft is restored.
      if (!draft) return;
      setEditing(draft);
    }
    setUrlReady(true);
  }, [workspace.drafts]);
  useEffect(() => {
    setTopicBatchCount(workspace.settings.topicsPerRun);
  }, [workspace.settings.topicsPerRun]);
  useEffect(() => {
    weKnoraFormDirtyRef.current = weKnoraConfigDirty;
  }, [weKnoraConfigDirty]);
  useEffect(() => {
    setEditorSection("write");
  }, [editing?.id]);
  useEffect(() => {
    if (!copilotOpen) return;
    const viewport = copilotMessagesRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [copilotOpen, editing?.id, editing?.copilotMessages]);
  useEffect(() => {
    if (!urlReady) return;
    const pathname = routeForTab(tab, editing?.id);
    window.history.replaceState(
      null,
      "",
      pathname,
    );
  }, [tab, editing?.id, urlReady]);
  const collectionRunning = workspace.runs.find(
    (run) => run.status === "运行中",
  );
  useEffect(() => {
    if (!collectionRunning) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [collectionRunning?.id]);
  useEffect(() => {
    void load().catch(() => setNotice("无法连接本地资料库，请检查服务状态。"));
  }, [load]);
  useEffect(() => {
    if (
      !draftDirty &&
      !settingsDirty &&
      !sitesDirty &&
      !weKnoraConfigDirty
    )
      return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draftDirty, settingsDirty, sitesDirty, weKnoraConfigDirty]);
  useEffect(() => {
    const hasRunningTask =
      workspace.runs.some((run) => run.status === "运行中") ||
      workspace.topicRuns.some((run) => run.status === "运行中") ||
      workspace.drafts.some(
        (draft) =>
          draft.generationRun?.status === "运行中" ||
          draft.visualRun?.status === "运行中" ||
          draft.videoRun?.status === "运行中" ||
          draft.copilotMessages.some(
            (message) =>
              message.role === "assistant" && message.status === "运行中",
          ),
      ) ||
      weKnoraRuntime?.status === "preparing" ||
      weKnoraRuntime?.status === "starting";
    if (
      settingsDirty ||
      sitesDirty ||
      (!hasRunningTask && !workspace.settings.autoCollect)
    )
      return;
    const timer = window.setInterval(() => {
      void load();
    }, hasRunningTask ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [
    workspace.runs,
    workspace.topicRuns,
    workspace.drafts,
    workspace.settings.autoCollect,
    load,
    settingsDirty,
    sitesDirty,
    weKnoraRuntime?.status,
  ]);
  useEffect(() => {
    if (!editing) return;
    const fresh = workspace.drafts.find((draft) => draft.id === editing.id);
    if (!fresh) return;
    const generationChanged =
      fresh.generationRun?.status !== editing.generationRun?.status ||
      fresh.generationRun?.stage !== editing.generationRun?.stage ||
      generationWorkflowChanged(editing.generationRun, fresh.generationRun) ||
      fresh.updatedAt !== editing.updatedAt;
    const visualChanged =
      fresh.visualRun?.status !== editing.visualRun?.status ||
      fresh.visualRun?.stage !== editing.visualRun?.stage ||
      generationWorkflowChanged(editing.visualRun, fresh.visualRun) ||
      generationWorkflowChanged(editing.videoRun, fresh.videoRun) ||
      fresh.visualRun?.completed !== editing.visualRun?.completed ||
      fresh.videoRun?.status !== editing.videoRun?.status ||
      fresh.videoRun?.stage !== editing.videoRun?.stage;
    if (generationChanged || visualChanged)
      setEditing((current) => applyCopilotResponse(current, fresh));
    else if (!sameCopilotMessages(fresh.copilotMessages, editing.copilotMessages))
      setEditing((current) => applyCopilotMessages(current, fresh));
  }, [
    workspace.drafts,
    editing?.id,
    editing?.copilotMessages,
    editing?.generationRun?.status,
    editing?.generationRun?.stage,
    editing?.visualRun?.status,
    editing?.visualRun?.stage,
    editing?.visualRun?.completed,
    editing?.videoRun?.status,
    editing?.videoRun?.stage,
    editing?.updatedAt,
  ]);
  useEffect(() => {
    const latest = workspace.topicRuns[0];
    if (
      !latest ||
      latest.status === "运行中" ||
      settledTopicRun.current === latest.id ||
      topicResearchFeedback?.tone !== "running"
    )
      return;
    settledTopicRun.current = latest.id;
    setTopicResearchFeedback(null);
    setNotice(
      latest.status === "完成"
        ? latest.createdTopicIds.length
          ? `选题研究完成，已加入 ${latest.createdTopicIds.length} 个带来源的选题。`
          : "选题研究完成，但没有发现新的可写作角度。可以继续补充资料后重试。"
        : `选题研究失败：${latest.error || "请检查资料与 DeepSeek 配置后重试。"}`,
    );
  }, [workspace.topicRuns, topicResearchFeedback?.tone]);
  useEffect(() => {
    if (!weKnoraSync || weKnoraSync.status !== "运行中" || !token) return;
    let stopped = false;
    const poll = async () => {
      const response = await fetch("/api/knowledge/sync", {
        cache: "no-store",
      });
      if (!response.ok || stopped) return;
      const result = await response.json();
      const run = result.run as WeKnoraSyncRun | null;
      if (!run) return;
      setWeKnoraSync(run);
      if (
        run.status !== "运行中" &&
        settledKnowledgeSync.current !== run.startedAt
      ) {
        settledKnowledgeSync.current = run.startedAt;
        setNotice(
          run.status === "完成"
            ? `资料同步完成：新建 ${run.created} 份，更新 ${run.updated} 份。`
            : `资料同步结束：${run.failed} 份失败${run.errors[0] ? `；${run.errors[0]}` : ""}`,
        );
        void load();
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [weKnoraSync?.status, weKnoraSync?.startedAt, token, load]);
  useEffect(() => {
    if (!confirmDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settleConfirm(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog]);
  useEffect(() => {
    const runId = watchedCollectionRun.current;
    if (!runId) return;
    const run = workspace.runs.find((entry) => entry.id === runId);
    if (!run || run.status === "运行中") return;
    watchedCollectionRun.current = "";
    if (run.status === "完成")
      setNotice(
        `资料处理完成：发现 ${run.found} 条候选，保存 ${run.contentCount ?? 0} 份原文，完成 ${run.archived} 份结构化归档。`,
      );
    else if (run.status === "已停止")
      setNotice("资料任务已停止；已经保存的原文和结构化资料保持不变。");
    else setNotice(`资料任务失败：${run.error || "请检查网络和模型配置后重试。"}`);
  }, [workspace.runs]);
  useEffect(() => {
    if (tab !== "知识图谱" || !token) return;
    const controller = new AbortController();
    setKnowledgeLoading(true);
    setKnowledgeError("");
    const timer = setTimeout(() => {
      void fetch(
        `/api/knowledge?q=${encodeURIComponent(knowledgeQuery.trim())}`,
        {
          headers: { "X-Draft-Studio-Token": token },
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || "知识图谱索引失败。");
          setKnowledgeGraph(result as KnowledgeGraphResult);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          setKnowledgeError(
            error instanceof Error ? error.message : "知识图谱索引失败。",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setKnowledgeLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    tab,
    token,
    knowledgeQuery,
    workspace.sources.length,
    workspace.entities.length,
    workspace.relations.length,
  ]);

  async function call(path: string, method = "POST", body?: unknown, refresh = true) {
    const request = (requestToken: string) =>
      fetch(`/api${path}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          "X-Draft-Studio-Token": requestToken,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    let response = await request(token);
    let result = await response.json();
    // The server rotates this token after a process restart/hot reload. Refresh
    // once so an already-open editor can continue without a manual reload.
    if (
      response.status === 403 &&
      result?.error === "本机会话校验失败，请刷新页面后重试。"
    ) {
      const session = await fetch("/api/session", { cache: "no-store" }).then(
        (sessionResponse) => sessionResponse.json(),
      );
      const refreshedToken = typeof session.token === "string" ? session.token : "";
      if (refreshedToken) {
        setToken(refreshedToken);
        response = await request(refreshedToken);
        result = await response.json();
      }
    }
    if (!response.ok) throw new Error(result.error || "操作失败");
    if (refresh) await load();
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  const filteredSources = useMemo(
    () =>
      workspace.sources.filter(
        (item) =>
          `${item.title} ${item.publisher} ${item.excerpt} ${item.facts} ${item.interpretation}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (sourceKindFilter === "全部" || item.kind === sourceKindFilter) &&
          (sourceDirectionFilter === "全部" ||
            item.direction === sourceDirectionFilter),
      ),
    [workspace.sources, search, sourceKindFilter, sourceDirectionFilter],
  );
  const visibleSources = useMemo(
    () => filteredSources.slice(0, visibleSourceCount),
    [filteredSources, visibleSourceCount],
  );
  const graphEntities = knowledgeGraph?.entities ?? [];
  const graphRelations = knowledgeGraph?.relations ?? [];
  useEffect(() => {
    setVisibleSourceCount(20);
  }, [search, sourceKindFilter, sourceDirectionFilter]);

  async function createSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement)
      .files?.[0];
    await run(async () => {
      const result = await call("/sources", "POST", sourceForm);
      if (file) {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch(`/api/sources/${result.source.id}/file`, {
          method: "POST",
          headers: { "X-Draft-Studio-Token": token },
          body: form,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "文件归档失败");
        await load();
      }
      setSourceForm({
        title: "",
        kind: "资料摘录",
        eventDate: "",
        url: "",
        publisher: "",
        publishedAt: "",
        direction,
        excerpt: "",
        facts: "",
        interpretation: "",
        unknowns: "",
        summary: "",
        category: "",
      });
      setNotice("资料已归档，可继续整理事实与判断，或关联到选题。");
    });
  }
  async function reindexKnowledgeGraph() {
    await run(async () => {
      const response = await fetch("/api/knowledge/reindex", {
        method: "POST",
        headers: { "X-Draft-Studio-Token": token },
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Kuzu 图谱索引重建失败。");
      const indexed = await fetch(
        `/api/knowledge?q=${encodeURIComponent(knowledgeQuery.trim())}`,
        { headers: { "X-Draft-Studio-Token": token } },
      );
      const graph = await indexed.json();
      if (!indexed.ok)
        throw new Error(graph.error || "Kuzu 图谱索引读取失败。");
      setKnowledgeGraph(graph as KnowledgeGraphResult);
      setNotice(
        `Kuzu 图谱索引已重建：${graph.counts.entities} 个规范化实体，${graph.counts.relations} 条关系。`,
      );
    });
  }
  async function searchKnowledgePlugins() {
    const query = pluginQuery.trim();
    if (!query) {
      setNotice("请输入要跨资料库检索的问题或关键词。");
      return;
    }
    setPluginSearching(true);
    setNotice("");
    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Draft-Studio-Token": token,
        },
        body: JSON.stringify({ query }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "跨库知识检索失败。");
      setPluginSearchResult(result as KnowledgePluginSearchResult);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "跨库知识检索失败。",
      );
    } finally {
      setPluginSearching(false);
    }
  }
  async function saveWeKnoraPlugin(
    form: WeKnoraPluginForm = weKnoraForm,
  ) {
    setWeKnoraManaging(true);
    setNotice("");
    try {
      const response = await fetch("/api/knowledge/plugins/weknora", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Draft-Studio-Token": token,
        },
        body: JSON.stringify({
          ...form,
          knowledgeBaseIds: form.knowledgeBaseIds
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean),
          apiKey: form.apiKey.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "WeKnora 插件设置保存失败。");
      const config = result.config as WeKnoraPluginPublicConfig;
      setWeKnoraConfig(config);
      if (result.runtime)
        setWeKnoraRuntime(result.runtime as BuiltinWeKnoraState);
      setWeKnoraForm((current) => ({
        ...current,
        mode: config.mode,
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        tenantId: config.tenantId,
        knowledgeBaseIds: config.knowledgeBaseIds.join(", "),
        apiKey: "",
        clearApiKey: false,
      }));
      setKnowledgePlugins(
        Array.isArray(result.plugins)
          ? (result.plugins as KnowledgePluginStatus[])
          : [],
      );
      setWeKnoraConfigDirty(false);
      setNotice(
        config.enabled
          ? "WeKnora 插件已启用。现在可以从资料库跨库检索并导入原文。"
          : "WeKnora 插件已保存并暂停；已有导入资料不受影响。",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "插件设置保存失败。",
      );
    } finally {
      setWeKnoraManaging(false);
    }
  }
  async function startBuiltinKnowledgeEngine() {
    await run(async () => {
      const result = await call("/knowledge/plugins/weknora/start", "POST", {});
      if (result.runtime)
        setWeKnoraRuntime(result.runtime as BuiltinWeKnoraState);
      setNotice("内置知识引擎正在启动；准备完成后会自动进入可用状态。");
    });
  }
  async function enableBuiltinKnowledgeEngine() {
    const form: WeKnoraPluginForm = {
      ...weKnoraForm,
      mode: "builtin",
      enabled: true,
      baseUrl: "",
      apiKey: "",
      clearApiKey: false,
    };
    setWeKnoraForm(form);
    await saveWeKnoraPlugin(form);
  }
  async function stopBuiltinKnowledgeEngine() {
    await run(async () => {
      const result = await call("/knowledge/plugins/weknora/stop", "POST", {});
      if (result.config)
        setWeKnoraConfig(result.config as WeKnoraPluginPublicConfig);
      if (result.runtime)
        setWeKnoraRuntime(result.runtime as BuiltinWeKnoraState);
      setNotice("内置知识引擎已停止，本地资料与引擎数据均已保留。");
    });
  }
  async function syncBuiltinKnowledge() {
    await run(async () => {
      const result = await call("/knowledge/sync", "POST", {});
      if (result.run)
        setWeKnoraSync(result.run as WeKnoraSyncRun);
      setNotice(
        `资料同步已在后台开始；当前计划处理 ${result.run?.attempted ?? 0} 份资料。`,
      );
    });
  }
  async function importKnowledgeHit(hit: KnowledgeSearchHit) {
    if (hit.pluginId !== "weknora" || !hit.documentId) return;
    const confirmed = await askConfirm({
      title: "导入 WeKnora 文档？",
      message: `将读取「${hit.title}」的完整分块并加入本地资料库，标记为待核实。相同文档不会重复导入。`,
      confirmLabel: "导入资料库",
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await call("/knowledge/import", "POST", {
        knowledgeId: hit.documentId,
        direction: knowledgeImportDirection,
      });
      setNotice(
        `「${result.source.title}」已导入本地资料库；可继续补充事实判断或生成知识图谱。`,
      );
    });
  }
  async function saveAutomationSettings() {
    await run(async () => {
      const result = await call("/settings", "PUT", {
        ...workspace.settings,
        topicMix,
      });
      setWorkspace((current) => ({
        ...current,
        settings: result.settings,
      }));
      setSettingsDirty(false);
      setNotice(
        "采集与选题设置已保存；注意力配比已自动归一化为 100%。",
      );
    });
  }
  async function submitTopicGeneration(topic: Topic): Promise<Draft | null> {
    setSubmittingTopicIds((ids) =>
      ids.includes(topic.id) ? ids : [...ids, topic.id],
    );
    try {
      const result = await call(`/topics/${topic.id}/draft`, "POST", {});
      return result.draft as Draft;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "待写文章创建失败。",
      );
      return null;
    } finally {
      setSubmittingTopicIds((ids) => ids.filter((id) => id !== topic.id));
    }
  }
  async function generate(topic: Topic) {
    const existing = workspace.drafts.filter(
      (draft) => draft.topicId === topic.id,
    );
    if (existing[0]) {
      setEditing(existing[0]);
      setTab("内容草稿");
      return;
    }
    const confirmed = await askConfirm({
      title: "创建待写文章",
      message: "创建待写文章，进入文章后再手动选择渠道并生成内容。选题阶段不决定发布渠道。",
      confirmLabel: "创建待写文章",
    });
    if (!confirmed) return;
    const draft = await submitTopicGeneration(topic);
    if (draft) {
      setEditing(draft);
      setTab("内容草稿");
      setNotice(
        "待写文章已创建。请在文章页选择渠道，再生成该渠道专属内容。",
      );
    }
  }
  async function generateSelectedTopics() {
    const requested = workspace.topics.filter(
      (topic) =>
        selectedTopics.includes(topic.id) && topic.status === "准备写作",
    );
    const chosen = requested.filter((topic) =>
      !workspace.drafts.some((draft) => draft.topicId === topic.id) &&
      workspace.sources.some(
        (source) =>
          topic.sourceIds.includes(source.id) &&
          source.kind !== "候选链接" &&
          Boolean(source.facts.trim() || source.excerpt.trim()),
      ),
    );
    if (!requested.length) {
      setNotice("先勾选选题，并将其状态设为「准备写作」。");
      return;
    }
    if (!chosen.length) {
      const withDraft = requested.filter((topic) =>
        workspace.drafts.some((draft) => draft.topicId === topic.id),
      ).length;
      setNotice(
        withDraft
          ? `${withDraft} 个选题已经有文章，请直接在卡片中进入文章；批量生成只处理尚无文章的选题。`
          : "所选选题都没有可追溯的结构化资料，不能创建待写文章。",
      );
      return;
    }
    const batch = chosen;
    const confirmed = await askConfirm({
      title: "批量创建待写文章",
      message: `将为 ${batch.length} 个选题创建待写文章，不生成渠道内容；进入文章后手动选择渠道。`, 
      confirmLabel: `提交 ${batch.length} 篇初稿`,
    });
    if (!confirmed) return;
    let submitted = 0;
    const submittedIds: string[] = [];
    for (const topic of batch) {
      if (await submitTopicGeneration(topic)) {
        submitted += 1;
        submittedIds.push(topic.id);
      }
    }
    setSelectedTopics((ids) =>
      ids.filter((id) => !submittedIds.includes(id)),
    );
    if (submitted)
      setNotice(
        `已创建 ${submitted} 篇待写文章，请进入文章选择渠道并生成。`,
      );
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setEditing((draft) => (draft && draft.videoRun?.status !== "运行中" ? { ...draft, [key]: value } : draft));
  }
  const craftReady = editing
    ? craftGroups
        .filter((group) => !group.optional)
        .every((group) =>
          group.keys.every((key) => editing.creativeBrief[key].trim()),
        )
    : false;
  async function generateCraft() {
    if (!editing) return;
    const confirmed = await askConfirm({
      title: editing.creativeBrief.counterAngle
        ? "重新生成创作卡？"
        : "生成创作卡？",
      message:
        "系统会根据选题、关联资料和图谱线索生成或刷新整张创作卡。已有正文不会改变。",
      confirmLabel: editing.creativeBrief.counterAngle
        ? "重新生成"
        : "生成创作卡",
    });
    if (!confirmed) return;
    await run(async () => {
      if (draftDirty) {
        await call(`/drafts/${editing.id}`, "PUT", editing);
      }
      const result = await call(`/drafts/${editing.id}/plan`, "POST", {});
      setEditing(result.draft);
      setNotice(
        "创作卡已根据资料自动生成；请查看文章结构，再决定是否重写正文。",
      );
    });
  }
  async function saveDraft() {
    if (!editing) return;
    await run(async () => {
      const result = await call(`/drafts/${editing.id}`, "PUT", editing);
      setEditing(result.draft);
      setNotice("文章已保存到本地工作区。");
    });
  }
  async function switchDraftChannel(channel: ContentChannel) {
    if (!editing || editing.channel === channel || channelSwitching) return;
    setChannelSwitching(true);
    await run(async () => {
      if (draftDirty) {
        const saved = await call(`/drafts/${editing.id}`, "PUT", editing);
        setEditing(saved.draft);
      }
      let result: { draft: Draft };
      try {
        result = await call(`/drafts/${editing.id}/channel`, "POST", { channel });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/配图仍在生成/.test(message)) throw error;
        setNotice("当前配图仍在生成，完成后自动切换到目标渠道…");
        await waitForVisualSet(editing.id);
        result = await call(`/drafts/${editing.id}/channel`, "POST", { channel });
      }
      setEditing(result.draft as Draft);
      setNotice(
        result.draft.title || result.draft.body
          ? `已切换到${channelLabel(channel)}版本。`
          : `${channelLabel(channel)}还没有内容，可以直接写作，也可以生成渠道版本。`,
      );
    }).finally(() => setChannelSwitching(false));
  }
  function regenerateArticle(draft: Draft) {
    setRegenerateSelections({});
    setRegenerateDialog(draft);
  }
  async function submitRegeneration() {
    if (!regenerateDialog) return;
    const target = regenerateDialog;
    const selections = contentChannels.flatMap(channel => {
      const value = regenerateSelections[channel];
      return value && (value.content || value.cover || value.images) ? [{ channel, ...value }] : [];
    });
    if (!selections.length) return;
    await run(async () => {
      if (editing?.id === target.id && draftDirty) await call(`/drafts/${target.id}`, "PUT", editing);
      const result = await call(`/drafts/${target.id}/regenerate`, "POST", { selections });
      if (editing?.id === target.id) setEditing(result.draft);
      setRegenerateDialog(null);
      setNotice("已提交勾选的生成任务，可刷新页面查看进度。");
    });
  }
  async function copyWechatRichText() {
    if (!editing) return;
    const html = renderWechatArticleHtml(
      { ...editing, images: draftImages },
      [],
      { includeMetadata: false },
    );
    const plainText = [
      editing.title,
      editing.body,
      ...wechatBodyImages.map(
        (item, index) =>
          `【正文图 ${String(index + 1).padStart(2, "0")}：${item.image.title || "文章配图"}｜插入到第 ${item.position} 个正文块之后】`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plainText);
    }
    setNotice(
      "公众号富文本已复制。图片不会随剪贴板上传，请按发布包中的编号和插入位置单独上传。",
    );
  }
  async function sendCopilotMessage(overrides?: { input?: string; target?: CopilotTarget; mentions?: string[] }) {
    if (!editing || copilotSubmitting) return;
    const draftId = editing.id;
    const message = (overrides?.input ?? copilotInput).trim();
    if (!message) {
      setNotice("请告诉 Copilot 这次要修改什么。");
      return;
    }
    if (
      editing.copilotMessages.some(
        (entry) => entry.role === "assistant" && entry.status === "运行中",
      )
    ) {
      setNotice("Copilot 正在处理上一次修改，完成后再发送新的要求。");
      return;
    }
    setCopilotSubmitting(true);
    try {
      await submitCopilotRequest(
        editing, draftDirty,
        { message, target: overrides?.target ?? copilotTarget, mentions: overrides?.mentions ?? copilotMentions },
        (path, method, body) => call(path, method, body, false),
        (response) => {
          setWorkspace((current) => ({
            ...current,
            drafts: current.drafts.map((draft) => draft.id === response.id ? response : draft),
          }));
          setEditing((current) => applyCopilotResponse(current, response));
        },
      );
      setCopilotInput("");
      setCopilotMentions([]);
      setCopilotMentionOpen(false);
      await load();
      if (editingIdRef.current === draftId) setNotice(
        (overrides?.target ?? copilotTarget) === "image"
          ? "Copilot 已开始修改视觉企划；完成后会自动重画视觉组和公众号头图。"
          : "Copilot 已开始处理这次修改，可以继续浏览其他页面。",
      );
    } catch (error) {
      if (editingIdRef.current === draftId) setNotice(
        error instanceof Error ? error.message : "Copilot 修改提交失败。",
      );
    } finally {
      setCopilotSubmitting(false);
    }
  }
  async function resendCopilotMessage(message: CopilotMessage) {
    await sendCopilotMessage({
      input: message.text,
      target: message.target,
      mentions: message.mentions.map((mention) => mention.id),
    });
  }
  async function exportDraft() {
    if (!editing) return;
    await run(async () => {
      if (draftDirty) {
        const saved = await call(`/drafts/${editing.id}`, "PUT", editing);
        setEditing(saved.draft);
      }
      const response = await fetch(`/api/drafts/${editing.id}/export`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "导出失败，请稍后重试。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        channelDownloadName(editing.channel, editing.id, "md");
      link.click();
      URL.revokeObjectURL(url);
      setNotice("已按当前保存内容导出 Markdown。");
    });
  }
  async function generateVideo() {
    if (!editing) return;
    await run(async () => {
      if (draftDirty) await call(`/drafts/${editing.id}`, "PUT", editing);
      const result = await call(`/drafts/${editing.id}/video`, "POST", {});
      setEditing(current => applyCopilotResponse(current, result.draft as Draft));
      await load();
      setNotice("视频已开始渲染，完成后可在预览中播放并下载发布包。");
    });
  }
  async function downloadPublishPackage() {
    if (!editing) return;
    if (editing.channel !== "video" && !draftImages.length && !editing.wechatCover) {
      setNotice("这篇草稿还没有图片。先在当前页面生成视觉组，再下载发布包。");
      return;
    }
    await run(async () => {
      if (draftDirty) {
        const saved = await call(`/drafts/${editing.id}`, "PUT", editing);
        setEditing(saved.draft);
      }
      const response = await fetch(
        `/api/drafts/${editing.id}/package`,
        { headers: { "X-Draft-Studio-Token": token } },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "发布包生成失败。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        channelDownloadName(editing.channel, editing.id, "zip");
      link.click();
      URL.revokeObjectURL(url);
      setNotice(
        editing.channel === "video" ? "视频发布包已下载：包含 MP4、封面、摘要、口播稿、字幕和分镜。" : editing.channel === "wechat"
          ? "公众号发布包已下载：包含 article.html、900×383 封面、按位置编号的正文图和发布文案。"
          : `${channelLabel(editing.channel)}发布包已下载：包含发布文案、发布说明和按顺序编号的图片。`,
      );
    });
  }
  async function createWechatDraft() {
    if (!editing) return;
    if (!wechatConfigured) {
      setNotice(
        "未配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET，请先完成公众号接口设置。",
      );
      return;
    }
    if (editing.channel !== "video" && !draftImages.length && !editing.wechatCover) {
      setNotice("公众号官方草稿至少需要一张封面图。");
      return;
    }
    const confirmed = await askConfirm({
      title: "创建公众号官方草稿？",
      message:
        "工作台会通过微信官方接口上传封面和正文图，并创建一篇草稿。不会群发或发布；请先在公众号后台预览确认。",
      confirmLabel: "创建官方草稿",
    });
    if (!confirmed) return;
    await run(async () => {
      if (draftDirty) {
        const saved = await call(`/drafts/${editing.id}`, "PUT", editing);
        setEditing(saved.draft);
      }
      const result = await call(
        `/drafts/${editing.id}/wechat-draft`,
        "POST",
        {},
      );
      setEditing(result.draft as Draft);
      setNotice(
        "公众号草稿已创建。请到公众号后台检查封面、正文样式、图片位置和评论设置。",
      );
    });
  }
  async function waitForVisualSet(draftId: string): Promise<Draft> {
    const deadline = Date.now() + 60 * 60_000;
    let missingRunPolls = 0;
    while (Date.now() < deadline) {
      const workspace = await fetch("/api/workspace", {
        cache: "no-store",
      }).then((response) => response.json());
      const draft = (workspace.drafts as Draft[]).find(
        (entry) => entry.id === draftId,
      );
      if (!draft) throw new Error("草稿不存在。");
      const run = draft.visualRun;
      // The task is started asynchronously. A workspace read can briefly land
      // between the 202 response and the first persisted visualRun update.
      // Keep polling through that small write window instead of turning a
      // successful submission into a false error.
      if (!run) {
        missingRunPolls += 1;
        if (missingRunPolls < 8) {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          continue;
        }
        throw new Error("配图任务没有返回可识别的运行状态，请刷新后查看任务记录。");
      }
      missingRunPolls = 0;
      if (run.status === "失败")
        throw new Error(run.error || "配图组生成失败，请稍后重试。");
      if (run.status === "完成") {
        setNotice(
          run.error
            ? `视觉组已生成，但有降级说明：${run.error}`
            : "自动视觉组已生成；图片数量由内容决定，并共享同一视觉语言。",
        );
        return draft;
      }
      setEditing((current) =>
        current?.id === draftId ? draft : current,
      );
      setNotice(
        `${run.stage} · 已完成 ${run.completed}/${run.total} 张`,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("配图组生成超过 60 分钟，请在草稿中查看任务状态后重试。");
  }
  async function verifySource(source: Source) {
    await run(async () => {
      await call(`/sources/${source.id}`, "PATCH", {
        verification: source.verification === "已核对" ? "待核实" : "已核对",
      });
    });
  }
  async function deleteSource(source: Source) {
    const confirmed = await askConfirm({
      title: "删除这份资料？",
      message: `「${source.title}」的相关选题引用、图谱链接、本地附件和已保存原文都会清理，此操作不可撤销。`,
      confirmLabel: "删除资料",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(async () => {
      await call(`/sources/${source.id}`, "DELETE");
      setNotice("资料已删除，相关引用和本地文件已清理。");
    });
  }
  async function clearCandidates() {
    const count = workspace.sources.filter(
      (source) => source.kind === "候选链接",
    ).length;
    if (!count) return;
    const confirmed = await askConfirm({
      title: "清除候选链接？",
      message: `将清除全部 ${count} 条尚未结构化的候选链接，已完成的正式资料不会受影响。`,
      confirmLabel: "清除候选",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await call("/sources/candidates", "DELETE");
      setNotice(`已清除 ${result.removed} 条候选链接。`);
    });
  }
  async function processCandidates(source?: Source) {
    const count = source ? 1 : candidateSources.length;
    const label = source ? `「${source.title}」` : `全部 ${count} 条候选`;
    const confirmed = await askConfirm({
      title: "补抓并整理原文？",
      message: `将补抓${label}的原文，并提取摘要、分类、实体、关系和选题。读取失败项会保留原因，可再次重试。`,
      confirmLabel: "开始补抓",
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await call("/sources/process-candidates", "POST", {
        ...(source ? { sourceIds: [source.id] } : {}),
      });
      watchedCollectionRun.current = result.run.id;
      setNotice(
        `正在补抓 ${count} 条候选原文；可实时查看读取、本地原文和结构化进度。`,
      );
    });
  }
  async function deleteTopic(topic: Topic) {
    const draftCount = workspace.drafts.filter(
      (draft) => draft.topicId === topic.id,
    ).length;
    const confirmed = await askConfirm({
      title: "删除这个选题？",
      message: draftCount
        ? `将删除「${topic.title}」及其 ${draftCount} 篇草稿和配图，此操作不可撤销。`
        : `将删除选题「${topic.title}」，此操作不可撤销。`,
      confirmLabel: draftCount ? "删除选题和草稿" : "删除选题",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(async () => {
      await call(`/topics/${topic.id}`, "DELETE");
      setSelectedTopics((ids) => ids.filter((id) => id !== topic.id));
      if (editing?.topicId === topic.id) setEditing(null);
      setNotice("选题及相关草稿已删除。");
    });
  }
  async function deleteDraft(draft: Draft) {
    const confirmed = await askConfirm({
      title: "删除这篇草稿？",
      message: `「${draft.title || "未命名草稿"}」及其配图会被删除，此操作不可撤销。`,
      confirmLabel: "删除草稿",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(async () => {
      await call(`/drafts/${draft.id}`, "DELETE");
      if (editing?.id === draft.id) setEditing(null);
      setNotice("草稿已删除。");
    });
  }
  async function collectNow() {
    if (settingsDirty || sitesDirty) {
      setNotice("请先保存信源与自动化设置，再开始采集。");
      return;
    }
    const enabledSites = workspace.sites.filter((site) => site.enabled);
    if (!enabledSites.length) {
      setNotice("请先在「信源与自动化」启用至少一个信源。");
      return;
    }
    const confirmed = await askConfirm({
      title: "开始采集资料？",
      message: `将检查 ${enabledSites.length} 个已启用信源，搜索网页、读取原文并调用 DeepSeek 生成结构化资料。该任务可能需要几分钟。`,
      confirmLabel: "开始采集",
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await call("/collect", "POST", {});
      watchedCollectionRun.current = result.run.id;
      setNotice(
        `正在检查 ${enabledSites.length} 个信源；发现和归档数量会自动更新。`,
      );
    });
  }
  async function stopCollection() {
    if (!collectionRunning) return;
    const confirmed = await askConfirm({
      title: "停止本轮采集？",
      message:
        "尚未归档的结果会被丢弃，已经保存的资料和原文不会受影响。",
      confirmLabel: "停止采集",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(async () => {
      await call("/collect/stop", "POST", {});
      setNotice("停止请求已发送；Harness 子进程结束后即可重新采集。");
    });
  }
  async function startTopicResearch() {
    const count = Math.max(1, Math.min(30, Math.round(topicBatchCount) || 5));
    const usableSources = workspace.sources.filter(
      (source) =>
        source.kind !== "候选链接" &&
        Boolean(source.facts.trim() || source.excerpt.trim()),
    );
    const feedbackStartedAt = Date.now();
    setTopicResearchStarting(true);
    setTopicResearchFeedback({
      tone: "working",
      message: "正在检查资料完整性与来源数量…",
    });
    setBusy(true);
    setNotice("");
    try {
      if (!topicResearchRequest.trim() && !usableSources.length) {
        const candidateCount = workspace.sources.filter(
          (source) => source.kind === "候选链接",
        ).length;
        const structuredCount = workspace.sources.filter(
          (source) => source.kind !== "候选链接",
        ).length;
        setTopicResearchFeedback({
          tone: "error",
          message: candidateCount
            ? `当前只有 ${candidateCount} 条候选链接，没有完成原文阅读和结构化归档，因此不能生成有证据的选题。请先查看候选资料和抓取失败原因。`
            : structuredCount
              ? `当前有 ${structuredCount} 份结构化资料，但都缺少可核实的原文或事实，不能生成有证据的选题。`
              : "当前没有可用的结构化资料。请先归档资料并完成原文阅读。",
        });
        return;
      }
      setTopicResearchFeedback({
        tone: "running",
        message: "研究任务已启动，正在整理已归档证据…",
      });
      const result = await call("/topics/generate-batch", "POST", { count, request: topicResearchRequest.trim() });
      setNotice(
        result.run
          ? topicResearchRequest.trim()
            ? "自主研究已开始，正在检索知识库，随后搜索网页并读取原文。"
            : `选题研究已开始，正在整理 ${result.run.sourceCount ?? usableSources.length} 份已归档资料。`
          : "选题研究已开始。",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法启动选题研究。";
      setTopicResearchFeedback({ tone: "error", message });
      setNotice(message);
    } finally {
      const remainingFeedbackTime = 500 - (Date.now() - feedbackStartedAt);
      if (remainingFeedbackTime > 0)
        await new Promise((resolve) =>
          window.setTimeout(resolve, remainingFeedbackTime),
        );
      setBusy(false);
      setTopicResearchStarting(false);
    }
  }

  const activeTopic =
    editing && workspace.topics.find((topic) => topic.id === editing.topicId);
  const draftImages: Draft["images"] = editing
    ? editing.images.length
      ? editing.images
      : editing.imageFile
        ? [
            {
              id: "legacy-image",
              role: "配图",
              title: "历史配图",
              prompt: editing.imagePrompt ?? "",
              fileName: editing.imageFile,
              createdAt: editing.updatedAt,
            },
          ]
        : []
    : [];
  const wechatBodyImages = editing
    ? sortedWechatBodyImages({ ...editing, images: draftImages })
    : [];
  const wechatCoverImageId = editing?.wechatCover?.id || "";
  const wechatCoverImage = editing?.wechatCover;
  const wechatCoverNeedsRegeneration =
    editing?.wechatCover?.origin !== "ai";
  const copilotMentionAssets = [
    ...draftImages.map((image, index) => ({
      id: image.id,
      label: `正文图 ${String(index + 1).padStart(2, "0")} · ${image.title}`,
    })),
    ...(editing?.wechatCover
      ? [
          {
            id: editing.wechatCover.id,
            label: `${channelLabel(editing.channel)}封面 · ${editing.wechatCover.title}`,
          },
        ]
      : []),
  ];
  const deliveryImages = editing?.wechatCover
    ? [editing.wechatCover, ...draftImages.filter(image => image.id !== editing.wechatCover?.id)]
    : draftImages;
  const activeXhsImageIndex = Math.min(xhsImageIndex, Math.max(0, deliveryImages.length - 1));
  const activeXhsImage = deliveryImages[activeXhsImageIndex];
  const activeImageGeometry = editing
    ? activeXhsImage?.id === editing.wechatCover?.id
      ? channelVisuals[editing.channel].cover
      : channelVisuals[editing.channel]
    : channelVisuals.xiaohongshu;
  const wechatPreviewHtml = editing
    ? renderWechatArticleHtml(
        { ...editing, images: draftImages },
        wechatBodyImages.map((item) => ({
          image: item.image,
          position: item.position,
          src: `/api/media/${item.image.fileName}`,
        })),
        { includeMetadata: false },
      )
    : "";
  const activeChannelHasContent = Boolean(
    editing &&
      (editing.title.trim() || editing.body.trim()),
  );
  const activeVisualTheme = visualThemeById(editing?.visualThemeId);
  const activeImagePromptTemplate = editing
    ? visualPromptTemplateById(editing.imagePromptTemplateId) ||
      selectVisualPromptTemplate(editing, activeTopic ?? undefined)
    : imagePromptTemplates[18];
  const copilotRunning = Boolean(
    editing?.copilotMessages.some(
      (message) => message.role === "assistant" && message.status === "运行中",
    ),
  );

  const copilotUnavailable = Boolean(
    copilotRunning ||
      editing?.generationRun?.status === "运行中" ||
      editing?.visualRun?.status === "运行中" ||
      editing?.videoRun?.status === "运行中",
  );
  const topicResearchRunning = workspace.topicRuns.find(
    (run) => run.status === "运行中",
  );
  const structuredSources = workspace.sources.filter(
    (source) => source.kind !== "候选链接",
  );
  const usableSources = structuredSources.filter((source) =>
    Boolean(source.facts.trim() || source.excerpt.trim()),
  );
  const runningDraftGenerationCount = workspace.drafts.filter(
    (draft) => draft.generationRun?.status === "运行中",
  ).length;
  const generationCapacityFull =
    runningDraftGenerationCount >= MAX_CONCURRENT_DRAFT_GENERATIONS;
  const candidateSources = workspace.sources.filter(
    (source) => source.kind === "候选链接",
  );
  const syncedBuiltinSources = workspace.sources.filter(
    (source) =>
      weKnoraRuntime?.knowledgeBaseId &&
      source.externalKnowledgeBaseId === weKnoraRuntime.knowledgeBaseId,
  ).length;
  const builtinRuntimeRunning = weKnoraRuntime?.status === "running";
  const externalWeKnoraActive =
    weKnoraConfig?.mode === "external" && weKnoraConfig.enabled;
  const builtinRuntimePreparing =
    weKnoraRuntime?.status === "preparing" ||
    weKnoraRuntime?.status === "starting";
  const knowledgeSyncRunning = weKnoraSync?.status === "运行中";
  const collectionStopping = collectionRunning?.stage === "正在停止收集";
  const publishedTopicIds = new Set(
    workspace.topics.filter((topic) => topic.status === "已发布").map((topic) => topic.id),
  );
  const publishedArticleCount = workspace.drafts.filter((draft) => publishedTopicIds.has(draft.topicId)).length;
  const visibleArticles = workspace.drafts.filter((draft) =>
    articleListTab === "已发" ? publishedTopicIds.has(draft.topicId) : !publishedTopicIds.has(draft.topicId),
  );
  const nav = [
    { tab: "概览", label: "工作台", icon: Lightbulb },
    { tab: "内容草稿", label: "文章", icon: FileText },
    { tab: "选题池", label: "选题", icon: FlaskConical },
    { tab: "资料归档", label: "素材", icon: Archive },
    { tab: "知识图谱", label: "知识库", icon: BookOpen },
    { tab: "信源与自动化", label: "设置", icon: Settings2 },
  ] as const;

  return (
    <div className={`shell ${editing && copilotOpen ? "copilot-drawer-open" : ""}`}>
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => setTab("概览")}>
          <div className="brand-mark">墨</div>
          <div>
            <b>熵衍之墨</b>
            <small>DRAFT STUDIO</small>
          </div>
        </button>
        <div className="workspace-label">工作空间</div>
        <nav>
          {nav.map(({ tab: navTab, label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${tab === navTab ? "selected" : ""}`}
              aria-current={tab === navTab ? "page" : undefined}
              onClick={() => setTab(navTab)}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
              {navTab === "资料归档" && workspace.sources.length > 0 && (
                <span className="nav-count">{workspace.sources.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="storage-icon">
            <Archive size={15} />
          </div>
          <div>
            <b>本地内容库</b>
            <small>素材与文章保存在本机</small>
          </div>
          <span className="green-dot" />
        </div>
        <div className="side-bottom">
          <span className="tiny-avatar">AI</span>
          <div>
            <b>文章创作空间</b>
            <small>从想法到多平台交付</small>
          </div>
          <CircleHelp size={16} />
        </div>
      </aside>

      <main className={`main ${tab === "内容草稿" ? "main-draft" : ""}`}>
        <header className="topbar">
          <div className="breadcrumbs">
            {editing && tab === "内容草稿" && (
              <button
                type="button"
                className="back-button"
                aria-label="返回文章列表"
                title="返回文章列表"
                onClick={closeDraft}
              >
                <ChevronLeft size={15} />
                <span>文章列表</span>
              </button>
            )}
            <button className="brand-home-link" onClick={() => setTab("概览")}>熵衍之墨</button>
            <ChevronRight size={13} /> <span>{nav.find((item) => item.tab === tab)?.label ?? tab}</span>
          </div>
          <div className="top-actions">
            <div className="save-indicator">
              <i />
              本机存储已连接
            </div>
            <div className="avatar">Z</div>
          </div>
        </header>
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}

        {tab === "概览" && (
          <>
            <section className="hero">
              <div className="hero-text">
                <div className="eyebrow">
                  <span className="eyebrow-dot" /> 深度内容工作室 · 本地工作区
                </div>
                <h1>
                  把复杂议题，
                  <br />
                  <em>写成值得读的文章。</em>
                </h1>
                <p>
                  收集素材，发现选题，打磨观点与表达。让一篇好文章，从第一条线索顺畅走到多平台交付。
                </p>
                <div className="hero-actions">
                  <button
                    className="button primary"
                    onClick={() => setTab(workspace.drafts.length ? "内容草稿" : "选题池")}
                  >
                    <PenLine size={16} /> {workspace.drafts.length ? "继续写文章" : "从选题开始"}
                  </button>
                  <button
                    className="button soft"
                    onClick={() => setTab("资料归档")}
                  >
                    整理素材与线索 <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
              <div className="hero-art">
                <div className="orb orb-a" />
                <div className="orb orb-b" />
                <div className="orb-core">
                  <Sparkles size={28} />
                </div>
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <div className="art-caption">
                  NOTICE
                  <br />
                  <b>→</b> QUESTION
                  <br />
                  <b>→</b> TELL
                </div>
                <div className="art-chip">Human × AI</div>
              </div>
            </section>
            <div className="section-heading">
              <div>
                <span className="eyebrow muted-label">YOUR WORKSPACE</span>
                <h2>从素材到文章</h2>
              </div>
              <span className="hint-text">制造共鸣，不制造焦虑</span>
            </div>
            <div className="pipeline">
              <PipelineStep
                number="01"
                title="收集素材"
                detail="原文、事实与来源边界可追溯"
                count={`${workspace.sources.length} 份资料`}
                active={workspace.sources.length > 0}
                onClick={() => setTab("资料归档")}
                icon={<Archive size={17} />}
              />
              <div className="pipe-arrow">→</div>
              <PipelineStep
                number="02"
                title="确定选题"
                detail="先形成判断，再决定怎么写"
                count={`${workspace.topics.length} 个选题`}
                active={workspace.topics.length > 0}
                onClick={() => setTab("选题池")}
                icon={<Lightbulb size={17} />}
              />
              <div className="pipe-arrow">→</div>
              <PipelineStep
                number="03"
                title="编辑文章"
                detail="打磨结构、证据、表达与交付"
                count={`${workspace.drafts.length} 篇草稿`}
                active={workspace.drafts.length > 0}
                onClick={() => setTab("内容草稿")}
                icon={<FileText size={17} />}
              />
            </div>
            <div className="below-grid">
              <section className="panel direction-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow muted-label">
                      EDITORIAL PILLARS
                    </span>
                    <h3>内容方向</h3>
                  </div>
                  <BookOpen size={17} />
                </div>
                <div className="directions">
                  {directions.map((item, i) => (
                    <button
                      key={item}
                      onClick={() => {
                        setDirection(item);
                        setSourceForm((f) => ({ ...f, direction: item }));
                        setTab("资料归档");
                      }}
                    >
                      <span className="direction-index">0{i + 1}</span>
                      <b>{item}</b>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel latest-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow muted-label">RECENT CAPTURE</span>
                    <h3>最近归档</h3>
                  </div>
                  <button
                    className="text-link"
                    onClick={() => setTab("资料归档")}
                  >
                    查看全部 <ArrowUpRight size={13} />
                  </button>
                </div>
                {workspace.sources.slice(0, 3).map((source) => (
                  <div className="latest-row" key={source.id}>
                    <span className="latest-dot" />
                    <div>
                      <b>{source.title}</b>
                      <small>
                        {source.publisher || source.direction} ·{" "}
                        {source.kind === "候选链接"
                          ? source.contentFile
                            ? "原文已保存"
                            : "候选链接"
                          : source.verification}
                      </small>
                    </div>
                    <time>
                      {new Date(source.capturedAt).toLocaleDateString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </time>
                  </div>
                ))}
                {workspace.sources.length === 0 && (
                  <div className="empty-inline">
                    资料归档后，会在这里看到最近的观察。
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {tab === "资料归档" && (
          <>
            <PageTitle
              eyebrow="SOURCE LIBRARY"
              title="素材库"
              subtitle="信源自动收集并归档。你可以按方向搜索资料、查看 AI 抽取的事实与待核实点，并追溯它们如何连接到知识图谱和选题。"
            />
            <section className="archive-workflow panel">
              <div className="archive-flow-copy">
                <span className="eyebrow muted-label">
                  HOW KNOWLEDGE IS ORGANIZED
                </span>
                <h3>来源 → 结构化资料 → 知识图谱 → 选题</h3>
                <p>
                  点击一次「立即收集」，系统会在同一轮发现候选、抓取并保存全部候选原文，再提取事实、实体、关系和选题。候选箱只承接读取失败或中途停止的项目，作为再次补抓的补偿入口。
                </p>
              </div>
              <div className="archive-flow-actions">
                <button
                  className="button primary"
                  disabled={busy || Boolean(collectionRunning)}
                  onClick={() => void collectNow()}
                >
                  {collectionRunning || busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Search size={15} />
                  )}
                  {collectionRunning ? "正在收集" : "立即收集"}
                </button>
                {candidateSources.length > 0 && (
                  <button
                    className="button outline"
                    disabled={busy || Boolean(collectionRunning)}
                    onClick={() => void clearCandidates()}
                  >
                    清除候选
                  </button>
                )}
                {candidateSources.length > 0 && (
                  <button
                    className="button dark"
                    disabled={busy || Boolean(collectionRunning)}
                    onClick={() => void processCandidates()}
                  >
                    补抓全部候选（{candidateSources.length}）
                  </button>
                )}
                <button
                  className="button outline"
                  onClick={() => setTab("信源与自动化")}
                >
                  管理信源
                </button>
                <button
                  className="button outline"
                  onClick={() => setTab("知识图谱")}
                >
                  查看知识图谱
                </button>
              </div>
              {collectionRunning && (
                <CollectionProgress
                  run={collectionRunning}
                  sites={workspace.sites.filter((site) => site.enabled)}
                  now={clock}
                  stopping={collectionStopping}
                  onStop={() => void stopCollection()}
                />
              )}
              <div className="archive-stats">
                <span>
                  <b>
                    {
                      workspace.sources.filter(
                        (source) => source.kind !== "候选链接",
                      ).length
                    }
                  </b>{" "}
                  份资料
                </span>
                <span>
                  <b>
                    {
                      workspace.sources.filter(
                        (source) => source.kind === "候选链接",
                      ).length
                    }
                  </b>{" "}
                  候选链接
                </span>
                <span>
                  <b>
                    {
                      workspace.sources.filter((source) => source.contentFile)
                        .length
                    }
                  </b>{" "}
                  有本地原文
                </span>
                <span>
                  <b>{workspace.entities.length}</b> 个图谱实体
                </span>
              </div>
            </section>
            <details className="manual-source-details panel">
              <summary>
                <Plus size={15} />
                手动添加资料或上传附件{" "}
                <span>链接、摘录与本地文件都可以成为起点</span>
              </summary>
              <form className="form-panel" onSubmit={createSource}>
                <div className="form-heading">
                  <div className="form-icon">
                    <Plus size={18} />
                  </div>
                  <div>
                    <h3>添加资料</h3>
                    <p>支持论文、官方公告、产品文档、研究报道与商业材料</p>
                  </div>
                </div>
                <div className="form-grid two-col">
                  <Field label="记录类型">
                    <select
                      value={sourceForm.kind}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          kind: e.target.value as "资料摘录" | "AI事件观察",
                        })
                      }
                    >
                      <option>资料摘录</option>
                      <option>AI事件观察</option>
                    </select>
                  </Field>
                  <Field label="资料标题 *">
                    <input
                      required
                      maxLength={160}
                      value={sourceForm.title}
                      onChange={(e) =>
                        setSourceForm({ ...sourceForm, title: e.target.value })
                      }
                      placeholder="例如：DeepSeek 发布新模型技术报告"
                    />
                  </Field>
                  <Field label="内容方向">
                    <select
                      value={sourceForm.direction}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          direction: e.target.value as Direction,
                        })
                      }
                    >
                      {directions.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="原始来源链接">
                    <input
                      type="url"
                      value={sourceForm.url}
                      onChange={(e) =>
                        setSourceForm({ ...sourceForm, url: e.target.value })
                      }
                      placeholder="https://…"
                    />
                  </Field>
                  <Field label="发布机构 / 作者">
                    <input
                      value={sourceForm.publisher}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          publisher: e.target.value,
                        })
                      }
                      placeholder="作者、公司、研究机构、媒体…"
                    />
                  </Field>
                  <Field label="事件发生日期">
                    <input
                      type="date"
                      value={sourceForm.eventDate}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          eventDate: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="报道 / 发布日期">
                    <input
                      type="date"
                      value={sourceForm.publishedAt}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          publishedAt: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="本地附件（≤10MB）">
                    <label className="file-input">
                      <Upload size={15} />
                      <span>选择文件</span>
                      <input
                        name="file"
                        type="file"
                        accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp"
                      />
                    </label>
                  </Field>
                </div>
                <Field label="原文摘录 / 研究摘要">
                  <textarea
                    value={sourceForm.excerpt}
                    maxLength={80000}
                    onChange={(e) =>
                      setSourceForm({ ...sourceForm, excerpt: e.target.value })
                    }
                    placeholder="粘贴与选题相关的原文片段、摘要或记录。请保留上下文和出处。"
                    rows={5}
                  />
                </Field>
                <div className="form-grid two-col">
                  <Field label="已确认事实">
                    <textarea
                      value={sourceForm.facts}
                      onChange={(e) =>
                        setSourceForm({ ...sourceForm, facts: e.target.value })
                      }
                      placeholder="只记来源直接支持的内容"
                      rows={3}
                    />
                  </Field>
                  <Field label="你的初步解释">
                    <textarea
                      value={sourceForm.interpretation}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          interpretation: e.target.value,
                        })
                      }
                      placeholder="可能的原理、人性、商业或产业逻辑"
                      rows={3}
                    />
                  </Field>
                </div>
                <div className="form-grid two-col">
                  <Field label="知识摘要">
                    <textarea
                      value={sourceForm.summary}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          summary: e.target.value,
                        })
                      }
                      placeholder="2–3 句说明发生了什么、机制与影响；留空时自动整理。"
                      rows={3}
                    />
                  </Field>
                  <Field label="知识分类">
                    <input
                      value={sourceForm.category}
                      onChange={(e) =>
                        setSourceForm({
                          ...sourceForm,
                          category: e.target.value,
                        })
                      }
                      placeholder="商业与资本 / 产品与体验 / 研究与前沿…"
                    />
                  </Field>
                </div>
                <Field label="未知与待核实">
                  <textarea
                    value={sourceForm.unknowns}
                    onChange={(e) =>
                      setSourceForm({ ...sourceForm, unknowns: e.target.value })
                    }
                    placeholder="还缺什么证据？有什么替代解释？"
                    rows={2}
                  />
                </Field>
                <div className="form-footer">
                  <span>
                    <i className="amber-dot" /> 新资料默认标记为「待核实」
                  </span>
                  <button className="button primary" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Plus size={16} />
                    )}{" "}
                    保存到资料库
                  </button>
                </div>
              </form>
            </details>
            <section className="panel archive-list">
              <div className="panel-title">
                <div>
                  <span className="eyebrow muted-label">ARCHIVE</span>
                  <h3>
                    资料与候选{" "}
                    <span className="count-badge">
                      {workspace.sources.length}
                    </span>
                  </h3>
                </div>
              </div>
              <div className="search-box">
                <Search size={15} />
                <input
                  placeholder="搜索标题、作者或摘录"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="内容方向筛选"
                  value={sourceDirectionFilter}
                  onChange={(e) => setSourceDirectionFilter(e.target.value)}
                >
                  <option value="全部">全部方向</option>
                  {directions.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  aria-label="资料类型筛选"
                  value={sourceKindFilter}
                  onChange={(e) => setSourceKindFilter(e.target.value)}
                >
                  <option>全部</option>
                  <option>候选链接</option>
                  <option>AI事件观察</option>
                  <option>资料摘录</option>
                </select>
              </div>
              <div className="source-list">
                {visibleSources.map((source) => {
                  const entities = workspace.entities.filter((entity) =>
                    entity.sourceIds.includes(source.id),
                  );
                  const factText =
                    source.facts ||
                    source.excerpt ||
                    (source.kind === "候选链接"
                      ? "搜索已返回该链接，正在等待阅读原文"
                      : "尚未抽取");
                  const analysisText =
                    source.summary ||
                    source.interpretation ||
                    "尚未生成";
                  const unknownText =
                    source.unknowns || "暂无记录";
                  return (
                    <article
                      className={`source-card ${source.kind === "候选链接" ? "candidate-source" : ""}`}
                      key={source.id}
                    >
                      <div className="source-card-top">
                        <span className="source-type">
                          {source.kind} · {source.direction}
                          {source.category ? ` · ${source.category}` : ""}
                          {source.knowledgePluginId === "weknora"
                            ? " · WeKnora 导入"
                            : ""}
                          {source.contentReader === "jina"
                            ? " · Jina Reader 兜底"
                            : ""}
                        </span>
                        <span
                          className={`verify ${source.verification === "已核对" ? "verified" : ""}`}
                        >
                          <i />
                          {source.kind === "候选链接"
                            ? source.contentFile
                              ? "原文已保存"
                              : "等待阅读"
                            : source.verification}
                        </span>
                      </div>
                      <h4>
                        {source.title}
                        <CopyButton value={source.title} label="资料标题" />
                      </h4>
                      <div className="source-meta">
                        {source.publisher || "未填写机构"}{" "}
                        {source.externalKnowledgeBase &&
                          source.externalKnowledgeBase !== source.publisher &&
                          `· ${source.externalKnowledgeBase} `}
                        {source.eventDate && `· 事件 ${source.eventDate}`}{" "}
                        {source.publishedAt && `· 报道 ${source.publishedAt}`}
                      </div>
                      {source.excerpt && (
                        <p>
                          {source.excerpt.slice(0, 140)}
                          {source.excerpt.length > 140 ? "…" : ""}
                          <CopyButton
                            value={source.excerpt}
                            label="资料原文摘录"
                          />
                        </p>
                      )}
                      <details className="source-insights">
                        <summary>
                          查看 AI 整理与关联{" "}
                          {entities.length > 0 && (
                            <span>{entities.length} 个知识实体</span>
                          )}
                        </summary>
                        <div className="insight-grid">
                          <div>
                            <b>
                              资料摘要 / 事实
                              <CopyButton value={factText} label="资料事实" />
                            </b>
                            <p>{factText}</p>
                          </div>
                          <div>
                            <b>
                              分析线索
                              <CopyButton
                                value={analysisText}
                                label="分析线索"
                              />
                            </b>
                            <p>{analysisText}</p>
                          </div>
                          <div>
                            <b>
                              未知与待核实
                              <CopyButton
                                value={unknownText}
                                label="未知与待核实"
                              />
                            </b>
                            <p>{unknownText}</p>
                          </div>
                        </div>
                        {entities.length > 0 && (
                          <div className="source-entities">
                            {entities.map((entity) => (
                              <button
                                key={entity.id}
                                onClick={() => setTab("知识图谱")}
                              >
                                {entity.name} ↗
                              </button>
                            ))}
                          </div>
                        )}
                      </details>
                      <div className="source-actions">
                        {source.url && (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            打开来源 <ArrowUpRight size={12} />
                          </a>
                        )}
                        {source.contentFile && (
                          <a
                            href={`/api/sources/${source.id}/content`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <BookOpen size={12} />
                            查看爬取原文
                          </a>
                        )}
                        {source.fileName && (
                          <a
                            href={`/api/sources/${source.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Upload size={12} />
                            {source.fileName}
                          </a>
                        )}
                        {source.kind === "候选链接" && (
                          <button
                            disabled={busy || Boolean(collectionRunning)}
                            onClick={() => void processCandidates(source)}
                          >
                            补抓这篇原文
                          </button>
                        )}
                        {source.kind === "候选链接" ? (
                          <span>
                            {source.contentFile
                              ? "原文已保存，等待结构化"
                              : "发现后立即保存，等待阅读原文"}
                          </span>
                        ) : (
                          <button onClick={() => void verifySource(source)}>
                            <Check size={12} />
                            {source.verification === "已核对"
                              ? "撤销核对"
                              : "标记已核对"}
                          </button>
                        )}
                        <button
                          className="source-delete"
                          aria-label={`删除资料 ${source.title}`}
                          disabled={
                            busy ||
                            Boolean(collectionRunning) ||
                            knowledgeSyncRunning
                          }
                          onClick={() => void deleteSource(source)}
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    </article>
                  );
                })}
                {visibleSourceCount < filteredSources.length && (
                  <button
                    className="button outline load-more-sources"
                    onClick={() => setVisibleSourceCount((count) => count + 20)}
                  >
                    再显示 20 条（剩余{" "}
                    {filteredSources.length - visibleSourceCount} 条）
                  </button>
                )}
                {filteredSources.length === 0 && (
                  <div className="empty-state">
                    <Archive size={22} />
                    <b>{search ? "没有找到匹配的资料" : "资料库还是空的"}</b>
                    <span>
                      先到「信源与自动化」添加或启用来源并运行采集；搜索返回后候选会立即显示，完成阅读后升级为正式资料。
                    </span>
                  </div>
                )}
              </div>
              <div className="archive-foot">
                正式资料、候选元数据和爬取原文保存在工作区数据目录的 archive 中；实体与关系用于知识图谱，选题会记录关联资料。
              </div>
            </section>
          </>
        )}

        {tab === "信源与自动化" && (
          <>
            <PageTitle
              eyebrow="RESEARCH SOURCES"
              title="信源与自动化"
              subtitle="默认只归集最近 7 天的新资料；按原文 URL 和标题去重。Stanford、Harvard 与吴恩达公开课作为长期课程资料，不受时间限制但仍去重。"
            />
            <section className="panel automation-panel">
              <div className="panel-title">
                <div>
                  <span className="eyebrow muted-label">
                    COLLECTION CONTROL
                  </span>
                  <h3>
                    自动观察设置
                    {(settingsDirty || sitesDirty) && (
                      <span className="config-unsaved"> · 有未保存修改</span>
                    )}
                  </h3>
                </div>
                <button
                  className="button primary"
                  disabled={busy || Boolean(collectionRunning)}
                  onClick={() => void collectNow()}
                >
                  {collectionRunning || busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Search size={15} />
                  )}
                  {collectionRunning ? "正在收集" : "立即采集"}
                </button>
              </div>
              {collectionRunning && (
                <CollectionProgress
                  run={collectionRunning}
                  sites={workspace.sites.filter((site) => site.enabled)}
                  now={clock}
                  stopping={collectionStopping}
                  onStop={() => void stopCollection()}
                />
              )}
              <div className="automation-controls">
                <label>
                  频率（小时）
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={workspace.settings.frequencyHours}
                    onChange={(e) => {
                      setSettingsDirty(true);
                      setWorkspace((w) => ({
                        ...w,
                        settings: {
                          ...w.settings,
                          frequencyHours: Number(e.target.value),
                        },
                      }));
                    }}
                  />
                </label>
                <label>
                  每轮选题数
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={workspace.settings.topicsPerRun}
                    onChange={(e) => {
                      setSettingsDirty(true);
                      setWorkspace((w) => ({
                        ...w,
                        settings: {
                          ...w.settings,
                          topicsPerRun: Number(e.target.value),
                        },
                      }));
                    }}
                  />
                </label>
                <label className="auto-toggle">
                  <input
                    type="checkbox"
                    checked={workspace.settings.autoCollect}
                    onChange={(e) => {
                      setSettingsDirty(true);
                      setWorkspace((w) => ({
                        ...w,
                        settings: {
                          ...w.settings,
                          autoCollect: e.target.checked,
                        },
                      }));
                    }}
                  />
                  服务运行时自动采集
                </label>
                <button
                  className="button outline"
                  onClick={() => void saveAutomationSettings()}
                >
                  保存设置
                </button>
              </div>
              <div className="topic-mix">
                <div className="topic-mix-head">
                  <div>
                    <b>选题注意力配比</b>
                    <span>
                      保存时自动归一化为 100%；当前合计{" "}
                      {topicMixTotal(topicMix)}%
                    </span>
                  </div>
                  <span className="topic-mix-plan">
                    本轮预计：
                    {allocateTopicSlots(
                      workspace.settings.topicsPerRun,
                      topicMix,
                    )
                      .map(({ direction, count }) => `${direction} ${count}`)
                      .join(" · ")}
                  </span>
                </div>
                <div className="topic-mix-grid">
                  {directions.map((item) => (
                    <label key={item}>
                      <span>{item}</span>
                      <span className="topic-mix-input">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          aria-label={`${item}选题权重`}
                          value={topicMix[item]}
                          onChange={(e) => {
                            setSettingsDirty(true);
                            setWorkspace((w) => ({
                              ...w,
                              settings: {
                                ...w.settings,
                                topicMix: {
                                  ...(w.settings.topicMix ?? defaultTopicMix),
                                  [item]: Math.max(
                                    0,
                                    Math.min(100, Number(e.target.value) || 0),
                                  ),
                                },
                              },
                            }));
                          }}
                        />
                        %
                      </span>
                    </label>
                  ))}
                </div>
                <p>
                  每次生成前会按权重折算本轮具体名额。AI
                  人文视角不会另起素材库，而是从同一批已核实信息中选出一部分，
                  换成偏向人的判断、信任、代价与选择的写法。15%
                  是编辑倾向和上限，不是必须凑满的配额；资料不适配时会少生成。
                </p>
                <div className="topic-mix-actions">
                  <span>
                    {settingsDirty
                      ? "配比有未保存的修改"
                      : "配比已保存，下次生成选题时生效"}
                  </span>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !settingsDirty}
                    onClick={() => void saveAutomationSettings()}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                    保存配比
                  </button>
                </div>
              </div>
              <p className="automation-note">
                每个信源可单独设置每次最多归档篇数，默认
                10；采集始终按发布时间从新到旧选择。后台定时任务依赖本地服务保持运行，服务重启后会按已保存的频率补跑到期任务。
              </p>
              <div className="site-grid">
                {workspace.sites.map((site) => (
                  <div className="site-row" key={site.id}>
                    <input
                      aria-label={`${site.name} 启用`}
                      type="checkbox"
                      checked={site.enabled}
                      onChange={(e) => {
                        setSitesDirty(true);
                        setWorkspace((w) => ({
                          ...w,
                          sites: w.sites.map((x) =>
                            x.id === site.id
                              ? { ...x, enabled: e.target.checked }
                              : x,
                          ),
                        }));
                      }}
                    />
                    <div>
                      <b>{site.name}</b>
                      <span>
                        {site.category} · {site.direction}
                      </span>
                      <input
                        value={site.query}
                        aria-label={`${site.name} 搜索词`}
                        onChange={(e) => {
                          setSitesDirty(true);
                          setWorkspace((w) => ({
                            ...w,
                            sites: w.sites.map((x) =>
                              x.id === site.id
                                ? { ...x, query: e.target.value }
                                : x,
                            ),
                          }));
                        }}
                      />
                      <span className="site-limit">
                        每次最多{" "}
                        <input
                          type="number"
                          min="1"
                          max="50"
                          aria-label={`${site.name} 每次最多文章数`}
                          value={site.maxArticles ?? 10}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(e) => {
                            setSitesDirty(true);
                            setWorkspace((w) => ({
                              ...w,
                              sites: w.sites.map((x) =>
                                x.id === site.id
                                  ? {
                                      ...x,
                                      maxArticles: Math.max(
                                        1,
                                        Math.min(
                                          50,
                                          Number(e.target.value) || 10,
                                        ),
                                      ),
                                    }
                                  : x,
                              ),
                            }));
                          }}
                        />{" "}
                        篇
                      </span>
                      <a href={site.url} target="_blank" rel="noreferrer">
                        {site.url}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="site-add">
                <input id="new-site-name" placeholder="站点名称" />
                <input id="new-site-url" placeholder="https://example.com" />
                <input id="new-site-query" placeholder="搜索主题" />
                <button
                  className="button outline"
                  onClick={() => {
                    const name = (
                      document.getElementById(
                        "new-site-name",
                      ) as HTMLInputElement
                    ).value;
                    const url = (
                      document.getElementById(
                        "new-site-url",
                      ) as HTMLInputElement
                    ).value;
                    const query = (
                      document.getElementById(
                        "new-site-query",
                      ) as HTMLInputElement
                    ).value;
                    if (!name || !url || !query)
                      return setNotice("请填写站点名、网址和搜索词。");
                    setSitesDirty(true);
                    setWorkspace((w) => ({
                      ...w,
                      sites: [
                        ...w.sites,
                        {
                          id: `custom-${Date.now()}`,
                          name,
                          url,
                          category: "新闻商业" as const,
                          direction,
                          query,
                          maxArticles: 10,
                          enabled: true,
                        },
                      ],
                    }));
                  }}
                >
                  添加信源
                </button>
                <button
                  className="button soft"
                  onClick={() =>
                    void run(async () => {
                      await call("/sites", "PUT", { sites: workspace.sites });
                      setSitesDirty(false);
                      setNotice("信源列表已保存。");
                    })
                  }
                >
                  保存信源
                </button>
              </div>
            </section>
            <section className="panel runs-panel">
              <div className="panel-title">
                <div>
                  <span className="eyebrow muted-label">
                    COLLECTION HISTORY
                  </span>
                  <h3>采集运行记录</h3>
                </div>
              </div>
              {workspace.runs.slice(0, 8).map((r) => (
                <div className="run-row" key={r.id}>
                  <b>{r.status}</b>
                  <span>{new Date(r.startedAt).toLocaleString("zh-CN")}</span>
                  <span>
                    发现 {r.found} · 新归档 {r.archived}
                    {r.skippedRecent
                      ? ` · 超期/无日期 ${r.skippedRecent} 条`
                      : ""}
                    {r.skippedDuplicate
                      ? ` · 重复 ${r.skippedDuplicate} 条`
                      : ""}
                  </span>
                  {r.error && <small>{r.error}</small>}
                </div>
              ))}
              {!workspace.runs.length && (
                <p className="empty-inline">还没有采集记录。</p>
              )}
            </section>
          </>
        )}

        {tab === "知识图谱" && (
          <>
            <PageTitle
              eyebrow="HYBRID KNOWLEDGE PLUGINS"
              title="混合知识检索与创作图谱"
              subtitle="本地 Kuzu 负责可追溯的资料、实体与关系；WeKnora 插件补足组织知识库的混合召回和原文引用。检索命中的外部文档可以先导入本地资料库，再进入同一套图谱、选题和创作流程。"
            />
            <section className="knowledge-plugin-center panel">
              <div className="knowledge-plugin-head">
                <div>
                  <span className="eyebrow muted-label">
                    RETRIEVAL PROVIDERS
                  </span>
                  <h3>跨资料库检索</h3>
                  <p>
                    本地资料与 WeKnora 并行检索。一个提供者失败不会阻断另一个；外部结果只有显式导入后才成为创作证据。
                  </p>
                </div>
                <div className="knowledge-plugin-badges">
                  {knowledgePlugins.map((plugin) => (
                    <span
                      className={`plugin-badge ${
                        plugin.enabled ? "ready" : "disabled"
                      }`}
                      key={plugin.id}
                    >
                      <i />
                      <b>{plugin.label}</b>
                      {plugin.mode}
                    </span>
                  ))}
                </div>
              </div>
              <div className="knowledge-runtime-dashboard">
                <div
                  className={`runtime-hero ${
                    builtinRuntimeRunning || externalWeKnoraActive
                      ? "running"
                      : builtinRuntimePreparing
                        ? "preparing"
                        : weKnoraRuntime?.status === "error"
                          ? "error"
                          : ""
                  }`}
                >
                  <div className="runtime-hero-icon">
                    {builtinRuntimePreparing ? (
                      <LoaderCircle className="spin" size={19} />
                    ) : builtinRuntimeRunning || externalWeKnoraActive ? (
                      <Check size={19} />
                    ) : (
                      <BookOpen size={19} />
                    )}
                  </div>
                  <div>
                    <span>
                      {weKnoraConfig?.mode === "external"
                        ? "外部服务 · WeKnora"
                        : `内置引擎 · WeKnora Lite ${weKnoraRuntime?.version ?? "v0.8.3"}`}
                    </span>
                    <b>
                      {externalWeKnoraActive
                        ? "外部知识服务已连接"
                        : builtinRuntimeRunning
                        ? "知识引擎已就绪"
                        : builtinRuntimePreparing
                          ? weKnoraRuntime?.stage || "正在准备知识引擎"
                          : weKnoraRuntime?.status === "error"
                            ? "知识引擎需要处理"
                            : "无需部署，一键启用"}
                    </b>
                    <small>
                      {(weKnoraConfig?.mode === "external"
                        ? weKnoraConfig.baseUrl ||
                          "外部 WeKnora 尚未配置服务地址。"
                        : weKnoraRuntime?.detail) ||
                        "工作台会自动准备本机运行时、SQLite 索引、向量服务与默认知识库。"}
                    </small>
                  </div>
                  <div className="runtime-actions">
                    {weKnoraConfig?.mode === "external" ? (
                      <>
                        {externalWeKnoraActive ? (
                          <span className="runtime-preparing">
                            <Check size={14} />
                            正在使用外部服务
                          </span>
                        ) : null}
                        <button
                          className="button outline"
                          disabled={busy || weKnoraManaging}
                          onClick={() => void enableBuiltinKnowledgeEngine()}
                        >
                          <Sparkles size={14} />
                          切换到内置引擎
                        </button>
                      </>
                    ) : builtinRuntimeRunning ? (
                      <>
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            Boolean(collectionRunning) ||
                            knowledgeSyncRunning
                          }
                          onClick={() => void syncBuiltinKnowledge()}
                        >
                          {busy || knowledgeSyncRunning ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Upload size={14} />
                          )}
                          {knowledgeSyncRunning
                            ? `同步中 ${weKnoraSync?.processed ?? 0}/${weKnoraSync?.attempted ?? 0}`
                            : "同步本地资料"}
                        </button>
                        <button
                          className="button outline"
                          disabled={busy || knowledgeSyncRunning}
                          onClick={() => void stopBuiltinKnowledgeEngine()}
                        >
                          <Square size={13} />
                          停止引擎
                        </button>
                      </>
                    ) : builtinRuntimePreparing ? (
                      <span className="runtime-preparing">
                        <LoaderCircle className="spin" size={14} />
                        首次准备可能需要几分钟
                      </span>
                    ) : (
                      <>
                        {weKnoraConfig?.mode === "builtin" &&
                        weKnoraConfig.enabled ? (
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() => void startBuiltinKnowledgeEngine()}
                          >
                            <Sparkles size={14} />
                            启动引擎
                          </button>
                        ) : (
                          <button
                            className="button primary"
                            disabled={busy || weKnoraManaging}
                            onClick={() => void enableBuiltinKnowledgeEngine()}
                          >
                            <Sparkles size={14} />
                            一键启用
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="runtime-metrics">
                  <div>
                    <span>运行模式</span>
                    <b>
                      {weKnoraConfig?.mode === "external"
                        ? "外部连接"
                        : "内置托管"}
                    </b>
                    <small>数据仅在本机处理</small>
                  </div>
                  <div>
                    <span>
                      {weKnoraConfig?.mode === "external"
                        ? "知识库范围"
                        : "已同步资料"}
                    </span>
                    <b>
                      {weKnoraConfig?.mode === "external"
                        ? weKnoraConfig.knowledgeBaseIds.length || "自动"
                        : syncedBuiltinSources}
                    </b>
                    <small>
                      {weKnoraConfig?.mode === "external"
                        ? "外部服务自行管理索引"
                        : `共 ${structuredSources.length} 份可同步资料`}
                    </small>
                  </div>
                  <div>
                    <span>默认知识库</span>
                    <b>
                      {weKnoraConfig?.mode === "external"
                        ? externalWeKnoraActive
                          ? "外部已连接"
                          : "外部未连接"
                        : weKnoraRuntime?.knowledgeBaseId
                          ? "已创建"
                          : "待创建"}
                    </b>
                    <small>
                      {weKnoraConfig?.mode === "external"
                        ? "使用已有 WeKnora 服务"
                        : "SQLite + 向量 + 关键词索引"}
                    </small>
                  </div>
                  <div>
                    <span>本地向量</span>
                    <b>
                      {weKnoraConfig?.mode === "external"
                        ? "外部提供"
                        : weKnoraRuntime?.embeddingModelId
                          ? "已连接"
                          : "待初始化"}
                    </b>
                    <small>
                      {weKnoraConfig?.mode === "external"
                        ? "由外部服务配置"
                        : "384 维，本地检索向量"}
                    </small>
                  </div>
                </div>
                <div className="runtime-lifecycle">
                  {[
                    {
                      label: "运行环境",
                      ready: Boolean(weKnoraRuntime?.installed),
                    },
                    {
                      label: "知识服务",
                      ready: builtinRuntimeRunning,
                    },
                    {
                      label: "默认知识库",
                      ready: Boolean(weKnoraRuntime?.knowledgeBaseId),
                    },
                    {
                      label: "资料索引",
                      ready: syncedBuiltinSources > 0,
                    },
                  ].map((step, index) => (
                    <div className={step.ready ? "ready" : ""} key={step.label}>
                      <i>{step.ready ? <Check size={11} /> : index + 1}</i>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
                {weKnoraSync && (
                  <div
                    className={`knowledge-sync-progress ${weKnoraSync.status === "失败" ? "failed" : ""}`}
                  >
                    <div>
                      <b>{weKnoraSync.stage}</b>
                      <span>
                        {weKnoraSync.processed}/{weKnoraSync.attempted} 已处理 ·
                        新建 {weKnoraSync.created} · 更新 {weKnoraSync.updated} ·
                        失败 {weKnoraSync.failed}
                      </span>
                    </div>
                    <div className="knowledge-sync-track">
                      <i
                        style={{
                          width: `${weKnoraSync.attempted ? Math.round((weKnoraSync.processed / weKnoraSync.attempted) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    {weKnoraSync.errors[0] && (
                      <small>{weKnoraSync.errors[0]}</small>
                    )}
                  </div>
                )}
                {weKnoraRuntime?.lastError && (
                  <div className="runtime-error">
                    <CircleHelp size={14} />
                    <span>{weKnoraRuntime.lastError}</span>
                    <button
                      className="text-link"
                      onClick={() => void startBuiltinKnowledgeEngine()}
                    >
                      重试
                    </button>
                  </div>
                )}
              </div>
              <details className="knowledge-plugin-config">
                <summary>
                  <div>
                    <b>管理 WeKnora 连接</b>
                    <span>
                      {weKnoraConfig?.mode === "external"
                        ? "外部服务"
                        : "内置托管"}
                      {" · "}
                      {weKnoraConfig?.enabled
                        ? "已启用"
                        : weKnoraConfig?.baseUrl
                          ? "已配置但暂停"
                          : "尚未配置"}
                      {" · "}
                      {weKnoraConfig?.mode === "external" &&
                        ` · API Key ${weKnoraConfig.apiKeyConfigured ? "已保存" : "未设置"}`}
                    </span>
                  </div>
                  <span>
                    {weKnoraConfigDirty ? "有未保存修改" : "展开配置"}
                    <ChevronRight size={14} />
                  </span>
                </summary>
                <div className="knowledge-plugin-form">
                  <div className="plugin-mode-switch">
                    <button
                      type="button"
                      className={weKnoraForm.mode === "builtin" ? "selected" : ""}
                      onClick={() => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          mode: "builtin",
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    >
                      <b>内置托管</b>
                      <span>自动准备并启动 WeKnora Lite</span>
                    </button>
                    <button
                      type="button"
                      className={weKnoraForm.mode === "external" ? "selected" : ""}
                      onClick={() => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          mode: "external",
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    >
                      <b>外部服务</b>
                      <span>连接已有 WeKnora 部署</span>
                    </button>
                  </div>
                  <label className="plugin-enable">
                    <input
                      type="checkbox"
                      checked={weKnoraForm.enabled}
                      onChange={(event) => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    />
                    启用 WeKnora 跨库检索
                  </label>
                  {weKnoraForm.mode === "builtin" ? (
                    <div className="plugin-builtin-note">
                      <Sparkles size={15} />
                      <div>
                        <b>无需安装 Docker、数据库或单独部署</b>
                        <span>
                          保存后工作台会自动构建并启动 WeKnora Lite，创建
                          SQLite 知识库和本地向量模型。首次准备需要 Go
                          工具链与编译环境，系统会自动下载并构建，通常在 2–5
                          分钟内完成，之后直接复用。
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                  <label>
                    服务地址
                    <input
                      value={weKnoraForm.baseUrl}
                      placeholder="http://localhost:8080"
                      onChange={(event) => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          baseUrl: event.target.value,
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    />
                    <small>
                      可填写根地址或完整的 <code>/api/v1</code> 地址。
                    </small>
                  </label>
                  <label>
                    API Key
                    <input
                      type="password"
                      autoComplete="off"
                      value={weKnoraForm.apiKey}
                      placeholder={
                        weKnoraConfig?.apiKeyConfigured
                          ? "留空则保留当前密钥"
                          : "可选；无鉴权部署可留空"
                      }
                      onChange={(event) => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          apiKey: event.target.value,
                          clearApiKey: false,
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    />
                    {weKnoraConfig?.apiKeyConfigured && (
                      <span className="plugin-clear-secret">
                        <input
                          type="checkbox"
                          checked={weKnoraForm.clearApiKey}
                          onChange={(event) => {
                            setWeKnoraForm((current) => ({
                              ...current,
                              apiKey: "",
                              clearApiKey: event.target.checked,
                            }));
                            setWeKnoraConfigDirty(true);
                          }}
                        />
                        清除已保存的 API Key
                      </span>
                    )}
                  </label>
                  <label>
                    租户 ID（可选）
                    <input
                      value={weKnoraForm.tenantId}
                      placeholder="平台级密钥需要填写"
                      onChange={(event) => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          tenantId: event.target.value,
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    />
                  </label>
                  <label>
                    知识库 ID（可选）
                    <input
                      value={weKnoraForm.knowledgeBaseIds}
                      placeholder="kb-123, kb-456；留空自动发现"
                      onChange={(event) => {
                        setWeKnoraForm((current) => ({
                          ...current,
                          knowledgeBaseIds: event.target.value,
                        }));
                        setWeKnoraConfigDirty(true);
                      }}
                    />
                  </label>
                    </>
                  )}
                  <div className="knowledge-plugin-form-note">
                    <span>
                      连接信息保存在本机工作区数据目录的 <code>plugin-settings.json</code> 中，
                      密钥不会发送到浏览器或写入导出包。
                    </span>
                    {weKnoraConfig?.updatedAt && (
                      <small>
                        上次更新{" "}
                        {new Date(weKnoraConfig.updatedAt).toLocaleString(
                          "zh-CN",
                        )}
                      </small>
                    )}
                    <button
                      type="button"
                      className="button primary"
                      disabled={weKnoraManaging || !weKnoraConfigDirty}
                      onClick={() => void saveWeKnoraPlugin()}
                    >
                      {weKnoraManaging ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                      保存插件设置
                    </button>
                  </div>
                </div>
              </details>
              <form
                className="knowledge-plugin-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchKnowledgePlugins();
                }}
              >
                <Search size={16} />
                <input
                  value={pluginQuery}
                  onChange={(event) => setPluginQuery(event.target.value)}
                  maxLength={200}
                  placeholder="例如：这个模型在哪些客户场景里被验证过？"
                />
                <button
                  className="button primary"
                  disabled={pluginSearching || busy}
                >
                  {pluginSearching ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Search size={14} />
                  )}
                  {pluginSearching ? "正在检索" : "跨库检索"}
                </button>
              </form>
              <div className="knowledge-plugin-detail">
                {knowledgePlugins.map((plugin) => (
                  <div key={plugin.id}>
                    <b>{plugin.label}</b>
                    <span>{plugin.detail}</span>
                    <small>{plugin.capabilities.join(" · ")}</small>
                    {plugin.sourceUrl && (
                      <a
                        href={plugin.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看插件来源 <ArrowUpRight size={11} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
              {pluginSearchResult && (
                <div className="knowledge-plugin-results">
                  <div className="knowledge-plugin-results-head">
                    <div>
                      <b>“{pluginSearchResult.query}”的合并结果</b>
                      <span>
                        {pluginSearchResult.hits.length} 条命中 ·{" "}
                        {pluginSearchResult.searchedPlugins.length} 个提供者
                      </span>
                    </div>
                    <label>
                      导入方向
                      <select
                        value={knowledgeImportDirection}
                        onChange={(event) =>
                          setKnowledgeImportDirection(
                            event.target.value as Direction,
                          )
                        }
                      >
                        {directions.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {pluginSearchResult.warnings.map((warning) => (
                    <div className="knowledge-plugin-warning" key={warning}>
                      {warning}
                    </div>
                  ))}
                  <div className="knowledge-plugin-result-grid">
                    {pluginSearchResult.hits.map((hit) => (
                      <article key={hit.id}>
                        <div>
                          <span className={`provider-tag ${hit.pluginId}`}>
                            {hit.pluginLabel}
                          </span>
                          {hit.knowledgeBase && <small>{hit.knowledgeBase}</small>}
                          {hit.score !== undefined && (
                            <small>相关度 {hit.score.toFixed(3)}</small>
                          )}
                        </div>
                        <b>{hit.title}</b>
                        <p>{hit.excerpt || "该命中没有返回摘要。"}</p>
                        <div className="knowledge-hit-actions">
                          {hit.url && (
                            <a href={hit.url} target="_blank" rel="noreferrer">
                              打开来源 <ArrowUpRight size={11} />
                            </a>
                          )}
                          {hit.pluginId === "weknora" ? (
                            <button
                              type="button"
                              className="text-link"
                              disabled={busy || !hit.documentId}
                              onClick={() => void importKnowledgeHit(hit)}
                            >
                              <Plus size={11} /> 导入资料库
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => {
                                setSearch(hit.title);
                                setTab("资料归档");
                              }}
                            >
                              查看本地资料 ↗
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!pluginSearchResult.hits.length && (
                    <div className="knowledge-plugin-empty">
                      没有命中。请换一个更具体的问题，或检查 WeKnora
                      的知识库范围与凭据。
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="knowledge-toolbar panel">
              <div>
                <span className="knowledge-engine">
                  Kuzu {knowledgeGraph?.version ?? "0.11.3"}
                </span>
                <b>属性图索引与证据邻域检索</b>
                <small>
                  {knowledgeGraph
                    ? `索引于 ${new Date(knowledgeGraph.indexedAt).toLocaleString()}`
                    : "首次进入时会规范化并建立本地图索引"}
                </small>
              </div>
              <label className="knowledge-search">
                <Search size={15} />
                <input
                  value={knowledgeQuery}
                  onChange={(event) => setKnowledgeQuery(event.target.value)}
                  placeholder="搜索公司、模型、产品、人物、技术…"
                />
              </label>
              <button
                className="button outline"
                disabled={busy || knowledgeLoading}
                onClick={() => void reindexKnowledgeGraph()}
              >
                {knowledgeLoading ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <FlaskConical size={14} />
                )}
                重建索引
              </button>
            </section>
            {knowledgeError && (
              <div className="knowledge-error">{knowledgeError}</div>
            )}
            <div className="knowledge-summary">
              <span>{knowledgeGraph?.counts.sources ?? 0} 份资料入图</span>
              <span>
                {knowledgeGraph?.counts.structuredSources ?? 0} 份已完成结构化
              </span>
              <span>{knowledgeGraph?.counts.entities ?? 0} 个规范实体</span>
              <span>{knowledgeGraph?.counts.relations ?? 0} 条关系</span>
              <span>{knowledgeGraph?.counts.mentions ?? 0} 条资料—实体链接</span>
              <span>{knowledgeGraph?.counts.topics ?? 0} 个选题已连接</span>
            </div>
            {knowledgeGraph && (
              <div className="knowledge-taxonomy">
                <b>规范化结果</b>
                <span>
                  {knowledgeGraph.normalization.rawEntities} →{" "}
                  {knowledgeGraph.normalization.canonicalEntities} 个实体
                </span>
                <span>
                  {knowledgeGraph.normalization.rawRelations} →{" "}
                  {knowledgeGraph.normalization.canonicalRelations} 条关系
                </span>
                {knowledgeGraph.normalization.entityTypes.slice(0, 10).map(
                  (item) => (
                    <span key={item.type}>
                      {item.type} {item.count}
                    </span>
                  ),
                )}
                {knowledgeGraph.normalization.sourceCategories
                  .slice(0, 8)
                  .map((item) => (
                    <span className="category-chip" key={item.category}>
                      知识分类 · {item.category} {item.count}
                    </span>
                  ))}
              </div>
            )}
            {knowledgeLoading && !knowledgeGraph ? (
              <div className="knowledge-loading">
                <LoaderCircle className="spin" size={20} />
                <b>正在规范化实体并建立 Kuzu 图索引</b>
                <span>
                  首次构建需要写入资料、实体、关系和选题；后续只同步新增变化。
                </span>
              </div>
            ) : (
              <KnowledgeGraphExplorer
                entities={graphEntities}
                relations={graphRelations}
                query={knowledgeQuery}
                selectedId={selectedKnowledgeEntityId}
                onSelect={setSelectedKnowledgeEntityId}
                onOpenSource={(source) => {
                  setSearch(source.title);
                  setTab("资料归档");
                }}
              />
            )}
            {knowledgeGraph?.query && knowledgeGraph.sources.length > 0 && (
              <section className="knowledge-source-hits panel">
                <div>
                  <b>资料命中</b>
                  <span>
                    摘要与知识分类来自已归档资料，可追溯到原文
                  </span>
                </div>
                {knowledgeGraph.sources.slice(0, 8).map((source) => (
                  <button
                    key={source.id}
                    onClick={() => {
                      setSearch(source.title);
                      setTab("资料归档");
                    }}
                  >
                    <span>{source.category}</span>
                    <b>{source.title}</b>
                    <small>{source.summary || "暂无摘要"}</small>
                  </button>
                ))}
              </section>
            )}
            <div className="knowledge-grid">
              {graphEntities.map((entity) => (
                <article className="panel entity-card" key={entity.id}>
                  <span>{entity.type}</span>
                  <h3>
                    {entity.name}
                    <CopyButton value={entity.name} label="图谱实体" />
                  </h3>
                  <p>
                    {entity.summary || "尚无摘要"}
                    <CopyButton
                      value={entity.summary || "尚无摘要"}
                      label="实体的知识摘要"
                    />
                  </p>
                  <small>来源资料</small>
                  <div className="entity-sources">
                    {entity.sources
                      .map((source) => (
                        <button
                          key={source.id}
                          onClick={() => {
                            setSearch(source.title);
                            setTab("资料归档");
                          }}
                        >
                          [{source.category}] {source.title} ↗
                        </button>
                      ))}
                    {!entity.sources.length && <span>无可追溯来源</span>}
                  </div>
                  <div>
                    {graphRelations
                      .filter(
                        (r) => r.fromId === entity.id || r.toId === entity.id,
                      )
                      .slice(0, 5)
                      .map((r) => (
                        <span
                          className="edge-chip"
                          key={`${r.fromId}-${r.toId}-${r.predicate}`}
                        >
                          {r.fromId === entity.id ? "→" : "←"}{" "}
                          {r.fromId === entity.id ? r.toName : r.fromName} ·{" "}
                          {r.predicate}
                          {r.explanation ? `：${r.explanation}` : ""}
                        </span>
                      ))}
                  </div>
                  <button
                    type="button"
                    className="entity-focus"
                    onClick={() => {
                      setSelectedKnowledgeEntityId(entity.id);
                      setKnowledgeQuery(entity.name);
                    }}
                  >
                    查看证据邻域 <ChevronRight size={12} />
                  </button>
                </article>
              ))}
            </div>
            {!knowledgeLoading && !graphEntities.length && (
              <div className="empty-state">
                <BookOpen size={24} />
                <b>
                  {workspace.sources.some(
                    (source) => source.kind === "候选链接",
                  )
                    ? "候选已保存，但还没有形成图谱"
                    : "知识库还没有实体"}
                </b>
                <span>
                  {workspace.sources.some(
                    (source) => source.kind === "候选链接",
                  )
                    ? `当前有 ${workspace.sources.filter((source) => source.kind === "候选链接").length} 条候选链接。只有完成原文阅读和结构化归档后，才会生成实体与关系。`
                    : "运行资料采集后，系统会从已阅读的原文中提取实体和关系。"}
                </span>
                <button
                  className="button soft"
                  onClick={() => setTab("资料归档")}
                >
                  查看资料与原文
                </button>
              </div>
            )}
          </>
        )}

        {tab === "选题池" && (
          <>
            <PageTitle
              eyebrow="IDEA BOARD"
              title="选题池"
              subtitle="从已有资料出发，或带着一个问题自主研究。审核证据与判断，再把值得写的选题推进到文章。"
              action={<span className="hint-pill">资料决定选题</span>}
            />
            <section className="panel topic-research">
              <div className="topic-research-copy">
                <div className="form-icon lavender">
                  <Sparkles size={18} />
                </div>
                <div>
                  <span className="eyebrow muted-label">
                    EDITORIAL RESEARCH
                  </span>
                  <h3>让证据先说话</h3>
                  <p>
                    留空时研究已归档资料；填写诉求后，结合知识库、网页搜索与原文阅读自主探索，再提出有证据的选题。
                  </p>
                  <label className="topic-request-field">
                    本轮诉求 / 关注方向 <span>可选</span>
                    <textarea
                      value={topicResearchRequest}
                      onChange={(event) => setTopicResearchRequest(event.target.value)}
                      maxLength={2000}
                      rows={3}
                      disabled={topicResearchStarting || Boolean(topicResearchRunning)}
                      placeholder="例如：研究 AI 编程工具如何改变小团队的工作方式，关注真实案例、成本与局限。"
                    />
                  </label>
                  {topicResearchRunning && (
                    <span className="research-running">
                      <LoaderCircle className="spin" size={12} />{" "}
                      {topicResearchRunning.stage || "正在研究已归档资料"}
                      {topicResearchRunning.sourceCount
                        ? ` · ${topicResearchRunning.completedSourceCount ?? 0}/${topicResearchRunning.sourceCount} 份资料`
                        : ""}
                      {topicResearchRunning.request ? ` · 搜索 ${topicResearchRunning.searchCalls ?? 0} 次 · 读取 ${topicResearchRunning.fetchCalls ?? 0} 次` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="topic-batch">


                <label className="topic-count-field">
                  本轮数量
                  <input
                    type="number"
                    min="1"
                    max="30"
                    disabled={
                      Boolean(topicResearchRunning) || topicResearchStarting
                    }
                    value={topicBatchCount}
                    onChange={(e) =>
                      setTopicBatchCount(Number(e.target.value) || 1)
                    }
                  />
                </label>
                <button
                  className="button primary research-start-button"
                  aria-busy={
                    topicResearchStarting || Boolean(topicResearchRunning)
                  }
                  disabled={
                    busy ||
                    Boolean(topicResearchRunning) ||
                    topicResearchStarting
                  }
                  onClick={() => void startTopicResearch()}
                >
                  {topicResearchStarting || topicResearchRunning ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {topicResearchStarting
                    ? "正在检查资料"
                    : topicResearchRunning
                      ? "正在生成选题"
                      : "研究资料并生成选题"}
                </button>
                <button
                  className="button dark"
                  disabled={
                    busy ||
                    !selectedTopics.length ||
                    submittingTopicIds.length > 0
                  }
                  onClick={() => void generateSelectedTopics()}
                >
                  批量创建待写文章
                </button>
              </div>
            </section>
            <section className="research-readiness panel">
              <div className="readiness-counts">
                <span>
                  <b>{usableSources.length}</b> 份可研究资料
                </span>
                <span>
                  <b>{structuredSources.length}</b> 份结构化资料
                </span>
                <span>
                  <b>{candidateSources.length}</b> 条候选链接
                </span>
                <span>
                  <b>
                    {
                      workspace.sources.filter((source) => source.contentFile)
                        .length
                    }
                  </b>{" "}
                  份本地原文
                </span>
                <span>
                  <b>{workspace.entities.length}</b> 个图谱实体
                </span>
              </div>
              {usableSources.length === 0 && !topicResearchRequest.trim() && (
                  <div className="readiness-warning">
                    <div>
                      <b>
                        {candidateSources.length > 0
                          ? "选题研究暂不可用：候选还没有完成结构化。"
                          : "选题研究暂不可用：资料缺少可核实的原文或事实。"}
                      </b>
                      <p>
                        {candidateSources.length > 0
                          ? "候选链接只包含搜索结果中的标题和 URL；缺少原文、事实与边界时，系统不会生成没有证据的选题。请先检查抓取失败原因或重新收集资料。"
                          : "可以填写本轮诉求，让系统检索知识库并自主搜索原文；或先补充原文摘录与事实。"}
                      </p>
                    </div>
                    <button
                      className="button outline"
                      onClick={() => setTab("资料归档")}
                    >
                      查看候选与原文
                    </button>
                  </div>
                )}
              {topicResearchFeedback && (
                <div
                  className={`research-feedback ${topicResearchFeedback.tone}`}
                >
                  <span>
                    {topicResearchFeedback.tone === "working" ||
                    topicResearchFeedback.tone === "running" ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : (
                      <CircleHelp size={13} />
                    )}
                  </span>
                  <p>{topicResearchFeedback.message}</p>
                  {topicResearchFeedback.tone === "error" && (
                    <button
                      className="text-link"
                      onClick={() => setTab("资料归档")}
                    >
                      查看资料归档 <ArrowUpRight size={12} />
                    </button>
                  )}
                </div>
              )}
              {Boolean(workspace.topicRuns[0]?.warnings?.length) && (
                <div className="research-feedback error" role="status">
                  <p>本轮研究说明：{workspace.topicRuns[0].warnings!.join("；")}</p>
                </div>
              )}
            </section>
            <section className="topic-board topic-board-wide">
              <div className="board-head">
                <div>
                  <span className="eyebrow muted-label">EDITORIAL QUEUE</span>
                  <h3>系统发现的机会</h3>
                </div>
                <div className="board-summary">
                  <span>
                    {
                      workspace.topics.filter(
                        (topic) => topic.status === "待评估",
                      ).length
                    }{" "}
                    待评估
                  </span>
                  <span>
                    {
                      workspace.topics.filter(
                        (topic) => topic.status === "准备写作",
                      ).length
                    }{" "}
                    准备写作
                  </span>
                  <span className="count-badge">
                    {workspace.topics.length} 个选题
                  </span>
                </div>
              </div>
              <div className="topic-pool-tabs" role="tablist" aria-label="选题进度">
                {topicPoolStages.map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    role="tab"
                    aria-selected={topicPoolTab === stage}
                    onClick={() => setTopicPoolTab(stage)}
                  >
                    {stage} <span>{workspace.topics.filter((topic) => topicPoolStage(topic, workspace.drafts) === stage).length}</span>
                  </button>
                ))}
              </div>
              {!workspace.topics.some((topic) => topicPoolStage(topic, workspace.drafts) === topicPoolTab) && (
                <p className="topic-pool-empty">暂无{topicPoolTab}选题</p>
              )}
              {workspace.topics.filter((topic) => topicPoolStage(topic, workspace.drafts) === topicPoolTab).map((topic) => {
                const sources = workspace.sources.filter((source) =>
                  topic.sourceIds.includes(source.id),
                );
                const existingDraft = workspace.drafts.find(
                  (draft) => draft.topicId === topic.id,
                );
                const submitting = submittingTopicIds.includes(topic.id);
                return (
                  <article className="topic-card" key={topic.id}>
                    <div className="topic-card-top">
                      <label className="topic-select">
                        <input
                          type="checkbox"
                          checked={selectedTopics.includes(topic.id)}
                          onChange={(e) =>
                            setSelectedTopics((ids) =>
                              e.target.checked
                                ? [...ids, topic.id]
                                : ids.filter((id) => id !== topic.id),
                            )
                          }
                        />
                        选择
                      </label>
                      <span className="source-type">{topic.direction}</span>
                      <select
                        aria-label="选题状态"
                        value={topic.status}
                        onChange={(e) =>
                          void run(async () => {
                            await call(`/topics/${topic.id}`, "PATCH", {
                              status: e.target.value,
                            });
                          })
                        }
                      >
                        <option>待评估</option>
                        <option>准备写作</option>
                        <option>暂缓</option>
                        <option>已发布</option>
                      </select>
                    </div>
                    <div className="topic-title-line">
                      <h3>{topic.title}</h3>
                      <CopyButton value={topic.title} label="选题标题" />
                    </div>
                    {topic.thesis && (
                      <p className="thesis">
                        <span>判断</span>
                        {topic.thesis}
                        <CopyButton value={topic.thesis} label="选题判断" />
                      </p>
                    )}
                    {topic.readerValue && (
                      <p className="reader-value">
                        <span>读者价值：{topic.readerValue}</span>
                        <CopyButton
                          value={topic.readerValue}
                          label="选题读者价值"
                        />
                      </p>
                    )}
                    <div className="topic-sources">
                      <Archive size={13} />
                      {sources.length ? (
                        sources.map((source) => (
                          <span key={source.id}>{source.title}</span>
                        ))
                      ) : (
                        <span>尚未关联资料</span>
                      )}
                    </div>
                    <div className="topic-card-bottom">
                      <span>
                        {sources.length} 份来源 ·{" "}
                        {
                          sources.filter((s) => s.verification === "已核对")
                            .length
                        }{" "}
                        份已核对
                      </span>
                      <div className="topic-actions">
                        <button
                          className="button outline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              if (existingDraft) {
                                setEditing(existingDraft);
                                setTab("内容草稿");
                                return;
                              }
                              const result = await call(
                                `/topics/${topic.id}/draft`,
                                "POST",
                                {},
                              );
                              setEditing(result.draft);
                              setTab("内容草稿");
                            })
                          }
                        >
                          {existingDraft ? "进入文章" : "空白草稿"}
                        </button>
                        {(existingDraft || topic.status === "已发布") && (
                          <button
                            type="button"
                            className="button outline"
                            disabled={busy}
                            onClick={() => void run(async () => {
                              await call(`/topics/${topic.id}`, "PATCH", {
                                status: topic.status === "已发布" ? "准备写作" : "已发布",
                              });
                            })}
                          >
                            {topic.status === "已发布" ? "改回已选" : "设为已发布"}
                          </button>
                        )}
                        {!existingDraft && (
                          <button
                            className="button dark"
                            disabled={busy || submitting}
                            title="创建待写文章，进入后选择渠道生成"
                            onClick={() => void generate(topic)}
                          >
                            <Sparkles size={14} />
                            {submitting ? "创建中…" : "创建待写文章"}
                          </button>
                        )}
                        <button
                          className="button outline topic-delete"
                          aria-label={`删除选题 ${topic.title}`}
                          disabled={busy}
                          onClick={() => void deleteTopic(topic)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {workspace.topics.length === 0 && (
                <div className="empty-state board-empty">
                  <Lightbulb size={24} />
                  <b>还没有选题</b>
                  <span>先归档资料，再让系统研究证据并提出值得写的判断。</span>
                </div>
              )}
              {workspace.topics.length > 0 && (
                <div className="topic-pool-foot">
                  先看来源和判断，再决定是否写作。待评估不等于值得发布。
                </div>
              )}
            </section>
          </>
        )}

        {tab === "内容草稿" && (
          <>
            <PageTitle
              eyebrow="ARTICLE WORKSPACE"
              title="文章工作台"
              subtitle="专注写好一篇文章。构思、证据、配图和渠道交付，在需要时随手切换。"
              wide
            />
            {editing ? (
              <div className="draft-workspace">
                <div className="draft-editor panel">
                  <div className="draft-header">
                    <div>
                      <span className="eyebrow muted-label">
                        {activeTopic ? activeTopic.direction : "DRAFT"}{" "}
                        · {editing.generation}
                      </span>
                      <h3>{editing.title || activeTopic?.title || "未命名文章"}</h3>
                    </div>
                    <div className="draft-header-actions">
                      <span
                        className={`draft-save-state ${draftDirty ? "dirty" : ""}`}
                      >
                        {draftDirty ? "有未保存修改" : "已保存"}
                      </span>
                      <button
                        type="button"
                        className="button primary draft-header-save"
                        disabled={busy || !draftDirty}
                        onClick={() => void saveDraft()}
                      >
                        {draftDirty ? "保存文章" : "已保存"}
                      </button>
                      <button
                        type="button"
                        className="draft-regenerate"
                        title="选择渠道与生成范围"
                        aria-label="选择渠道与生成范围"
                        disabled={busy || editing.generationRun?.status === "运行中" || editing.videoRun?.status === "运行中"}
                        onClick={() => void regenerateArticle(editing)}
                      >
                        <Sparkles size={15} />
                        <span>生成</span>
                      </button>
                      <button className="button outline" onClick={closeDraft}>
                        文章列表
                      </button>
                    </div>
                  </div>
                  <div className="generation-flows">
                    <GenerationFlow title="内容" run={editing.generationRun} />
                    <GenerationFlow title="图片与封面" run={editing.visualRun} />
                    <GenerationFlow title="视频" run={editing.videoRun} />
                  </div>
                  <div className="article-channel-bar">
                    <div><span className="eyebrow muted-label">CHANNEL VERSION</span><b>当前编辑版本</b></div>
                      <div className="channel-preview-switch">
                        <div
                          className="channel-tabs"
                          role="tablist"
                          aria-label="发布渠道"
                          style={{ flexWrap: "wrap" }}
                        >
                          {contentChannels.map((channel) => (
                            <button key={channel} type="button" role="tab"
                              aria-selected={editing.channel === channel}
                              className={editing.channel === channel ? "selected" : ""}
                              disabled={channelSwitching || copilotRunning || editing.videoRun?.status === "运行中"}
                              onClick={() => void switchDraftChannel(channel)}>
                              <b>{channelLabel(channel)}</b>
                              <small>{(editing.channel === channel ? activeChannelHasContent : Boolean(editing.channelVariants[channel])) ? "已生成" : "未生成"}</small>
                            </button>
                          ))}
                        </div>


                      </div>
                  </div>
                  {editing.videoRun?.status === "运行中" && <p role="status">视频正在渲染，完成后可继续编辑和切换渠道。</p>}
                  <nav className="article-sections" aria-label="文章工作区">
                    {[
                      { id: "write", label: "写文章", icon: PenLine },
                      { id: "brief", label: "构思与证据", icon: Lightbulb },
                      { id: "visual", label: "配图/视频", icon: Sparkles },
                      { id: "review", label: "审校", icon: Check },
                      { id: "deliver", label: "预览与交付", icon: Upload },
                    ].map(({ id, label, icon: Icon }) => (
                      <button key={id} type="button" aria-pressed={editorSection === id}
                        className={editorSection === id ? "selected" : ""}
                        onClick={() => setEditorSection(id)}><Icon size={15} />{label}</button>
                    ))}
                  </nav>
                  {editorSection === "write" && <section className="article-writing-canvas" aria-label="文章编辑器">
                    <div className="article-writing-meta"><span>{channelLabel(editing.channel)} · 标题与正文</span><span>{editing.body.replace(/\s/g, "").length.toLocaleString()} 字</span></div>
                    <Field
                      label={
                        editing.channel === "wechat"
                          ? "公众号标题"
                          : `${channelLabel(editing.channel)}标题`
                      }
                      copyValue={editing.title}
                    >
                      <input
                        value={editing.title}
                        maxLength={240}
                        onChange={(e) => updateDraft("title", e.target.value)}
                      />
                    </Field>
                  <Field
                    label={
                      editing.channel === "video" ? "视频口播稿" : editing.channel === "wechat"
                        ? "公众号正文（支持 #/## 标题、段落、> 引用与列表）"
                        : "正文 / 图文逐页文案"
                    }
                    copyValue={editing.body}
                  >
                    <textarea
                      className="draft-body"
                      value={editing.body}
                      maxLength={editing.channel === "video" ? 1600 : editing.channel === "xiaohongshu" ? 1000 : 80000}
                      onChange={(e) => updateDraft("body", e.target.value)}
                      rows={22}
                      placeholder={
                        editing.channel === "wechat"
                          ? "使用 Markdown 编辑长文；在“配图/视频”中安排图片的正文位置。"
                          : "直接开始写作，或前往“构思与证据”生成创作卡，再按创作卡重写正文。"
                      }
                    />
                  </Field>
                  <Field label="主题标签（发布时使用）" copyValue={editing.tags}>
                    <input
                      value={editing.tags}
                      onChange={(e) => updateDraft("tags", e.target.value)}
                      placeholder="#AI趋势 #人工智能"
                    />
                  </Field>
                    <details className="article-secondary-fields"><summary>文章信息与渠道设置 <ChevronRight size={14} /></summary>
                  <div className="draft-grid">
                    <Field label="封面标题" copyValue={editing.coverTitle}>
                      <input
                        value={editing.coverTitle}
                        maxLength={30}
                        onChange={(e) =>
                          updateDraft("coverTitle", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="目标读者" copyValue={editing.audience}>
                      <input
                        value={editing.audience}
                        onChange={(e) =>
                          updateDraft("audience", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="读者价值" copyValue={editing.readerValue}>
                      <input
                        value={editing.readerValue}
                        onChange={(e) =>
                          updateDraft("readerValue", e.target.value)
                        }
                      />
                    </Field>
                  </div>
                  {editing.channel === "wechat" && (
                    <div className="draft-grid">
                      <Field
                        label="公众号作者（最多 16 字）"
                        copyValue={editing.wechatAuthor}
                      >
                        <input
                          value={editing.wechatAuthor}
                          maxLength={16}
                          onChange={(e) =>
                            updateDraft("wechatAuthor", e.target.value)
                          }
                          placeholder="可选，发布时写入作者栏"
                        />
                      </Field>
                      <Field
                        label="公众号摘要（最多 120 字）"
                        copyValue={editing.wechatSummary}
                      >
                        <input
                          value={editing.wechatSummary}
                          maxLength={120}
                          onChange={(e) =>
                            updateDraft("wechatSummary", e.target.value)
                          }
                          placeholder="用于草稿箱摘要与分享文案"
                        />
                      </Field>
                    </div>
                  )}
                    </details>
                  </section>}
                  {editing.channel === "video" && (editorSection === "write" || editorSection === "deliver") && <Field label="视频摘要（最多120字）" copyValue={editing.wechatSummary}>
                    <textarea value={editing.wechatSummary} maxLength={120} rows={3} onChange={event => updateDraft("wechatSummary", event.target.value)} />
                  </Field>}
                  {editorSection === "brief" && <section className="article-research">
                  <section className="craft-panel">
                    <div className="craft-panel-head">
                      <div className="form-icon craft-icon">
                        <Compass size={18} />
                      </div>
                      <div>
                        <span className="eyebrow muted-label">
                          CREATIVE BRIEF
                        </span>
                        <h4>把判断、结构和依据想清楚</h4>
                        <p>
                          创作卡由系统根据选题与来源自动生成，不需要手动填写。
                        </p>
                      </div>
                      <div className="craft-tools">
                        <div className="craft-score">
                          {craftGroups.map((group) => {
                            const done = group.keys.filter(
                              (key) =>
                                editing.creativeBrief[key].trim() &&
                                !editing.creativeBrief[key].startsWith(
                                  "待补充",
                                ),
                            ).length;
                            return (
                              <span
                                key={group.id}
                                className={
                                  done === group.keys.length ? "complete" : ""
                                }
                              >
                                <b>{done}</b>/{group.keys.length} {group.label}
                                {group.optional ? " · 可选" : ""}
                              </span>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className="button outline craft-generate"
                          disabled={busy}
                          onClick={() => void generateCraft()}
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          {craftReady ? "重新生成创作卡" : "生成创作卡"}
                        </button>
                      </div>
                    </div>
                    <div className="craft-boundary">
                      <span>自动生成</span>
                      系统只使用选题与已关联来源；没有真实个人观察时会明确保留“待补充”。
                    </div>
                    <div className="craft-section">
                      <div className="craft-section-title">
                        <b>01 · 共鸣判断</b>
                        <span>制造共鸣，不制造焦虑</span>
                      </div>
                      <div className="craft-grid">
                        <BriefField
                          label="读者原本相信什么"
                          value={editing.creativeBrief.commonBelief}
                        />
                        <BriefField
                          label="值得争辩的反常识判断"
                          value={editing.creativeBrief.counterAngle}
                        />
                        <BriefField
                          label="情绪从哪里走到哪里"
                          value={editing.creativeBrief.emotionalArc}
                        />
                        <BriefField
                          label="读者会在哪句话里看到自己"
                          value={editing.creativeBrief.readerMirror}
                        />
                      </div>
                      <BriefField
                        label="可核实的场景锚点"
                        value={editing.creativeBrief.sceneAnchor}
                      />
                      <BriefField
                        label="我的真实观察 / 态度（可后补）"
                        value={editing.creativeBrief.voiceAnchor}
                      />
                    </div>
                    <div className="craft-section">
                      <div className="craft-section-title">
                        <b>02 · 文章结构</b>
                        <span>一句话只做一个动作</span>
                      </div>
                      <div className="story-grid">
                        <StoryView
                          code="起"
                          title="破题"
                          value={editing.creativeBrief.opening}
                        />
                        <StoryView
                          code="承"
                          title="展开"
                          value={editing.creativeBrief.development}
                        />
                        <StoryView
                          code="转"
                          title="推进判断"
                          value={editing.creativeBrief.turn}
                        />
                        <StoryView
                          code="合"
                          title="落点"
                          value={editing.creativeBrief.landing}
                        />
                      </div>
                    </div>
                    <div className="craft-section craft-share">
                      <div>
                        <div className="craft-section-title">
                          <b>03 · 传播落点</b>
                          <span>标题即观点，金句要能被截图</span>
                        </div>
                        <BriefField
                          label="不超过 40 字的可截图句"
                          value={editing.creativeBrief.shareLine}
                        />
                      </div>

                    </div>
                  </section>
                    <details className="article-secondary-fields" open><summary>事实、来源与边界 <ChevronRight size={14} /></summary>
                  <div className="draft-grid">
                    <Field
                      label="核心问题"
                      copyValue={editing.paperQuestion}
                    >
                      <textarea
                        value={editing.paperQuestion}
                        onChange={(e) =>
                          updateDraft("paperQuestion", e.target.value)
                        }
                        rows={3}
                      />
                    </Field>
                    <Field
                      label="证据与机制"
                      copyValue={editing.paperMethod}
                    >
                      <textarea
                        value={editing.paperMethod}
                        onChange={(e) =>
                          updateDraft("paperMethod", e.target.value)
                        }
                        rows={3}
                      />
                    </Field>
                    <Field
                      label="关键变化"
                      copyValue={editing.paperFindings}
                    >
                      <textarea
                        value={editing.paperFindings}
                        onChange={(e) =>
                          updateDraft("paperFindings", e.target.value)
                        }
                        rows={3}
                      />
                    </Field>
                    <Field
                      label="边界与反证"
                      copyValue={editing.paperLimits}
                    >
                      <textarea
                        value={editing.paperLimits}
                        onChange={(e) =>
                          updateDraft("paperLimits", e.target.value)
                        }
                        rows={3}
                      />
                    </Field>
                  </div>
                  <Field label="来源与事实依据" copyValue={editing.sources}>
                    <textarea
                      value={editing.sources}
                      onChange={(e) => updateDraft("sources", e.target.value)}
                      rows={4}
                    />
                  </Field>
                  <Field
                    label="Kuzu 图谱创作线索"
                    copyValue={editing.knowledgeContext ?? ""}
                  >
                    <textarea
                      value={editing.knowledgeContext ?? ""}
                      onChange={(e) =>
                        updateDraft("knowledgeContext", e.target.value)
                      }
                      rows={6}
                      placeholder="生成创作卡或正文时会自动写入规范化实体、跨资料覆盖度与关系边界。"
                    />
                  </Field>
                    </details>
                  </section>}
                  {editorSection === "visual" && editing.channel === "video" && <section className="settings-card"><h4>视频画面</h4><p>DSH 根据文章和资料设计动画，封面作为视频首帧。</p><div className="video-delivery"><div className="video-preview-stage">{editing.video?.fileName ? <video controls preload="metadata" src={`/api/videos/${editing.video.fileName}`} /> : editing.wechatCover ? <img src={`/api/media/${editing.wechatCover.fileName}`} alt="视频封面" /> : <p>先生成口播稿，再生成视频</p>}</div><div className="video-delivery-details">{editing.video && editing.video.sourceText !== videoSourceText(editing) && <p role="status">当前为历史视频，与最新文案不一致，请重新生成后发布。</p>}<button className="button primary" disabled={busy || copilotUnavailable || !editing.body.trim()} onClick={() => void generateVideo()}>{editing.videoRun?.status === "运行中" ? "视频渲染中…" : editing.video ? "重新生成视频" : "生成视频"}</button></div></div></section>}
                  {editorSection === "visual" && editing.channel !== "video" && <section aria-label="文章配图">
                  <Field
                    label="封面与配图素材企划"
                    copyValue={editing.visualBrief}
                  >
                    <textarea
                      value={editing.visualBrief}
                      onChange={(e) =>
                        updateDraft("visualBrief", e.target.value)
                      }
                      rows={4}
                    />
                  </Field>
                  <section className="visual-set">
                    <div className="visual-set-head">
                      <div>
                        <span className="eyebrow muted-label">
                          AUTO VISUAL SERIES
                        </span>
                        <h4>自动生成成套配图</h4>
                        <p>
                          {`${channelLabel(editing.channel)}配图 ${channelVisuals[editing.channel].width}×${channelVisuals[editing.channel].height}（${channelVisuals[editing.channel].ratio}）。文字卡、插画和信息卡按内容选用，最多6张，不凑数；同篇锁定模板与配色。${channelVisuals[editing.channel].cover ? "另生成独立封面，不裁切正文图。" : ""}`}
                        </p>
                      </div>
                      <div className="image-tools">
                        <span
                          className={`visual-service ${imageEnabled ? "ready" : ""}`}
                        >
                          {imageEnabled ? "图片服务已连接" : "未配置图片服务"}
                        </span>
                        <select
                          value={imageModel}
                          disabled={busy}
                          onChange={(e) => setImageModel(e.target.value)}
                        >
                          <option value={imageModel}>
                            {imageModel}（Right Codes）
                          </option>
                        </select>
                        <span>请使用页面顶部的重新生成入口选择生成范围。</span>
                        <button
                          type="button"
                          className="button outline"
                          disabled={busy || !draftImages.length}
                          onClick={() => void downloadPublishPackage()}
                        >
                          <Archive size={14} />
                          下载发布包
                        </button>
                      </div>
                    </div>
                    <div className="visual-set-guide">
                      <span>创意人文科技</span>
                      保留原文的判断与因果，但用人物、写实动漫角色、小型非拟人机器人、动物、建筑、器物、植物、玻璃、纸张与克制的数据光组合转译；可以没有人物。避免巨大人物或巨型机器人占满画面，也不要空洞凝视的人脸、解剖感、发光大脑和满屏霓虹。
                    </div>
                    <div className="visual-theme-note">
                      <span>本篇视觉主题</span>
                      <b>
                        {editing.visualThemeId
                          ? activeVisualTheme.label
                          : "生成时按内容自动选择"}
                      </b>
                      <i
                        style={{
                          background: activeVisualTheme.colors.surfaceStart,
                        }}
                      />
                      <i
                        style={{
                          background: activeVisualTheme.colors.ink,
                        }}
                      />
                      <i
                        style={{
                          background: activeVisualTheme.colors.accent,
                        }}
                      />
                      <small>
                        同一篇文章的所有图片固定使用这一套主题。
                      </small>
                    </div>
                    <div className="visual-library-note">
                      <div>
                        <span className="visual-library-badge">
                          Prompt-as-Code
                        </span>
                        <b>{visualPromptLibraryInfo.name}</b>
                        <small>
                          {visualPromptLibraryInfo.templateCount} 个模板 ·{" "}
                          {visualPromptLibraryInfo.license}
                        </small>
                      </div>
                      <label>
                        生图模板
                        <select
                          value={editing.imagePromptTemplateId ?? ""}
                          disabled={busy}
                          onChange={(event) =>
                            updateDraft(
                              "imagePromptTemplateId",
                              event.target.value,
                            )
                          }
                        >
                          <option value="">
                            自动匹配 · {activeImagePromptTemplate.label}
                          </option>
                          {imagePromptTemplates.map((template) => (
                            <option value={template.id} key={template.id}>
                              {template.label} · {template.category}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p>{activeImagePromptTemplate.description}</p>
                      <a
                        href={visualPromptTemplateSource(
                          activeImagePromptTemplate,
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看模板方法与避坑指南{" "}
                        <ArrowUpRight size={11} />
                      </a>
                    </div>
                    {editing.wechatCover && (
                      <a className="visual-card visual-cover-card" href={`/api/media/${editing.wechatCover.fileName}`} target="_blank" rel="noreferrer">
                        <img src={`/api/media/${editing.wechatCover.fileName}`} alt={`${channelLabel(editing.channel)}独立封面`} style={{aspectRatio: `${channelVisuals[editing.channel].cover?.width} / ${channelVisuals[editing.channel].cover?.height}`, objectFit:"contain"}} />
                        <b>{channelLabel(editing.channel)}独立封面 · {channelVisuals[editing.channel].cover?.width}×{channelVisuals[editing.channel].cover?.height}</b>
                      </a>
                    )}
                    {draftImages.length ? (
                      <>
                        <div className="visual-set-grid">
                          {draftImages.map((image, index) => (
                            <a
                              key={image.id}
                              href={`/api/media/${image.fileName}`}
                              target="_blank"
                              rel="noreferrer"
                              className="visual-card"
                            >
                              <img
                                src={`/api/media/${image.fileName}`}
                                alt={`${image.role}：${image.title}`}
                                style={{ aspectRatio: `${channelVisuals[editing.channel].width} / ${channelVisuals[editing.channel].height}`, objectFit: "contain" }}
                              />
                              <div className="visual-card-caption">
                                <span>
                                  0{index + 1} ·{" "}
                                  {visualKindLabel(image.kind)} · {image.role}
                                  {image.promptTemplateName
                                    ? ` · ${image.promptTemplateName}`
                                    : ""}
                                </span>
                                <b>{image.title}</b>
                                {image.notice && (
                                  <small className="visual-card-notice">
                                    {image.notice}
                                  </small>
                                )}
                              </div>
                            </a>
                          ))}
                        </div>
                        {editing.channel === "wechat" && (
                          <div className="wechat-image-map">
                            <div className="wechat-image-map-head">
                              <div>
                                <span className="eyebrow muted-label">
                                  WECHAT IMAGE MAP
                                </span>
                                <b>公众号图片编排</b>
                              </div>
                              <small>
                                封面 {WECHAT_COVER_WIDTH}×
                                {WECHAT_COVER_HEIGHT} · 正文{" "}
                                {WECHAT_BODY_WIDTH}×{WECHAT_BODY_HEIGHT}
                              </small>
                            </div>
                            {draftImages.map((image) => {
                              const blocks = articleBlocks(editing.body);
                              return (
                                <div className="wechat-image-row" key={image.id}>
                                  <span>
                                    正文 ·{" "}
                                    {image.role || image.title}
                                  </span>
                                  <select
                                    aria-label={`${image.title}正文插入位置`}
                                    value={
                                      editing.imagePlacements?.[image.id] ?? ""
                                    }
                                    onChange={(event) => {
                                      const next = {
                                        ...editing.imagePlacements,
                                      };
                                      if (!event.target.value)
                                        delete next[image.id];
                                      else
                                        next[image.id] = Number(
                                          event.target.value,
                                        );
                                      updateDraft("imagePlacements", next);
                                    }}
                                  >
                                    <option value="">
                                      自动
                                      {wechatBodyImages.find(
                                        (item) => item.image.id === image.id,
                                      )?.position !== undefined
                                        ? `（第 ${wechatBodyImages.find((item) => item.image.id === image.id)?.position} 个块后）`
                                        : ""}
                                    </option>
                                    <option value="0">正文最前面</option>
                                    {blocks.map((block) => (
                                      <option
                                        key={block.index}
                                        value={block.index}
                                      >
                                        第 {block.index} 块后 ·{" "}
                                        {block.text.slice(0, 18) || "分隔线"}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <details className="visual-prompts">
                          <summary>
                            查看视觉统一规范与 {draftImages.length} 组提示词
                          </summary>
                          {editing.visualStyleGuide && (
                            <p>
                              <b>
                                统一规范
                                <CopyButton
                                  value={editing.visualStyleGuide}
                                  label="视觉统一规范"
                                />
                              </b>
                              {editing.visualStyleGuide}
                            </p>
                          )}
                          {draftImages.map((image) => (
                            <p key={image.id}>
                              <b>
                                {image.role}
                                <CopyButton
                                  value={image.prompt}
                                  label={`${image.role}提示词`}
                                />
                              </b>
                              {image.prompt}
                            </p>
                          ))}
                        </details>
                      </>
                    ) : (
                      <div className="visual-empty">
                        <Sparkles size={18} />
                        <div>
                          <b>还没有视觉组</b>
                          <span>
                            自动视觉组尚未生成；可以在这里直接重试或重新生成。
                          </span>
                        </div>
                      </div>
                    )}
                  </section>
                  </section>}
                  {editorSection === "review" && <section aria-label="文章审校">
                  <div className="review-box">
                    <div className="review-title">
                      <Check size={16} />
                      <b>发布前人工自查</b>
                      <span>自查状态由你确认，不代表系统核验事实</span>
                    </div>
                    <div className="review-items">
                      {checks.map((check) => (
                        <label key={check}>
                          <input
                            type="checkbox"
                            checked={editing.checklist.includes(check)}
                            onChange={(e) =>
                              updateDraft(
                                "checklist",
                                e.target.checked
                                  ? [...editing.checklist, check]
                                  : editing.checklist.filter(
                                      (x) => x !== check,
                                    ),
                              )
                            }
                          />
                          {check}
                        </label>
                      ))}
                    </div>
                  </div>
                  </section>}
                  {editorSection === "deliver" && <section aria-label="文章交付">
                  <section className="channel-preview">
                    <div className="channel-preview-head"><div><span className="eyebrow muted-label">PREVIEW & DELIVERY</span><h4>{channelLabel(editing.channel)}成品预览</h4><p>检查阅读效果，复制文案或下载完整发布包。</p></div></div>
                    {!activeChannelHasContent && !(editing.channel === "video" && editing.video?.fileName) ? (
                      <div className="channel-preview-empty channel-preview-empty-large">
                        <Sparkles size={26} />
                        <b>
                          还没有生成{channelLabel(editing.channel)}版本
                        </b>
                        <span>
                          旧草稿可以在这里单独生成当前渠道版本，不会覆盖另一个渠道。
                        </span>
                        <span>请使用页面顶部的重新生成入口选择生成范围。</span>
                      </div>
                    ) : editing.channel === "video" ? (
                      <div className="video-delivery">
                        <div className="video-preview-stage">
                          {editing.video?.fileName ? <video controls preload="metadata" src={`/api/videos/${editing.video.fileName}`} poster={editing.wechatCover ? `/api/media/${editing.wechatCover.fileName}` : undefined} /> : editing.wechatCover ? <img src={`/api/media/${editing.wechatCover.fileName}`} alt="视频封面" /> : <p>先生成口播稿，再生成视频</p>}
                        </div>
                        <div className="video-delivery-details">
                          <h4>{editing.title}</h4>
                          <p>ManimGL · 1080×1920 · 30fps · DSH解释性动画 · {editing.video?.audio ? "龙小夏配音" : "待生成配音"}</p>
                          <p>DSH每次读取文章、研究资料与知识，加载ManimGL skill，设计分镜并编写动画代码。统一品牌基调，视觉表达随题目变化。</p>
                          {editing.video && (editing.video.engine !== "dsh-manim" || editing.video.sourceText !== videoSourceText(editing)) && <p role="status">当前显示的是历史视频，与最新文案不一致；请重新生成后再作为当前版本发布。</p>}
                          {editing.videoRun?.status === "运行中" && <p>视频生成进度见页面顶部流程。</p>}
                          <button className="button primary" disabled={busy || copilotUnavailable || !editing.body.trim()} onClick={() => void generateVideo()}>{editing.videoRun?.status === "运行中" ? "视频渲染中…" : editing.video ? "重新生成视频" : "生成视频"}</button>
                          <button className="button outline" disabled={busy || copilotUnavailable || !editing.video || editing.video.engine !== "dsh-manim" || editing.video.sourceText !== videoSourceText(editing) || !editing.wechatCover} onClick={() => void downloadPublishPackage()}>下载视频发布包</button>
                          {editing.video?.engine === "dsh-manim" && editing.video.sourceText === videoSourceText(editing) && <p><a href={`/api/videos/${editing.video.subtitleFile}`} download>下载字幕 SRT</a> · <a href={`/api/videos/${editing.video.planFile}`} download>查看分镜 JSON</a></p>}
                        </div>
                      </div>
                    ) : editing.channel !== "wechat" && editing.channel !== "toutiao" ? (
                      <div className="xhs-channel-preview">
                        <div className="xhs-carousel-panel">
                          <div className="xhs-carousel-stage" style={{aspectRatio:`${activeImageGeometry.width} / ${activeImageGeometry.height}`}}>
                            {activeXhsImage ? (
                              <img
                                src={`/api/media/${activeXhsImage.fileName}`}
                                alt={`${channelLabel(editing.channel)}图片 ${activeXhsImageIndex + 1}`}
                                style={{aspectRatio:`${activeImageGeometry.width} / ${activeImageGeometry.height}`,objectFit:"contain"}}
                              />
                            ) : (
                              <div className="xhs-carousel-placeholder">
                                {editing.visualRun?.status === "运行中" ? (
                                  <>
                                    <LoaderCircle
                                      className="spin"
                                      size={24}
                                    />
                                    <span>{editing.visualRun.stage}</span>
                                  </>
                                ) : (
                                  <>
                                    <Sparkles size={24} />
                                    <span>还没有生成图片</span>
                                    <span>请使用页面顶部的重新生成入口选择生成范围。</span>
                                  </>
                                )}
                              </div>
                            )}
                            {deliveryImages.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  className="xhs-carousel-arrow previous"
                                  aria-label="上一张图片"
                                  onClick={() =>
                                    setXhsImageIndex(
                                      (activeXhsImageIndex -
                                        1 +
                                        deliveryImages.length) %
                                        deliveryImages.length,
                                    )
                                  }
                                >
                                  <ChevronLeft size={18} />
                                </button>
                                <button
                                  type="button"
                                  className="xhs-carousel-arrow next"
                                  aria-label="下一张图片"
                                  onClick={() =>
                                    setXhsImageIndex(
                                      (activeXhsImageIndex + 1) %
                                        deliveryImages.length,
                                    )
                                  }
                                >
                                  <ChevronRight size={18} />
                                </button>
                              </>
                            )}
                            <span className="xhs-carousel-count">
                              {deliveryImages.length
                                ? `${activeXhsImageIndex + 1} / ${deliveryImages.length}`
                                : "0 / 0"}
                            </span>
                          </div>
                          {deliveryImages.length > 1 && (
                            <div className="xhs-carousel-thumbs">
                              {deliveryImages.map((image, index) => (
                                <button
                                  type="button"
                                  key={image.id}
                                  className={
                                    index === activeXhsImageIndex
                                      ? "selected"
                                      : ""
                                  }
                                  onClick={() => setXhsImageIndex(index)}
                                  aria-label={`查看第 ${index + 1} 张图片`}
                                >
                                  <img
                                    src={`/api/media/${image.fileName}`}
                                    alt=""
                                  />
                                  <span>
                                    {String(index + 1).padStart(2, "0")}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className="button dark xhs-package-button"
                            disabled={busy || !draftImages.length}
                            onClick={() => void downloadPublishPackage()}
                          >
                            <Archive size={14} />
                            打包下载小红书图文
                          </button>
                        </div>
                        <div className="xhs-copy-panel">
                          <div className="xhs-copy-head">
                            <span>文章标题</span>
                            <CopyButton
                              value={editing.title}
                              label="小红书文章标题"
                            />
                          </div>
                          <h3>{editing.title || "小红书标题"}</h3>
                          <div className="xhs-copy-divider" />
                          <div className="xhs-copy-head">
                            <span>原文</span>
                            <CopyButton
                              value={editing.body}
                              label="小红书原文"
                            />
                          </div>
                          <div className="xhs-copy-body">
                            {editing.body || "正文内容会在这里展示。"}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="wechat-channel-preview">
                        <div className="wechat-device-preview">
                          <div className="wechat-browser-bar">
                            <span />
                            <b>{channelLabel(editing.channel)}文章预览</b>
                            <small>•••</small>
                          </div>
                          <div className="wechat-publication-cover" style={{ aspectRatio: `${channelVisuals[editing.channel].cover.width} / ${channelVisuals[editing.channel].cover.height}` }}>
                            {wechatCoverImage ? (
                              <img
                                src={`/api/media/${wechatCoverImage.fileName}`}
                                alt={`${channelLabel(editing.channel)}封面预览`}
                              />
                            ) : (
                              <div className="wechat-cover-empty">
                                {editing.visualRun?.status === "运行中" ? (
                                  <>
                                    <LoaderCircle
                                      className="spin"
                                      size={24}
                                    />
                                    <span>{editing.visualRun.stage}</span>
                                  </>
                                ) : (
                                  <>
                                    <BookOpen size={24} />
                                    <span>
                                      还没有独立的 {channelVisuals[editing.channel].cover?.width}×{channelVisuals[editing.channel].cover?.height} {channelLabel(editing.channel)}封面
                                    </span>
                                    <span>请使用页面顶部的重新生成入口选择生成范围。</span>
                                  </>
                                )}
                              </div>
                            )}
                            {wechatCoverImage && wechatCoverNeedsRegeneration && (
                              <div className="wechat-cover-regenerate">
                                <span>当前是临时裁切封面</span>
                                <span>请使用页面顶部的重新生成入口选择生成范围。</span>
                              </div>
                            )}
                          </div>
                          {editing.body ? (
                            <div
                              className="wechat-rich-preview"
                              dangerouslySetInnerHTML={{
                                __html: wechatPreviewHtml,
                              }}
                            />
                          ) : (
                            <div className="channel-preview-empty">
                              <BookOpen size={22} />
                              <b>还没有{channelLabel(editing.channel)}正文</b>
                              <span>在「写文章」中编辑正文后，即可预览阅读效果。</span>
                            </div>
                          )}
                        </div>
                        {editing.channel === "wechat" && <aside className="wechat-manual-kit">
                          <span className="eyebrow muted-label">
                            MANUAL PUBLISH
                          </span>
                          <h4>公众号手工发布</h4>
                          <div className="wechat-manual-step">
                            <i>01</i>
                            <div>
                              <b>复制标题</b>
                              <span>粘贴到公众号文章标题栏。</span>
                            </div>
                            <CopyButton
                              value={editing.title}
                              label="公众号标题"
                            />
                          </div>
                          <div className="wechat-manual-step">
                            <i>02</i>
                            <div>
                              <b>复制富文本</b>
                              <span>保留标题层级、段落和引用。</span>
                            </div>
                            <button
                              type="button"
                              className="button soft"
                              onClick={() => void copyWechatRichText()}
                            >
                              复制正文
                            </button>
                          </div>
                          <div className="wechat-manual-images">
                            <div>
                              <b>03 · 上传图片</b>
                              <span>封面和正文图已按发布位置编号。</span>
                            </div>
                            {wechatCoverImage && (
                              <a
                                href={`/api/media/${wechatCoverImage.fileName}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img
                                  src={`/api/media/${wechatCoverImage.fileName}`}
                                  alt="公众号封面"
                                />
                                <span>封面</span>
                              </a>
                            )}
                            {wechatBodyImages.map((item, index) => (
                              <a
                                href={`/api/media/${item.image.fileName}`}
                                target="_blank"
                                rel="noreferrer"
                                key={item.image.id}
                                title={`插入到第 ${item.position} 个正文块之后`}
                              >
                                <img
                                  src={`/api/media/${item.image.fileName}`}
                                  alt={item.image.title}
                                />
                                <span>
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                              </a>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="button dark wechat-package-button"
                            disabled={busy || !draftImages.length}
                            onClick={() => void downloadPublishPackage()}
                          >
                            <Archive size={14} />
                            打包下载公众号发布包
                          </button>
                          <small>
                            发布包含 `article.html`、900×383 封面和按位置编号的正文图。
                          </small>
                        </aside>}
                      </div>
                    )}
                  </section>
                  <section className="publication-topics" aria-label="发布主题标签">
                    <div className="publication-topics-head">
                      <b>{channelLabel(editing.channel)} · 主题标签</b>
                      <CopyButton value={editing.tags} label="主题标签" />
                    </div>
                    {editing.tags.trim() ? (
                      <div className="publication-topic-chips">
                        {editing.tags.split(/[\s#＃,，、;；]+/).filter(Boolean).map((tag, index) => <span key={`${tag}-${index}`}>#{tag}</span>)}
                      </div>
                    ) : <p>暂无主题标签，可在「写文章」中填写。</p>}
                    <small>{editing.channel === "xiaohongshu" ? "发布时将话题添加到文案或平台话题选择器中。" : "发布时按平台提供的话题或标签入口选择；公众号的标签与话题能力以当前账号后台为准。"}</small>
                  </section>
                  {editing.channel === "wechat" && (
                    <section className="wechat-official-draft">
                      <div>
                        <span className="eyebrow muted-label">
                          OFFICIAL DRAFT API
                        </span>
                        <b>公众号官方草稿箱</b>
                        <p>
                          可选能力：通过微信官方接口上传封面和正文图，并创建草稿。不会群发；当前出口 IP
                          需在公众号后台白名单中，且账号需具备素材上传与草稿箱权限。
                        </p>
                      </div>
                      <div className="wechat-official-actions">
                        <span
                          className={`visual-service ${wechatConfigured ? "ready" : ""}`}
                        >
                          {wechatConfigured
                            ? "AppID / AppSecret 已配置"
                            : "接口未配置"}
                        </span>
                        <button
                          type="button"
                          className="button dark"
                          disabled={
                            busy ||
                            !wechatConfigured ||
                            !draftImages.length
                          }
                          onClick={() => void createWechatDraft()}
                        >
                          <Upload size={14} />
                          创建公众号草稿
                        </button>
                      </div>
                      {editing.wechatDraft && (
                        <small
                          className={
                            editing.wechatDraft.status === "失败"
                              ? "wechat-draft-status failed"
                              : "wechat-draft-status"
                          }
                        >
                          {editing.wechatDraft.status === "已创建"
                            ? `草稿已创建 · media_id ${editing.wechatDraft.mediaId || "已返回"} · ${new Date(editing.wechatDraft.createdAt).toLocaleString("zh-CN")}`
                            : `上次创建失败：${editing.wechatDraft.error || "未知错误"}`}
                        </small>
                      )}
                    </section>
                  )}
                  </section>}
                  <section
                    key={editing.id}
                    className={`copilot-panel ${copilotOpen ? "open" : "collapsed"}`}
                    aria-label="文章 Copilot"
                  >
                    <button
                      type="button"
                      className="copilot-toggle"
                      aria-expanded={copilotOpen}
                      onClick={() => setCopilotOpen((open) => !open)}
                    >
                      <Sparkles size={14} />
                      <b>Copilot</b>
                      {copilotUnavailable && (
                        <i className="copilot-live-dot" />
                      )}
                      <ChevronRight
                        size={14}
                        className={copilotOpen ? "open" : ""}
                      />
                    </button>
                    {copilotOpen && (
                      <>
                    <div className="copilot-head">
                      <div>
                        <span className="eyebrow muted-label">
                          ARTICLE COPILOT
                        </span>
                        <h4>继续修改这篇文章</h4>
                        <p>
                          仅使用这篇文章的内容和对话；聊天记录独立保存。可直接描述要改的标题、正文和图片，也可以用 @ 指定对象。
                        </p>
                      </div>
                      <span
                        className={`copilot-state ${copilotRunning ? "running" : ""}`}
                      >
                        {copilotUnavailable ? (
                          <LoaderCircle className="spin" size={12} />
                        ) : (
                          <Sparkles size={12} />
                        )}
                        {copilotRunning
                          ? "修改中"
                          : copilotUnavailable
                            ? "生成中"
                            : "就绪"}
                      </span>
                    </div>
                    <div ref={copilotMessagesRef} className="copilot-messages" aria-live="polite">
                      {editing.copilotMessages.length ? (
                        editing.copilotMessages.map((message) => (
                          <CopilotMessageView
                            key={message.id}
                            message={message}
                            onResend={message.role === "user" ? () => void resendCopilotMessage(message) : undefined}
                          />
                        ))
                      ) : (
                        <div className="copilot-empty dsh-chat-empty">
                          <Sparkles size={18} />
                          <span>
                            例如：“标题更直接”“正文缩短三分之一”
                            “换成更适合公众号的科技编辑视觉”。
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="copilot-composer">
                      {copilotMentionOpen && (
                        <div className="copilot-mention-list">
                          {([['title','标题'],['body','正文'],['image','图片']] as const).map(([value,label]) => (
                            <button type="button" key={value} className="selected" onClick={() => { setCopilotTarget("auto"); setCopilotInput((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${label}`); setCopilotMentionOpen(true); }}>
                              <span>@</span>{label}<small>修改目标</small>
                            </button>
                          ))}
                          {copilotMentionAssets.map((asset) => {
                            const selected = copilotMentions.includes(asset.id);
                            return (
                              <button
                                type="button"
                                key={asset.id}
                                className={selected ? "selected" : ""}
                                onClick={() => {
                                  setCopilotMentions((ids) =>
                                    selected
                                      ? ids.filter((id) => id !== asset.id)
                                      : [...ids, asset.id].slice(0, 6),
                                  );
                                  setCopilotTarget("auto");
                                  if (!selected)
                                    setCopilotInput((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${asset.label.split(" · ")[0]}`);
                                  setCopilotMentionOpen(true);
                                }}
                              >
                                <span>@</span>
                                {asset.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {copilotMentions.length > 0 && (
                        <div className="copilot-mentioned">
                          {copilotMentions.map((id) => {
                            const asset = copilotMentionAssets.find(
                              (item) => item.id === id,
                            );
                            if (!asset) return null;
                            return (
                              <button
                                type="button"
                                key={id}
                                title="移除素材引用"
                                onClick={() =>
                                  setCopilotMentions((ids) =>
                                    ids.filter((item) => item !== id),
                                  )
                                }
                              >
                                @{asset.label}
                                <X size={9} />
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="copilot-input-row dsh-composer">
                        <button
                          type="button"
                          className={`copilot-mention-trigger ${copilotMentionOpen ? "selected" : ""}`}
                          aria-label="添加修改目标"
                          title="添加修改目标"
                          disabled={
                            copilotSubmitting ||
                            copilotUnavailable ||
                            !copilotMentionAssets.length
                          }
                          onClick={() =>
                            setCopilotMentionOpen((open) => !open)
                          }
                        >
                          <span aria-hidden="true">@</span>
                          {copilotMentions.length > 0 && (
                            <b>{copilotMentions.length}</b>
                          )}
                        </button>
                        <textarea
                          value={copilotInput}
                          rows={2}
                          maxLength={4000}
                          disabled={copilotSubmitting || copilotUnavailable}
                          placeholder={
                              copilotTarget === "title"
                                ? "希望标题更具体、更克制，还是换一个切入点？"
                                : copilotTarget === "body"
                                  ? "说明要调整的结构、语气、长度或段落，不要同时修改标题和图片。"
                                  : copilotTarget === "image"
                                    ? "描述想要的图片或封面变化，完成后会自动重画整套视觉组。"
                                    : "直接说要改什么，例如：把 @标题 改得更直接，@正文 保留数据，@正文图 01 换成更克制的视觉。"
                          }
                          onChange={(event) => {
                            const value = event.target.value;
                            setCopilotInput(value);
                            if (/@$/.test(value) && copilotMentionAssets.length)
                              setCopilotMentionOpen(true);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" &&
                              !event.shiftKey &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault();
                              void sendCopilotMessage();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="button dark copilot-send dsh-send"
                          title={copilotSubmitting ? "正在发送" : "发送消息"}
                          aria-label={copilotSubmitting ? "正在发送" : "发送消息"}
                          disabled={
                            copilotSubmitting ||
                            copilotUnavailable ||
                            !copilotInput.trim()
                          }
                          onClick={() => void sendCopilotMessage()}
                        >
                          {copilotSubmitting ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Sparkles size={14} />
                          )}
                          <span className="copilot-send-label">{copilotSubmitting ? "提交中" : "修改"}</span>
                        </button>
                      </div>
                    </div>
                      </>
                    )}
                  </section>
                  <div className="draft-actions">
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void saveDraft()}
                    >
                        <Check size={16} />
                        {draftDirty ? "保存修改" : "保存草稿"}
                    </button>
                    <button
                      className="button soft"
                      disabled={busy}
                      onClick={() => void exportDraft()}
                    >
                      <Upload size={15} />
                      导出 Markdown
                    </button>
                    {editing.channel === "wechat" && (
                      <button
                        className="button outline"
                        disabled={
                          busy || !wechatConfigured || !draftImages.length
                        }
                        onClick={() => void createWechatDraft()}
                      >
                        <Compass size={15} />
                        创建官方草稿
                      </button>
                    )}
                    <span>
                      最后编辑{" "}
                      {new Date(editing.updatedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="panel drafts-list">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow muted-label">SAVED WORK</span>
                    <h3>我的文章</h3>
                  </div>
                  <button
                    className="button soft"
                    onClick={() => setTab("选题池")}
                  >
                    <Plus size={15} />
                    从选题池开始
                  </button>
                </div>
                <div className="topic-pool-tabs" role="tablist" aria-label="文章发布状态">
                  {(["草稿", "已发"] as const).map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      role="tab"
                      aria-selected={articleListTab === stage}
                      onClick={() => setArticleListTab(stage)}
                    >
                      {stage} <span>{stage === "已发" ? publishedArticleCount : workspace.drafts.length - publishedArticleCount}</span>
                    </button>
                  ))}
                </div>
                {visibleArticles.map((draft) => (
                  <div className="saved-draft-row" key={draft.id}>
                    <button
                      className="saved-draft"
                      onClick={() => setEditing(draft)}
                    >
                      <div className="draft-thumb">
                        <FileText size={18} />
                      </div>
                      <div className="saved-draft-main">
                        <b>
                          {draft.title ||
                            workspace.topics.find((t) => t.id === draft.topicId)
                              ?.title ||
                            "未命名草稿"}
                        </b>
                        <span
                          className={`draft-activity ${draftActivity(draft).tone}`}
                        >
                          {draftActivity(draft).tone === "running" && (
                            <LoaderCircle className="spin" size={10} />
                          )}
                          {draftActivity(draft).text}
                        </span>
                        <span>
                          {new Date(draft.updatedAt).toLocaleString("zh-CN")}
                        </span>
                      </div>
                      <span className="draft-open">
                        编辑 <ChevronRight size={14} />
                      </span>
                    </button>
                    <button
                      className="draft-regenerate"
                      aria-label="选择渠道与生成范围"
                      title="选择渠道与生成范围"
                      disabled={busy || draft.generationRun?.status === "运行中"}
                      onClick={() => void regenerateArticle(draft)}
                    >
                      <Sparkles size={14} />
                      <span>生成</span>
                    </button>
                    <button
                      className="draft-delete"
                      aria-label={`删除草稿 ${draft.title || "未命名草稿"}`}
                      disabled={busy}
                      onClick={() => void deleteDraft(draft)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {visibleArticles.length === 0 && (
                  <div className="empty-state">
                    <FileText size={24} />
                    <b>{articleListTab === "已发" ? "还没有已发文章" : "还没有草稿"}</b>
                    <span>
                      {articleListTab === "已发" ? "在选题池将文章设为已发布后，会同步显示在这里。" : "从选题创建空白稿直接写作，或根据已有资料创建待写文章。"}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {regenerateDialog && (
          <div className="confirm-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) setRegenerateDialog(null); }}>
            <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="regenerate-title" style={{ maxWidth: 620, width: "calc(100vw - 32px)" }}>
              <div className="confirm-copy">
                <h3 id="regenerate-title">选择生成范围</h3>
                <p>生成内容时会结合选题与资料，为各渠道创作标题。提交后立即清空勾选部分的旧内容或图片，再重新生成；未勾选部分保留。各渠道独立研究撰写。封面和插图独立生成，可分别勾选。机制关系与证据图优先Manim，照片场景用GPT Image，纯文字卡本地排版；Manim代码设计仍消耗文本token。视频渠道先生成口播稿和摘要，勾选视频后由DSH读取文章与研究资料、加载ManimGL技能、设计并生成动画代码，再试渲染与修复；视频封面由GPT Image生成，并作为视频首帧。</p>
                {contentChannels.map(channel => (
                  <fieldset key={channel} disabled={busy} style={{ margin: "16px 0", padding: 12, border: "1px solid #e5e5e5", borderRadius: 8 }}>
                    <legend><label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" aria-label={`全选${channelLabel(channel)}`} checked={Boolean(regenerateSelections[channel]?.content && regenerateSelections[channel]?.cover && regenerateSelections[channel]?.images)} ref={element => { if (element) { const value = regenerateSelections[channel]; const count = Number(Boolean(value?.content)) + Number(Boolean(value?.cover)) + Number(Boolean(value?.images)); element.indeterminate = count > 0 && count < 3; } }} onChange={event => { const selected = event.target.checked; setRegenerateSelections(current => ({ ...current, [channel]: { content: selected, cover: selected, images: selected } })); }} />
                      {channelLabel(channel)} · 全选
                    </label></legend>
                    <div style={{ display: "flex", gap: 24 }}>
                      {([ ["content", "内容"], ["cover", "封面"], ["images", "插图"] ] as const).map(([key, label]) => (
                        <label key={key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={regenerateSelections[channel]?.[key] ?? false} onChange={event => setRegenerateSelections(current => ({ ...current, [channel]: { content: false, cover: false, images: false, ...current[channel], [key]: event.target.checked } }))} />
                          {channel === "video" && key === "images" ? "视频（ManimGL）" : label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="confirm-actions">
                <button className="button outline" disabled={busy} onClick={() => setRegenerateDialog(null)}>取消</button>
                <button className="button primary" disabled={busy || !Object.values(regenerateSelections).some(value => value && (value.content || value.cover || value.images))} onClick={() => void submitRegeneration()}>{busy ? "提交中…" : "生成所选内容"}</button>
              </div>
            </div>
          </div>
        )}
        {confirmDialog && (
          <div
            className="confirm-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) settleConfirm(false);
            }}
          >
            <div
              className={`confirm-dialog ${confirmDialog.tone === "danger" ? "danger" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`confirm-title-${confirmDialog.id}`}
              aria-describedby={`confirm-message-${confirmDialog.id}`}
            >
              <div className="confirm-icon">
                {confirmDialog.tone === "danger" ? (
                  <Trash2 size={18} />
                ) : (
                  <CircleHelp size={18} />
                )}
              </div>
              <div className="confirm-copy">
                <span className="eyebrow muted-label">PLEASE CONFIRM</span>
                <h3 id={`confirm-title-${confirmDialog.id}`}>
                  {confirmDialog.title}
                </h3>
                <p id={`confirm-message-${confirmDialog.id}`}>
                  {confirmDialog.message}
                </p>
              </div>
              <div className="confirm-actions">
                <button
                  className="button outline"
                  autoFocus
                  onClick={() => settleConfirm(false)}
                >
                  {confirmDialog.cancelLabel || "取消"}
                </button>
                <button
                  className={`button ${
                    confirmDialog.tone === "danger" ? "danger" : "primary"
                  }`}
                  onClick={() => settleConfirm(true)}
                >
                  {confirmDialog.confirmLabel || "确认"}
                </button>
              </div>
            </div>
          </div>
        )}
        <footer className="footer">
          <span>© 熵衍之墨 · draft studio</span>
          <span>
            <i className="green-dot" />
            只在本机存储 · 不自动发布
          </span>
        </footer>
      </main>
    </div>
  );
}

function PipelineStep({
  number,
  title,
  detail,
  count,
  active,
  onClick,
  icon,
}: {
  number: string;
  title: string;
  detail: string;
  count: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      className={`pipeline-step ${active ? "has-items" : ""}`}
      onClick={onClick}
    >
      <div className="step-top">
        <span>{number}</span>
        <div className="step-icon">{icon}</div>
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      <small>
        {count}
        <ChevronRight size={12} />
      </small>
    </button>
  );
}
function draftActivity(draft: Draft): {
  text: string;
  tone: "running" | "failed" | "complete";
} {
  if (draft.videoRun?.status === "运行中") return { text: `视频渲染中 · ${draft.videoRun.stage}`, tone: "running" as const };
  if (draft.videoRun?.status === "失败" && draft.channel === "video") return { text: `视频生成失败 · ${draft.videoRun.error || "可重试"}`, tone: "failed" as const };
  if (draft.generationRun?.status === "运行中")
    return {
      text: `${channelLabel(draft.channel)} · 文案生成中 · ${draft.generationRun.stage}`,
      tone: "running",
    };
  if (draft.visualRun?.status === "运行中")
    return {
      text: `${channelLabel(draft.channel)} · 配图生成中 · ${draft.visualRun.stage}`,
      tone: "running",
    };
  if (draft.generationRun?.status === "失败")
    return {
      text: `${channelLabel(draft.channel)} · 文案生成失败 · ${draft.generationRun.error || "请稍后重试"}`,
      tone: "failed",
    };
  if (draft.visualRun?.status === "失败")
    return {
      text: `${channelLabel(draft.channel)} · 配图生成失败 · ${draft.visualRun.error || "可进入草稿重试"}`,
      tone: "failed",
    };
  return {
    text: `${channelLabel(draft.channel)} · ${
      draft.creativeBrief.shareLine ||
      (draft.visualRun?.status === "完成"
        ? "正文与视觉组已生成"
        : `${draft.generation} · 待补创作卡`)
    }`,
    tone: "complete",
  };
}
function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
  wide = false,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`page-title ${wide ? "page-title-wide" : ""}`}>
      <div>
        <span className="eyebrow muted-label">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  copyValue,
}: {
  label: string;
  children: React.ReactNode;
  copyValue?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {copyValue !== undefined && (
          <CopyButton value={copyValue} label={label} />
        )}
      </span>
      {children}
    </label>
  );
}
function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <div className="brief-field">
      <span className="brief-field-label">
        {label}
        <CopyButton value={value} label={label} />
      </span>
      <p className={value ? "" : "empty"}>{value || "等待系统生成"}</p>
    </div>
  );
}
function StoryView({
  code,
  title,
  value,
}: {
  code: string;
  title: string;
  value: string;
}) {
  return (
    <div className="story-view">
      <span className="story-code">{code}</span>
      <span className="story-title">
        {title}
        <CopyButton value={value} label={`${code} · ${title}`} />
      </span>
      <p className={value ? "" : "empty"}>{value || "等待系统生成"}</p>
    </div>
  );
}
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  if (!value.trim()) return null;
  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  }
  return (
    <button
      type="button"
      className={`copy-field-button ${copied ? "copied" : ""}`}
      aria-label={`复制${label}`}
      title={copied ? "已复制" : `复制${label}`}
      onClick={(event) => void copy(event)}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  );
}
function visualKindLabel(kind: Draft["images"][number]["kind"]): string {
  if (kind === "slide") return "编辑卡片";
  if (kind === "chart") return "数据卡";
  return "AI 插画";
}
function CollectionProgress({
  run,
  sites,
  now,
  stopping,
  onStop,
}: {
  run: Workspace["runs"][number];
  sites: Workspace["sites"];
  now: number;
  stopping: boolean;
  onStop: () => void;
}) {
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(run.startedAt)) / 1000),
  );
  const duration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const totalSources = run.totalSources ?? run.siteCount ?? sites.length;
  const checkedSources = Math.min(
    totalSources,
    Math.max(
      run.checkedSources ?? 0,
      Math.min(totalSources, run.searchCalls ?? 0),
    ),
  );
  const fetchCalls = run.fetchCalls ?? 0;
  const stage = run.stage || "";
  const inStructuring = /结构化|事实|图谱|生成选题|校验/.test(stage);
  const inReading = /读取|原文|候选|处理/.test(stage);
  const percent =
    run.status === "完成"
      ? 100
      : inStructuring
        ? 84
        : inReading
          ? Math.min(
              72,
              Math.max(
                12,
                Math.round(
                  (totalSources ? checkedSources / totalSources : 0) * 62 +
                    10,
                ),
              ),
            )
      : Math.min(
          78,
          Math.max(
            2,
            Math.round(
              totalSources
                ? (checkedSources / totalSources) * 78 +
                    Math.min(fetchCalls, 8) * 2
                : fetchCalls * 3,
            ),
          ),
        );
  return (
    <div className="collection-progress" aria-live="polite">
      <div className="collection-progress-head">
        <span className="collecting-pulse">
          <LoaderCircle className="spin" size={14} />
        </span>
        <div>
          <b>{run.stage || "正在收集资料"}</b>
          <small>
            已运行 {duration} · 已处理 {checkedSources}/{totalSources} 个任务 ·
            每 2 秒更新
          </small>
        </div>
        <span className="collection-percent">{percent}%</span>
        <button
          type="button"
          className="collection-stop"
          disabled={stopping}
          onClick={onStop}
        >
          {stopping ? (
            <LoaderCircle className="spin" size={12} />
          ) : (
            <Square size={11} />
          )}
          {stopping ? "正在停止" : "停止收集"}
        </button>
      </div>
      <div
        className="collection-track"
        role="progressbar"
        aria-label="采集进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="collection-counts">
        <span>
          处理进度{" "}
          <b>
            {checkedSources}/{totalSources}
          </b>
        </span>
        <span>
          发现候选 <b>{run.found}</b>
        </span>
        <span>
          读取尝试 <b>{fetchCalls}</b>
        </span>
        <span>
          本地原文 <b>{run.contentCount ?? 0}</b>
        </span>
        <span>
          读取失败 <b>{run.fetchFailed ?? 0}</b>
        </span>
        <span>
          新归档 <b>{run.archived}</b>
        </span>
      </div>
      <div className="collection-sites">
        {sites.slice(0, 6).map((site) => (
          <span key={site.id}>{site.name}</span>
        ))}
        {sites.length > 6 && <span>等 {sites.length} 个信源</span>}
      </div>
    </div>
  );
}
