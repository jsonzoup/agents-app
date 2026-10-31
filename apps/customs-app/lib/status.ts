import type { Cell, Draft, Status, Task, TaskSummary } from "./types";

export const REQUIRED_TYPES = ["合同", "商业发票", "装箱单", "提运单", "报关委托书"];
export const STATUS_TODO: Status[] = ["待补充", "待确认", "待复核"];
export const STATUS_ORDER: Status[] = ["待补充", "待确认", "待复核", "处理中", "可交付", "已交付"];

export function iterCells(draft: Draft | null): Array<[string, Cell]> {
  if (!draft) return [];
  const list: Array<[string, Cell]> = [];
  for (const [field, cell] of Object.entries(draft.header)) list.push([`header|${field}`, cell]);
  draft.rows.forEach((row, index) => {
    for (const [field, cell] of Object.entries(row)) list.push([`row|${index + 1}|${field}`, cell]);
  });
  for (const [field, cell] of Object.entries(draft.footer ?? {})) list.push([`footer|${field}`, cell]);
  return list;
}

export function counts(draft: Draft | null) {
  let missing = 0;
  let low = 0;
  let total = 0;
  for (const [, cell] of iterCells(draft)) {
    total += 1;
    if (cell.state === "missing") missing += 1;
    else if (cell.state === "low") low += 1;
  }
  return { missing, low, total };
}

export function recomputeStatus(task: Task): void {
  if (["处理中", "已交付", "可交付"].includes(task.status)) return;
  const { missing, low } = counts(task.draft);
  task.status = missing > 0 ? "待补充" : low > 0 ? "待确认" : "待复核";
}

export function stepName(status: Status): string {
  switch (status) {
    case "处理中":
      return "资料解析";
    case "待补充":
      return "资料补充";
    case "待确认":
      return "草单确认";
    case "待复核":
      return "等待复核";
    case "可交付":
    case "已交付":
      return "交付";
    default:
      return "草单确认";
  }
}

const CORE_DOC_TYPES = ["合同", "商业发票", "装箱单", "提运单"];

const UNNAMED_CUSTOMER = new Set(["", "待识别客户", "未识别客户"]);

/** 建单时还没有客户名。草单写出境内收货人后，用该企业名称作为本票客户。 */
export function adoptConsignee(task: Task): boolean {
  const company = task.draft?.header["境内收发货人-企业名称"]?.value?.trim() ?? "";
  if (!company || task.customer === company) return false;
  if (!UNNAMED_CUSTOMER.has(task.customer.trim())) return false;
  task.customer = company;
  const ticket = task.name.trim() || "进口制单";
  task.title = `${company} · ${ticket}`;
  return true;
}

export function taskSummary(task: Task): TaskSummary {
  const c = counts(task.draft);
  const have = new Set(task.materials.map((material) => material.type));
  const codeRefs = task.codeRefs ?? [];
  return {
    id: task.id,
    title: task.title,
    customer: task.customer,
    name: task.name,
    owner: task.owner,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    missing: c.missing,
    low: c.low,
    total: c.total,
    filled: c.total - c.missing,
    materialCount: task.materials.length,
    missingDocs: CORE_DOC_TYPES.filter((type) => !have.has(type)),
    codeTotal: codeRefs.length,
    codeUnmatched: codeRefs.filter((ref) => !ref.matched).length,
    version: task.version,
    step: stepName(task.status),
    itemCount: task.draft?.rows.length ?? 0,
  };
}

export function findCell(task: Task, cellPath: string): Cell | null {
  const [group, a, b] = cellPath.split("|");
  if (!task.draft) return null;
  if (group === "header") return task.draft.header[a] ?? null;
  if (group === "row") return task.draft.rows[Number(a) - 1]?.[b] ?? null;
  return task.draft.footer?.[a] ?? null;
}

export function fieldLabel(cellPath: string): string {
  const parts = cellPath.split("|");
  if (parts[0] === "row") return `第${parts[1]}项 · ${parts[2]}`;
  return parts[parts.length - 1];
}
