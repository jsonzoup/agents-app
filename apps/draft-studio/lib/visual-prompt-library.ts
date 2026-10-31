import { channelVisuals } from "./channel-visuals";
import type { Draft, DraftPromptSpec, Topic } from "./types";

export type ImagePromptTemplate = {
  id: string;
  label: string;
  category: string;
  styles: string[];
  scenes: string[];
  tags: string[];
  description: string;
  guidance: string[];
  pitfalls: string[];
  exampleCases: number[];
};

const repository = "https://github.com/freestylefly/awesome-gpt-image-2";

export const visualPromptLibraryInfo = {
  name: "GPT-Image2 Style Library",
  version: "2026-10-26",
  sourceUrl: repository,
  license: "MIT",
  templateCount: 22,
} as const;

export const imagePromptTemplates: ImagePromptTemplate[] = [
  {
    id: "ui-screenshot-system",
    label: "UI 截图系统",
    category: "UI 与界面",
    styles: ["UI"],
    scenes: ["科技", "社交"],
    tags: ["UI", "仪表盘", "截图"],
    description: "生成 App、网页、仪表盘和社媒界面的高保真视觉。",
    guidance: ["锁定平台、比例、层级和画面文字。", "明确状态栏、Tab 与操作区。"],
    pitfalls: ["避免平台描述过泛。", "约束文字可读性和平台特征。"],
    exampleCases: [17, 2, 4],
  },
  {
    id: "infographic-engine",
    label: "信息图引擎",
    category: "图表与信息可视化",
    styles: ["信息图", "图表"],
    scenes: ["教育", "科技"],
    tags: ["信息图", "图表", "知识卡"],
    description: "把机制、时间线和知识卡片组织成清楚的信息图。",
    guidance: ["定义 3–5 个模块、信息流和视觉层级。", "用色块、箭头与留白控制复杂度。"],
    pitfalls: ["避免把长段正文塞进画面。", "先限制模块数量，再补视觉细节。"],
    exampleCases: [334, 1, 8],
  },
  {
    id: "scientific-scale-diagram",
    label: "科学尺度缩放图",
    category: "图表与信息可视化",
    styles: ["信息图", "科学"],
    scenes: ["教育", "科技"],
    tags: ["信息图", "尺度", "科学"],
    description: "用从微观到宏观的尺度变化解释科学主题。",
    guidance: ["使用 6–8 个尺度框和短标签。", "展示单位、倍率与不同尺度的细节。"],
    pitfalls: ["避免所有尺度框长得一样。", "避免通用放大镜式布局。"],
    exampleCases: [341],
  },
  {
    id: "poster-layout-system",
    label: "海报排版系统",
    category: "海报与排版",
    styles: ["海报"],
    scenes: ["商业", "社交"],
    tags: ["海报", "封面", "排版"],
    description: "用清楚的主视觉、标题层级和受限配色组织封面。",
    guidance: ["锁定主体、版式、配色和比例。", "突出标题安全区与单一主视觉。"],
    pitfalls: ["成品画面不要做成拼贴展示板。", "约束多余文字和装饰符号。"],
    exampleCases: [345, 5, 10],
  },
  {
    id: "sports-campaign-poster",
    label: "运动商业 Campaign",
    category: "海报与排版",
    styles: ["海报", "写实"],
    scenes: ["商业", "时尚"],
    tags: ["Campaign", "运动", "排版"],
    description: "用强光影、动作和核心道具形成商业 Campaign 画面。",
    guidance: ["定义运动、姿态、核心道具和品牌色。", "保持干净构图和可读数据层。"],
    pitfalls: ["避免错误运动器材和杂乱拼贴。", "让运动员与道具保持主导。"],
    exampleCases: [350, 3],
  },
  {
    id: "conceptual-typography-poster",
    label: "概念字体海报",
    category: "海报与排版",
    styles: ["海报", "字体"],
    scenes: ["创意", "社交"],
    tags: ["字体", "主视觉", "海报"],
    description: "把准确标题转成主视觉结构，适合强观点封面。",
    guidance: ["让字体成为画面主角。", "人物、物体或风景必须服务标题含义。"],
    pitfalls: ["避免默认字效与标题错字。", "把配色控制在克制范围内。"],
    exampleCases: [355],
  },
  {
    id: "ink-double-exposure-poster",
    label: "水墨双重曝光",
    category: "海报与排版",
    styles: ["海报", "插画", "古典"],
    scenes: ["叙事", "历史"],
    tags: ["水墨", "剪影", "留白"],
    description: "将人物、水墨材质、氛围与留白叠加成诗性画面。",
    guidance: ["融合剪影、墨色、气氛与大面积留白。", "保持构图克制和高级感。"],
    pitfalls: ["避免廉价奇幻拼贴。", "非必要时减少文字。"],
    exampleCases: [359],
  },
  {
    id: "nature-science-poster",
    label: "自然科普海报",
    category: "海报与排版",
    styles: ["海报", "信息图"],
    scenes: ["教育"],
    tags: ["自然", "科普", "留白"],
    description: "用清晰主体、柔和阴影和充分留白做高级科普。",
    guidance: ["选择一个清楚的自然主体。", "保持科普标签短而明确。"],
    pitfalls: ["避免广告感过重。", "避免密集百科正文。"],
    exampleCases: [339],
  },
  {
    id: "product-commerce-visual",
    label: "商品商业视觉",
    category: "商品与电商",
    styles: ["商品", "写实"],
    scenes: ["商业"],
    tags: ["商品", "材质", "包装"],
    description: "用于产品主视觉、包装、卖点与商业场景。",
    guidance: ["定义商品、材质、场景、光线和版块。", "区分主商品、卖点与辅助道具。"],
    pitfalls: ["避免无关道具削弱识别。", "包装文字与卖点要保守准确。"],
    exampleCases: [373, 358],
  },
  {
    id: "personalized-beauty-report",
    label: "个性化美妆报告",
    category: "商品与电商",
    styles: ["商品", "UI"],
    scenes: ["商业", "时尚"],
    tags: ["报告", "商品卡", "版式"],
    description: "用诊断、推荐与商品卡组织生活方式报告。",
    guidance: ["建立报告式信息层级。", "对齐商品、标签与评分。"],
    pitfalls: ["避免医疗化结论。", "不要使用难读的小字。"],
    exampleCases: [353],
  },
  {
    id: "brand-identity-package",
    label: "品牌身份包",
    category: "品牌与标志",
    styles: ["品牌"],
    scenes: ["商业"],
    tags: ["Logo", "VI", "品牌"],
    description: "组织 Logo 系统、品牌板和触点应用。",
    guidance: ["定义品牌名、定位、配色和字体。", "让所有应用共享同一视觉规则。"],
    pitfalls: ["避免无关 Logo 变体。", "保持品牌文字准确。"],
    exampleCases: [354],
  },
  {
    id: "brand-touchpoint-board",
    label: "品牌触点视觉板",
    category: "品牌与标志",
    styles: ["品牌", "商品"],
    scenes: ["商业", "社交"],
    tags: ["品牌", "触点", "Campaign"],
    description: "预览同一 Campaign 在多个触点上的落地方式。",
    guidance: ["指定触点清单和样机排列。", "统一配色与字体逻辑。"],
    pitfalls: ["避免混入无关 Campaign 风格。", "可读性下降时减少触点。"],
    exampleCases: [362],
  },
  {
    id: "architecture-space",
    label: "建筑与空间",
    category: "建筑与空间",
    styles: ["建筑"],
    scenes: ["旅行", "商业"],
    tags: ["建筑", "室内", "空间"],
    description: "用于室内、建筑表现、城市地图与空间概念。",
    guidance: ["定义视角、尺度、材质、光线和功能。", "地图需要明确地标与标签。"],
    pitfalls: ["避免不合理透视。", "锁定地图标签语言和相对位置。"],
    exampleCases: [331, 11],
  },
  {
    id: "realistic-photography",
    label: "写实摄影",
    category: "摄影与写实",
    styles: ["摄影", "写实"],
    scenes: ["时尚", "商业"],
    tags: ["摄影", "镜头", "写实"],
    description: "通过机位、镜头、光线和真实纹理建立纪实感。",
    guidance: ["指定机位、镜头、光源、质感与背景。", "加入可信的小瑕疵增强真实感。"],
    pitfalls: ["避免过度磨皮和广告棚拍质感。", "约束手部、文字和结构错误。"],
    exampleCases: [342, 7],
  },
  {
    id: "street-accident-moment",
    label: "街头意外瞬间",
    category: "摄影与写实",
    styles: ["摄影", "写实"],
    scenes: ["旅行", "社交"],
    tags: ["抓拍", "街景", "瞬间"],
    description: "用运动模糊、真实街景和具体瞬间制造可信纪实。",
    guidance: ["描述具体瞬间、机位高度与街景。", "避免摆拍和广告棚拍感。"],
    pitfalls: ["避免画面过于干净。", "让事件和动作看起来可信。"],
    exampleCases: [344],
  },
  {
    id: "illustration-art-style",
    label: "插画与艺术风格",
    category: "插画与艺术",
    styles: ["插画", "艺术"],
    scenes: ["叙事", "创意"],
    tags: ["插画", "笔触", "材质"],
    description: "用构图、笔触、材质和情绪形成完整插画。",
    guidance: ["同时定义构图、材质、配色和完成度。", "参考图任务要说明保留哪些特征。"],
    pitfalls: ["避免只写风格、不写构图。", "使用参考图时锁定角色识别。"],
    exampleCases: [346, 6],
  },
  {
    id: "character-design-sheet",
    label: "角色设定表",
    category: "人物与角色",
    styles: ["角色", "插画"],
    scenes: ["叙事"],
    tags: ["角色", "动作", "一致性"],
    description: "用身份锚点、服装和动作网格保持角色一致性。",
    guidance: ["定义身份锚点、服装、比例和动作数。", "保持脸、发型和服装细节一致。"],
    pitfalls: ["避免不同动作里服装变化。", "画面拥挤时减少动作数量。"],
    exampleCases: [347],
  },
  {
    id: "3d-collectible-toy",
    label: "3D 收藏玩具",
    category: "人物与角色",
    styles: ["3D", "角色"],
    scenes: ["商业", "创意"],
    tags: ["3D", "潮玩", "材质"],
    description: "把角色或物品写成高级收藏玩具视觉。",
    guidance: ["保留参考图中的脸和服装锚点。", "指定材质、底座、光线和收藏比例。"],
    pitfalls: ["避免没有身份细节的通用玩具。", "包装文字少量且准确。"],
    exampleCases: [378],
  },
  {
    id: "scene-storytelling",
    label: "场景叙事",
    category: "场景与故事",
    styles: ["场景", "插画"],
    scenes: ["故事", "社交"],
    tags: ["场景", "情绪", "故事"],
    description: "用人物、地点、时间、冲突和机位组织叙事画面。",
    guidance: ["定义人物、地点、时间、冲突与情绪。", "让场景细节服务故事。"],
    pitfalls: ["避免通用幻想背景。", "让故事线索在画面中可见。"],
    exampleCases: [330],
  },
  {
    id: "history-classical-themes",
    label: "历史与古风题材",
    category: "历史与古风",
    styles: ["历史", "古典", "插画"],
    scenes: ["历史", "叙事"],
    tags: ["古风", "朝代", "长卷"],
    description: "处理朝代、服饰、器物、长卷与诗词视觉。",
    guidance: ["指定朝代、服饰、器物和版式。", "明确长卷、册页或海报形式。"],
    pitfalls: ["需要历史准确时避免朝代混搭。", "约束随机现代物件。"],
    exampleCases: [375, 338],
  },
  {
    id: "document-publishing",
    label: "文档与出版物",
    category: "文档与出版",
    styles: ["文档", "信息图"],
    scenes: ["教育", "科技"],
    tags: ["白皮书", "版式", "图表"],
    description: "组织白皮书、手册、百科图鉴和报告页面。",
    guidance: ["定义页面尺寸、分栏、目录和图表系统。", "按页面网格对齐标题、标签和说明。"],
    pitfalls: ["避免密集小字。", "让图表和说明符合同一网格。"],
    exampleCases: [360],
  },
  {
    id: "concept-product-breakdown",
    label: "概念产品研发拆解",
    category: "其他应用场景",
    styles: ["产品", "研发板"],
    scenes: ["创意", "科技"],
    tags: ["拆解图", "组件", "技术"],
    description: "用组件、标注、材质和关系拆解复杂产品。",
    guidance: ["定义产物类型、组件、材质逻辑和展示格式。", "用清晰标注表达组件关系。"],
    pitfalls: ["避免任务边界过泛。", "标签要短，关系要清楚。"],
    exampleCases: [370, 361],
  },
];

const templateById = new Map(
  imagePromptTemplates.map((template) => [template.id, template]),
);

export function visualPromptTemplateById(
  templateId?: string,
): ImagePromptTemplate | undefined {
  return templateId ? templateById.get(templateId) : undefined;
}

function templateScore(
  template: ImagePromptTemplate,
  haystack: string,
): number {
  const fields = [
    template.label,
    template.category,
    template.description,
    ...template.styles,
    ...template.scenes,
    ...template.tags,
  ].map((value) => value.toLocaleLowerCase());
  return fields.reduce(
    (score, field) =>
      score + (haystack.includes(field) ? Math.max(2, field.length / 2) : 0),
    0,
  );
}

export function selectVisualPromptTemplate(
  draft: Draft,
  _topic?: Topic,
): ImagePromptTemplate {
  const explicit = visualPromptTemplateById(draft.imagePromptTemplateId);
  if (explicit) return explicit;
  const candidates = ["illustration-art-style", "infographic-engine", "document-publishing", "concept-product-breakdown", "poster-layout-system"];
  let seed = 2166136261;
  for (const char of draft.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return visualPromptTemplateById(candidates[(seed >>> 0) % candidates.length])!;
}

export function styleGuideWithTemplate(
  styleGuide: string,
  template: ImagePromptTemplate,
): string {
  return [
    styleGuide.trim(),
    `GPT-Image2 用途方法「${template.label}」：仅提供构图与信息承载方法，不改变文章已锁定的艺术方向、色调和材质。`,
    `用途提示：${template.guidance.join("；")}`,
    `用途避坑：${template.pitfalls.join("；")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function visualPromptTemplateSource(template: ImagePromptTemplate): string {
  const anchors: Record<string, string> = {
    "infographic-engine": "tpl-infographic", "scientific-scale-diagram": "tpl-infographic",
    "document-publishing": "tpl-document", "concept-product-breakdown": "tpl-other",
    "illustration-art-style": "tpl-illustration", "ui-screenshot-system": "tpl-ui",
  };
  return `${repository}/blob/main/docs/templates.md#${anchors[template.id] || "tpl-poster"}`;
}

export function buildDraftPromptSpec(input: {
  template: ImagePromptTemplate;
  concept: string;
  role: string;
  index: number;
  total: number;
  themeLabel: string;
  channel: Draft["channel"];
  kind: "background" | "illustration";
  layout?: string;
  purpose?: "cover" | "body";
}): DraftPromptSpec {
  const placement =
    input.purpose === "cover"
      ? "封面级单一焦点；为标题和文字叠层预留稳定安全区。"
      : `第 ${input.index + 1}/${input.total} 页；只表达一个机制、对照或证据细节。`;
  const geometry = channelVisuals[input.channel];
  const aspectRatio = `目标画幅${geometry.ratio}，交付${geometry.width}×${geometry.height}；按画布组织布局，关键文字和主体保持安全边距，不裁切已排版文字。`;
  return {
    templateId: input.template.id,
    templateName: input.template.label,
    subject: input.concept.trim().slice(0, 1800) || input.role,
    composition: `${placement} ${input.layout ? `页面布局：${input.layout}；` : ""}${input.template.guidance.join("；")}`,
    visualStyle: `${input.themeLabel}；${input.template.description} 同一系列复用配色与材质，构图按信息任务独立设计，不复用同一个几何主体或标题框。`,
    textPolicy:
      input.kind === "background"
        ? "只生成背景资产，不生成可读文字、数字、logo、水印或界面内容；文字由本地排版系统准确叠加。"
        : "画面不生成可读文字、品牌标识、水印或虚构数据；通过明确对象、关系和动作解释本页的信息任务。",
    aspectRatio,
    constraints: input.template.pitfalls.join("；"),
  };
}

export function formatDraftPromptSpec(spec: DraftPromptSpec): string {
  return [
    `【模板】${spec.templateName}（${spec.templateId}）`,
    `【主体与任务】${spec.subject}`,
    `【构图与层级】${spec.composition}`,
    `【视觉风格】${spec.visualStyle}`,
    `【文字规则】${spec.textPolicy}`,
    `【画幅与安全区】${spec.aspectRatio}`,
    `【约束与避坑】${spec.constraints}`,
  ].join("\n\n");
}
