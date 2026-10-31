import { promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import * as XLSX from "xlsx";

export type Preview =
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "text"; text: string; note?: string }
  | { kind: "sheet"; sheets: Array<{ name: string; rows: string[][] }>; note?: string }
  | { kind: "slides"; slides: Array<{ index: number; text: string }>; note?: string }
  | { kind: "unsupported"; note: string };

const decoder = new TextDecoder("utf-8");
const trim = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

function xmlText(xml: string): string {
  return trim(
    xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/a:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))),
  );
}

function docxPreview(buffer: Buffer): Preview {
  const zip = unzipSync(new Uint8Array(buffer));
  const entry = zip["word/document.xml"];
  if (!entry) return { kind: "unsupported", note: "docx 中未找到正文（word/document.xml）" };
  const body = xmlText(decoder.decode(entry));
  return { kind: "text", text: body.slice(0, 12000), note: "Word 正文（段落与表格文本）" };
}

function pptxPreview(buffer: Buffer): Preview {
  const zip = unzipSync(new Uint8Array(buffer));
  const slides = Object.keys(zip)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
    .map((name) => ({ index: Number(name.match(/slide(\d+)/)?.[1] ?? 0), text: xmlText(decoder.decode(zip[name])) }));
  if (!slides.length) return { kind: "unsupported", note: "pptx 中未找到幻灯片" };
  return { kind: "slides", slides, note: `${slides.length} 页幻灯片（文本视图）` };
}

function sheetPreview(buffer: Buffer): Preview {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheets = workbook.SheetNames.slice(0, 6).map((name) => {
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, blankrows: false, raw: false });
    return {
      name,
      rows: rows.slice(0, 60).map((row) => (row as unknown[]).slice(0, 14).map((cell) => (cell == null ? "" : String(cell)))),
    };
  });
  return { kind: "sheet", sheets, note: `${workbook.SheetNames.length} 个工作表，最多展示 6 个` };
}

export async function buildPreview(file: string, name: string): Promise<Preview> {
  const ext = path.extname(name || file).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext)) return { kind: "image" };
  if (ext === ".pdf") return { kind: "pdf" };
  if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    const text = await fs.readFile(file, "utf8");
    return { kind: "text", text: text.slice(0, 16000), note: "纯文本" };
  }
  if ([".doc", ".ppt"].includes(ext)) {
    return {
      kind: "unsupported",
      note: "旧版二进制 Office 格式（.doc/.ppt）无法在线预览，已保存原文件，可下载查看；建议另存为 .docx/.pptx。",
    };
  }
  const buffer = await fs.readFile(file);
  if (ext === ".docx") return docxPreview(buffer);
  if (ext === ".pptx") return pptxPreview(buffer);
  if ([".xlsx", ".xlsm", ".xls"].includes(ext)) return sheetPreview(buffer);
  return { kind: "unsupported", note: "暂不支持在线预览，可下载原文件查看。" };
}
