import type { Draft } from "./types";

export type VisualEntity = {
  id: string;
  name: string;
  type: "人物" | "公司" | "产品";
  aliases: string[];
  officialUrl: string;
  visualRole: "portrait" | "logo" | "both";
  visualTokens: string;
  portraitPolicy: string;
  logoPolicy: string;
  assetPolicy: "generated-reference" | "official-upload-needed";
};

const people = [
  ["huang-renxun", "黄仁勋", ["Jensen Huang", "Jensen", "老黄"] , "https://www.nvidia.com/about-nvidia/leadership/jensen-huang/", "NVIDIA 创始人兼 CEO，公开演讲场景、黑色皮衣或深色简洁服装；只做编辑肖像，不复制新闻照片。"],
  ["elon-musk", "埃隆·马斯克", ["Elon Musk", "马斯克"] , "https://www.tesla.com/elon-musk", "Tesla、SpaceX 创业者；公开发布会或工程现场的编辑肖像，不伪造新闻事件。"],
  ["bill-gates", "比尔·盖茨", ["Bill Gates", "比尔盖茨", "盖茨"] , "https://www.gatesfoundation.org/about/leadership/bill-gates", "微软联合创始人；成熟、克制的公开演讲或阅读场景编辑肖像。"],
  ["mark-zuckerberg", "马克·扎克伯格", ["Mark Zuckerberg", "小札", "扎克伯格"] , "https://about.meta.com/media-gallery/executives/mark-zuckerberg/", "Meta 创始人；公开访谈或产品讨论场景的编辑肖像，不制造虚假引语。"],
  ["sam-altman", "山姆·奥特曼", ["Sam Altman", "奥特曼"] , "https://openai.com/index/sam-altman/", "OpenAI CEO；公开发布会或研究讨论场景编辑肖像，不暗示未证实立场。"],
  ["ray-dalio", "雷·达里奥", ["Ray Dalio", "达里奥", "桥水达里奥"] , "https://www.bridgewater.com/people/ray-dalio", "投资人和 Bridgewater 创始人；宏观研究、图表讨论场景编辑肖像。"],
  ["zhang-yiming", "张一鸣", ["Zhang Yiming", "字节张一鸣"] , "https://www.bytedance.com/en/leadership", "字节跳动创始人；创业与产品讨论场景编辑肖像，不补写隐私信息。"],
  ["liang-wenfeng", "梁文锋", ["Liang Wenfeng", "DeepSeek 梁文锋"] , "https://www.deepseek.com/", "DeepSeek 创始人；研究或工程讨论场景编辑肖像，不生成未证实活动。"],
] as const;

const companies = [
  ["openai", "OpenAI", ["Open AI", "开放AI", "开放人工智能"], "https://openai.com/", "黑白、绿色和简洁几何的研究机构品牌语汇；准确 Logo 需官方上传素材。"],
  ["tesla", "Tesla", ["特斯拉", "Tesla Motors"], "https://www.tesla.com/", "红色与黑色、汽车与能源科技品牌语汇；不用模型臆造准确商标字形。"],
  ["spacex", "SpaceX", ["Space X", "太空探索技术公司"], "https://www.spacex.com/", "深蓝、黑色、航天器与发射台工程语汇；Logo 只做抽象占位。"],
  ["microsoft", "Microsoft", ["微软", "MSFT"], "https://www.microsoft.com/", "蓝色、四色方格和生产力软件语汇；准确 Logo 需官方上传素材。"],
  ["nvidia", "NVIDIA", ["英伟达", "Nvidia", "NVDA"], "https://www.nvidia.com/", "深墨绿、荧光绿和芯片/算力工程语汇；不凭空生成准确商标。"],
  ["bytedance", "字节跳动", ["ByteDance", "字节"], "https://www.bytedance.com/", "多彩跳动、内容产品与推荐系统语汇；品牌标识只做抽象占位。"],
  ["deepseek", "DeepSeek", ["Deep Seek", "深度求索"], "https://www.deepseek.com/", "蓝色、鲸鱼意象和模型研究语汇；准确 Logo 需官方上传素材。"],
  ["moonshot-ai", "月之暗面", ["Kimi", "Kimi AI", "月之暗面智能"], "https://www.moonshot.cn/", "深色、月光和长上下文产品语汇；不生成未经确认的商标字形。"],
  ["cursor", "Cursor", ["Anysphere", "Cursor IDE"], "https://www.cursor.com/", "深色编辑器、光标和代码协作语汇；界面只做抽象结构，不伪造截图。"],
] as const;

export const visualEntities: VisualEntity[] = [
  ...people.map(([id, name, aliases, officialUrl, visualTokens]) => ({
    id, name, aliases: [...aliases], officialUrl, visualTokens,
    type: "人物" as const, visualRole: "portrait" as const,
    portraitPolicy: "可识别的公开人物编辑肖像；不复制具体照片，不伪造新闻事件、引语或未证实行为。",
    logoPolicy: "不适用。",
    assetPolicy: "generated-reference" as const,
  })),
  ...companies.map(([id, name, aliases, officialUrl, visualTokens]) => ({
    id, name, aliases: [...aliases], officialUrl, visualTokens,
    type: "公司" as const, visualRole: "logo" as const,
    portraitPolicy: "不适用。",
    logoPolicy: "默认只生成品牌色、几何构成和抽象标志占位；准确 Logo 必须使用用户拥有授权的本地素材。",
    assetPolicy: "official-upload-needed" as const,
  })),
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s·._-]/g, "");
}

export function resolveVisualEntities(text: string): VisualEntity[] {
  const normalized = normalize(text);
  return visualEntities.filter((entity) =>
    [entity.name, ...entity.aliases].some((alias) => normalized.includes(normalize(alias))),
  );
}

export function visualEntityContext(draft: Pick<Draft, "title" | "body" | "visualBrief">): string {
  const matched = resolveVisualEntities(`${draft.title}\n${draft.body}\n${draft.visualBrief}`);
  if (!matched.length) return "未识别到目录中的人物或公司视觉实体。";
  return matched.map((entity) => [
    `${entity.name}（${entity.type}；别名：${entity.aliases.join("、")}）`,
    `官方来源：${entity.officialUrl}`,
    `视觉元素：${entity.visualTokens}`,
    `人物策略：${entity.portraitPolicy}`,
    `Logo策略：${entity.logoPolicy}`,
    `素材策略：${entity.assetPolicy}`,
  ].join("\n")).join("\n\n");
}

export function visualEntityProjection() {
  return visualEntities.map((entity) => ({
    name: entity.name,
    type: entity.type,
    aliases: entity.aliases,
    summary: `内置视觉实体目录。${entity.visualTokens} 官方来源：${entity.officialUrl}`,
    sourceIds: [] as string[],
  }));
}
