import type { ContentChannel } from "./types";

/** Transferable editorial approaches, without persona identity or catchphrases. */
export const writingMethods = {
  research: { label: "研究解读", rule: "问题→方法→结果→局限→实际影响；基准写清样本、条件与比较口径；作者主张与独立验证分开，不将跑分等同现实能力。" },
  review: { label: "产品评测", rule: "用户任务→条件与版本→可追溯结果→失败案例→成本与取舍→适用人群；只有材料明确提供测试记录时才能写实测，不能虚构亲测、耗时或截图。" },
  tutorial: { label: "实用教程", rule: "痛点与目标→前置条件→最小可执行步骤→预期结果→排错与边界；只写资料支持的命令和界面，不为凑完整补造操作。" },
  business: { label: "商业与产品决策", rule: "具体动作→为什么现在做→用户需求、商业激励与资源约束→收益和代价→反方与后续观察；不揣测未披露的个人动机，区分事实和推断。" },
  human: { label: "人文与认知观察", rule: "具体人的选择或处境→默认认知→矛盾与代价→有边界的判断→读者可辨认的选择；概念解释服务事件，不空泛哲学化，不把技术新闻强写成人生故事。" },
  news: { label: "新闻解释", rule: "发生什么→相对过去变了什么→来源与时间→机制和受影响人群→未披露项；导语先交代事件，不堆惊叹号，不将旧闻包装为刚发生。" },
} as const;

/** The reader-facing outcome shared by every article format. */
export const creativeMethodRules = `围绕真实事件、读者具体处境和有证据的认知冲突建立吸引力。标题在具体问题、反常识、事件变化或读者利益中按题选择，条件与结论须准确；开篇尽快呈现问题或动作，再以可核实故事、证据与机制递进，按题选择转折、反方和边界，结尾回应开头并给读者可使用的判断。情绪变化要来自内容，不强加人生升华、心理诊断、无依据因果、亲历或固定套路。至少一个值得记住的表达应承载信息，不堆砌金句；短视频前几秒建立具体问题，时长随内容与语速确定，避免机械套时间段。只迁移故事、视角和节奏技巧，保持自己的声音，不复制他人口头禅。` ;

export const editorialNorthStar =
  "最高编辑目标：写出有事实底座、有明确判断、有大众共鸣、有情绪价值且有传播吸引力的文章；价值、共鸣和吸引力必须同时成立，不能用空洞煽情换点击，也不能用研究堆砌牺牲可读性。";

type WritingInput = { title: string; direction?: string; intent?: string; evidence?: string; channel?: ContentChannel };

/** Match requested genre before topic signals; source vocabulary alone cannot turn news into a tutorial.
 * @param input - Topic, explicit author intent and source evidence.
 * @returns A primary editorial method.
 */
export function selectWritingMethod(input: WritingInput): keyof typeof writingMethods {
  const intent = `${input.intent || ""} ${input.title}`;
  if (/教程|如何操作|操作指南|上手指南|排错|一步步/.test(intent)) return "tutorial";
  if (/评测|横评|实测|测评|选型|对比测试/.test(intent)) return "review";
  if (/人文|人的处境|认知观察/.test(`${intent} ${input.direction || ""}`)) return "human";
  if (/融资|并购|定价|商业|营收|组织|创业|产品决策/.test(`${intent} ${input.direction || ""}`)) return "business";
  if (/论文|研究解读|科研|学术|证明|消融|基准/.test(`${intent} ${input.direction || ""}`)) return "research";
  return "news";
}

/** Fuse a content-specific structure with the studio's common reader-engagement method.
 * @param input - Article attributes and author intent.
 * @returns Model instructions for planning, writing and scoped revisions.
 */
export function writingMethodPrompt(input: WritingInput): string {
  const method = writingMethods[selectWritingMethod(input)];
  return `${editorialNorthStar}
${creativeMethodRules}
撰写方式：${method.label}。${method.rule}
匹配依据先看作者明确诉求，再看文章要回答的问题、来源类型与证据充分度。当前为初步主写法；阅读材料后如不适配，应在创作卡中说明取舍并调整结构，不能仅凭标题关键词硬套。缺测试记录的评测应写成资料对照，缺具体操作依据的教程应写成概念解释。
共同传播骨架（融合李尚龙公开资料中的可迁移技巧）：先明确读者默认认知、具体冲突和可被证据支持的反常识判断；标题落在具体事件、变化和读者利益，准确且有张力，避免虚假悬念；开头三行给具体动作或变化，再展开证据和解释；情绪从困惑走向看清，不人为制造焦虑；起承转合服务本篇体裁，不强加人物故事；结尾回扣开头，落在读者的判断或选择，可截图句必须有信息而非口号。标题力度不得超过证据；不保证爆款、不冒充任何作者或机构、不复制口头禅。
先在创作卡的起承转合中落实主写法，再写正文；只借用最多一种辅助方法，禁止拼贴多种腔调。没有实测记录不能自称亲测，没有真实经历不能写成作者亲历。修改时尊重作者已确认的创作卡、请求范围和事实边界，不因匹配写法而擅自改动其它字段。`;
}
