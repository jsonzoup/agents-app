import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db";
import { materialFile } from "../store";
import { DSH_TURN_BUDGET_MS, runDsh, runDshStream, stopDsh } from "./agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import * as pdfParseModule from "pdf-parse";
import type { Cell, Draft, Task } from "../types";
import { emptyDraft, HEADER_FIELDS, ROW_FIELDS } from "../draft-fields";
export { emptyDraft, HEADER_FIELDS, ROW_FIELDS };

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`模型未返回 JSON：${cleaned.slice(0, 160)}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function extractDraft(task: Task, onEvent?: (event: { kind: string; text: string; name: string; id?: string; args?: string; isError?: boolean }) => void): Promise<Draft> {
  const dir = path.join(DATA_DIR, "runs", task.id, "docs");
  await fs.mkdir(dir, { recursive: true });
  await fs.rm(path.join(dir, "answer.json"), { force: true }).catch(() => undefined);
  const files: string[] = [];
  const texts: string[] = [];
  const images: string[] = [];
  for (const material of task.materials) {
    const source = await materialFile(task.id, material.id);
    if (!source) continue;
    const target = path.join(dir, material.name);
    await fs.rm(target, { force: true }).catch(() => undefined);
    await fs.copyFile(source, target);
    await fs.chmod(target, 0o644).catch(() => undefined);
    files.push(`${material.name}（${material.type || "未识别"}，${material.pages} 页）`);
    if (source.toLowerCase().endsWith(".pdf")) {
      try {
        const prefix = path.join(dir, "pages", material.name.replace(/\.pdf$/i, ""));
        await fs.mkdir(path.dirname(prefix), { recursive: true });
        await execFileAsync("/tmp/customs-venv/bin/python", ["-c", "import sys,pypdfium2 as p;d=p.PdfDocument(sys.argv[1]);n=min(len(d),8);[d[i].render(scale=2).to_pil().save(f'{sys.argv[2]}-{i+1:02d}.png') for i in range(n)]", source, prefix], { timeout: 120000 });
        for (let page = 1; page <= Math.min(material.pages, 8); page += 1) images.push(`${prefix}-${String(page).padStart(2, "0")}.png`);
      } catch { /* ignore render failure */ }
    }
    try {
      const buffer = await fs.readFile(source);
      let text = "";
      if (source.toLowerCase().endsWith(".pdf")) {
        try {
          const mod = pdfParseModule as unknown as { PDFParse: new (options: { data: Buffer }) => { getText(): Promise<{ text: string }> } };
          const parser = new mod.PDFParse({ data: buffer });
          text = (await parser.getText()).text;
        } catch { /* pdf-parse worker unavailable */ }
        if (text.replace(/-- \d+ of \d+ --/g, "").trim().length < 80) {
          try {
            const { stdout } = await execFileAsync("/tmp/customs-venv/bin/python", ["-c", "import sys,pypdf;r=pypdf.PdfReader(sys.argv[1]);print(''.join((p.extract_text() or '') for p in r.pages))", source], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
            if (stdout.trim().length > text.trim().length) text = stdout;
          } catch { /* ignore */ }
        }
      }
      if (text.trim()) texts.push(`== ${material.name} ==\n${text.trim().slice(0, 20000)}`);
    } catch (error) {
      console.error("[extract-text-error]", material.name, (error as Error)?.message);
    }
  }
  if (!files.length) throw new Error("没有可读取的资料文件");
  console.error("[extract-texts]", texts.map((t) => t.length).join(","));

  const prompt = `你是报关单提取 agent，必须真实读取当前目录下的单证文件（PDF 可用 python3 + pypdf 提取文本；图片直接读取），并遵循 ${path.join(process.cwd(), "..", "customs-extraction", "SKILL.md")} 的规则。

文件：
${files.map((f) => `- ${f}`).join("\n")}

${images.length ? `请用 read 工具逐页读取这些页面图片：\n${images.join("\n")}` : "请使用 read 工具读取上述文件。"}

要求：HS 10 位、金额保留原小数、数量单位按单据；来源写文件名和页码；不得编造，读不到就留空。`;

  const finalPrompt = task.model?.startsWith("gpt")
    ? `你是报关单字段提取助手。下面是本票资料文本，直接输出 JSON（只输出 JSON，不要调用工具，不要执行技能工作流）。\n\n${texts.join("\n\n").slice(0, 60000)}\n\n结构：{"header":{键:值},"items":[{键:值}]}\nheader 键：${HEADER_FIELDS.join("、")}\nitems 键：${ROW_FIELDS.join("、")}\n读不到的字段留空。`
    : prompt + "\n\n把最终 JSON 写入当前目录的 answer.json 文件（使用 write 或 bash 均可），文件内容必须是纯 JSON。";
  let text = "";
  if (task.model?.startsWith("gpt")) {
    text = onEvent
      ? (await runDshStream(finalPrompt, dir, undefined, `extract:${task.id}:${Date.now()}`, onEvent, DSH_TURN_BUDGET_MS, task.model, "extract")).text
      : (await runDsh(finalPrompt, dir, DSH_TURN_BUDGET_MS, undefined, task.model, "extract")).text;
  } else {
    text = onEvent
      ? (await runDshStream(finalPrompt, dir, undefined, `extract:${task.id}:${Date.now()}`, onEvent, DSH_TURN_BUDGET_MS, task.model, "extract")).text
      : (await runDsh(finalPrompt, dir, DSH_TURN_BUDGET_MS, undefined, task.model)).text;
  }
  let raw = text;
  try {
    const written = await fs.readFile(path.join(dir, "answer.json"), "utf8");
    if (written.trim().startsWith("{")) raw = written;
  } catch { /* fall back to final message */ }
  console.error("[extract-raw]", raw.slice(0, 400));
  const data = parseJson(raw) as { header?: Record<string, string>; items?: Array<Record<string, string>>; sources?: Record<string, { file?: string; page?: number }> };
  const draft = emptyDraft();
  const docId = (file?: string) => task.materials.find((m) => m.name === file)?.id ?? task.materials[0]?.id ?? "";

  for (const field of HEADER_FIELDS) {
    const value = String(data.header?.[field] ?? "").trim();
    const cell = draft.header[field];
    const src = data.sources?.[field];
    if (value) {
      cell.value = value;
      cell.state = "normal";
      cell.confidence = 100;
      cell.rule = "读取单证";
      cell.sources = src?.file ? [{ docId: docId(src.file), docName: src.file, page: src.page ?? 1 }] : [];
    }
  }

  const items = (data.items ?? []).filter((item) => Object.values(item).some((v) => String(v ?? "").trim()));
  if (!items.length) throw new Error("未抽取到商品行");
  draft.rows = items.map((item, index) => {
    const row: Record<string, Cell> = {
      项号: { value: String(index + 1), state: "normal", confidence: 100, rule: "按商品行顺序", sources: [], history: [] },
    };
    for (const field of ROW_FIELDS) {
      const value = String(item[field] ?? "").trim();
      row[field] = {
        value,
        state: value ? "normal" : "missing",
        confidence: value ? 100 : 0,
        rule: value ? "读取单证" : "未从单证中读到",
        sources: value ? [] : [],
        history: [],
      };
    }
    return row;
  });
  return draft;
}
