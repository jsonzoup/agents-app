/** 读取 skill 内置 Excel 字典并做代码/名称双向查询（只读、进程内缓存）。 */
import path from "node:path";
import fs from "node:fs/promises";
import * as XLSX from "xlsx";
import { SKILL_ROOT } from "./skill";

type Row = Record<string, string>;
type Table = { name: string; rows: number; byCode: Map<string, string>; byName: Map<string, string> };

const cache = new Map<string, Table>();
const hsCache = new Map<string, { name: string; unit1: string; unit2: string; control: string; element: string }>();
const ciqByHs = new Map<string, { code: string; name: string }[]>();
let ciqByCode: Map<string, string> | null = null;
let units: Table | null = null;

const str = (value: unknown) => String(value ?? "").trim();

async function loadRaw(file: string): Promise<Row[]> {
  const buffer = await fs.readFile(file);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

function pick(row: Row, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && str(row[key])) return str(row[key]);
  }
  return "";
}

async function table(name: string): Promise<Table> {
  if (cache.has(name)) return cache.get(name)!;
  const rows = await loadRaw(path.join(SKILL_ROOT, "data", `${name}.xlsx`));
  const header = Object.keys(rows[0] ?? {});
  const codeKey = header.find((key) => /^(代码|编码)$/.test(key)) ?? header.find((key) => key.includes("代码") || key.includes("编码")) ?? header[0];
  const nameKey = header.find((key) => /名称|简称|中文/.test(key)) ?? header[1];
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of rows) {
    const code = str(row[codeKey]);
    const label = str(row[nameKey]);
    if (code && !byCode.has(code)) byCode.set(code, label);
    if (label && !byName.has(label)) byName.set(label, code);
  }
  const item = { name, rows: rows.length, byCode, byName };
  cache.set(name, item);
  return item;
}

export async function dictionaryStats(): Promise<Array<{ name: string; rows: number }>> {
  const files = (await fs.readdir(path.join(SKILL_ROOT, "data"))).filter((file) => file.endsWith(".xlsx"));
  return Promise.all(
    files.map(async (file) => {
      const name = file.replace(/\.xlsx$/, "");
      const rows = await loadRaw(path.join(SKILL_ROOT, "data", file));
      return { name, rows: rows.length };
    }),
  );
}

export async function resolveCode(name: string, code: string): Promise<{ code: string; name: string; table: string; matched: boolean }> {
  if (!code) return { code, name: "", table: name, matched: false };
  const item = await table(name);
  const hit = item.byCode.get(code);
  return { code, name: hit ?? "", table: name, matched: Boolean(hit) };
}

/** 码表名称较长时，技能用这些简称落代码。展示仍用原值。 */
const PACKING_ALIASES: Record<string, string> = {
  纸箱: "22",
  袋: "06",
  塑料袋: "06",
  内袋: "06",
  包: "06",
  木箱: "23",
  木制箱: "23",
  木质箱: "23",
  其他木质包装: "97",
  天然原木托: "93",
  天然木托: "93",
  再生木托: "92",
  免熏蒸木托: "92",
  人工处理木托: "92",
  塑料托盘: "99",
  纸托盘: "99",
};

function parenStem(entry: string): string {
  return entry.replace(/[（(][^）)]+[）)]$/u, "");
}

export async function resolveName(name: string, label: string): Promise<{ code: string; name: string; table: string; matched: boolean }> {
  if (!label) return { code: "", name: label, table: name, matched: false };
  const item = await table(name);
  const exact = item.byName.get(label);
  if (exact) return { code: exact, name: label, table: name, matched: true };
  for (const [entry, code] of item.byName) {
    const rest = entry.slice(label.length);
    if (entry.startsWith(label) && /^[（(][^）)]+[）)]$/.test(rest)) {
      return { code, name: label, table: name, matched: true };
    }
  }
  if (name === "包装种类") {
    const alias = PACKING_ALIASES[label];
    if (alias && item.byCode.has(alias)) return { code: alias, name: label, table: name, matched: true };
  }
  if (name === "港口") {
    const stem = label.replace(/(国际机场|机场|港)$/u, "");
    if (stem && stem !== label) {
      const codes = new Set<string>();
      for (const [entry, code] of item.byName) {
        if (parenStem(entry) === stem) codes.add(code);
      }
      if (codes.size === 1) return { code: [...codes][0]!, name: label, table: name, matched: true };
    }
  }
  return { code: "", name: label, table: name, matched: false };
}

async function loadHs() {
  if (hsCache.size) return;
  const rows = await loadRaw(path.join(SKILL_ROOT, "data", "HS编码2026.xlsx"));
  for (const row of rows) {
    const code = pick(row, ["CODE_TS", "HS编码", "商品编号"]);
    if (code && !hsCache.has(code)) {
      hsCache.set(code, {
        name: pick(row, ["G_NAME", "HS编码中文名称", "商品名称"]),
        unit1: pick(row, ["unit1", "法定单位"]),
        unit2: pick(row, ["unit2", "第二单位"]),
        control: pick(row, ["CONTROL_MARK", "监管证件"]),
        element: pick(row, ["ELEMENT", "申报要素"]),
      });
    }
  }
}

async function loadCiq() {
  if (ciqByHs.size) return;
  const rows = await loadRaw(path.join(SKILL_ROOT, "data", "CIQ代码表.xlsx"));
  ciqByCode = new Map();
  for (const row of rows) {
    const hs = pick(row, ["HS编码"]);
    const code = pick(row, ["CIQ编码"]);
    const name = pick(row, ["CIQ编码名称", "ciqcode"]);
    if (!hs || !code) continue;
    if (str(row["是否作废"]) === "是") continue;
    if (!ciqByHs.has(hs)) ciqByHs.set(hs, []);
    const list = ciqByHs.get(hs)!;
    if (list.length < 8 && !list.some((item) => item.code === code)) list.push({ code, name });
    if (!ciqByCode.has(code)) ciqByCode.set(code, name);
  }
}

export async function resolveHs(code: string) {
  await loadHs();
  await loadCiq();
  const hs = hsCache.get(code);
  const unitsTable = await table("计量单位");
  const unitName = (unit: string) => unitsTable.byCode.get(unit) ?? unit;
  return {
    code,
    matched: Boolean(hs),
    name: hs?.name ?? "",
    control: hs?.control ?? "",
    unit1: hs?.unit1 ? `${hs.unit1} ${unitName(hs.unit1)}`.trim() : "",
    unit2: hs?.unit2 ? `${hs.unit2} ${unitName(hs.unit2)}`.trim() : "",
    element: hs?.element ?? "",
    ciq: ciqByHs.get(code) ?? [],
  };
}

export async function resolveCiq(code: string): Promise<{ code: string; name: string; matched: boolean }> {
  await loadCiq();
  const name = ciqByCode?.get(code) ?? "";
  return { code, name, matched: Boolean(name) };
}

export async function resolveUnit(code: string) {
  const unitsTable = await table("计量单位");
  const name = unitsTable.byCode.get(code) ?? "";
  return { code, name, table: "计量单位", matched: Boolean(name) };
}
