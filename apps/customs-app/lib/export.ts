import ExcelJS from "exceljs";
import path from "node:path";
import { buildCodeRefs, type CodeRef } from "./code-refs";
import { codeOf, presentCoded, withParen } from "./form-codes";
import type { Cell, Draft, Task } from "./types";

const TEMPLATE = path.join(process.cwd(), "assets", "export-template.xlsx");
const LOGO = path.join(process.cwd(), "assets", "customs-form-logo.png");
const SHEET = "进口报关草单";
const APPENDIX = "进口报关草单附表";

const val = (cell?: Cell | { value: string }) => (cell && "value" in cell ? String(cell.value ?? "").trim() : "");

function trimSpec(spec: string): string {
  return spec.replace(/\|+$/, "");
}

function block(label: string, name: string, code?: string): string {
  const head = code ? `${label} (${code})` : label;
  return name ? `${head}\n${name}` : head;
}

function party(label: string, name: string, usci: string): string {
  return block(label, name, usci);
}

function composeFee(label: string, method: string, amount: string, currency: string, methodLabel: string): string {
  if (!method && !amount && !currency) return label;
  const lines = [label];
  if (method) lines.push(`${methodLabel}：${method}`);
  if (amount) lines.push(`金额：${amount}`);
  if (currency) lines.push(`币制：${currency}`);
  return lines.join("\n");
}

function set(ws: ExcelJS.Worksheet, addr: string, text: string): void {
  const cell = ws.getCell(addr);
  cell.value = text === "" ? null : text;
  cell.alignment = { vertical: "middle", horizontal: cell.alignment?.horizontal ?? "left", wrapText: true };
}

function clear(ws: ExcelJS.Worksheet, addr: string): void {
  ws.getCell(addr).value = null;
}

function placeFormLogo(workbook: ExcelJS.Workbook, ws: ExcelJS.Worksheet): void {
  const imageId = workbook.addImage({ filename: LOGO, extension: "png" });
  ws.addImage(imageId, {
    tl: { col: 1.06, row: 0.02 },
    ext: { width: 74, height: 76 },
    editAs: "oneCell",
  });
}

export async function buildDraftWorkbook(task: Task): Promise<Buffer> {
  const draft = task.draft as Draft;
  const h = draft.header;
  const refs: CodeRef[] = await buildCodeRefs(task);
  const named = (path: string, raw: string) => presentCoded(raw, codeOf(refs, path));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE);
  const ws = workbook.getWorksheet(SHEET);
  const ap = workbook.getWorksheet(APPENDIX);
  if (!ws || !ap) throw new Error("模板缺少工作表");

  const get = (field: string) => val(h[field]);

  const entry = named("header|进境关别", get("进境关别"));
  const transport = named("header|运输方式", get("运输方式"));
  const supervision = named("header|监管方式", get("监管方式"));
  const relief = named("header|征免性质", get("征免性质"));
  const trade = named("header|贸易国别（地区）", get("贸易国别（地区）"));
  const originCountry = named("header|启运国（地区）", get("启运国（地区）"));
  const stopPort = named("header|经停港", get("经停港"));
  const departPort = named("header|启运港", get("启运港"));
  const entryPort = named("header|入境口岸", get("入境口岸"));
  const term = named("header|成交方式", get("成交方式"));
  const packing = named("header|包装种类", get("包装种类"));
  const extraPack = named("header|其他包装（额外包装种类）", get("其他包装（额外包装种类）"));
  const packLines = [
    packing.name,
    extraPack.name ? `其他包装：${withParen(extraPack.name, extraPack.code)}` : "",
  ].filter(Boolean).join("\n");

  set(ws, "B3", party("境内收货人", get("境内收发货人-企业名称"), get("境内收发货人-18位社会信用代码") || get("境内收发货人-10位海关编码")));
  set(ws, "G3", block("进境关别", entry.name, entry.code));
  set(ws, "I3", get("进口日期") ? `进口日期\n${get("进口日期")}` : "进口日期");
  set(ws, "M3", get("备案号") ? `备案号\n${get("备案号")}` : "备案号");

  set(ws, "B4", party("境外发货人", get("境外收发货人-企业名称（外文）"), get("境外收发货人-境外企业代码")));
  set(ws, "G4", block("运输方式", transport.name, transport.code));
  set(
    ws,
    "I4",
    get("运输工具名称") || get("航次号")
      ? `运输工具名称及航次号\n${get("运输工具名称")}${get("航次号") ? `\n航次号：${get("航次号")}` : ""}`
      : "运输工具名称及航次号",
  );
  set(ws, "K4", get("提单号") ? `提运单号\n${get("提单号")}` : "提运单号");
  set(ws, "M4", get("货物存放地点") ? `货物存放地点\n${get("货物存放地点")}` : "货物存放地点");

  set(ws, "B5", party("消费使用单位", get("消费使用单位-企业名称"), get("消费使用单位-18位社会信用代码") || get("消费使用单位-10位海关编码")));
  set(ws, "G5", block("监管方式", supervision.name, supervision.code));
  set(ws, "I5", block("征免性质", relief.name, relief.code));
  set(ws, "K5", "许可证号");
  set(ws, "M5", block("启运港", departPort.name, departPort.code));

  set(ws, "B6", get("合同协议号码") ? `合同协议号\n${get("合同协议号码")}` : "合同协议号");
  set(ws, "G6", block("贸易国（地区）", trade.name, trade.code));
  set(ws, "I6", block("启运国（地区）", originCountry.name, originCountry.code));
  set(ws, "K6", block("经停港", stopPort.name, stopPort.code));
  set(ws, "M6", block("入境口岸", entryPort.name, entryPort.code));

  set(ws, "B7", block("包装种类", packLines, packing.code));
  set(ws, "G7", get("件数") ? `件数\n${get("件数")}` : "件数");
  set(ws, "H7", get("毛重") ? `毛重（千克）\n${get("毛重")}` : "毛重（千克）");
  set(ws, "I7", get("净重") ? `净重（千克）\n${get("净重")}` : "净重（千克）");
  set(ws, "J7", block("成交方式", term.name, term.code));
  set(ws, "K7", composeFee("运费", get("运费方式"), get("具体运费"), get("运费币制"), "运费方式"));
  set(ws, "L7", composeFee("保费", get("保费方式"), get("具体保费"), get("保费币制"), "保费方式"));
  set(ws, "N7", composeFee("杂费", get("杂费方式"), get("具体杂费"), get("杂费币制"), "杂费方式"));

  set(ws, "B8", `随附单证及编号${get("随附单证代码") ? `\n代码：${get("随附单证代码")}` : ""}${get("随附单证号码") ? `\n编号：${get("随附单证号码")}` : ""}`);
  set(ws, "B9", `标记唛码及备注\n${get("标记唛码") || ""}${get("备注") ? `\n备注：${get("备注")}` : ""}`);

  const footer = (field: string, fallback: string) => (draft.footer?.[field]?.value ?? "").trim() || fallback;
  const confirmText = (field: string) => {
    const value = footer(field, get(field));
    return value === "1" ? "是" : value === "0" ? "否" : value;
  };
  set(ws, "B31", `特殊关系确认： ${confirmText("特殊关系确认")}`);
  set(ws, "D31", `价格影响确认： ${confirmText("价格影响确认")}`);
  set(ws, "I31", `支付特许权使用费确认： ${confirmText("特许权使用确认")}`);
  set(ws, "K31", `公式定价确认： ${confirmText("公式价格确认")}`);
  set(ws, "M31", `暂定价格确认： ${confirmText("暂定价格确认")}`);
  set(ws, "N31", `自报自缴：${confirmText("自报自缴") ? ` ${confirmText("自报自缴")}` : ""}`);

  set(ws, "B33", party("申报单位", footer("申报单位", get("申报单位名称")), get("申报单位10位海关编码")));

  // 表体 20 行模板：按实际行数写入并隐藏多余行
  draft.rows.forEach((row, index) => {
    const r = 11 + index;
    const cell = (field: string) => val(row[field]);
    const at = (field: string) => named(`row|${index + 1}|${field}`, cell(field));
    const hs = cell("商品编号(HSCODE)");
    const ciq = cell("检验检疫编码");
    const control = cell("海关监管证件");
    set(ws, `B${r}`, cell("项号") || String(index + 1));
    set(ws, `C${r}`, `\n${hs}${ciq ? `\n检验检疫编码：${ciq}` : ""}${control ? `\n监管证件：${control}` : ""}`.trim());
    set(ws, `D${r}`, `${cell("商品名称")}\n${trimSpec(cell("规格型号"))}`.trim());
    set(ws, `I${r}`, `${cell("法定数量")}${cell("法定单位")}\n${cell("第二数量")}${cell("第二单位")}\n${cell("成交数量")}${cell("成交单位")}`);
    set(ws, `J${r}`, `${cell("单价")}\n${cell("总价")}\n${cell("币制")}`);
    const made = at("原产国（地区）");
    const dest = at("最终目的国（地区）");
    const domestic = at("境内目的地（国内地区代码）");
    const admin = at("境内目的地（行政区划代码）");
    const duty = at("征免方式");
    const placeNames = [domestic.name, admin.name].filter(Boolean).join("/");
    const placeCodes = [domestic.code, admin.code].filter(Boolean).join("/");
    set(ws, `L${r}`, withParen(made.name, made.code));
    set(ws, `M${r}`, withParen(dest.name, dest.code));
    set(ws, `N${r}`, placeCodes ? `${placeNames}\n(${placeCodes})` : placeNames);
    set(ws, `O${r}`, withParen(duty.name, duty.code));
  });
  for (let r = 11 + draft.rows.length; r <= 30; r += 1) {
    for (const col of ["B", "C", "D", "I", "J", "L", "M", "N", "O"]) clear(ws, `${col}${r}`);
    ws.getRow(r).hidden = true;
  }

  // 附表：头 + 原产地 13 行 + 集装箱 1 行
  set(ap, "B3", get("申报地海关") ? `申报地海关\n${get("申报地海关")}` : "申报地海关");
  set(ap, "F3", get("启运时间") ? `启运时间\n${get("启运时间")}` : "启运时间");
  set(ap, "I3", get("目的地海关") ? `目的地海关\n${get("目的地海关")}` : "目的地海关");
  set(ap, "M3", get("清单类型") ? `清单类型\n${get("清单类型")}` : "清单类型");

  const origin = draft.origin ?? [];
  for (let i = 0; i < 13; i += 1) {
    const row = origin[i];
    const r = 19 + i;
    const v = (field: string) => (row?.[field] ? String(row[field].value ?? "") : "");
    set(ap, `B${r}`, v("项号"));
    set(ap, `C${r}`, v("商品名称"));
    set(ap, `E${r}`, v("优惠贸易协定代码"));
    set(ap, `G${r}`, v("原产地证明类型"));
    set(ap, `I${r}`, v("原产地证明编号"));
    set(ap, `L${r}`, v("优惠贸易协定项下原产地"));
    set(ap, `N${r}`, v("原产地证明商品项号"));
  }

  const container = draft.containers?.[0];
  set(ap, "B35", container ? String(container["集装箱号"]?.value ?? "") : "");
  set(ap, "G35", container ? String(container["集装箱规格"]?.value ?? "") : "");
  set(ap, "K35", container ? String(container["商品项号关系"]?.value ?? "") : "");

  placeFormLogo(workbook, ws);

  const array = await workbook.xlsx.writeBuffer();
  return Buffer.from(array);
}
