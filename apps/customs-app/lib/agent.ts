import { counts, findCell, fieldLabel, iterCells, recomputeStatus } from "./status";
import type { AskQuestion, Cell, Message, SourceRef, Task } from "./types";
import { nowIso, uid } from "./db";
import { sourceTool } from "./skill";

export const ASK_QUESTIONS: AskQuestion[] = [
  {
    id: "party",
    label: "境内收发货人主体",
    hint: "合同/发票买方与提单收货人均为 FOREST SENLIN；校对稿填的是报关行「上海航联报关」。",
    options: [
      { value: "buyer", label: "采用提单收货人 FOREST SENLIN", desc: "与合同 Buyer、发票 Buyer/Consignee 一致" },
      { value: "draft", label: "采用校对稿主体 上海航联报关", desc: "若本票为代理进口，需改由代理企业申报" },
    ],
  },
  {
    id: "date",
    label: "进口日期",
    hint: "校对稿为 20260630；提单只载装船日 2026-06-23，未见进境申报回执。",
    options: [
      { value: "draft", label: "采用 20260630", desc: "沿用校对稿日期" },
      { value: "bl", label: "采用 20260623", desc: "按提单装船日填写" },
      { value: "skip", label: "先留空，稍后补", desc: "保留低置信度标记" },
    ],
  },
  {
    id: "origin",
    label: "原产地证第 14 项",
    hint: "FORM E 只覆盖前 13 项（57 件 / 19,023.576 KGS），SOS BOX 未列入。",
    options: [
      { value: "keep", label: "保留待补充，稍后补证", desc: "享惠栏留空" },
      { value: "manual", label: "已在随附单证中补充", desc: "人工确认后按已有证明填报" },
      { value: "none", label: "本项不申请享惠", desc: "按非优惠申报，备注说明" },
    ],
  },
];

const FIELD_ALIASES: Record<string, string[]> = {
  提单号: ["提单号", "提单", "b/l"],
  进口日期: ["进口日期", "进境日期"],
  毛重: ["毛重", "总毛重"],
  净重: ["净重", "总净重"],
  件数: ["件数", "包装件数"],
  "境内收发货人-企业名称": ["收发货人", "境内收货人", "主体"],
  成交方式: ["成交方式", "贸易术语"],
  合同协议号码: ["合同号", "合同协议号"],
  原产地证明编号: ["原产地证号", "原产地证明编号", "产地证号"],
  申报单位名称: ["申报单位"],
  货物存放地点: ["存放地点", "仓库"],
  规格型号: ["规格", "型号"],
  商品名称: ["商品名称", "品名"],
};

function resolveField(text: string): string | null {
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias))) return field;
  }
  return null;
}

function cellByField(task: Task, field: string): { path: string; cell: Cell } | null {
  if (!task.draft) return null;
  const header = task.draft.header[field];
  if (header) return { path: `header|${field}`, cell: header };
  for (let i = 0; i < task.draft.rows.length; i += 1) {
    const row = task.draft.rows[i];
    if (row[field]) return { path: `row|${i + 1}|${field}`, cell: row[field] };
  }
  return null;
}

export function updateCell(
  task: Task,
  cellPath: string,
  value: string,
  options: { actor?: string; state?: Cell["state"]; reason?: string } = {},
): Cell | null {
  const cell = findCell(task, cellPath);
  if (!cell) return null;
  const actor = options.actor ?? "林岚";
  const before = cell.value;
  cell.value = value;
  if (before !== value) {
    cell.history = [...(cell.history ?? []), { by: actor, at: nowIso(), before, after: value }];
    task.events.push({ at: nowIso(), type: "field_edit", path: cellPath, before, after: value, actor });
    task.version += 1;
  }
  cell.state = options.state ?? (value ? "edited" : "missing");
  cell.confidence = value ? 100 : 0;
  task.updatedAt = nowIso();
  recomputeStatus(task);
  return cell;
}

export function attachAsk(task: Task, presetId?: string): Task {
  if (!task.messages) task.messages = [];
  const already = new Set(task.messages.map((m) => m.askId));
  const pending = ASK_QUESTIONS.filter((q) => !already.has(`ask_${q.id}`));
  if (pending.length === 0) return task;
  task.messages.push({
    id: uid("m"),
    role: "agent",
    kind: "ask",
    askId: presetId ?? `ask_${pending[0].id}_${Math.random().toString(36).slice(2, 6)}`,
    questions: pending,
    answered: false,
    text: "以下几处资料存在竞争，我需要你确认后才能继续：",
    at: nowIso(),
  });
  return task;
}

export function applyAsk(task: Task, answers: Record<string, string>): string {
  const notes: string[] = [];
  if (answers.party === "buyer") {
    for (const field of ["境内收发货人-企业名称", "消费使用单位-企业名称"]) {
      updateCell(task, `header|${field}`, "FOREST SENLIN ELECTRICAL APPLIANCE TRADING(SHANGHAI)CO.,LTD.", { state: "normal" });
    }
    for (const field of ["境内收发货人-18位社会信用代码", "消费使用单位-18位社会信用代码"]) {
      updateCell(task, `header|${field}`, "91310000798991041T", { state: "normal" });
    }
    notes.push("主体按提单收货人 FOREST SENLIN 确认；两位 10 位海关编码仍需补录。");
  } else if (answers.party === "draft") {
    for (const field of ["境内收发货人-企业名称", "消费使用单位-企业名称"]) {
      updateCell(task, `header|${field}`, "上海航联报关有限责任公司", { state: "normal" });
    }
    for (const field of ["境内收发货人-18位社会信用代码", "消费使用单位-18位社会信用代码"]) {
      updateCell(task, `header|${field}`, "91310109132289635R", { state: "normal" });
    }
    notes.push("已按代理进口口径改为上海航联报关有限责任公司，请复核代理协议与消费使用单位。");
  }

  if (answers.date === "draft") {
    updateCell(task, "header|进口日期", "20260630", { state: "normal" });
    notes.push("进口日期按 20260630 确认。");
  } else if (answers.date === "bl") {
    updateCell(task, "header|进口日期", "20260623", { state: "normal" });
    notes.push("进口日期改为 20260623（提单装船日），仍需以进境申报回执复核。");
  } else if (answers.date === "skip") {
    notes.push("进口日期暂留空，保持低置信度标记。");
  }

  if (answers.origin === "keep") notes.push("第 14 项享惠信息保持留空，等待原产地证明补充。");
  if (answers.origin === "manual") notes.push("第 14 项按人工补充的原产地证明处理，请在随附单证栏核对证号。");
  if (answers.origin === "none") notes.push("第 14 项按非优惠申报，已在备注保留说明。");

  for (const message of task.messages) {
    if (message.kind === "ask" && !message.answered) {
      message.answered = true;
      message.selection = answers;
    }
  }
  task.events.push({ at: nowIso(), type: "ask_answer", answers, actor: "林岚" });
  task.updatedAt = nowIso();
  recomputeStatus(task);
  return notes.join("；");
}

function describe(task: Task, field: string): string {
  const found = cellByField(task, field);
  if (!found) return `我在本票草单里没有找到「${field}」。`;
  const { cell } = found;
  const lines = [`「${field}」当前值：${cell.value || "（空）"}`];
  if (cell.sources?.length) {
    const src = cell.sources[0];
    lines.push(`来源：${src.docName} · 第${src.page}页 · ${src.region ?? ""}`);
  } else {
    lines.push(`来源：暂无结构化来源${cell.state === "missing" ? "（待补充）" : ""}`);
  }
  if (cell.confidence) lines.push(`置信度：${cell.confidence}%${cell.confidence < 80 ? "（低于 80%，建议核对）" : ""}`);
  if (cell.rule) lines.push(`规则：${cell.rule}`);
  return lines.join("\n");
}

const asCite = (s: SourceRef): SourceRef => s;

export function agentReply(task: Task, text: string, selected?: string | null): Message[] {
  const out: Message[] = [];
  const say = (body: string, cites: SourceRef[] = []) => {
    out.push({ id: uid("m"), role: "agent", kind: "text", text: body, cites: cites.map(asCite), at: nowIso() });
  };
  const input = (text ?? "").trim();
  if (!input) return out;

  if (/(改|修正|设为|填写|填成|换成)/.test(input)) {
    const field = resolveField(input);
    const match = input.match(/(?:改成|改为|设为|填写为|填成|换成)[「"']?([^」"'，。,]+)/);
    const value = match?.[1]?.trim() ?? "";
    if (field && value) {
      const found = cellByField(task, field);
      if (found) {
        updateCell(task, found.path, value, { reason: "Copilot 指令" });
        say(`已把「${field}」更新为 ${value}，并在任务事件里留痕。还需要我核对其他字段吗？`);
        return out;
      }
    }
    say("我可以改字段，但需要你给出字段名和目标值，例如「把进口日期改成20260701」。");
    return out;
  }

  if (/(来源|溯源|哪一页|哪份|出处|证据)/.test(input)) {
    const field = resolveField(input) ?? (selected ? selected.split("|").slice(-1)[0] : null);
    if (field) {
      const found = cellByField(task, field);
      if (found?.cell.sources?.length) {
        const src = found.cell.sources[0];
        out.push({
          id: uid("m"),
          role: "agent",
          kind: "tool",
          text: "",
          at: nowIso(),
          tool: sourceTool(src.docName, src.page, src.region),
        });
        say(
          `「${field}」取自 ${src.docName} 第 ${src.page} 页（${src.region ?? ""}）。我已把资料定位到右侧面板，可继续翻页。`,
          [src],
        );
        return out;
      }
    }
    say("点字段名左侧的 ⌖ 可以打开来源；也可以告诉我具体字段，我直接定位到对应资料页。");
    return out;
  }

  if (/(导出|下载|excel|Excel|表格)/.test(input)) {
    say(
      "点草单右下角「导出草单」即可下载标准格式 Excel（版式与《进口报关草单模板》一致，含正表与附表）。" +
        "如果还有「待补充」字段，会先提示确认，导出文件中该字段留空。",
    );
    return out;
  }

  if (/(待补充|待确认|未决|还有|检查|问题|风险|核对)/.test(input)) {
    const c = counts(task.draft);
    const cells = iterCells(task.draft);
    const missing = cells.filter(([, cell]) => cell.state === "missing").map(([p]) => fieldLabel(p));
    const low = cells.filter(([, cell]) => cell.state === "low").map(([p]) => fieldLabel(p));
    const lines = [`当前共有 ${c.missing} 个待补充、${c.low} 个低置信度字段。`];
    if (missing.length) lines.push(`待补充：${missing.slice(0, 6).join("、")}${missing.length > 6 ? "…" : ""}`);
    if (low.length) lines.push(`建议核对：${low.slice(0, 6).join("、")}${low.length > 6 ? "…" : ""}`);
    lines.push("需要我把这些字段按资料逐一说明来源吗？");
    say(lines.join("\n"));
    return out;
  }

  if (/(主体|收发货人|代理)/.test(input)) {
    say(
      "本票主体存在竞争：合同/发票/提单都指向 FOREST SENLIN ELECTRICAL APPLIANCE TRADING(SHANGHAI)CO.,LTD.，" +
        "而校对稿把境内收发货人写成了报关行「上海航联报关」。我已按原件取 FOREST SENLIN，但需要你确认是否存在代理进口协议。",
    );
    attachAsk(task, `ask_party_${Math.random().toString(36).slice(2, 6)}`);
    const ask = task.messages.filter((m) => m.kind === "ask").at(-1);
    if (ask) out.push({ ...ask });
    return out;
  }

  if (/(原产地|享惠|FORM|FORM E)/.test(input)) {
    say(
      "原产地证是 FORM E（东盟，协定代码 02），覆盖第 1–13 项；第 14 项 SOS BOX（9026100000）不在证上，所以享惠五栏留空。" +
        "另外证载总价是 USD 146,912.90，与发票 CNY 1,014,116 币制不同，建议一并核对。",
    );
    return out;
  }

  if (/(你好|hi|hello|在吗)/i.test(input)) {
    say("在的。本票可以问我：字段为什么这样填、来源在哪一页、还有哪些待补充，或者直接让我改某个字段。");
    return out;
  }

  const field = resolveField(input);
  if (field) {
    say(describe(task, field));
    return out;
  }

  const c = counts(task.draft);
  say(
    "收到。我基于当前草单回答：本票 " +
      `${task.draft?.rows.length ?? 0} 项商品，5 类资料齐备；目前 ${c.missing} 个字段待补充、${c.low} 个低置信度。` +
      "你可以问「哪几项待确认」「提单号从哪来」，或直接说「把进口日期改成20260701」。",
  );
  return out;
}
