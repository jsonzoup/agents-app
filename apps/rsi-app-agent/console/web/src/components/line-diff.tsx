"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Op = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };

/** Line diff by longest common subsequence; inputs here are app files, a few thousand lines at most. */
function diffLines(before: string, after: string): Op[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ kind: "same", text: a[i], a: ++i, b: ++j });
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i], a: ++i });
    else out.push({ kind: "add", text: b[j], b: ++j });
  }
  while (i < n) out.push({ kind: "del", text: a[i], a: ++i });
  while (j < m) out.push({ kind: "add", text: b[j], b: ++j });
  return out;
}

export function LineDiff({ before, after, context = 3 }: { before: string | null; after: string | null; context?: number }) {
  const [full, setFull] = useState(false);
  const ops = useMemo(() => diffLines(before ?? "", after ?? ""), [before, after]);
  const keep = useMemo(() => {
    const k = new Array(ops.length).fill(full);
    if (!full) ops.forEach((o, i) => o.kind !== "same" && k.fill(true, Math.max(0, i - context), Math.min(ops.length, i + context + 1)));
    return k;
  }, [ops, full, context]);
  if (before === null && after === null) return <p className="p-3 text-xs text-muted-foreground">二进制文件，不显示差异。</p>;
  const rows: React.ReactNode[] = [];
  let gap = 0;
  ops.forEach((o, i) => {
    if (!keep[i]) {
      gap++;
      return;
    }
    if (gap) {
      rows.push(
        <button key={`g${i}`} onClick={() => setFull(true)} className="block w-full bg-muted/60 px-3 py-0.5 text-left text-muted-foreground hover:bg-muted">
          ⋯ {gap} 行未改动
        </button>,
      );
      gap = 0;
    }
    rows.push(
      <div key={i} className={cn("grid grid-cols-[3rem_3rem_1rem_1fr]", o.kind === "add" && "bg-emerald-50", o.kind === "del" && "bg-red-50")}>
        <span className="select-none pr-2 text-right text-muted-foreground/60">{o.a ?? ""}</span>
        <span className="select-none pr-2 text-right text-muted-foreground/60">{o.b ?? ""}</span>
        <span className={cn("select-none", o.kind === "add" && "text-emerald-700", o.kind === "del" && "text-red-700")}>{o.kind === "add" ? "+" : o.kind === "del" ? "-" : ""}</span>
        <span className="whitespace-pre-wrap break-all">{o.text}</span>
      </div>,
    );
  });
  if (gap) rows.push(<div key="gend" className="bg-muted/60 px-3 py-0.5 text-muted-foreground">⋯ {gap} 行未改动</div>);
  return <div className="overflow-auto font-mono text-xs leading-5">{rows}</div>;
}
