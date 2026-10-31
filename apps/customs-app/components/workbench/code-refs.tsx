"use client";

import * as React from "react";
import { ChevronRight, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CodeRefItem {
  path: string;
  field: string;
  code: string;
  name: string;
  table: string;
  matched: boolean;
  note?: string;
}

export function CodeRefs({ refs }: { refs: CodeRefItem[] }) {
  const [open, setOpen] = React.useState(true);
  if (!refs.length) return null;
  const matched = refs.filter((ref) => ref.matched).length;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border/80 bg-white shadow-[0_1px_2px_rgba(26,29,33,0.04)]">
      <button
        className="flex w-full items-center gap-2 border-b border-border/70 px-4 py-2.5 text-left transition-colors hover:bg-[#FBFAF7]"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Hash className="size-3.5 text-[#8C8F94]" />
        <span className="text-[12px] font-medium text-[#344054]">编码参考</span>
        <span className="rounded-full bg-[#F4F2ED] px-1.5 py-0.5 text-[10px] text-[#6B6F76]">{refs.length} 项</span>
        <span className="rounded-full bg-[#EDF6F1] px-1.5 py-0.5 text-[10px] text-[#2F6B4F]">字典命中 {matched}</span>
        {refs.length - matched > 0 && (
          <span className="rounded-full bg-[#FBF5E8] px-1.5 py-0.5 text-[10px] text-[#8A5A12]">未匹配 {refs.length - matched}</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[10.5px] text-[#98A2B3]">
          {open ? "收起" : "展开"}
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="scroll-thin max-h-[280px] overflow-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead className="sticky top-0 z-[1] bg-[#FBFAF7] text-[10.5px] text-[#8C8F94]">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">字段</th>
                <th className="px-3 py-1.5 text-left font-medium">代码</th>
                <th className="px-3 py-1.5 text-left font-medium">名称 / 说明</th>
                <th className="px-3 py-1.5 text-left font-medium">字典来源</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((ref) => (
                <tr key={`${ref.path}|${ref.code}`} className="border-t border-[#F0EDE6] align-top hover:bg-[#FBFAF7]">
                  <td className="whitespace-nowrap px-3 py-1.5 text-[#4A4F57]">{ref.field}</td>
                  <td className={cn("whitespace-nowrap px-3 py-1.5 font-mono text-[11px]", ref.matched ? "text-[#1E3A5F]" : "text-[#8A5A12]")}>
                    {ref.code}
                    {!ref.matched && <span className="ml-1.5 rounded bg-[#FBF5E8] px-1 py-0.5 text-[9px]">未匹配</span>}
                  </td>
                  <td className="px-3 py-1.5 text-[#1A1D21]">
                    <span className="block">{ref.name || "—"}</span>
                    {ref.note && <span className="mt-0.5 block text-[10px] text-[#8C8F94]">{ref.note}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-[10.5px] text-[#8C8F94]">{ref.table}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
