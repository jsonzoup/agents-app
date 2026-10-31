import type { Source } from "./types";

/** Depth means a useful explanation, not a quota of disciplines or jargon. */
export const deepInquiryRules = `深度研究与综合思辨：禁止把单篇资料改写包装成深度文章。研究不是机械搜集原文，而是围绕一件事向外追问它牵动的人、关系、选择和社会处境：检索知识库、web_search，并用web_fetch阅读关键原文、独立分析和反证。搜索应主动寻找事件背后的心理与人性、组织和商业运转、利益与权力、社会情绪与公共价值，也可寻找相关人物、公司、产品、数据、思维方法、定律或哲学问题；这些是理解事件的材料，不是文章必须点名的学科清单。转载、同一公告的转述不算独立验证；区分发布者的自述与外部证据，说明来源间的依赖与冲突。
从材料中提出2–4个值得追问的问题：人们为什么会这样选择或感受，变化由什么机制产生，谁的激励或约束改变，谁获益谁付代价，普通人的生活和尊严如何被影响，短期与长期后果有何不同，什么条件下判断失效。按解释增益选择0–2个最相关视角：人文、哲学、心理、人性、组织、经济、环境、历史、未来、趋势、第一性原理或其它学科；不必逐项覆盖，不为显深刻堆概念。每个视角必须连接具体事实→人的处境或冲突→机制→适用条件→可观察后果；解释不了本题就舍弃。
第一性原理需要列明基础约束与假设，不把直觉叫原理；跨学科类比要说对应关系及失效边界。主动找反方、替代解释和可能推翻判断的证据。情景、畅想、趋势预测与已发生事实分开，标明前提和不确定性，不捏造概率、引语或共识。来源数量不等于深度，重点是独立性、证据质量和机制解释；资料不足时缩小结论或停止，不用宏大叙事补洞。
写作前先综合问题、证据、冲突、关键机制、人的处境和读者影响，再组织创作卡与正文。文章要有明确但克制的态度，写出读者能认出的生活感、犹豫、欲望、失落、希望或选择，让洞察带来情绪价值和公共价值；不要把“人性、心理、哲学、商业”当小标题逐项解释，不要把研究笔记拼成干巴巴的论文。保留李尚龙式具体冲突、共鸣、标题与叙事推进，让传播形式承载判断，不能反过来让事实迎合标题。`;

/** Require multiple traceable documents, while leaving independence to explicit source analysis.
 * @param sources - Retrieved and read documents.
 * @returns Sources deduplicated by original URL or local record.
 */
export function distinctArticleSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (source.kind === "候选链接" || !(source.facts.trim() || source.excerpt.trim())) return false;
    let identity = source.url || source.id;
    if (source.url) {
      try {
        const url = new URL(source.url);
        url.hash = "";
        for (const name of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(name)) url.searchParams.delete(name);
        identity = url.toString().replace(/\/$/, "");
      } catch { /* Keep a malformed legacy URL distinct by its stored value. */ }
    }
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
