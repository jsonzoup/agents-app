import type { Draft } from "./types";

export const HEADER_FIELDS = [
  "申报地海关","进境关别","备案号","合同协议号码","进口日期","境内收发货人-企业名称","境内收发货人-18位社会信用代码",
  "境内收发货人-10位海关编码","申报单位名称","申报单位10位海关编码","消费使用单位-企业名称","消费使用单位-18位社会信用代码",
  "消费使用单位-10位海关编码","境外收发货人-企业名称（外文）","境外收发货人-境外企业代码","运输方式","入境口岸","运输工具名称",
  "航次号","提单号","监管方式","启运国（地区）","经停港","启运港","启运时间","货物存放地点","征免性质","成交方式","运费方式",
  "具体运费","运费币制","保费币制","保费方式","具体保费","杂费方式","具体杂费","杂费币制","件数","包装种类","其他包装（额外包装种类）",
  "毛重","净重","贸易国别（地区）","目的地海关","随附单证代码","随附单证号码","清单类型","备注","特殊关系确认","价格影响确认",
  "特许权使用确认","公式价格确认","暂定价格确认","标记唛码",
];

export const ROW_FIELDS = ["商品编号(HSCODE)","商品名称","规格型号","成交数量","成交单位","单价","总价","币制","法定数量","法定单位","第二数量","第二单位","原产国（地区）","最终目的国（地区）","境内目的地（国内地区代码）","境内目的地（行政区划代码）","征免方式","检验检疫编码","海关监管证件"];

export function emptyDraft(): Draft {
  const header: Draft["header"] = {};
  for (const field of HEADER_FIELDS) header[field] = { value: "", state: "missing", confidence: 0, rule: "等待抽取", sources: [], history: [] };
  return {
    header,
    rows: [1, 2, 3].map((index) => ({ 项号: { value: String(index), state: "normal", confidence: 100, rule: "按商品行顺序", sources: [], history: [] } })),
    origin: [],
    containers: [],
    footer: {
      特殊关系确认: { value: "否", state: "normal", confidence: 100, rule: "默认否", sources: [], history: [] },
      价格影响确认: { value: "否", state: "normal", confidence: 100, rule: "默认否", sources: [], history: [] },
      特许权使用确认: { value: "否", state: "normal", confidence: 100, rule: "默认否", sources: [], history: [] },
      公式价格确认: { value: "否", state: "normal", confidence: 100, rule: "默认否", sources: [], history: [] },
      暂定价格确认: { value: "9", state: "normal", confidence: 100, rule: "未知", sources: [], history: [] },
      自报自缴: { value: "否", state: "normal", confidence: 100, rule: "默认否", sources: [], history: [] },
      报关人员: { value: "", state: "normal", confidence: 0, rule: "", sources: [], history: [] },
      申报单位: { value: "", state: "normal", confidence: 0, rule: "", sources: [], history: [] },
      "海关批注及签章": { value: "", state: "normal", confidence: 0, rule: "", sources: [], history: [] },
    },
  };
}
