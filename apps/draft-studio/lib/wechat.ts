import type { ContentChannel, Draft, DraftImage } from "./types";

export const WECHAT_COVER_WIDTH = 900;
export const WECHAT_COVER_HEIGHT = 383;
export const WECHAT_BODY_WIDTH = 1200;
export const WECHAT_BODY_HEIGHT = 675;

export type ArticleBlock = {
  index: number;
  text: string;
  html: string;
};

export type WechatBodyImage = {
  image: DraftImage;
  position: number;
};

export function channelLabel(channel: ContentChannel): string {
  return { xiaohongshu: "小红书", wechat: "微信公众号", wechat_card: "微信贴图", toutiao: "今日头条", video: "视频" }[channel];
}

export function articleBlocks(markdown: string): ArticleBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Omit<ArticleBlock, "index">[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | undefined;
  let listItems: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ text, html: `<p>${inlineMarkdown(text)}</p>` });
    paragraph = [];
  };
  const flushList = () => {
    if (listType && listItems.length) {
      const items = listItems
        .map((item) => `<li>${inlineMarkdown(item)}</li>`)
        .join("");
      blocks.push({
        text: listItems.join("；"),
        html: `<${listType}>${items}</${listType}>`,
      });
    }
    listType = undefined;
    listItems = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      const text = code.join("\n");
      blocks.push({
        text,
        html: `<pre><code>${escapeHtml(text)}</code></pre>`,
      });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      const level = Math.min(4, heading[1].length + 1);
      const text = heading[2].trim();
      blocks.push({
        text,
        html: `<h${level}>${inlineMarkdown(text)}</h${level}>`,
      });
      continue;
    }
    if (/^(?:---+|\*\*\*+)\s*$/.test(line)) {
      flush();
      blocks.push({ text: "", html: "<hr>" });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flush();
      const quoteLines: string[] = [quote[1]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(/^>\s?(.*)$/);
        if (!next) break;
        quoteLines.push(next[1]);
        index += 1;
      }
      const text = quoteLines.join(" ").trim();
      blocks.push({
        text,
        html: `<blockquote>${inlineMarkdown(text)}</blockquote>`,
      });
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? "").trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return blocks.map((block, index) => ({ ...block, index: index + 1 }));
}

export function sortedWechatBodyImages(
  draft: Draft,
  defaultPlacements = true,
): WechatBodyImage[] {
  const coverId = draft.wechatCover?.id;
  const candidates = draft.images.filter((image) => image.id !== coverId);
  if (!candidates.length) return [];
  const blockCount = articleBlocks(draft.body).length;
  const fallback = (index: number) =>
    Math.max(
      0,
      Math.min(
        blockCount,
        Math.round(((index + 1) * blockCount) / (candidates.length + 1)),
      ),
    );
  return candidates
    .map((image, originalIndex) => {
      const configured = draft.imagePlacements?.[image.id];
      const position =
        defaultPlacements && Number.isInteger(configured)
          ? Math.max(0, Math.min(blockCount, configured))
          : fallback(originalIndex);
      return { image, position, originalIndex };
    })
    .sort(
      (left, right) =>
        left.position - right.position ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ image, position }) => ({ image, position }));
}

export function renderWechatArticleHtml(
  draft: Draft,
  bodyImages: Array<{ image: DraftImage; position: number; src: string }>,
  options: { fullDocument?: boolean; includeMetadata?: boolean } = {},
): string {
  const blocks = articleBlocks(draft.body);
  const imagesAt = new Map<number, typeof bodyImages>();
  for (const item of bodyImages) {
    const position = Math.max(0, Math.min(blocks.length, item.position));
    const current = imagesAt.get(position) ?? [];
    current.push(item);
    imagesAt.set(position, current);
  }
  const figures = (position: number) =>
    (imagesAt.get(position) ?? [])
      .map(
        (item, index) =>
          `<figure style="margin: 24px 0; text-align: center;"><img src="${escapeAttribute(item.src)}" alt="${escapeAttribute(item.image.title || "文章配图")}" style="display: block; width: 100%; max-width: 100%; height: auto; margin: 0 auto; border-radius: 4px;" /><figcaption style="margin-top: 8px; color: #8a8a8a; font-size: 12px; line-height: 1.6;">${escapeHtml(item.image.title || `文章配图 ${position + index + 1}`)}</figcaption></figure>`,
      )
      .join("");
  const content = [
    figures(0),
    ...blocks.flatMap((block) => [block.html, figures(block.index)]),
  ].join("\n");
  const title = draft.title || "未命名文章";
  const byline = options.includeMetadata !== false && draft.wechatAuthor
    ? `<p style="margin: 8px 0 24px; color: #888; font-size: 14px;">${escapeHtml(draft.wechatAuthor)}</p>`
    : "";
  const summary = options.includeMetadata !== false && draft.wechatSummary
    ? `<p style="margin: 20px 0; padding: 14px 16px; border-left: 3px solid #507260; background: #f5f8f4; color: #536156; font-size: 15px; line-height: 1.8;">${escapeHtml(draft.wechatSummary)}</p>`
    : "";
  const article = `<article style="max-width: 677px; margin: 0 auto; padding: 24px 18px; color: #303832; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 16px; line-height: 1.85; word-break: break-word;">
<h1 style="margin: 0 0 8px; color: #1f2a23; font-size: 24px; line-height: 1.45;">${escapeHtml(title)}</h1>
${byline}
${summary}
${content}
</article>`;
  if (!options.fullDocument) return article;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0; background: #fff; }
h2 { margin: 32px 0 14px; color: #1f2a23; font-size: 21px; line-height: 1.5; }
h3 { margin: 28px 0 12px; color: #27362c; font-size: 18px; line-height: 1.55; }
h4 { margin: 24px 0 10px; color: #33463a; font-size: 16px; line-height: 1.55; }
p { margin: 16px 0; }
blockquote { margin: 22px 0; padding: 12px 16px; border-left: 3px solid #758c7b; background: #f5f7f4; color: #5b665d; }
pre { overflow-x: auto; padding: 14px; border-radius: 6px; background: #f4f6f3; }
ul, ol { padding-left: 24px; }
li { margin: 8px 0; }
</style>
</head>
<body>
${article}
</body>
</html>
`;
}

export function wechatPublishText(
  draft: Draft,
  bodyImages: WechatBodyImage[],
): string {
  const imageOrder = bodyImages
    .map(
      (item, index) =>
        `${String(index + 1).padStart(2, "0")}｜${item.image.title || "文章配图"}｜插入到第 ${item.position} 个正文块之后`,
    )
    .join("\n");
  return [
    "公众号发布文案",
    "",
    `标题\n${draft.title || "未命名文章"}`,
    `作者\n${draft.wechatAuthor || "未填写"}`,
    `摘要\n${draft.wechatSummary || "未填写"}`,
    `主题标签\n${draft.tags || "未填写"}`,
    "正文\n请使用 article.html 或把浏览器中的文章正文复制到公众号编辑器，再检查样式和图片。",
    `封面\n封面图/封面-${WECHAT_COVER_WIDTH}x${WECHAT_COVER_HEIGHT}.png`,
    `正文图片\n${imageOrder || "没有正文图"}`,
  ].join("\n\n");
}

function inlineMarkdown(raw: string): string {
  return escapeHtml(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(raw: string): string {
  return escapeHtml(raw);
}
