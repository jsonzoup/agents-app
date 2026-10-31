"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, FileText, FileWarning, Loader2, Maximize2, Sheet, X, ZoomIn, ZoomOut } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Material, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DocTarget {
  docId: string;
  page: number;
  rect?: [number, number, number, number] | null;
  region?: string;
}

type PreviewState =
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "text"; text: string; note?: string }
  | { kind: "sheet"; sheets: Array<{ name: string; rows: string[][] }>; note?: string }
  | { kind: "slides"; slides: Array<{ index: number; text: string }>; note?: string }
  | { kind: "unsupported"; note: string };

interface ViewerProps {
  task: Task;
  target: DocTarget | null;
  onTarget: (target: DocTarget | null) => void;
  sourceField: string | null;
  onCloseSource: () => void;
  readOnly?: boolean;
}

export function DocViewer({ task, target, onTarget, sourceField, onCloseSource }: ViewerProps) {
  const [docId, setDocId] = React.useState<string>(target?.docId ?? task.materials[0]?.id ?? "");
  const [page, setPage] = React.useState<number>(target?.page ?? 1);
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sheetIndex, setSheetIndex] = React.useState(0);
  const [zoom, setZoom] = React.useState(1);
  const [fullOpen, setFullOpen] = React.useState(false);

  React.useEffect(() => {
    if (target?.docId) setDocId(target.docId);
    if (target?.page) setPage(target.page);
  }, [target]);

  const material: Material | undefined = task.materials.find((m) => m.id === docId) ?? task.materials[0];
  const materialId = material?.id ?? "";
  const pageCount = Math.max(1, material?.pages ?? 1);
  const current = Math.min(page, pageCount);
  const isDemo = Boolean(material?.key);
  const fileUrl = material ? api.fileUrl(task.id, material.id) : "";

  React.useEffect(() => {
    if (!materialId) return;
    if (isDemo) {
      setPreview({ kind: "image" });
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setPreview(null);
    api
      .preview(task.id, materialId)
      .then(({ preview: data }) => {
        if (alive) setPreview(data as PreviewState);
      })
      .catch(() => alive && setPreview({ kind: "unsupported", note: "预览加载失败，可下载原文件查看。" }))
      .finally(() => alive && setLoading(false));
    setSheetIndex(0);
    return () => {
      alive = false;
    };
  }, [materialId, isDemo, task.id]);

  const rect = target?.docId === material?.id ? target?.rect : null;

  const go = (next: number) => {
    const value = Math.min(Math.max(1, next), pageCount);
    setPage(value);
    onTarget({ docId: material?.id ?? "", page: value, region: target?.region });
  };

  const imageSrc = isDemo && material?.key ? `/docs/${material.key}/p-${String(current).padStart(2, "0")}.jpg` : fileUrl;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sourceField && (
        <div className="mx-3 mt-2.5 rounded-xl border border-[#D8E1EC] bg-[#F7F5F1] px-3 py-2">
          <div className="flex items-center justify-between text-[11.5px] font-medium text-[#16294A]">
            <span>{sourceField} · 资料来源</span>
            <button onClick={onCloseSource} className="rounded p-0.5 hover:bg-[#E4EAF2]" aria-label="关闭来源">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-[#4A4F57]">
            {material?.name ?? "—"} · 第 {current} 页 · {target?.region || "整页"}
          </div>
        </div>
      )}

      <div className="scroll-thin flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2.5">
        {task.materials.map((mat) => (
          <button
            key={mat.id}
            onClick={() => {
              setDocId(mat.id);
              setPage(1);
              onTarget({ docId: mat.id, page: 1 });
            }}
            className={cn(
              "flex flex-none items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              mat.id === material?.id
                ? "border-[#1E3A5F] bg-[#1E3A5F] text-white"
                : "border-border bg-white text-[#4A4F57] hover:bg-[#F7F5F1]",
            )}
            title={`${mat.name}（${mat.pages} 页）`}
          >
            <FileText className="size-3" />
            {mat.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 10)}
          </button>
        ))}
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 justify-start overflow-auto bg-[#F4F2ED] p-3">
        {loading && (
          <div className="flex items-center gap-2 self-center text-[12px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 正在解析文档…
          </div>
        )}

        {!loading && preview?.kind === "image" && (
          <div className="w-full self-start">
            <div className="relative mx-auto" style={{ width: `${Math.round(zoom * 100)}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={imageSrc}
                src={imageSrc}
                alt={`${material?.name} 第${current}页`}
                className="block w-full rounded-[4px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.16)]"
              />
              {rect && (
                <div
                  className="pointer-events-none absolute rounded-[3px] border-2 border-[#B4791F] bg-[#B4791F]/20 shadow-[0_0_0_3px_rgba(180,121,31,0.18)]"
                  style={{
                    left: `${rect[0] * 100}%`,
                    top: `${rect[1] * 100}%`,
                    width: `${rect[2] * 100}%`,
                    height: `${rect[3] * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {!loading && preview?.kind === "pdf" && (
          <iframe
            key={`${fileUrl}-${current}`}
            src={`${fileUrl}#page=${current}&toolbar=0&navpanes=0&view=FitH`}
            title={material?.name}
            className="h-full min-h-[62vh] w-full rounded-lg border-0 bg-white shadow-sm"
          />
        )}

        {!loading && preview?.kind === "text" && (
          <div className="w-full self-start rounded-lg border bg-white p-3.5 shadow-sm">
            <div className="mb-2 text-[10.5px] text-muted-foreground">{preview.note}</div>
            <pre className="scroll-thin max-h-[56vh] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-6 text-[#363B42]">
              {preview.text}
            </pre>
          </div>
        )}

        {!loading && preview?.kind === "sheet" && (
          <div className="w-full self-start">
            <div className="mb-2 flex flex-wrap gap-1">
              {preview.sheets.map((sheet, index) => (
                <button
                  key={sheet.name}
                  onClick={() => setSheetIndex(index)}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px]",
                    index === sheetIndex ? "border-[#1E3A5F] bg-[#EDF2F8] text-[#16294A]" : "bg-white text-[#4A4F57]",
                  )}
                >
                  <Sheet className="size-3" /> {sheet.name}
                </button>
              ))}
            </div>
            <div className="scroll-thin max-h-[56vh] overflow-auto rounded-lg border bg-white shadow-sm">
              <table className="w-full border-collapse text-[10.5px]">
                <tbody>
                  {(preview.sheets[sheetIndex]?.rows ?? []).map((row, rowIndex) => (
                    <tr key={rowIndex} className={rowIndex === 0 ? "bg-[#F6F4EF] font-medium" : "odd:bg-white even:bg-[#FBFAF7]"}>
                      <td className="sticky left-0 border-b border-r bg-inherit px-1.5 py-1 text-[9px] text-[#8C8F94]">{rowIndex + 1}</td>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="max-w-[160px] truncate border-b px-1.5 py-1">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">{preview.note}</div>
          </div>
        )}

        {!loading && preview?.kind === "slides" && (
          <div className="w-full space-y-2 self-start">
            <div className="text-[10.5px] text-muted-foreground">{preview.note}</div>
            {preview.slides.map((slide) => (
              <div key={slide.index} className="rounded-lg border bg-white p-3 shadow-sm">
                <div className="mb-1 text-[10px] font-medium text-[#6B6F76]">Slide {slide.index}</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11.5px] leading-5 text-[#363B42]">
                  {slide.text || "（此页无文本）"}
                </pre>
              </div>
            ))}
          </div>
        )}

        {!loading && preview?.kind === "unsupported" && (
          <div className="flex max-w-[300px] flex-col items-center gap-2 self-center rounded-xl border bg-white px-4 py-6 text-center shadow-sm">
            <FileWarning className="size-6 text-[#8A5A12]" />
            <div className="text-[12px] leading-relaxed text-[#4A4F57]">{preview.note}</div>
            <a href={fileUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <Download className="size-3.5" /> 下载原文件
              </Button>
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3.5 py-2 text-[11.5px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => go(current - 1)} disabled={current <= 1}>
            <ChevronLeft className="size-3.5" /> 上一页
          </Button>
          <span className="tabular-nums">{current} / {pageCount}</span>
          <Button variant="ghost" size="sm" onClick={() => go(current + 1)} disabled={current >= pageCount}>
            下一页 <ChevronRight className="size-3.5" />
          </Button>
          {preview?.kind === "image" && (
            <span className="ml-2 flex items-center gap-0.5 rounded-md border border-border bg-white px-0.5">
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))} aria-label="缩小">
                <ZoomOut className="size-3.5" />
              </Button>
              <span className="w-9 text-center text-[10.5px] tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))} aria-label="放大">
                <ZoomIn className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setFullOpen(true)} aria-label="全屏预览">
                <Maximize2 className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
        <a href={fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[#1E3A5F] hover:underline">
          <Download className="size-3.5" /> 原文件
        </a>
      </div>

      <Dialog open={fullOpen} onOpenChange={setFullOpen}>
        <DialogContent className="w-[min(1200px,96vw)] max-w-none p-2">
          <div className="relative mx-auto w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt={`${material?.name} 第${current}页`} className="max-h-[86vh] w-auto rounded bg-white" />
            {rect && (
              <div
                className="pointer-events-none absolute rounded-[3px] border-2 border-[#B4791F] bg-[#B4791F]/20"
                style={{
                  left: `${rect[0] * 100}%`,
                  top: `${rect[1] * 100}%`,
                  width: `${rect[2] * 100}%`,
                  height: `${rect[3] * 100}%`,
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
