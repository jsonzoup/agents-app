"use client";

import * as React from "react";
import { ChevronRight, FileText, Layers } from "lucide-react";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<string, [string, string]> = {
  pdf: ["PDF", "border-[#EFCDC7] bg-[#FBF0EE] text-[#9F2D24]"],
  doc: ["DOC", "border-[#CFDAE8] bg-[#EDF2F8] text-[#1E3A5F]"],
  docx: ["DOC", "border-[#CFDAE8] bg-[#EDF2F8] text-[#1E3A5F]"],
  ppt: ["PPT", "border-[#ECD8A8] bg-[#FBF5E8] text-[#8A5A12]"],
  pptx: ["PPT", "border-[#ECD8A8] bg-[#FBF5E8] text-[#8A5A12]"],
  xls: ["XLS", "border-[#CBE3D6] bg-[#EDF6F1] text-[#2F6B4F]"],
  xlsx: ["XLS", "border-[#CBE3D6] bg-[#EDF6F1] text-[#2F6B4F]"],
  xlsm: ["XLS", "border-[#CBE3D6] bg-[#EDF6F1] text-[#2F6B4F]"],
  csv: ["CSV", "border-[#CBE3D6] bg-[#EDF6F1] text-[#2F6B4F]"],
  txt: ["TXT", "border-[#E4E0D8] bg-[#F4F2ED] text-[#4A4F57]"],
};
const label = (name: string) => STYLES[name.split(".").pop()?.toLowerCase() ?? ""]?.[0] ?? "IMG";
const style = (name: string) => STYLES[name.split(".").pop()?.toLowerCase() ?? ""]?.[1] ?? "border-[#CFDAE8] bg-[#EDF2F8] text-[#1E3A5F]";

export function MaterialsStrip({ task, onOpen }: { task: Task; onOpen: (docId: string) => void }) {
  const [open, setOpen] = React.useState(true);

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border/80 bg-white shadow-[0_1px_2px_rgba(26,29,33,0.04)]">
      <button
        className="flex w-full items-center gap-2 border-b border-border/70 px-4 py-2.5 text-left transition-colors hover:bg-[#FBFAF7]"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Layers className="size-3.5 text-[#8C8F94]" />
        <span className="text-[12px] font-medium text-[#344054]">本票资料</span>
        <span className="rounded-full bg-[#F4F2ED] px-1.5 py-0.5 text-[10px] text-[#6B6F76]">{task.materials.length} 份文件</span>
        <span className="ml-auto flex items-center gap-1 text-[10.5px] text-[#98A2B3]">
          {open ? "收起" : "展开"}
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {task.materials.map((material) => (
            <button
              key={material.id}
              onClick={() => onOpen(material.id)}
              className="group flex items-center gap-2.5 rounded-xl border border-[#E4E0D8] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#C8A45C]/60 hover:bg-[#FBFAF7]"
              title={`预览 ${material.name}`}
            >
              <span className={cn("grid size-9 flex-none place-items-center rounded-lg border text-[9.5px] font-bold", style(material.name))}>
                {label(material.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-[#1A1D21]">{material.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[#8C8F94]">
                  {material.type} · {material.pages} 页 · {material.sizeLabel}
                </span>
              </span>
              <FileText className="size-3.5 flex-none text-[#C6C9CE] transition-colors group-hover:text-[#C8A45C]" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
