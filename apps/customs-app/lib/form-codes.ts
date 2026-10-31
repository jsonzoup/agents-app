import type { CodeRef } from "./code-refs";

/** 栏名右侧带编码，和报关单「进境关别 (2233)」一致。 */
export const LABEL_CODE_FIELDS = [
  "申报地海关",
  "目的地海关",
  "进境关别",
  "运输方式",
  "监管方式",
  "征免性质",
  "贸易国别（地区）",
  "启运国（地区）",
  "启运港",
  "经停港",
  "入境口岸",
  "包装种类",
  "其他包装（额外包装种类）",
  "成交方式",
] as const;

/** 栏值后面带编码，如「泰国 (THA)」「照章征税 (1)」。 */
export const VALUE_CODE_FIELDS = [
  "原产国（地区）",
  "最终目的国（地区）",
  "境内目的地（国内地区代码）",
  "境内目的地（行政区划代码）",
  "征免方式",
] as const;

export function codeOf(refs: CodeRef[] | undefined, path: string): CodeRef | undefined {
  return refs?.find((item) => item.path === path && item.matched && item.code);
}

/** 展示和导出都保持原值。代码与原值不同时才附在括号里，不把代码换成码表中文名。 */
export function presentCoded(raw: string, ref?: CodeRef): { name: string; code: string } {
  const value = raw.trim();
  if (!ref?.code || ref.code === value) return { name: value, code: "" };
  return { name: value, code: ref.code };
}

export function withParen(text: string, code?: string): string {
  if (!text) return "";
  if (!code || code === text || text.includes(`(${code})`)) return text;
  return `${text} (${code})`;
}
