"use client";

import * as React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CompactionView, Message, SessionContext } from "@/lib/types";

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const scaled = Math.round(value / 100) / 10;
    return `${scaled}K`;
  }
  const scaled = Math.round(value / 100_000) / 10;
  return `${scaled}M`;
}

function token(value: number | undefined): string {
  return value === undefined ? "—" : formatTokens(value);
}

function rows(context: SessionContext | undefined): Array<{ label: string; value: string }> {
  const model = context?.model?.split("/").pop() || "—";
  return [
    { label: "模型", value: model },
    { label: "窗口", value: token(context?.contextWindow) },
    { label: "未缓存", value: token(context?.inputTokens) },
    { label: "缓存读", value: token(context?.cacheReadTokens) },
    { label: "缓存写", value: token(context?.cacheWriteTokens) },
    { label: "输出", value: token(context?.outputTokens) },
    { label: "卸图", value: String(context?.imageOffloads ?? 0) },
  ];
}

export function contextReading(context: SessionContext | undefined): { percent: number; label: string } | null {
  if (!context || context.pressureTokens === undefined || !context.contextWindow) return null;
  const percent = Math.min(100, Math.round((context.pressureTokens / context.contextWindow) * 100));
  return { percent, label: `${formatTokens(context.pressureTokens)} / ${formatTokens(context.contextWindow)}` };
}

export function ContextBar({
  context,
  compactions,
}: {
  context?: SessionContext;
  compactions: Message[];
}) {
  const [open, setOpen] = React.useState(false);
  const reading = contextReading(context);
  const radius = 5.5;
  const circumference = 2 * Math.PI * radius;
  const percent = reading?.percent ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] text-[#4A4F57] transition-colors hover:bg-[#F4F2ED]"
        aria-expanded={open}
        aria-label={reading ? `上下文已用 ${reading.percent}%` : "上下文尚未统计"}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r={radius} fill="none" stroke="#E4E0D8" strokeWidth="2" />
          <circle
            cx="7"
            cy="7"
            r={radius}
            fill="none"
            stroke={percent >= 85 ? "#9F2D24" : "#1E3A5F"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
        <span>{reading ? `上下文 ${reading.percent}%` : "上下文"}</span>
        {compactions.length > 0 && <span className="text-[#8C8F94]">压缩 {compactions.length}</span>}
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-30 rounded-xl border border-[#E4E0D8] bg-white px-2.5 py-2 text-[12px] shadow-xl"
          style={{ width: 232 }}
        >
          <div className="mb-1.5 flex items-baseline justify-between gap-2 whitespace-nowrap">
            <strong className="text-[12px]">{reading ? `已用 ${reading.percent}%` : "尚未统计"}</strong>
            {reading && <span className="font-mono text-[10.5px] text-[#8C8F94]">{reading.label}</span>}
          </div>
          <dl className="text-[11px] leading-5">
            {rows(context).map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-[#8C8F94]">{row.label}</dt>
                <dd className="min-w-0 truncate text-right font-mono">{row.value}</dd>
              </div>
            ))}
          </dl>
          {compactions.length > 0 && (
            <div className="mt-1.5 border-t border-[#EFEBE3] pt-1.5">
              <div className="text-[10.5px] text-[#8C8F94]">压缩 {compactions.length}</div>
              <div className="overflow-auto" style={{ maxHeight: 64 }}>
                {compactions.map((message) => (
                  <div key={message.id} className="truncate text-[11px] leading-5 text-[#363B42]">
                    {compactionLabel(message.compaction)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function compactionLabel(info: CompactionView | undefined): string {
  if (!info) return "压缩";
  if (info.mode === "prune") {
    const count = info.shadowedItemCount ?? 0;
    const tokens = info.shadowedTokenCount !== undefined ? `，约 ${formatTokens(info.shadowedTokenCount)} tokens` : "";
    return `裁剪了 ${count} 条较早的工具结果${tokens}`;
  }
  if (info.status === "running") return "正在压缩更早的对话";
  if (info.status === "error") return info.error || "压缩失败";
  const count = info.shadowedItemCount !== undefined ? `${info.shadowedItemCount} 条` : "较早内容";
  const tokens = info.shadowedTokenCount !== undefined ? `，约 ${formatTokens(info.shadowedTokenCount)} tokens` : "";
  return `已压缩 ${count}${tokens}`;
}

export function CompactionRow({ message }: { message: Message }) {
  const info = message.compaction;
  const [open, setOpen] = React.useState(false);
  const expandable = Boolean(info?.summary);
  return (
    <div className="rounded-xl border border-[#E4E0D8] bg-[#FBFAF7]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#4A4F57]"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="grid size-4 place-items-center rounded-full bg-[#EDF2F8] text-[9px] text-[#1E3A5F]">压</span>
        <span className="font-medium text-[#1A1D21]">{info?.mode === "prune" ? "裁剪" : "压缩"}</span>
        <span className="min-w-0 flex-1 truncate">{compactionLabel(info)}</span>
      </button>
      {open && info?.summary && (
        <div className="dsh-prose border-t border-[#EFEBE3] px-3 py-2 text-[12.5px]">
          <Markdown remarkPlugins={[remarkGfm]}>{info.summary}</Markdown>
        </div>
      )}
    </div>
  );
}
