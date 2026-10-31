"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, FolderOpen, Info, Loader2, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/components/providers";
import { api } from "@/lib/api";
import { REQUIRED_TYPES } from "@/lib/status";
import { cn } from "@/lib/utils";

interface UploadRow {
  id: string;
  name: string;
  size: number;
  sizeLabel?: string;
  pages: number;
  type: string;
  typeGuess: string;
  confidence: string;
}

const OPTIONAL_TYPES = ["原产地证", "申报要素", "其他"];

const ICONS: Record<string, [string, string]> = {
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
const iconLabel = (name: string) => ICONS[name.split(".").pop()?.toLowerCase() ?? ""]?.[0] ?? "IMG";
const iconClass = (name: string) => ICONS[name.split(".").pop()?.toLowerCase() ?? ""]?.[1] ?? "border-[#dde5fb] bg-[#eef4ff] text-[#3b5bdb]";

export function NewTask() {
  const router = useRouter();
  const { readOnly } = useRole();
  const [rows, setRows] = React.useState<UploadRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const types = React.useMemo(() => new Set(rows.map((row) => row.type).filter(Boolean)), [rows]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    for (const file of list) {
      if (file.size > 45 * 1024 * 1024) {
        toast.error(`${file.name} 超过 45MB`);
        continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      }).catch(() => "");
      if (!data) continue;
      try {
        const { upload } = await api.upload(file.name, data);
        const row: UploadRow = { ...upload, confidence: upload.confidence };
        setRows((prev) => {
          const sameType = row.type && prev.find((item) => item.type === row.type);
          if (sameType && row.type !== "其他") {
            // 同类重复：提示后保留两份，以最新一份为准
            toast.message(`已存在同类资料，保留两份（${row.type}以最新一份为准）`);
          }
          return [...prev, row];
        });
      } catch (error) {
        toast.error(`${file.name} 上传失败：${(error as Error).message}`);
      }
    }
    setBusy(false);
  };

  const start = async () => {
    if (readOnly || rows.length === 0) return;
    setStarting(true);
    try {
      const typesMap: Record<string, string> = {};
      rows.forEach((row) => {
        if (row.type) typesMap[row.id] = row.type;
      });
      const { task } = await api.createTask({
        uploadIds: rows.map((row) => row.id),
        prompt,
        types: typesMap,
        model: window.localStorage.getItem("bgl-model") || undefined,
      });
      router.push(`/work/${task.id}`);
    } catch (error) {
      toast.error((error as Error).message);
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[960px] px-6 pb-16 pt-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">新建制单</h1>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            上传本票原始单证，Copilot 会加载 customs-extraction 技能逐份识别并生成可追溯的报关草单。
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11px]">
            {["上传资料", "生成草单", "核对交付"].map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                <span className={cn("flex items-center gap-1.5 rounded-full border px-2 py-1", index === 0 ? "border-[#8FA6C0] bg-[#F7F5F1] text-[#16294A]" : "border-border bg-white text-[#8C8F94]")}>
                  <span className={cn("grid size-4 place-items-center rounded-full text-[9px] font-semibold", index === 0 ? "bg-[#1E3A5F] text-white" : "bg-[#F3F1EC] text-[#8C8F94]")}>{index + 1}</span>
                  {step}
                </span>
                {index < 2 && <span className="text-[#D6D2CA]">›</span>}
              </span>
            ))}
          </div>
        </div>

      </div>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div
          onClick={() => !readOnly && inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!readOnly) addFiles(event.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#c6d5cb] bg-[#FBFAF7] px-5 py-8 text-center transition-colors hover:border-[#7C9BF0] hover:bg-[#F2F6FD]",
            dragging && "border-[#7C9BF0] bg-[#F2F6FD]",
            readOnly && "pointer-events-none opacity-60",
          )}
        >
          <span className="grid size-10 place-items-center rounded-full bg-secondary text-primary">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
          </span>
          <strong className="text-[13.5px] font-semibold">点击或拖拽上传制单资料</strong>
          <small className="text-[11.5px] text-muted-foreground">PDF · Word · PPT · Excel · 图片 · 文本，支持多选，单文件 ≤ 45MB</small>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.xlsm,.csv,.txt,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <div className="mt-4 space-y-2">
          {rows.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-[12px] text-muted-foreground">
              <FolderOpen className="size-4" /> 还没有资料，先上传合同、发票、装箱单等原件。
            </div>
          )}
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[38px_1fr_auto_auto_28px] items-center gap-2.5 rounded-[10px] border bg-white px-3 py-2">
              <span className={cn("grid size-[34px] place-items-center rounded-lg border text-[9.5px] font-bold", row.name.toLowerCase().endsWith(".pdf") ? "border-[#E3E9F2] bg-[#F2F0EB] text-[#5d7568]" : "border-[#DDE5FB] bg-[#EEF4FF] text-[#3B5BDB]")}>
                {row.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium">{row.name}</div>
                <div className="text-[10.5px] text-muted-foreground">
                  {row.sizeLabel} · {/\.pdf$/i.test(row.name) ? `${row.pages} 页` : "文档"} · 识别完成
                </div>
              </div>
              {row.type ? (
                <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px]", REQUIRED_TYPES.includes(row.type) ? "border-[#d3e7db] bg-secondary text-secondary-foreground" : "border-[#E3E8F1] bg-[#F3F1EC] text-[#6f7d75]")}>
                  {row.type}
                </span>
              ) : (
                <Select
                  value=""
                  onValueChange={(value) =>
                    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, type: value } : item)))
                  }
                >
                  <SelectTrigger className="h-7 border-[#F3D9A4] bg-[#FFF7E6] px-2 text-[10.5px] text-[#B45309]">
                    <SelectValue placeholder="未识别 · 指定类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...REQUIRED_TYPES, ...OPTIONAL_TYPES].map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                className="grid size-6 place-items-center rounded-full text-[#8C8F94] hover:bg-[#FBF0EE] hover:text-[#B23A2E]"
                onClick={() => setRows((prev) => prev.filter((item) => item.id !== row.id))}
                disabled={readOnly}
                aria-label="移除文件"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted-foreground">
          <span>
            已上传 <b className="text-foreground">{rows.length}</b> 份资料
            {types.size > 0 && <span className="mx-1.5 text-[#D6D2CA]">·</span>}
            {types.size > 0 && <span>{Array.from(types).join("、")}</span>}
          </span>
        </div>

        <div className="mt-5 border-t pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#344054]">
            本票特殊要求
            <span className="font-normal text-[#98A2B3]">（选填）</span>
          </div>
          <Textarea
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="填写本票需要特别注意的事项，例如：成交方式以合同为准、赠品单独列一行申报。不填可直接开始"
            disabled={readOnly}
          />
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            需要上传完整资料：「合同」、「商业发票」、「装箱单」、「提运单」、「报关委托书」
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" size="lg" onClick={start} disabled={readOnly || starting || busy || rows.length === 0}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            {starting ? "正在初始化…" : "开始制单"}
          </Button>
          <span className="text-[11.5px] text-muted-foreground">
            {rows.length ? `已上传 ${rows.length} 份资料，可直接开始` : "请先上传至少一份资料"}
          </span>
        </div>
      </section>

    </div>
  );
}
