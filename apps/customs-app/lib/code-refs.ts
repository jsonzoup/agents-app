/** 从草单中提取代码类字段，用 skill 内置字典还原中文名称，供报关系统对接参考。 */
import { resolveCiq, resolveCode, resolveHs, resolveName, resolveUnit } from "./dictionaries";
import type { Task } from "./types";
import { fieldLabel } from "./status";

export interface CodeRef {
  path: string;
  field: string;
  code: string;
  name: string;
  table: string;
  matched: boolean;
  note?: string;
}

const HEADER_TABLE: Array<[RegExp, string]> = [
  [/进境关别|申报地海关|目的地海关/, "关区代码"],
  [/入境口岸/, "口岸代码"],
  [/启运港|经停港/, "港口"],
  [/监管方式/, "监管方式"],
  [/征免性质/, "征免性质"],
  [/成交方式/, "成交方式"],
  [/币制/, "币制"],
  [/原产国|启运国|贸易国|运抵国|目的地/, "国别"],
  [/包装种类/, "包装种类"],
];

const NAME_TABLE: Array<[RegExp, string]> = [[/运输方式/, "运输方式"], [/随附单证代码/, "随附单证"]];

async function resolveEither(table: string, value: string) {
  const byCode = await resolveCode(table, value);
  if (byCode.matched) return byCode;
  const byName = await resolveName(table, value);
  if (byName.matched) return { code: byName.code, name: value, table, matched: true };
  return { code: value, name: "", table, matched: false };
}

export async function buildCodeRefs(task: Task): Promise<CodeRef[]> {
  if (!task.draft) return [];
  const refs: CodeRef[] = [];
  const seen = new Set<string>();
  const push = (ref: CodeRef) => {
    const key = `${ref.field}|${ref.code}`;
    if (!ref.code || seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const [field, cell] of Object.entries(task.draft.header)) {
    const value = cell.value?.trim();
    if (!value) continue;
    for (const [pattern, table] of HEADER_TABLE) {
      if (!pattern.test(field)) continue;
      const tokens = value.split(/[;,；、]/).map((item) => item.trim()).filter(Boolean);
      for (const token of tokens.length > 1 ? tokens : [value]) {
        const hit = await resolveEither(table, token);
        push({ path: `header|${field}`, field: fieldLabel(field) || field, code: hit.code, name: hit.code === token && !hit.matched ? "" : hit.name || token, table, matched: hit.matched });
      }
    }
    for (const [pattern, table] of NAME_TABLE) {
      if (pattern.test(field)) {
        const hit = await resolveEither(table, value);
        push({ path: `header|${field}`, field: fieldLabel(field) || field, code: hit.code, name: hit.matched ? hit.name || value : "", table, matched: hit.matched });
      }
    }
  }

  for (const [index, row] of task.draft.rows.entries()) {
    const hsCell = row["商品编号(HSCODE)"];
    if (hsCell?.value) {
      const hs = hsCell.value.trim();
      const info = await resolveHs(hs);
      const note = [
        info.control ? `监管证件 ${info.control}` : "",
        info.unit1 ? `法定单位 ${info.unit1}` : "",
        info.unit2 ? `第二单位 ${info.unit2}` : "",
        info.ciq[0] ? `CIQ ${info.ciq[0].code} ${info.ciq[0].name}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      push({ path: `row|${index + 1}|商品编号(HSCODE)`, field: `商品编号（第 ${index + 1} 项）`, code: hs, name: info.name, table: "HS编码2026", matched: info.matched, note });
      for (const code of (info.control || "").split(/[^0-9A-Za-z]/).filter((item) => item.length === 1 || item.length === 2)) {
        push({ path: `row|${index + 1}|监管证件`, field: `监管证件（第 ${index + 1} 项）`, code, name: "证件代码（字典中无名称表）", table: "HS编码2026 · CONTROL_MARK", matched: true });
      }
    }
    const ciqCell = row["检验检疫编码"];
    if (ciqCell?.value) {
      const rawCiq = ciqCell.value.trim();
      const hsValue = row["商品编号(HSCODE)"]?.value?.trim() ?? "";
      const fullCiq = rawCiq.length <= 3 && hsValue ? `${hsValue}${rawCiq.padStart(3, "0")}` : rawCiq;
      const ciq = await resolveCiq(fullCiq);
      push({ path: `row|${index + 1}|检验检疫编码`, field: `检验检疫编码（第 ${index + 1} 项）`, code: fullCiq, name: ciq.name, table: "CIQ代码表", matched: ciq.matched });
    }
    const rowTables: Array<[RegExp, string]> = [
      [/^币制$/, "币制"],
      [/原产国|最终目的国/, "国别"],
      [/境内目的地（国内地区代码）/, "境内货源地"],
      [/境内目的地（行政区划代码）/, "行政区划代码"],
      [/征免方式/, "征免方式"],
    ];
    for (const [pattern, table] of rowTables) {
      for (const field of Object.keys(row)) {
        if (!pattern.test(field)) continue;
        const value = row[field]?.value?.trim();
        if (!value) continue;
        const hit = await resolveEither(table, value);
        push({ path: `row|${index + 1}|${field}`, field: `${fieldLabel(field) || field}（第 ${index + 1} 项）`, code: hit.code, name: hit.matched ? hit.name || value : "", table, matched: hit.matched });
      }
    }
    const controlValue = row["海关监管证件"]?.value?.trim();
    if (controlValue) {
      for (const code of controlValue.split(/[;,；、\s]+/).filter(Boolean)) {
        push({ path: `row|${index + 1}|海关监管证件`, field: `海关监管证件（第 ${index + 1} 项）`, code, name: "证件代码", table: "HS编码2026 · CONTROL_MARK", matched: true });
      }
    }
    for (const unitField of ["法定单位", "第二单位", "成交单位"]) {
      const unit = row[unitField];
      if (!unit?.value) continue;
      const rawUnit = unit.value.trim();
      const hit = await resolveUnit(rawUnit);
      if (hit.matched) {
        push({ path: `row|${index + 1}|${unitField}`, field: `${unitField}（第 ${index + 1} 项）`, code: rawUnit, name: hit.name, table: "计量单位", matched: true });
      } else {
        const byName = await resolveName("计量单位", rawUnit);
        push({ path: `row|${index + 1}|${unitField}`, field: `${unitField}（第 ${index + 1} 项）`, code: byName.matched ? byName.code : rawUnit, name: byName.matched ? rawUnit : "", table: "计量单位", matched: byName.matched });
      }
    }
  }

  return refs;
}
