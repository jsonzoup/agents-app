"use client";

import { Pill } from "@/components/shell/page";
import { cn } from "@/lib/utils";

export function tone(score: number) {
  return score >= 1
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
    : score >= 0.8
      ? "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : "bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300";
}

export function SplitBadge({ split, locked }: { split: "dev" | "holdout"; locked?: boolean }) {
  return split === "holdout" ? (
    <Pill className="border-violet-200 bg-violet-50 text-violet-700" >
      留出集{locked ? " · 契约" : ""}
    </Pill>
  ) : (
    <Pill className="border-sky-200 bg-sky-50 text-sky-700">开发集</Pill>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return <pre className={cn("overflow-auto rounded-md border bg-muted/30 p-2.5 font-mono text-[11.5px] leading-[1.45]", className)}>{value === undefined ? "—" : JSON.stringify(value, null, 2)}</pre>;
}

export const RUN_STATUS: Record<string, { label: string; className: string }> = {
  queued: { label: "排队中", className: "border-slate-200 bg-slate-50 text-slate-700" },
  running: { label: "评测中", className: "border-blue-200 bg-blue-50 text-blue-700" },
  done: { label: "完成", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", className: "border-red-200 bg-red-50 text-red-700" },
};
