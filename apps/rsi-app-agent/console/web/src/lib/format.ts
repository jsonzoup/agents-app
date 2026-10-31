export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`;
}

export const TIER: Record<string, { label: string; note: string; className: string }> = {
  knowledge: { label: "知识", note: "回路可改 · 一位管理者批准", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  code: { label: "代码", note: "回路可改 · 两位管理者批准 · 需应用自测", className: "bg-amber-50 text-amber-700 border-amber-200" },
  contract: { label: "契约", note: "只有人改 · 不走进化回路", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

export const PROPOSAL_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "待验证", className: "bg-blue-50 text-blue-700 border-blue-200" },
  verified: { label: "已验证 · 待批准", className: "bg-violet-50 text-violet-700 border-violet-200" },
  failed: { label: "验证未过", className: "bg-red-50 text-red-700 border-red-200" },
  rejected: { label: "已驳回", className: "bg-slate-100 text-slate-600 border-slate-200" },
  released: { label: "已发布", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export const SIGNAL_KIND: Record<string, string> = {
  correction: "人工修正",
  confirmation: "人工确认",
  pause: "风险暂停",
  failure: "评测失败",
  instruction: "口径指示",
  suggestion: "改进建议",
};

export function scopeLabel(scope: { level: string; key?: string; value?: string }, titles?: Record<string, string>): string {
  if (scope.level === "task") return "只这一单";
  if (scope.level === "app") return "所有任务";
  return `${titles?.[scope.key ?? ""] ?? scope.key}：${scope.value}`;
}
