import { creativeMethodRules } from "./writing-methods";
import { z } from "zod";

/** Model output must explain each page's distinct reader value and quote its basis. */
export const visualPlanSchema = z.object({
  styleGuide: z.string().default(""),
  images: z.array(z.object({
    kind: z.enum(["illustration", "slide", "chart"]).default("slide"),
    role: z.string().default(""),
    renderer: z.enum(["manim", "gpt_image"]).optional(),
    layout: z.enum(["info_card", "hero_illustration", "text_card", "data_card"]).optional(),
    title: z.string().default(""),
    prompt: z.string().default(""),
    lead: z.string().default(""),
    points: z.array(z.string()).default([]),
    metrics: z.array(z.object({
      value: z.string(), label: z.string(), detail: z.string().default(""),
    })).default([]),
    source: z.string().default(""),
    claim: z.string().min(1),
    valueReason: z.string().min(1),
    evidenceQuotes: z.array(z.string().min(1)).min(1),
  })),
});

export const visualPlanningRules = `${creativeMethodRules} 图片须将文章中真实的冲突、具体对象和认知转折转化为能够辨识的视觉关系；依据文章判断，避免强加人物故事或情绪。
你是科技内容视觉总监。第一步先判断文章是否真的需要配图；没有配图能更清楚、更有节奏或更好看时，必须返回images=[]，无图是合格结果，不得为了完成生图任务增加页面。配图服务于文章的价值、可读性、观赏性、趣味性和传播节奏，不是装饰，也不是为了显示“做过生图”。先理解文章的核心判断、人的处境与情绪推进，再找值得可视化的机制、前后对照、可信数据、操作决策、适用边界或能让抽象冲突变得可感的具体动作；每张图必须回答：它帮读者更快理解了什么、让哪种情绪或共鸣更有依据、强化了哪一个判断，或为什么值得保存分享。再决定数量，允许0–6张；0张或1张完全正常。结合正文字数和独立信息点控制数量：短文优先1–2张，信息较少合并到一张；篇幅更长也只有新增独立证据、关系、情绪转折或阅读节奏价值才增加页面。字数只是上限参考，不是必须填满的配额，禁止为凑数画封面、情绪结尾、装饰静物、口号或浅显常识。文字观点卡、证据卡、对照卡和知识卡可以承载正文的主要信息，独立阅读有收获、便于保存即有价值，不要求正文之外的新事实；允许提炼正文但不能同组换标题重复表达。流程图低频按需，只在明确步骤、先后依赖或分支决策帮助理解或操作时使用；普通新闻、观点分析和人文讨论不得强套流程。每张必须比一句文字更有用，并且有不同的独立结论claim、具体增益valueReason和正文逐字摘录evidenceQuotes；valueReason要具体说明理解增益、情绪承接或传播价值，不能只写“更直观”“更有趣”。同一结论/同一段证据不得换标题重复画。正文无可视化价值则images=[]。
禁止套用旧视觉企划中的嵌套六边形、同心多边形与统一大标题框。配色统一不等于构图统一；每张按具体对象和信息关系选择构图，不以抽象几何图形替代内容。正文第一张不是封面，独立封面由另一个任务生成。
布局layout按信息任务选择：hero_illustration用于主体/机制插画，info_card用于对照、流程与知识卡，text_card用于有证据支撑的短文字贴图（无需生成背景），data_card用于数字证据。图文稿可混用这些页面，但服从整篇模板、字体层级与配色，不得为了展示模板增加页面。参考awesome-gpt-image-2的信息图模块控制、出版物网格、字体主视觉、明确主体/动作/笔触技巧；提炼技法，不照抄案例内容或虚构数据。
每张显式选择renderer：机制、结构、关系、比较、阈值与有依据的数据图优先manim；它能用精确文字、几何、坐标、轮廓、局部放大和细节组合成完整解释性插画，不等于方框箭头模板。真实人物、照片感场景、复杂材质或自由笔触用gpt_image。text_card由本地准确排版，无需图片API。不要为了省费用强行把不适合的题画成几何。封面仍由独立GPT Image任务生成。Manim画面使用整幅画布，丰富元素来自主题对象、语义分组、标签与证据，不用随机装饰。默认slide：清晰的信息层级、一页一个具体结论，少量高密度短句，关系、比较、步骤与边界清楚；文字由代码准确排版。chart只在metrics呈现证据，points留空；其它类型metrics留空。chart仅用于正文中有准确指标、数值、单位、样本和比较条件的证据，禁止拼接无关数字。illustration仅用于不依赖长文字即可讲清具体关系或动作的解释性贴图；不是装饰背景。没有固定类型配额，没有强制最后一页。禁止空白无字页、纯背景页、感谢阅读或装饰性收尾。信息卡必须有可直接阅读的标题和有效解释；illustration填写title以及lead或points作为图注与依据，实际插画不强制叠加标题框，必须画清具体关系，不单独充当无字尾页。所有实际文字中的数字都必须出自本页evidenceQuotes，metrics的value和label必须在同一条摘录中逐字出现。
默认留白充分、主体清晰、克制配色。指定艺术方向只影响小面积贴图/材质细节，不能牺牲可读性或抢信息主体；不做全幅繁复背景、渐变企业汇报、霓虹HUD、发光大脑、六边形接口或无关机器人。图像模型不写文字、数字或图表刻度。slide标题<=28字、lead<=70字、points最多3条每条<=60字；超出则提炼而非截断。具体细节保留条件、单位与限制，禁止空话如“效率提升”“未来已来”。返回JSON：{"images":[{"kind":"slide|chart|illustration","renderer":"manim|gpt_image","role":"信息任务","title":"具体结论","claim":"独立结论","valueReason":"读者借图获得什么理解或决策帮助","evidenceQuotes":["正文逐字原句"],"lead":"关键解释","points":["有信息量的短句"],"metrics":[{"value":"原文数值与单位","label":"原文指标名","detail":"比较条件"}],"source":"原文来源","prompt":"贴图对象、关系和动作；slide/chart可留空"}]}。`;

function key(text: string): string {
  return text.toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}
function numbers(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?(?:%|％)?/g) ?? [];
}

/** Validate model data, apply layout limits, and reject ungrounded or repeated pages. */
export function groundedVisualPlan(raw: unknown, body: string) {
  const plan = visualPlanSchema.parse(raw);
  const normalized = plan.images.map((page) => ({
    ...page,
    layout: page.layout ?? (page.kind === "illustration" ? "hero_illustration" : page.kind === "chart" ? "data_card" : "info_card"),
    kind: page.kind,
    title: page.title.trim(),
    lead: page.lead.trim(),
    points: page.points.map(point => point.trim()),
    metrics: page.metrics.map((metric) => ({
      value: metric.value.trim(),
      label: metric.label.trim(),
      detail: metric.detail.trim(),
    })),
  }));
  const claims = new Set<string>();
  const evidence = new Set<string>();
  const images = normalized.filter((page) => {
    if ([...page.title].length > 28 || [...page.lead].length > 70 || page.points.length > 3 || page.points.some(point => [...point].length > 60) || page.metrics.length > 4) throw new Error("视觉企划文字超长，请精炼完整语义，不得截断否定、条件、单位或边界。");
    const quotes = page.evidenceQuotes.map((quote) => quote.trim());
    if (quotes.some((quote) => !quote || !body.includes(quote))) return false;
    const claim = key(page.claim);
    const evidenceKey = quotes.map(key).sort().join("|");
    if (!claim || claims.has(claim) || evidence.has(evidenceKey)) return false;
    const printed = [page.title, page.lead, ...page.points,
      ...page.metrics.flatMap((metric) => [metric.value, metric.label, metric.detail])].join(" ");
    const knownNumbers = new Set(numbers(quotes.join(" ")));
    if (numbers(printed).some((value) => !knownNumbers.has(value))) return false;
    if (page.metrics.some((metric) => !metric.value.trim() || !metric.label.trim() ||
      !quotes.some((quote) => quote.includes(metric.value) && quote.includes(metric.label)))) return false;
    if (page.kind === "chart" && !page.metrics.length) return false;
    if (page.kind !== "chart" && page.metrics.length) return false;
    if (page.kind === "chart" && page.points.length) return false;
    if (!page.title.trim() ||
      (!page.lead.trim() && !page.points.some((point) => point.trim()) && !page.metrics.length)) return false;
    if (/^(谢谢观看|感谢阅读|谢谢阅读|感谢观看|敬请期待|未完待续|谢谢|再见)[！!。\s]*$/.test(page.title.trim())) return false;
    claims.add(claim);
    evidence.add(evidenceKey);
    return true;
  });
  // Length limits excess pages; grounded distinct information still decides
  // how many of that allowance are useful.
  const length = body.replace(/\s/g, "").length;
  const limit = length <= 180 ? 2 : length <= 450 ? 3 : length <= 900 ? 4 : length <= 1600 ? 5 : 6;
  return { ...plan, images: images.slice(0, limit) };
}
