/** Xiaohongshu captions are plain text, not Markdown documents. */
export function xiaohongshuPlainText(value: string): string {
  return value
    .replace(/^\s*```[^\n]*\n/gm, "")
    .replace(/^\s*```\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^\n)]+)\)/g, "$1（$2）")
    .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^ {0,3}>[ \t]?/gm, "")
    .replace(/^ {0,3}(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([^\n]+?)__/g, "$1")
    .replace(/~~([^\n]+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[，。！？、；：,.!?;:]|$)/g, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
