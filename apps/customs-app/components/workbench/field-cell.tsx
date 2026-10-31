"use client";

import * as React from "react";
import { Check, Info, LocateFixed, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Cell } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FieldCellProps {
  cell: Cell | undefined;
  path: string;
  label?: string;
  readOnly?: boolean;
  compact?: boolean;
  bare?: boolean;
  hideTools?: boolean;
  className?: string;
  onSave?: (path: string, value: string) => void;
  onConfirm?: (path: string) => void;
  onTrace?: (path: string, cell: Cell) => void;
}

export function FieldCell({ cell, path, label, readOnly, compact, bare, hideTools, className, onSave, onConfirm, onTrace }: FieldCellProps) {
  const [openRule, setOpenRule] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const value = cell?.value ?? "";
  const low = cell?.state === "low";
  const empty = !value;

  React.useEffect(() => {
    if (ref.current && ref.current.innerText !== value) ref.current.innerText = value;
  }, [value]);

  const commit = () => {
    const text = ref.current?.innerText.replace(/\n+$/, "") ?? "";
    if (text !== value) onSave?.(path, text);
  };

  const hasSource = Boolean(cell?.sources?.length);
  const hasRule = Boolean(cell?.rule);

  return (
    <div className={cn(bare ? "group" : "cell group", className)}>
      {(label || (!hideTools && (hasSource || hasRule))) && (
        <div className="cell-label">
          {!hideTools && hasSource && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="查看资料来源"
                  className="grid size-[13px] place-items-center rounded-[3px] bg-[#EFEDE7] text-[8.5px] leading-none text-[#16294A] hover:bg-[#D5DEEA]"
                  onClick={() => cell && onTrace?.(path, cell)}
                >
                  ⌖
                </button>
              </TooltipTrigger>
              <TooltipContent>查看资料来源：{cell?.sources?.[0]?.docName} 第{cell?.sources?.[0]?.page}页</TooltipContent>
            </Tooltip>
          )}
          {!hideTools && hasRule && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="查看计算规则"
                  className="grid size-[13px] place-items-center rounded-[3px] bg-[#EDF0F7] text-[8.5px] leading-none text-[#4A4F57] hover:bg-[#E2E7F0]"
                  onClick={() => setOpenRule(true)}
                >
                  i
                </button>
              </TooltipTrigger>
              <TooltipContent>计算规则与置信度</TooltipContent>
            </Tooltip>
          )}
          {label && <span className="truncate">{label}</span>}
          {cell?.state === "edited" && <i className="size-1 rounded-full bg-[#3B5BDB]" title="人工修改" />}
          {low && <i className="size-1 rounded-full bg-destructive" title="低置信度" />}
        </div>
      )}

      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-label={label ?? path}
        className={cn(
          "cell-value",
          empty && cell?.state === "missing" && "cell-value-empty",
          low && "cell-value-low",
          compact && "text-[10.5px] leading-[1.4]",
          readOnly && "cursor-default",
        )}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            (event.target as HTMLDivElement).blur();
          }
          if (event.key === "Escape") {
            if (ref.current) ref.current.innerText = value;
            (event.target as HTMLDivElement).blur();
          }
        }}
      />

      <Dialog open={openRule} onOpenChange={setOpenRule}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{(label ?? path.split("|").pop()) + " · 计算规则"}</DialogTitle>
            <DialogDescription>抽取依据与一致性校验（文案由 agent 返回）</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 pb-2 text-[12.5px] leading-relaxed">
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[#3c4c43]">{cell?.rule || "暂无规则说明"}</p>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">置信度</span>
              <span className={cn("font-semibold", low ? "text-destructive" : "text-primary")}>{cell?.confidence ?? 0}%</span>
            </div>
            {low && (
              <div className="flex items-start gap-2 rounded-lg bg-[#FBF0EE] px-3 py-2 text-[11.5px] text-[#B23A2E]">
                <TriangleAlert className="mt-0.5 size-3.5" /> 置信度偏低，请人工核对后再提交。
              </div>
            )}
            {cell?.history?.length ? (
              <div className="text-[11px] text-muted-foreground">
                最近修改：{cell.history.at(-1)?.by} · {cell.history.at(-1)?.at.slice(0, 16).replace("T", " ")}（{cell.history.at(-1)?.before || "空"} → {cell.history.at(-1)?.after}）
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {low && !readOnly && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onConfirm?.(path);
                  setOpenRule(false);
                }}
              >
                <Check className="size-3.5" /> 确认无误
              </Button>
            )}
            <Button variant="default" size="sm" onClick={() => setOpenRule(false)}>
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
