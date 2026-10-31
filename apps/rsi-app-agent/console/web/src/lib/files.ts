/** How the console shows a file, decided by its name. */

export type FileKind = "markdown" | "code" | "csv" | "sheet" | "docx" | "pptx" | "pdf" | "image" | "video" | "audio" | "binary";

const EXT = (path: string) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "").toLowerCase();

const LANGUAGES: Record<string, string> = {
  json: "json",
  jsonc: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  txt: "plaintext",
  csv: "plaintext",
  tsv: "plaintext",
  log: "plaintext",
  env: "plaintext",
};

export function fileKind(path: string, isText?: boolean | null): FileKind {
  const ext = EXT(path);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm" || ext === "ods") return "sheet";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (ext === "pdf") return "pdf";
  if (ext === "svg") return isText === false ? "image" : "code";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  if (ext in LANGUAGES || isText) return "code";
  return "binary";
}

export function languageOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (name === "Dockerfile") return "dockerfile";
  if (name === ".mcp.json" || name.endsWith(".json")) return "json";
  return LANGUAGES[EXT(path)] ?? "plaintext";
}

/** Kinds the browser shows from the raw bytes (no text needed). */
export const PREVIEWABLE: FileKind[] = ["sheet", "docx", "pptx", "pdf", "image", "video", "audio"];

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** URL path segments, each encoded. */
export const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const CP437_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

/**
 * The file name people should see. Archives made on Chinese Windows store GBK names that
 * unzip as CP437 (“║╧═¼.PDF” for “合同.PDF”), and some tools escape characters as `%U00A0`.
 */
export function displayName(path: string): string {
  let name = path.split("/").pop() ?? path;
  name = name.replace(/%U([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\u00a0/g, " ");
  if (/[\u2500-\u25ff]/.test(name) && [...name].every((c) => c.charCodeAt(0) < 128 || CP437_HIGH.includes(c))) {
    const bytes = Uint8Array.from([...name], (c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 128 + CP437_HIGH.indexOf(c)));
    try {
      return new TextDecoder("gbk", { fatal: true }).decode(bytes);
    } catch {
      return name;
    }
  }
  return name;
}
