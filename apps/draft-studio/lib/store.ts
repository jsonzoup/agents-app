import { xiaohongshuPlainText } from "./channel-text";
import { channelLabel } from "./wechat";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { Direction, Workspace, SourceSite } from "./types";
import { blankCreativeBrief } from "./editorial";
import {
  normalizeKnowledgeCategory,
  summarizeKnowledge,
} from "./knowledge-model";
import { defaultTopicMix, directions } from "./topics";

export const home = path.resolve(
  process.env.DRAFT_STUDIO_HOME?.trim() || path.join(os.homedir(), "xhs-home"),
);
const dbPath = path.join(home, "workspace.json");
let queue: Promise<unknown> = Promise.resolve();
let boot: Promise<void> | undefined;

const legacyDirections: Record<string, Direction> = {
  原理: "科研",
  商业: "商业化",
  产品: "AI 产品",
  "前沿理论 / 论文": "学术前沿",
  "AI 人文观察": "AI 人文视角",
};
const legacyDirectionNames = new Set(Object.keys(legacyDirections));
const direction = z.preprocess(
  (value) =>
    typeof value === "string" ? (legacyDirections[value] ?? value) : value,
  z.enum(directions),
);
const topicMixSchema = z
  .object({
    商业化: z.number().min(0).max(100).default(defaultTopicMix.商业化),
    科研: z.number().min(0).max(100).default(defaultTopicMix.科研),
    "AI 产品": z.number().min(0).max(100).default(defaultTopicMix["AI 产品"]),
    "AI 新趋势": z
      .number()
      .min(0)
      .max(100)
      .default(defaultTopicMix["AI 新趋势"]),
    "AI 边界": z.number().min(0).max(100).default(defaultTopicMix["AI 边界"]),
    "AI 人文视角": z
      .number()
      .min(0)
      .max(100)
      .default(defaultTopicMix["AI 人文视角"]),
    学术前沿: z.number().min(0).max(100).default(defaultTopicMix.学术前沿),
  })
  .default(defaultTopicMix);
const defaultSites: SourceSite[] = [
  [
    "openai",
    "OpenAI 官方动态",
    "https://openai.com/news/",
    "公司研究",
    "AI 新趋势",
    "OpenAI company product announcement partnership enterprise pricing safety news",
  ],
  [
    "anthropic",
    "Anthropic 官方动态",
    "https://www.anthropic.com/news",
    "公司研究",
    "AI 新趋势",
    "Anthropic company product announcement partnership enterprise pricing safety news",
  ],
  [
    "deepmind",
    "Google DeepMind",
    "https://deepmind.google/discover/blog/",
    "公司研究",
    "科研",
    "Google DeepMind AI research latest",
  ],
  [
    "meta",
    "AI at Meta",
    "https://ai.meta.com/blog/",
    "公司研究",
    "AI 产品",
    "Meta AI research models product",
  ],
  [
    "nvidia",
    "NVIDIA 官方动态",
    "https://nvidianews.nvidia.com/",
    "公司研究",
    "商业化",
    "NVIDIA AI enterprise customers partnership data center earnings news",
  ],
  [
    "microsoft",
    "Microsoft Research",
    "https://www.microsoft.com/en-us/research/blog/",
    "公司研究",
    "科研",
    "Microsoft Research artificial intelligence",
  ],
  [
    "google-research",
    "Google Research",
    "https://research.google/blog/",
    "公司研究",
    "科研",
    "Google Research AI machine learning latest",
  ],
  [
    "hf-papers",
    "Hugging Face Papers",
    "https://huggingface.co/papers",
    "论文预印本",
    "学术前沿",
    "Hugging Face trending AI research papers",
  ],
  [
    "arxiv",
    "arXiv cs.AI",
    "https://arxiv.org/list/cs.AI/recent",
    "论文预印本",
    "学术前沿",
    "site:arxiv.org AI machine learning language model paper",
  ],
  [
    "acl",
    "ACL Anthology",
    "https://aclanthology.org/",
    "学术会议",
    "学术前沿",
    "ACL Anthology NLP large language model papers",
  ],
  [
    "neurips",
    "NeurIPS",
    "https://neurips.cc/",
    "学术会议",
    "学术前沿",
    "NeurIPS AI research papers",
  ],
  [
    "icml",
    "ICML",
    "https://icml.cc/",
    "学术会议",
    "学术前沿",
    "ICML machine learning research conference",
  ],
  [
    "iclr",
    "ICLR",
    "https://iclr.cc/",
    "学术会议",
    "学术前沿",
    "ICLR representation learning papers",
  ],
  [
    "aaai",
    "AAAI",
    "https://aaai.org/",
    "学术会议",
    "学术前沿",
    "AAAI artificial intelligence conference research",
  ],
  [
    "nature",
    "Nature Machine Intelligence",
    "https://www.nature.com/natmachintell/",
    "期刊",
    "学术前沿",
    "Nature Machine Intelligence research",
  ],
  [
    "hai",
    "Stanford HAI",
    "https://hai.stanford.edu/news",
    "学术机构",
    "AI 边界",
    "Stanford HAI AI policy industry research",
  ],
  [
    "mit",
    "MIT CSAIL",
    "https://www.csail.mit.edu/news",
    "学术机构",
    "学术前沿",
    "MIT CSAIL AI research news",
  ],
  [
    "stanford-cs229",
    "Stanford CS229 公开课程",
    "https://cs229.stanford.edu/",
    "学术机构",
    "科研",
    "site:cs229.stanford.edu lecture notes machine learning course transcript",
  ],
  [
    "harvard-cs50ai",
    "Harvard CS50 AI 公开课程",
    "https://cs50.harvard.edu/ai/",
    "学术机构",
    "科研",
    "site:cs50.harvard.edu/ai/ lecture notes artificial intelligence course",
  ],
  [
    "deeplearning-ai",
    "吴恩达 DeepLearning.AI 课程",
    "https://www.deeplearning.ai/courses/",
    "学术机构",
    "科研",
    "site:deeplearning.ai course notes transcript machine learning deep learning Andrew Ng",
  ],
  [
    "baai",
    "北京智源研究院",
    "https://www.baai.ac.cn/",
    "中国机构",
    "科研",
    "智源研究院 人工智能 研究",
  ],
  [
    "pku",
    "北大人工智能研究院",
    "https://www.ai.pku.edu.cn/",
    "中国机构",
    "科研",
    "北京大学 人工智能研究院",
  ],
  [
    "reuters",
    "Reuters Technology",
    "https://www.reuters.com/technology/",
    "新闻商业",
    "商业化",
    "OpenAI Anthropic Google DeepMind Microsoft Meta NVIDIA AI funding acquisition partnership pricing enterprise news",
  ],
  [
    "ft",
    "Financial Times Technology",
    "https://www.ft.com/technology",
    "新闻商业",
    "商业化",
    "OpenAI Anthropic Google DeepMind Microsoft Meta NVIDIA AI industry business funding pricing",
  ],
  [
    "mit-tr",
    "MIT Technology Review",
    "https://www.technologyreview.com/topic/artificial-intelligence/",
    "新闻商业",
    "AI 新趋势",
    "MIT Technology Review artificial intelligence",
  ],
  [
    "techcrunch-ai",
    "TechCrunch AI",
    "https://techcrunch.com/category/emerging-tech/artificial-intelligence/",
    "新闻商业",
    "商业化",
    "AI leading companies startups funding acquisition product launch enterprise partnership",
  ],
  [
    "bloomberg-tech",
    "Bloomberg Technology",
    "https://www.bloomberg.com/technology/",
    "新闻商业",
    "商业化",
    "OpenAI Anthropic Google DeepMind Microsoft Meta NVIDIA AI business investment deal",
  ],
  [
    "wired-ai",
    "WIRED AI",
    "https://www.wired.com/category/business/artificial-intelligence/",
    "新闻商业",
    "AI 新趋势",
    "WIRED artificial intelligence technology business culture",
  ],
  [
    "verge-ai",
    "The Verge AI",
    "https://www.theverge.com/ai-artificial-intelligence",
    "新闻商业",
    "AI 产品",
    "The Verge AI technology products companies policy",
  ],
  [
    "cnbc-tech",
    "CNBC Technology",
    "https://www.cnbc.com/technology/",
    "新闻商业",
    "商业化",
    "OpenAI Anthropic Google Microsoft Meta NVIDIA AI earnings investment enterprise partnership",
  ],
  [
    "ap-ai",
    "AP Artificial Intelligence",
    "https://apnews.com/hub/artificial-intelligence",
    "新闻商业",
    "AI 边界",
    "Associated Press artificial intelligence business technology policy",
  ],
].map(
  ([id, name, url, category, dir, query]) =>
    ({
      id,
      name,
      url,
      category,
      direction: dir,
      query,
      maxArticles: 10,
      enabled: true,
      evergreen: [
        "stanford-cs229",
        "harvard-cs50ai",
        "deeplearning-ai",
      ].includes(id),
    }) as SourceSite,
);
const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["资料摘录", "AI事件观察", "候选链接"]).default("资料摘录"),
  eventDate: z.string().default(""),
  url: z.string(),
  publisher: z.string(),
  publishedAt: z.string(),
  capturedAt: z.string(),
  direction,
  excerpt: z.string(),
  facts: z.string(),
  interpretation: z.string(),
  unknowns: z.string(),
  summary: z.string().default(""),
  category: z.string().default(""),
  verification: z.enum(["待核实", "已核对"]),
  fileName: z.string().optional(),
  contentFile: z.string().optional(),
  contentFetchedAt: z.string().optional(),
  contentReader: z.enum(["direct", "jina"]).optional(),
  collectionRunId: z.string().optional(),
  sourceSiteId: z.string().optional(),
  evergreen: z.boolean().optional(),
  knowledgePluginId: z.literal("weknora").optional(),
  externalKnowledgeId: z.string().optional(),
  externalKnowledgeBase: z.string().optional(),
  externalKnowledgeBaseId: z.string().optional(),
  externalSyncedAt: z.string().optional(),
  importedAt: z.string().optional(),
});
const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  direction,
  thesis: z.string(),
  readerValue: z.string(),
  sourceIds: z.array(z.string()),
  status: z.enum(["待评估", "准备写作", "暂缓", "已发布"]),
  createdAt: z.string(),
  generated: z.boolean().optional(),
});
const videoRunSchema = z.object({
  status: z.enum(["运行中", "完成", "失败"]), stage: z.string(), startedAt: z.string(), finishedAt: z.string().optional(), error: z.string().optional(),
});
const videoSchema = z.object({
  audio: z.boolean().optional(),
  projectFile: z.string().regex(/^video_[0-9a-f-]{36}\.zip$/i).optional(),
  engine: z.literal("dsh-manim").optional(),
  style: z.string().optional(), contextDigest: z.string().optional(),
  fileName: z.string().regex(/^video_[0-9a-f-]{36}\.mp4$/i),
  subtitleFile: z.string().regex(/^video_[0-9a-f-]{36}\.srt$/i),
  planFile: z.string().regex(/^video_[0-9a-f-]{36}\.json$/i),
  sourceText: z.string(), duration: z.number().positive(), createdAt: z.string(),
});
const draftVariantSchema = z.object({
  title: z.string().default(""),
  coverTitle: z.string().default(""),
  body: z.string().default(""),
  audience: z.string().default(""),
  readerValue: z.string().default(""),
  wechatAuthor: z.string().default(""),
  wechatSummary: z.string().default(""),
  tags: z.string().default(""),
  visualBrief: z.string().default(""),
  paperQuestion: z.string().default(""),
  paperMethod: z.string().default(""),
  paperFindings: z.string().default(""),
  paperLimits: z.string().default(""),
  knowledgeContext: z.string().default(""),
  creativeBrief: z
    .object({
      commonBelief: z.string().default(""),
      counterAngle: z.string().default(""),
      emotionalArc: z.string().default(""),
      readerMirror: z.string().default(""),
      sceneAnchor: z.string().default(""),
      voiceAnchor: z.string().default(""),
      opening: z.string().default(""),
      development: z.string().default(""),
      turn: z.string().default(""),
      landing: z.string().default(""),
      shareLine: z.string().default(""),
    })
    .default(blankCreativeBrief),
  generation: z.enum(["模板", "DeepSeek"]).default("模板"),
  images: z
    .array(
      z.object({
        id: z.string(),
        kind: z
          .enum(["illustration", "slide", "chart"])
          .default("illustration"),
        role: z.string(),
        title: z.string(),
        prompt: z.string(),
        promptTemplateId: z.string().optional(),
        promptTemplateName: z.string().optional(),
        promptTemplateSource: z.string().optional(),
        promptSpec: z
          .object({
            templateId: z.string(),
            templateName: z.string(),
            subject: z.string(),
            composition: z.string(),
            visualStyle: z.string(),
            textPolicy: z.string(),
            aspectRatio: z.string(),
            constraints: z.string(),
          })
          .optional(),
        fileName: z.string(),
        createdAt: z.string(),
        notice: z.string().optional(),
        origin: z.enum(["ai", "derived", "upload"]).optional(),
      }),
    )
    .default([]),
  imagePlacements: z.record(z.string(), z.number().int().min(0)).default({}),
  wechatCover: z
    .object({
      id: z.string(),
      kind: z.enum(["illustration", "slide", "chart"]).default("slide"),
      role: z.string(),
      title: z.string(),
      prompt: z.string(),
      promptTemplateId: z.string().optional(),
      promptTemplateName: z.string().optional(),
      promptTemplateSource: z.string().optional(),
      fileName: z.string(),
      createdAt: z.string(),
      notice: z.string().optional(),
      origin: z.enum(["ai", "derived", "upload"]).optional(),
    })
    .optional(),
  wechatCoverImageId: z.string().optional(),
  wechatDraft: z
    .object({
      status: z.enum(["已创建", "失败"]),
      mediaId: z.string().optional(),
      createdAt: z.string(),
      error: z.string().optional(),
    })
    .optional(),
  visualStyleGuide: z.string().optional(),
  imagePromptTemplateId: z.string().optional(),
  imagePrompt: z.string().optional(),
  imageFile: z.string().optional(),
  updatedAt: z.string(),
});
const draftSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  video: videoSchema.optional(),
  videoRun: videoRunSchema.optional(),
  channel: z.enum(["xiaohongshu", "wechat", "wechat_card", "toutiao", "video"]).default("xiaohongshu"),
  title: z.string(),
  coverTitle: z.string(),
  body: z.string(),
  audience: z.string(),
  readerValue: z.string(),
  wechatAuthor: z.string().default(""),
  wechatSummary: z.string().default(""),
  sources: z.string(),
  tags: z.string(),
  visualBrief: z.string(),
  paperQuestion: z.string(),
  paperMethod: z.string(),
  paperFindings: z.string(),
  paperLimits: z.string(),
  knowledgeContext: z.string().default(""),
  creativeBrief: z
    .object({
      commonBelief: z.string().default(""),
      counterAngle: z.string().default(""),
      emotionalArc: z.string().default(""),
      readerMirror: z.string().default(""),
      sceneAnchor: z.string().default(""),
      voiceAnchor: z.string().default(""),
      opening: z.string().default(""),
      development: z.string().default(""),
      turn: z.string().default(""),
      landing: z.string().default(""),
      shareLine: z.string().default(""),
    })
    .default(blankCreativeBrief),
  checklist: z.array(z.string()),
  updatedAt: z.string(),
  generation: z.enum(["模板", "DeepSeek"]),
  generationRun: z
    .object({
      status: z.enum(["运行中", "完成", "失败"]),
      stage: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  images: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["illustration", "slide", "chart"]).default("illustration"),
        role: z.string(),
        title: z.string(),
        prompt: z.string(),
        promptTemplateId: z.string().optional(),
        promptTemplateName: z.string().optional(),
        promptTemplateSource: z.string().optional(),
        promptSpec: z
          .object({
            templateId: z.string(),
            templateName: z.string(),
            subject: z.string(),
            composition: z.string(),
            visualStyle: z.string(),
            textPolicy: z.string(),
            aspectRatio: z.string(),
            constraints: z.string(),
          })
          .optional(),
        fileName: z.string(),
        createdAt: z.string(),
        notice: z.string().optional(),
        origin: z.enum(["ai", "derived", "upload"]).optional(),
      }),
    )
    .default([]),
  channelVariants: z
    .object({
      xiaohongshu: draftVariantSchema.optional(),
      wechat: draftVariantSchema.optional(),
      wechat_card: draftVariantSchema.optional(),
      toutiao: draftVariantSchema.optional(),
      video: draftVariantSchema.optional(),
    })
    .default({}),
  copilotMessages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        text: z.string(),
        reasoning: z.string().optional(),
        target: z.enum(["auto", "title", "body", "image"]),
        status: z.enum(["运行中", "完成", "失败"]),
        createdAt: z.string(),
        mentions: z
          .array(z.object({ id: z.string(), label: z.string() }))
          .default([]),
        tool: z
          .enum(["replace_title", "replace_body", "regenerate_visuals", "multiple"])
          .optional(),
        toolEvents: z
          .array(
            z.object({
              id: z.string(),
              action: z.enum(["get_context", "research_article", "replace_title", "replace_body", "regenerate_visuals"]),
              status: z.enum(["运行中", "完成", "失败"]),
              createdAt: z.string(),
              finishedAt: z.string().optional(),
              detail: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  imagePlacements: z.record(z.string(), z.number().int().min(0)).default({}),
  wechatCover: z
    .object({
      id: z.string(),
      kind: z.enum(["illustration", "slide", "chart"]).default("slide"),
      role: z.string(),
      title: z.string(),
      prompt: z.string(),
      promptTemplateId: z.string().optional(),
      promptTemplateName: z.string().optional(),
      promptTemplateSource: z.string().optional(),
      fileName: z.string(),
      createdAt: z.string(),
      notice: z.string().optional(),
      origin: z.enum(["ai", "derived", "upload"]).optional(),
    })
    .optional(),
  wechatCoverImageId: z.string().optional(),
  wechatDraft: z
    .object({
      status: z.enum(["已创建", "失败"]),
      mediaId: z.string().optional(),
      createdAt: z.string(),
      error: z.string().optional(),
    })
    .optional(),
  visualStyleGuide: z.string().optional(),
  imagePromptTemplateId: z.string().optional(),
  visualRun: z
    .object({
      status: z.enum(["运行中", "完成", "失败"]),
      stage: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
      completed: z.number(),
      total: z.number(),
      error: z.string().optional(),
    })
    .optional(),
  imagePrompt: z.string().optional(),
  imageFile: z.string().optional(),
  visualThemeId: z
    .enum([
      "forest",
      "cobalt",
      "terracotta",
      "aubergine",
      "ocean",
      "ink",
      "sand",
    ])
    .optional(),
});
const workspaceSchema = z.object({
  version: z.literal(2).default(2),
  sources: z.array(sourceSchema),
  topics: z.array(topicSchema),
  drafts: z.array(draftSchema),
  sites: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string(),
        category: z.enum([
          "公司研究",
          "论文预印本",
          "学术会议",
          "学术机构",
          "期刊",
          "新闻商业",
          "中国机构",
        ]),
        direction,
        enabled: z.boolean(),
        query: z.string(),
        maxArticles: z.number().int().min(1).max(50).default(10),
        evergreen: z.boolean().optional(),
      }),
    )
    .default(defaultSites),
  runs: z
    .array(
      z.object({
        id: z.string(),
        startedAt: z.string(),
        finishedAt: z.string().optional(),
        status: z.enum(["运行中", "完成", "失败", "已停止"]),
        stage: z.string().optional(),
        siteCount: z.number().optional(),
        totalSources: z.number().optional(),
        checkedSources: z.number().optional(),
        currentSite: z.string().optional(),
        searchCalls: z.number().optional(),
        fetchCalls: z.number().optional(),
        fetchFailed: z.number().optional(),
        contentCount: z.number().optional(),
        found: z.number(),
        archived: z.number(),
        skippedRecent: z.number().optional(),
        skippedDuplicate: z.number().optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  topicRuns: z
    .array(
      z.object({
        id: z.string(),
        request: z.string().optional(),
        searchCalls: z.number().optional(),
        fetchCalls: z.number().optional(),
        warnings: z.array(z.string()).optional(),
        startedAt: z.string(),
        finishedAt: z.string().optional(),
        status: z.enum(["运行中", "完成", "失败"]),
        requestedCount: z.number(),
        createdTopicIds: z.array(z.string()),
        stage: z.string().optional(),
        sourceCount: z.number().optional(),
        completedSourceCount: z.number().optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  entities: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        summary: z.string(),
        sourceIds: z.array(z.string()),
        updatedAt: z.string(),
      }),
    )
    .default([]),
  relations: z
    .array(
      z.object({
        id: z.string(),
        fromId: z.string(),
        toId: z.string(),
        label: z.string(),
        sourceIds: z.array(z.string()),
      }),
    )
    .default([]),
  settings: z
    .object({
      frequencyHours: z.number().min(1).max(720).default(24),
      topicsPerRun: z.number().min(1).max(30).default(6),
      topicMix: topicMixSchema,
      autoCollect: z.boolean().default(false),
      lastScheduledAt: z.string().optional(),
    })
    .default({
      frequencyHours: 24,
      topicsPerRun: 6,
      topicMix: defaultTopicMix,
      autoCollect: false,
    }),
});

function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function siteForUrl(
  rawUrl: string,
  sites: Workspace["sites"],
): Workspace["sites"][number] | undefined {
  try {
    const candidate = new URL(rawUrl);
    const candidateHost = candidate.hostname
      .replace(/^www\./, "")
      .toLowerCase();
    return sites.find((site) => {
      try {
        const siteHost = new URL(site.url).hostname
          .replace(/^www\./, "")
          .toLowerCase();
        return (
          candidateHost === siteHost ||
          candidateHost.endsWith(`.${siteHost}`)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

export function ensureHome(): Promise<void> {
  boot ??= (async () => {
    for (const dir of [
      "references",
      "archive",
      "topics",
      "drafts",
      "media",
      "exports",
      "skills",
    ]) {
      await mkdir(path.join(home, dir), { recursive: true });
    }
    try {
      await readFile(dbPath, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      await withDiskLock(async () => {
        try {
          await readFile(dbPath, "utf8");
        } catch (missing) {
          if (errorCode(missing) !== "ENOENT") throw missing;
          await writeWorkspaceFile({
            version: 2,
            sources: [],
            topics: [],
            drafts: [],
            sites: defaultSites,
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
          });
        }
      });
    }
  })();
  return boot;
}

async function writeWorkspaceFile(data: Workspace): Promise<void> {
  const temp = `${dbPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, dbPath);
}

async function writeRecord(
  folder: string,
  name: string,
  text: string,
): Promise<void> {
  const root = path.resolve(home, folder);
  const target = path.resolve(root, name);
  if (!target.startsWith(`${root}${path.sep}`))
    throw new Error("镜像文件路径超出本地数据目录。");
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, target);
}

function draftMarkdown(
  draft: Workspace["drafts"][number],
  topic?: Workspace["topics"][number],
): string {
  const brief = draft.creativeBrief;
  const visualSet = draft.images.length
    ? `\n\n## 自动视觉组\n\n${draft.visualStyleGuide ?? ""}\n\n${draft.images.map((image, index) => `${index + 1}. ${image.role}｜${image.title}\n   文件：${image.fileName}\n   提示词：${image.prompt}`).join("\n\n")}`
    : draft.imageFile
      ? `\n\n## 配图\n\n文件：${draft.imageFile}\n提示词：${draft.imagePrompt ?? ""}`
      : "";
  return `# ${draft.title || topic?.title || "内容草稿"}\n\n发布渠道：${channelLabel(draft.channel)}\n方向：${topic?.direction ?? "AI 深度观察"}\n所属选题：${topic?.title ?? "未关联"}\n封面标题：${draft.coverTitle}\n作者：${draft.wechatAuthor}\n摘要：${draft.wechatSummary}\n读者：${draft.audience}\n读者价值：${draft.readerValue}\n\n## 创作卡\n\n默认认知：${brief.commonBelief}\n反常识判断：${brief.counterAngle}\n情绪张力：${brief.emotionalArc}\n读者投射：${brief.readerMirror}\n场景锚点：${brief.sceneAnchor}\n作者态度：${brief.voiceAnchor}\n可截图句：${brief.shareLine}\n\n## 起承转合\n\n起：${brief.opening}\n\n承：${brief.development}\n\n转：${brief.turn}\n\n合：${brief.landing}\n\n## 正文\n\n${draft.body}\n\n## 来源\n\n${draft.sources}\n\n## Kuzu 图谱创作线索\n\n${draft.knowledgeContext || "暂无图谱线索"}\n\n## 标签\n\n${draft.tags}\n\n## 素材企划\n\n${draft.visualBrief}${visualSet}\n\n## 证据与边界\n\n核心问题：${draft.paperQuestion}\n\n证据与机制：${draft.paperMethod}\n\n关键变化：${draft.paperFindings}\n\n边界与反证：${draft.paperLimits}\n\n## 人工自查\n\n${draft.checklist.map((item) => `- [x] ${item}`).join("\n")}\n\n来源生成方式：${draft.generation}\n最后修改：${draft.updatedAt}\n`;
}

async function writeMirrors(data: Workspace): Promise<void> {
  const operations = [
    ...data.sources.map((item) =>
      writeRecord(
        "archive",
        `${item.id}.json`,
        `${JSON.stringify(item, null, 2)}\n`,
      ),
    ),
    ...data.topics.map((item) =>
      writeRecord(
        "topics",
        `${item.id}.json`,
        `${JSON.stringify(item, null, 2)}\n`,
      ),
    ),
    ...data.drafts.map((item) =>
      writeRecord(
        "drafts",
        `${item.id}.md`,
        draftMarkdown(
          item,
          data.topics.find((topic) => topic.id === item.topicId),
        ),
      ),
    ),
  ];
  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === "rejected"))
    console.warn(
      "[draft-studio] Some entity mirror files could not be refreshed; workspace.json remains authoritative.",
    );
}

export async function readWorkspace(): Promise<Workspace> {
  await ensureHome();
  const raw = JSON.parse(await readFile(dbPath, "utf8"));
  if (raw?.version === 1) {
    return withDiskLock(async () => {
      const latest = JSON.parse(await readFile(dbPath, "utf8"));
      if (latest?.version === 1) {
        Object.assign(latest, {
          version: 2,
          sites: defaultSites,
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
        });
      }
      const migrated = workspaceSchema.safeParse(latest);
      if (!migrated.success)
        throw new Error("本地工作区数据格式无效，未覆盖现有文件。");
      if (latest.version === 2 && raw.version === 1)
        await writeWorkspaceFile(migrated.data);
      return migrated.data;
    });
  }
  const rawTopicMix = raw.settings?.topicMix;
  const needsHumanitiesTopicMigration =
    !rawTopicMix ||
    typeof rawTopicMix !== "object" ||
    !("AI 人文视角" in rawTopicMix) ||
    (Object.values(rawTopicMix) as unknown[]).reduce<number>(
      (total, weight) =>
        total +
        (typeof weight === "number" && Number.isFinite(weight) ? weight : 0),
      0,
    ) !== 100;
  const parsed = workspaceSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("本地工作区数据格式无效，未覆盖现有文件。");
  const needsDirectionMigration = [
    raw.sources,
    raw.topics,
    raw.sites,
  ].some(
    (items) =>
      Array.isArray(items) &&
      items.some(
        (item) =>
          item &&
          typeof item === "object" &&
          legacyDirectionNames.has(
            String((item as { direction?: unknown }).direction),
          ),
      ),
  );
  const needsTopicSettingsMigration = !raw.settings?.topicMix;
  const needsKnowledgeMetadataMigration =
    Array.isArray(raw.sources) &&
    raw.sources.some(
      (source: Record<string, unknown>) =>
        source &&
        typeof source === "object" &&
        (!("summary" in source) || !("category" in source)),
    );
  const needsSiteAttribution = parsed.data.sources.some((source) => {
    if (source.kind !== "候选链接" || source.sourceSiteId) return false;
    if (siteForUrl(source.url, parsed.data.sites)) return true;
    try {
      return source.publisher !== new URL(source.url).hostname;
    } catch {
      return false;
    }
  });
  const needsSharedVisualMigration = parsed.data.drafts.some((draft) => {
    if (
      draft.channel === "video" ||
      draft.images.length ||
      draft.imageFile ||
      (!draft.title.trim() && !draft.body.trim())
    )
      return false;
    return Object.values(draft.channelVariants).some(
      (variant) =>
        variant &&
        Boolean(variant.images.length || variant.imageFile),
    );
  });
  const siteIds = new Set(parsed.data.sites.map((site) => site.id));
  if (
    needsDirectionMigration ||
    needsTopicSettingsMigration ||
    needsHumanitiesTopicMigration ||
    needsKnowledgeMetadataMigration ||
    needsSiteAttribution ||
    needsSharedVisualMigration ||
    defaultSites.some(
      (site) =>
        !siteIds.has(site.id) ||
        (site.evergreen &&
          !parsed.data.sites.find((current) => current.id === site.id)
            ?.evergreen),
    )
  ) {
    return updateWorkspace((workspace) => {
      const currentById = new Map(
        workspace.sites.map((site) => [site.id, site]),
      );
      workspace.sites.push(
        ...defaultSites.filter((site) => !currentById.has(site.id)),
      );
      for (const site of defaultSites)
        if (site.evergreen && currentById.has(site.id))
          currentById.get(site.id)!.evergreen = true;
      if (
        needsTopicSettingsMigration &&
        workspace.settings.topicsPerRun === 5
      )
        workspace.settings.topicsPerRun = 6;
      if (needsHumanitiesTopicMigration)
        workspace.settings.topicMix = defaultTopicMix;
      if (needsKnowledgeMetadataMigration)
        for (const source of workspace.sources) {
          source.summary =
            source.summary ||
            summarizeKnowledge(source);
          source.category =
            source.category ||
            normalizeKnowledgeCategory(
              source.category,
              source.direction,
              `${source.title} ${source.facts}`,
            );
        }
      for (const source of workspace.sources) {
        if (source.kind !== "候选链接" || source.sourceSiteId) continue;
        const site = siteForUrl(source.url, workspace.sites);
        if (site) {
          source.sourceSiteId = site.id;
          source.publisher = site.name;
          source.direction = site.direction;
        } else {
          try {
            source.publisher = new URL(source.url).hostname;
          } catch {
            /* Preserve malformed legacy candidates without hiding them. */
          }
        }
      }
      if (needsSharedVisualMigration)
        for (const draft of workspace.drafts) {
          if (
            draft.channel === "video" ||
            draft.images.length ||
            draft.imageFile ||
            (!draft.title.trim() && !draft.body.trim())
          )
            continue;
          const source = Object.values(draft.channelVariants).find(
            (variant) =>
              variant &&
              Boolean(
                variant.images.length ||
                  variant.imageFile,
              ),
          );
          if (!source) continue;
          draft.images = source.images;
          draft.imageFile = source.imageFile;
          draft.imagePrompt = source.imagePrompt;
          draft.wechatCover = draft.wechatCover || source.wechatCover;
          draft.visualStyleGuide = source.visualStyleGuide;
          draft.imagePlacements = {};
          draft.wechatCoverImageId =
            draft.channel === "wechat" ? source.images[0]?.id : undefined;
        }
      return workspace;
    });
  }
  return parsed.data;
}

export async function updateWorkspace<T>(
  fn: (data: Workspace) => T | Promise<T>,
  options: { writeMirrors?: boolean } = {},
): Promise<T> {
  await ensureHome();
  const run = queue.then(() =>
    withDiskLock(async () => {
      const raw = JSON.parse(await readFile(dbPath, "utf8"));
      if (raw?.version === 1)
        Object.assign(raw, {
          version: 2,
          sites: defaultSites,
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
        });
      const parsed = workspaceSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error("本地工作区数据格式无效，拒绝写入。");
      const data = parsed.data;
      const result = await fn(data);
      for (const draft of data.drafts) {
        if (draft.channel === "xiaohongshu") draft.body = xiaohongshuPlainText(draft.body);
        const variant = draft.channelVariants.xiaohongshu;
        if (variant) variant.body = xiaohongshuPlainText(variant.body);
      }
      await writeWorkspaceFile(data);
      if (options.writeMirrors !== false) await writeMirrors(data);
      return result;
    }),
  );
  queue = run.catch(() => undefined);
  return run;
}

async function withDiskLock<T>(work: () => Promise<T>): Promise<T> {
  const lockPath = path.join(home, ".workspace.lock");
  const nonce = crypto.randomUUID();
  const deadline = Date.now() + 10_000;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n${Date.now()}\n${nonce}\n`);
      await handle.close();
      acquired = true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      try {
        const [rawPid, createdAt] = (await readFile(lockPath, "utf8")).split(
          "\n",
        );
        const pid = Number(rawPid);
        let alive = Number.isInteger(pid) && pid > 0;
        if (alive) {
          try {
            process.kill(pid, 0);
          } catch (probe) {
            alive = errorCode(probe) === "EPERM";
          }
        }
        if (!alive && Number(createdAt) < Date.now() - 30_000)
          await unlink(lockPath);
      } catch (readError) {
        if (errorCode(readError) !== "ENOENT") throw readError;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    }
  }
  if (!acquired) throw new Error("工作区正被另一个进程写入，请稍后重试。");
  try {
    return await work();
  } finally {
    try {
      if ((await readFile(lockPath, "utf8")).includes(nonce))
        await unlink(lockPath);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
}

export const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
