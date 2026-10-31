import { emptyDraft, HEADER_FIELDS, ROW_FIELDS } from "./draft-fields";
import type { Cell, Draft, Material, SourceRef } from "./types";

type SkillCell = { value?: unknown; reason?: unknown; needs_review?: unknown; sources?: unknown };

function asCell(raw: unknown): SkillCell {
  if (raw && typeof raw === "object" && "value" in raw) return raw as SkillCell;
  return { value: raw ?? "" };
}

function text(raw: unknown): string {
  return String(asCell(raw).value ?? "").trim();
}

function sourcesOf(raw: unknown, materials: Material[]): SourceRef[] {
  const list = asCell(raw).sources;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as { material_id?: string; file?: string; pages?: number[] };
    const page = source.pages?.[0] ?? 1;
    const name = source.file || source.material_id || "";
    const material = materials.find((entry) => entry.id === source.material_id || entry.name === name || entry.name === source.file);
    return [{ docId: material?.id ?? "", docName: material?.name || name, page }];
  });
}

function fill(cell: Cell, raw: unknown, materials: Material[]): void {
  const parsed = asCell(raw);
  const value = String(parsed.value ?? "").trim();
  cell.value = value;
  cell.rule = String(parsed.reason ?? "").trim() || (value ? "customs-extraction" : "未从单证中读到");
  cell.sources = sourcesOf(raw, materials);
  if (!value) {
    cell.state = "missing";
    cell.confidence = 0;
    return;
  }
  cell.state = parsed.needs_review ? "low" : "normal";
  cell.confidence = parsed.needs_review ? 60 : 100;
}

function headerEntries(payload: Record<string, unknown>): Array<[string, unknown]> {
  const header = payload.header;
  if (Array.isArray(header)) {
    return header.flatMap((item) => {
      if (!item || typeof item !== "object" || !("field" in item)) return [];
      const field = String((item as { field?: unknown }).field ?? "");
      return field ? [[field, item] as [string, unknown]] : [];
    });
  }
  if (header && typeof header === "object") return Object.entries(header as Record<string, unknown>);
  return [];
}

function bodyRows(payload: Record<string, unknown>): unknown[] {
  if (Array.isArray(payload.items)) return payload.items;
  const table = payload.table_body;
  if (table && typeof table === "object" && Array.isArray((table as { basic?: unknown }).basic)) {
    return (table as { basic: unknown[] }).basic;
  }
  return [];
}

/** 把技能最终 JSON（或扁平 header/items）投影成工作台草单。 */
export function draftFromResult(payload: Record<string, unknown>, materials: Material[]): Draft {
  const draft = emptyDraft();
  for (const [field, raw] of headerEntries(payload)) {
    if (draft.header[field]) fill(draft.header[field], raw, materials);
    if (draft.footer[field]) fill(draft.footer[field], raw, materials);
  }
  const rows = bodyRows(payload).filter((row) => row && typeof row === "object");
  if (rows.length) {
    draft.rows = rows.map((row, index) => {
      const record = row as Record<string, unknown>;
      const built: Draft["rows"][number] = {
        项号: { value: text(record["项号"]) || String(index + 1), state: "normal", confidence: 100, rule: "按商品行顺序", sources: [], history: [] },
      };
      for (const field of ROW_FIELDS) {
        built[field] = { value: "", state: "missing", confidence: 0, rule: "未从单证中读到", sources: [], history: [] };
        if (field in record) fill(built[field], record[field], materials);
      }
      return built;
    });
  }
  if (!headerEntries(payload).some(([field]) => HEADER_FIELDS.includes(field)) && !rows.length) {
    throw new Error("结果里没有表头或商品行");
  }
  return draft;
}
