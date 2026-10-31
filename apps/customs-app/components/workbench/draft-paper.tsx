"use client";

import * as React from "react";
import { Download, FileCheck2, Info } from "lucide-react";
import { toast } from "sonner";
import { FieldCell } from "@/components/workbench/field-cell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { codeOf, presentCoded, withParen } from "@/lib/form-codes";
import type { Cell, Task } from "@/lib/types";
import { cn, formatAmount } from "@/lib/utils";

interface DraftPaperProps {
  task: Task;
  readOnly?: boolean;
  onSave: (path: string, value: string) => void;
  onConfirm: (path: string) => void;
  onTrace: (path: string, cell: Cell) => void;
  onExport: () => Promise<void>;
}

export function DraftPaper({ task, readOnly, onSave, onConfirm, onTrace, onExport }: DraftPaperProps) {
  const [confirmExport, setConfirmExport] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const draft = task.draft;
  if (!draft) return null;

  const props = { readOnly, onSave, onConfirm, onTrace };
  const h = (field: string) => draft.header[field];
  const coded = (path: string, raw?: string) => presentCoded(raw ?? "", codeOf(task.codeRefs, path));
  const viewCell = (path: string, cell?: Cell, place: "label" | "value" = "label"): Cell | undefined => {
    if (!cell) return cell;
    const pair = coded(path, cell.value);
    const value = place === "value" ? withParen(pair.name, pair.code) : pair.name;
    return value === cell.value ? cell : { ...cell, value };
  };
  const field = (name: string, label: string, className?: string) => {
    const pair = coded(`header|${name}`, h(name)?.value);
    return <FieldCell {...props} path={`header|${name}`} cell={viewCell(`header|${name}`, h(name))} label={pair.code ? `${label} (${pair.code})` : label} className={className} />;
  };
  const sub = (name: string, tag: string, className?: string) => (
    <div className={cn("flex items-center gap-1 text-[9px] text-[#8C8F94]", className)}>
      <span className="shrink-0">{tag}</span>
      <FieldCell {...props} path={`header|${name}`} cell={h(name)} compact hideTools className="min-w-0 flex-1" />
    </div>
  );

  let pricedRows = 0;
  const total = draft.rows.reduce((sum, row) => {
    const rawText = String(row["总价"]?.value ?? "").replace(/,/g, "").trim();
    if (!rawText) return sum;
    const raw = Number(rawText);
    if (!Number.isFinite(raw)) return sum;
    pricedRows += 1;
    return sum + raw;
  }, 0);
  const currency = draft.rows[0]?.["币制"]?.value || "CNY";
  const missing =
    Object.values(draft.header).filter((cell) => cell.state === "missing").length +
    draft.rows.reduce((acc, row) => acc + Object.values(row).filter((cell) => cell.state === "missing").length, 0);

  const doExport = async () => {
    setExporting(true);
    try {
      await onExport();
      setConfirmExport(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-[800px] pb-10">
      <div className="paper px-3.5 pb-3 pt-3.5">
        <div className="mb-1 border-b-2 border-[#1E3A5F] pb-1.5 text-center">
          <div className="text-[17px] font-bold tracking-[2px] text-[#0B1220]">中华人民共和国海关进口货物报关单</div>
          <div className="mt-0.5 text-[11px] text-[#4A4F57]">{h("申报地海关")?.value ? `(${h("申报地海关")?.value})` : ""}</div>
          <div className="mt-1 flex items-center justify-between text-[8.5px] text-[#6B6F76]">
            <span>预录入编号：{task.id}</span>
            <span>海关编号：—</span>
            <span>仅供核对用</span>
            <span>页码/页数：1/1</span>
          </div>
        </div>

        <div className="form-grid mt-1.5">
          <div className="cell col-span-4">
            <FieldCell
              {...props}
              path="header|境内收发货人-企业名称"
              cell={h("境内收发货人-企业名称")}
              label={`境内收货人${(h("境内收发货人-18位社会信用代码")?.value || h("境内收发货人-10位海关编码")?.value) ? ` (${h("境内收发货人-18位社会信用代码")?.value || h("境内收发货人-10位海关编码")?.value})` : ""}`}
            />
          </div>
          {field("进境关别", "进境关别", "col-span-2")}
          {field("进口日期", "进口日期", "col-span-2")}
          <div className="cell col-span-2">
            <div className="cell-label">申报日期</div>
            <div className="cell-value text-[#8C8F94]">—</div>
          </div>
          {field("备案号", "备案号", "col-span-2")}

          <div className="cell col-span-3">
            <FieldCell
              {...props}
              path="header|境外收发货人-企业名称（外文）"
              cell={h("境外收发货人-企业名称（外文）")}
              label={`境外发货人${h("境外收发货人-境外企业代码")?.value ? ` (${h("境外收发货人-境外企业代码")?.value})` : ""}`}
            />
          </div>
          {field("运输方式", "运输方式", "col-span-2")}
          <div className="cell col-span-3">
            <FieldCell {...props} path="header|运输工具名称" cell={h("运输工具名称")} label="运输工具名称及航次号" />
            {sub("航次号", "航次", "mt-1")}
          </div>
          {field("提单号", "提运单号", "col-span-2")}
          {field("货物存放地点", "货物存放地点", "col-span-2")}

          <div className="cell col-span-4">
            <FieldCell
              {...props}
              path="header|消费使用单位-企业名称"
              cell={h("消费使用单位-企业名称")}
              label={`消费使用单位${(h("消费使用单位-18位社会信用代码")?.value || h("消费使用单位-10位海关编码")?.value) ? ` (${h("消费使用单位-18位社会信用代码")?.value || h("消费使用单位-10位海关编码")?.value})` : ""}`}
            />
          </div>
          {field("监管方式", "监管方式", "col-span-2")}
          {field("征免性质", "征免性质", "col-span-2")}
          <div className="cell col-span-2">
            <div className="cell-label">许可证号</div>
            <div className="cell-value text-[#8C8F94]">—</div>
          </div>
          {field("启运港", "启运港", "col-span-2")}

          {field("合同协议号码", "合同协议号", "col-span-3")}
          {field("贸易国别（地区）", "贸易国（地区）", "col-span-2")}
          {field("启运国（地区）", "启运国（地区）", "col-span-2")}
          {field("经停港", "经停港", "col-span-2")}
          {field("入境口岸", "入境口岸", "col-span-3")}

          <div className="cell col-span-3">
            {(() => {
              const main = coded("header|包装种类", h("包装种类")?.value);
              const extra = coded("header|其他包装（额外包装种类）", h("其他包装（额外包装种类）")?.value);
              return (
                <>
                  <FieldCell
                    {...props}
                    path="header|包装种类"
                    cell={viewCell("header|包装种类", h("包装种类"))}
                    label={main.code ? `包装种类 (${main.code})` : "包装种类"}
                  />
                  {extra.name ? (
                    <div className="mt-1 text-[10.5px] leading-snug text-[#1A1D21]">其他包装：{withParen(extra.name, extra.code)}</div>
                  ) : null}
                </>
              );
            })()}
          </div>
          {field("件数", "件数", "col-span-1")}
          {field("毛重", "毛重（千克）", "col-span-2")}
          {field("净重", "净重（千克）", "col-span-2")}
          {field("成交方式", "成交方式", "col-span-1")}
          <div className="cell col-span-1">
            <div className="cell-label">运费</div>
            {sub("运费方式", "", "")}
            {sub("具体运费", "", "")}
            {sub("运费币制", "", "")}
          </div>
          <div className="cell col-span-1">
            <div className="cell-label">保费</div>
            {sub("保费方式", "", "")}
            {sub("具体保费", "", "")}
            {sub("保费币制", "", "")}
          </div>
          <div className="cell col-span-1">
            <div className="cell-label">杂费</div>
            {sub("杂费方式", "", "")}
            {sub("具体杂费", "", "")}
            {sub("杂费币制", "", "")}
          </div>

          <div className="cell col-span-6">
            <div className="cell-label">随附单证及编号</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {sub("随附单证代码", "代码", "min-w-0 flex-1")}
              {sub("随附单证号码", "编号", "min-w-0 flex-[2]")}
            </div>
          </div>
          <div className="cell col-span-6">
            <div className="cell-label">标记唛码及备注</div>
            <div className="flex items-start gap-2">
              <FieldCell {...props} path="header|标记唛码" cell={h("标记唛码")} compact hideTools className="w-16 shrink-0" />
              <FieldCell {...props} path="header|备注" cell={h("备注")} compact hideTools className="min-w-0 flex-1" />
            </div>
          </div>
        </div>

        <div className="mt-0 overflow-x-auto border border-t-0 border-[#D2CCC1]">
          <table className="goods-table">
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>项号</th>
                <th>商品编号</th>
                <th>商品名称及规格型号</th>
                <th>数量及单位</th>
                <th>单价/总价/币制</th>
                <th>原产国（地区）</th>
                <th>最终目的国（地区）</th>
                <th>境内目的地</th>
                <th>征免</th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((row, index) => {
                const p = (name: string) => `row|${index + 1}|${name}`;
                const cell = (name: string) => row[name];
                return (
                  <tr key={index}>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          aria-label="查看本行来源"
                          className="grid size-3 place-items-center rounded-[3px] bg-[#EFEDE7] text-[7.5px] leading-none text-[#16294A]"
                          onClick={() => {
                            const first = Object.values(row).find((item) => item.sources?.length);
                            if (first) onTrace(p("项号"), first);
                          }}
                        >
                          ⌖
                        </button>
                        <span className="text-[10.5px]">{row["项号"]?.value ?? index + 1}</span>
                      </div>
                    </td>
                    <td>
                      <FieldCell bare hideTools {...props} path={p("商品编号(HSCODE)")} cell={cell("商品编号(HSCODE)")} compact />
                      <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[#8C8F94]">
                        <span>CIQ</span>
                        <FieldCell bare hideTools {...props} path={p("检验检疫编码")} cell={cell("检验检疫编码")} compact className="min-w-0 flex-1" />
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-[#8C8F94]">
                        <span>证件</span>
                        <FieldCell bare hideTools {...props} path={p("海关监管证件")} cell={cell("海关监管证件")} compact className="min-w-0 flex-1" />
                      </div>
                    </td>
                    <td>
                      <FieldCell bare hideTools {...props} path={p("商品名称")} cell={cell("商品名称")} compact />
                      <FieldCell bare hideTools {...props} path={p("规格型号")} cell={cell("规格型号")} compact className="mt-0.5 text-[9.5px] text-[#363B42]" />
                    </td>
                    <td className="text-right">
                      {[
                        ["法定数量", "法定单位"],
                        ["第二数量", "第二单位"],
                        ["成交数量", "成交单位"],
                      ].map(([qty, unit]) => {
                        const amount = cell(qty)?.value?.trim();
                        const measure = cell(unit)?.value?.trim();
                        if (!amount && !measure) return null;
                        return (
                          <div key={qty} className="flex items-center justify-end gap-0.5">
                            <FieldCell bare hideTools {...props} path={p(qty)} cell={cell(qty)} compact className="max-w-[72px] text-right" />
                            <FieldCell bare hideTools {...props} path={p(unit)} cell={cell(unit)} compact className="w-[36px] text-[9.5px] text-[#8C8F94]" />
                          </div>
                        );
                      })}
                    </td>
                    <td className="text-right">
                      {(["单价", "总价", "币制"] as const).map((name) => {
                        if (!cell(name)?.value?.trim()) return null;
                        return (
                          <div key={name} className="flex items-center justify-end">
                            <FieldCell bare hideTools {...props} path={p(name)} cell={cell(name)} compact className={cn("text-right", name === "币制" && "text-[9.5px] text-[#8C8F94]")} />
                          </div>
                        );
                      })}
                    </td>
                    <td>
                      <FieldCell bare hideTools {...props} path={p("原产国（地区）")} cell={viewCell(p("原产国（地区）"), cell("原产国（地区）"), "value")} compact />
                    </td>
                    <td>
                      <FieldCell bare hideTools {...props} path={p("最终目的国（地区）")} cell={viewCell(p("最终目的国（地区）"), cell("最终目的国（地区）"), "value")} compact />
                    </td>
                    <td>
                      {(() => {
                        const domestic = coded(p("境内目的地（国内地区代码）"), cell("境内目的地（国内地区代码）")?.value);
                        const admin = coded(p("境内目的地（行政区划代码）"), cell("境内目的地（行政区划代码）")?.value);
                        return (
                          <div className="space-y-0.5 text-[9.5px] leading-snug text-[#1A1D21]">
                            <div>
                              <span className="text-[#8C8F94]">国内地区 </span>
                              {domestic.name ? withParen(domestic.name, domestic.code) : "—"}
                            </div>
                            <div>
                              <span className="text-[#8C8F94]">行政区划 </span>
                              {admin.name ? withParen(admin.name, admin.code) : "—"}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="text-center">
                      <FieldCell bare hideTools {...props} path={p("征免方式")} cell={viewCell(p("征免方式"), cell("征免方式"), "value")} compact className="text-[9.5px]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="footer-grid mt-0">
          {(
            [
              ["特殊关系确认", "特殊关系确认"],
              ["价格影响确认", "价格影响确认"],
              ["特许权使用确认", "支付特许权使用费确认"],
              ["公式价格确认", "公式定价确认"],
              ["暂定价格确认", "暂定价格确认"],
              ["自报自缴", "自报自缴"],
            ] as const
          ).map(([name, label]) => (
            <div key={name} className="cell flex items-center gap-1">
              <span className="shrink-0 text-[9.5px] text-[#6B6F76]">{label}：</span>
              <FieldCell bare hideTools {...props} path={`footer|${name}`} cell={draft.footer[name]} compact className="min-w-0 flex-1" />
            </div>
          ))}
        </div>

        <div className="sign-grid">
          {[
            ["报关人员", "报关人员"],
            ["报关人员证号", "报关人员证号"],
            ["电话", "电话"],
            ["申报单位", "申报单位"],
            ["海关批注及签章", "海关批注及签章"],
          ].map(([name, label]) => (
            <div key={name} className="cell">
              <div className="cell-label">
                {name === "申报单位" && h("申报单位10位海关编码")?.value ? `申报单位 (${h("申报单位10位海关编码")?.value})` : label}
              </div>
              {name === "申报单位" ? (
                <FieldCell bare hideTools {...props} path={`footer|${name}`} cell={draft.footer[name]} className="text-[11px]" />
              ) : (
                <FieldCell bare hideTools {...props} path={`footer|${name}`} cell={draft.footer[name]} className="text-[11px]" />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-4 border-b border-[#D2CCC1] bg-[#FBFAF7] px-1 py-2">
          <span className="text-[11px] text-muted-foreground">合计总价</span>
          <span className="text-[14px] font-bold tabular-nums">{pricedRows ? formatAmount(total) : "—"}</span>
          <span className="text-[11px] text-muted-foreground">{currency}</span>
        </div>

        <div className="flex items-center justify-between gap-3 px-0.5 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <FileCheck2 className="size-3.5" /> 共 {draft.rows.length} 项商品
            </span>
            {missing > 0 && (
              <span className="flex items-center gap-1 text-[#B23A2E]">
                <Info className="size-3.5" /> {missing} 个字段待补充，导出时留空
              </span>
            )}
            <span className="text-[#8C8F94]">字段可直接点击编辑，失焦即保存</span>
          </div>
          <Button variant="primary" size="lg" disabled={readOnly || exporting} onClick={() => (missing > 0 ? setConfirmExport(true) : doExport())}>
            <Download className="size-4" /> {exporting ? "正在导出…" : "导出草单"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmExport} onOpenChange={setConfirmExport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>存在未填写字段，确认导出？</DialogTitle>
            <DialogDescription>
              草单中仍有 {missing} 个「待补充」字段，导出文件对应单元格将留空。你可以先补录，或确认后直接导出。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="default" size="sm" onClick={() => setConfirmExport(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={exporting} onClick={doExport}>
              确认导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
