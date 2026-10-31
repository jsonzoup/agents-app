import type { ContentChannel } from "./types";

/** Channel delivery geometry, independent of illustration or card type. */
export const channelVisuals = {
  xiaohongshu: { width: 1080, height: 810, ratio: "4:3", cover: { width: 1080, height: 810, ratio: "4:3" } },
  wechat: { width: 1200, height: 675, ratio: "16:9", cover: { width: 900, height: 383, ratio: "2.35:1" } },
  wechat_card: { width: 1080, height: 1080, ratio: "1:1", cover: { width: 1080, height: 1080, ratio: "1:1" } },
  video: { width: 1080, height: 1920, ratio: "9:16", cover: { width: 1080, height: 1920, ratio: "9:16" } },
  toutiao: { width: 1200, height: 675, ratio: "16:9", cover: { width: 924, height: 720, ratio: "77:60" } },
} as const;

export type ChannelVisualFamily = "横版文章素材" | "小红书横版图文" | "微信贴图方版" | "竖屏视频";

/** Shared production family used by planning and prompt generation. */
export function channelVisualFamily(channel: ContentChannel): ChannelVisualFamily {
  if (channel === "video") return "竖屏视频";
  if (channel === "wechat" || channel === "toutiao") return "横版文章素材";
  if (channel === "wechat_card") return "微信贴图方版";
  return "小红书横版图文";
}

export function channelVisualRequirement(channel: ContentChannel): string {
  const geometry = channelVisuals[channel];
  const cover = geometry.cover
    ? `；封面另行生成 ${geometry.cover.width}×${geometry.cover.height}（${geometry.cover.ratio}）`
    : "；不额外生成独立封面";
  return `视觉规格归类：${channelVisualFamily(channel)}；正文图 ${geometry.width}×${geometry.height}（${geometry.ratio}）${cover}。`;
}

/** Writing instructions for each independently saved delivery scene. */
export function channelWritingRule(channel: ContentChannel): string {
  if (channel === "video") return "写中文口播稿，纯文本短句分段；按内容密度与自然语速安排篇幅，不为凑时长注水。沿用创作卡蒸馏的共鸣、具体场景、起承转合和回扣方法：前三秒出现具体冲突，随后讲证据、机制、反方和边界，结尾回到读者可作出的选择。不要写镜头指令、Markdown或虚构亲历；正文将交给DSH结合资料和知识设计ManimGL解释性动画，不能用画面补造事实。";
  if (channel === "wechat") return "写公众号深度文章，标题克制，段落连贯，用来源、机制、边界支撑判断；正文配图与今日头条共用横版文章素材体系。";
  if (channel === "toutiao") return "写今日头条文章：标题清楚具体、不夸大；导语交代事件，正文用事实、分析与边界展开；正文配图与公众号共用横版文章素材体系，不把文章写成卡片脚本。";
  if (channel === "wechat_card") return "写适合微信分享的文字信息贴图稿：每张承担可独立阅读的观点、证据、对照或知识；文字可整理正文已有信息，不要求虚构新信息，不用口号凑页。";
  return "写小红书图文：正文必须是可直接粘贴发布的纯文本，不支持Markdown；禁止**加粗**、星号斜体、井号标题、反引号代码、引用块或Markdown链接，用短段落、空行和自然文字表达层次，保留正常的话题标签。标题尽量精炼，正文不超过1000字；短段落、可扫描；信息卡可以承载主要阅读内容，提供可保存的观点、证据和边界。";
}
