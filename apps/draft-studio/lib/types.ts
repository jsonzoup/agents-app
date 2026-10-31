import type { GenerationWorkflow } from "./generation-flow";
export type Direction =
  | "商业化"
  | "科研"
  | "AI 产品"
  | "AI 新趋势"
  | "AI 边界"
  | "AI 人文视角"
  | "学术前沿";
export type ContentChannel = "xiaohongshu" | "wechat" | "wechat_card" | "toutiao" | "video";
export type VisualThemeId =
  | "forest"
  | "cobalt"
  | "terracotta"
  | "aubergine"
  | "ocean"
  | "ink"
  | "sand";
export type TopicMix = Record<Direction, number>;
export type SiteCategory =
  | "公司研究"
  | "论文预印本"
  | "学术会议"
  | "学术机构"
  | "期刊"
  | "新闻商业"
  | "中国机构";
export type SourceSite = {
  id: string;
  name: string;
  url: string;
  category: SiteCategory;
  direction: Direction;
  enabled: boolean;
  query: string;
  maxArticles: number;
  evergreen?: boolean;
};
export type Source = {
  id: string;
  title: string;
  kind: "资料摘录" | "AI事件观察" | "候选链接";
  eventDate: string;
  url: string;
  publisher: string;
  publishedAt: string;
  capturedAt: string;
  direction: Direction;
  excerpt: string;
  facts: string;
  interpretation: string;
  unknowns: string;
  summary?: string;
  category?: string;
  verification: "待核实" | "已核对";
  fileName?: string;
  contentFile?: string;
  contentFetchedAt?: string;
  contentReader?: "direct" | "jina";
  collectionRunId?: string;
  sourceSiteId?: string;
  evergreen?: boolean;
  knowledgePluginId?: "weknora";
  externalKnowledgeId?: string;
  externalKnowledgeBase?: string;
  externalKnowledgeBaseId?: string;
  externalSyncedAt?: string;
  importedAt?: string;
};
export type Topic = {
  id: string;
  title: string;
  direction: Direction;
  thesis: string;
  readerValue: string;
  sourceIds: string[];
  status: "待评估" | "准备写作" | "暂缓" | "已发布";
  createdAt: string;
  generated?: boolean;
};
export type CreativeBrief = {
  commonBelief: string;
  counterAngle: string;
  emotionalArc: string;
  readerMirror: string;
  sceneAnchor: string;
  voiceAnchor: string;
  opening: string;
  development: string;
  turn: string;
  landing: string;
  shareLine: string;
};
export type DraftImage = {
  id: string;
  kind?: "illustration" | "slide" | "chart";
  role: string;
  title: string;
  prompt: string;
  promptTemplateId?: string;
  promptTemplateName?: string;
  promptTemplateSource?: string;
  promptSpec?: DraftPromptSpec;
  fileName: string;
  createdAt: string;
  notice?: string;
  origin?: "ai" | "derived" | "upload";
};
export type { GenerationWorkflow } from "./generation-flow";
export type DraftVisualRun = {
  workflow?: GenerationWorkflow;
  status: "运行中" | "完成" | "失败";
  stage: string;
  startedAt: string;
  finishedAt?: string;
  completed: number;
  total: number;
  error?: string;
};
export type DraftGenerationRun = {
  workflow?: GenerationWorkflow;
  status: "运行中" | "完成" | "失败";
  stage: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};
export type WechatDraftRun = {
  status: "已创建" | "失败";
  mediaId?: string;
  createdAt: string;
  error?: string;
};
export type CopilotTarget = "auto" | "title" | "body" | "image";
export type CopilotMention = {
  id: string;
  label: string;
};
export type CopilotToolEvent = {
  id: string;
  action: "get_context" | "research_article" | "replace_title" | "replace_body" | "regenerate_visuals";
  status: "运行中" | "完成" | "失败";
  createdAt: string;
  finishedAt?: string;
  detail?: string;
};
export type DraftPromptSpec = {
  templateId: string;
  templateName: string;
  subject: string;
  composition: string;
  visualStyle: string;
  textPolicy: string;
  aspectRatio: string;
  constraints: string;
};
export type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  target: CopilotTarget;
  status: "运行中" | "完成" | "失败";
  createdAt: string;
  mentions: CopilotMention[];
  tool?: "replace_title" | "replace_body" | "regenerate_visuals" | "multiple";
  toolEvents?: CopilotToolEvent[];
};
export type DraftVariant = {
  title: string;
  coverTitle: string;
  body: string;
  audience: string;
  readerValue: string;
  wechatAuthor: string;
  wechatSummary: string;
  tags: string;
  visualBrief: string;
  paperQuestion: string;
  paperMethod: string;
  paperFindings: string;
  paperLimits: string;
  knowledgeContext: string;
  creativeBrief: CreativeBrief;
  generation: "模板" | "DeepSeek";
  images: DraftImage[];
  imagePlacements: Record<string, number>;
  wechatCover?: DraftImage;
  wechatCoverImageId?: string;
  wechatDraft?: WechatDraftRun;
  visualStyleGuide?: string;
  imagePromptTemplateId?: string;
  imagePrompt?: string;
  imageFile?: string;
  updatedAt: string;
};
export type DraftVideo = {
  audio?: boolean;
  projectFile?: string;
  engine?: "dsh-manim";
  style?: string;
  contextDigest?: string;
  fileName: string;
  subtitleFile: string;
  planFile: string;
  sourceText: string;
  duration: number;
  createdAt: string;
};
export type Draft = {
  video?: DraftVideo;
  videoRun?: DraftGenerationRun;
  id: string;
  topicId: string;
  channel: ContentChannel;
  title: string;
  coverTitle: string;
  body: string;
  audience: string;
  readerValue: string;
  wechatAuthor: string;
  wechatSummary: string;
  sources: string;
  tags: string;
  visualBrief: string;
  paperQuestion: string;
  paperMethod: string;
  paperFindings: string;
  paperLimits: string;
  knowledgeContext?: string;
  creativeBrief: CreativeBrief;
  checklist: string[];
  updatedAt: string;
  generation: "模板" | "DeepSeek";
  images: DraftImage[];
  channelVariants: Partial<Record<ContentChannel, DraftVariant>>;
  copilotMessages: CopilotMessage[];
  imagePlacements: Record<string, number>;
  wechatCover?: DraftImage;
  wechatCoverImageId?: string;
  wechatDraft?: WechatDraftRun;
  generationRun?: DraftGenerationRun;
  visualStyleGuide?: string;
  imagePromptTemplateId?: string;
  visualRun?: DraftVisualRun;
  imagePrompt?: string;
  imageFile?: string;
  visualThemeId?: VisualThemeId;
};
export type CollectionRun = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "运行中" | "完成" | "失败" | "已停止";
  stage?: string;
  siteCount?: number;
  totalSources?: number;
  checkedSources?: number;
  currentSite?: string;
  searchCalls?: number;
  fetchCalls?: number;
  fetchFailed?: number;
  contentCount?: number;
  found: number;
  archived: number;
  skippedRecent?: number;
  skippedDuplicate?: number;
  error?: string;
};
export type TopicRun = {
  id: string;
  request?: string;
  searchCalls?: number;
  fetchCalls?: number;
  warnings?: string[];
  startedAt: string;
  finishedAt?: string;
  status: "运行中" | "完成" | "失败";
  requestedCount: number;
  createdTopicIds: string[];
  stage?: string;
  sourceCount?: number;
  completedSourceCount?: number;
  error?: string;
};
export type KnowledgeEntity = {
  id: string;
  name: string;
  type: string;
  summary: string;
  sourceIds: string[];
  updatedAt: string;
};
export type KnowledgeRelation = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  sourceIds: string[];
};
export type KnowledgeSourceHit = {
  id: string;
  title: string;
  url: string;
  summary: string;
  category: string;
};
export type KnowledgeEntityHit = {
  id: string;
  name: string;
  type: string;
  summary: string;
  sourceCount: number;
  degree: number;
  sources: KnowledgeSourceHit[];
};
export type KnowledgeRelationHit = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  predicate: string;
  explanation: string;
};
export type KnowledgeGraphResult = {
  engine: "Kuzu";
  version: string;
  indexedAt: string;
  query: string;
  counts: {
    sources: number;
    structuredSources: number;
    entities: number;
    relations: number;
    topics: number;
    mentions: number;
  };
  normalization: {
    rawEntities: number;
    canonicalEntities: number;
    rawRelations: number;
    canonicalRelations: number;
    entityTypes: Array<{ type: string; count: number }>;
    sourceCategories: Array<{ category: string; count: number }>;
  };
  sources: KnowledgeSourceHit[];
  entities: KnowledgeEntityHit[];
  relations: KnowledgeRelationHit[];
};
export type KnowledgePluginId = "kuzu-local" | "weknora";
export type KnowledgePluginStatus = {
  id: KnowledgePluginId;
  label: string;
  description: string;
  configured: boolean;
  enabled: boolean;
  mode: string;
  detail: string;
  capabilities: string[];
  sourceUrl?: string;
};
export type KnowledgeSearchHit = {
  id: string;
  pluginId: KnowledgePluginId;
  pluginLabel: string;
  title: string;
  excerpt: string;
  score?: number;
  documentId?: string;
  knowledgeBase?: string;
  url?: string;
  sourceIds?: string[];
};
export type KnowledgePluginSearchResult = {
  query: string;
  hits: KnowledgeSearchHit[];
  searchedPlugins: KnowledgePluginId[];
  warnings: string[];
};
export type WorkspaceSettings = {
  frequencyHours: number;
  topicsPerRun: number;
  topicMix: TopicMix;
  autoCollect: boolean;
  lastScheduledAt?: string;
};
export type Workspace = {
  version?: 2;
  sources: Source[];
  topics: Topic[];
  drafts: Draft[];
  sites: SourceSite[];
  runs: CollectionRun[];
  topicRuns: TopicRun[];
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  settings: WorkspaceSettings;
};
