"use client";

import * as React from "react";
import { BookOpen, Database, FileCode2, ListTree, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { SkillInfo } from "@/lib/api";
import type { Task } from "@/lib/types";
import { DshToolHistory, ToolRow } from "@/components/copilot/tool-row";
import { MCP_SERVER } from "@/lib/mcp/meta";

export function SkillPanel({ task }: { task: Task | null }) {
  const [info, setInfo] = React.useState<SkillInfo | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    api.skill().then((data) => setInfo(data.skill)).catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="p-4 text-[12px] text-[#B23A2E]">{error}</div>;
  if (!info) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> 正在加载 skill…
      </div>
    );
  }

  const tools = (task?.messages ?? []).filter((message) => message.kind === "tool" && message.tool);

  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
      <div className="rounded-xl border border-[#D8E1EC] bg-gradient-to-br from-[#F7F5F1] to-white p-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-[#1E3A5F] text-white">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              {info.name}
              <span className="rounded bg-[#EDF2F8] px-1.5 py-0.5 text-[10px] font-medium text-[#16294A]">v{info.version}</span>
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">{info.root}</div>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
          {[
            [info.references.length, "规则文件"],
            [info.tables.length, "标准码表"],
            [info.capabilities.length, "核心能力"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg border border-[#E4EAF2] bg-white px-1 py-1.5">
              <div className="text-[14px] font-semibold text-[#16294A]">{value}</div>
              <div className="text-[9.5px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {info.scenes.map((scene) => (
            <span key={scene} className="rounded-full border border-[#e0e8fa] bg-white px-1.5 py-0.5 text-[9.5px] text-[#4A4F57]">
              {scene}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#363B42]">
        <ListTree className="size-3.5 text-[#6B6F76]" /> 核心能力
      </div>
      <div className="mt-1.5 space-y-1">
        {info.capabilities.map((item, index) => (
          <div key={item.title} className="flex gap-2 rounded-lg border bg-white px-2.5 py-1.5">
            <span className="mt-0.5 grid size-4 flex-none place-items-center rounded bg-[#EDF2F8] text-[9px] font-semibold text-[#16294A]">
              {index + 1}
            </span>
            <div>
              <div className="text-[11.5px] font-medium">{item.title}</div>
              <div className="text-[10.5px] leading-snug text-muted-foreground">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#363B42]">
        <FileCode2 className="size-3.5 text-[#6B6F76]" /> 已加载规则
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">SKILL.md · references/</span>
      </div>
      <div className="scroll-thin mt-1.5 max-h-56 space-y-1 overflow-y-auto pr-0.5">
        {info.references.map((ref) => (
          <div key={ref.file} className="rounded-lg border bg-white px-2.5 py-1.5">
            <div className="truncate text-[11.5px] text-[#363B42]">{ref.title}</div>
            <div className="truncate font-mono text-[9.5px] text-[#8C8F94]">references/{ref.file}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#363B42]">
        <Database className="size-3.5 text-[#6B6F76]" /> 标准码表
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">data/</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {info.tables.map((table) => (
          <span key={table} className="max-w-full truncate rounded-md border bg-white px-1.5 py-0.5 font-mono text-[9.5px] text-[#4A4F57]">
            {table}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#344054]">
        <Database className="size-3.5 text-[#667085]" /> MCP 服务
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">business-draft v1.0.0</span>
      </div>
      <div className="mt-1.5 rounded-lg border bg-white px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="rounded bg-[#EDF2F8] px-1.5 py-0.5 font-mono text-[9.5px] text-[#1E3A5F]">{MCP_SERVER.endpoint}</span>
          <span className="rounded bg-[#F4F2ED] px-1.5 py-0.5 text-[9.5px]">{MCP_SERVER.transport}</span>
          <span className="ml-auto">{MCP_SERVER.tools.length} 个工具</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {MCP_SERVER.tools.map((tool) => (
            <span key={tool.name} title={tool.description} className="rounded border border-[#E4E0D8] bg-[#FBFAF7] px-1.5 py-0.5 font-mono text-[9px] text-[#4A4F57]">
              {tool.name}
            </span>
          ))}
        </div>
      </div>

      {tools.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-[#363B42]">
            <BookOpen className="size-3.5 text-[#6B6F76]" /> 本票运行记录
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">{tools.length} 次调用</span>
          </div>
          <DshToolHistory messages={tools}>
            <div className="mt-1 space-y-1.5">
              {tools.map((message) => message.tool && <ToolRow key={message.id} callId={message.id} tool={message.tool} />)}
            </div>
          </DshToolHistory>
        </>
      )}
    </div>
  );
}
