import { promises as fs } from "node:fs";
import path from "node:path";
import type { Task, ToolCall } from "./types";
import { counts } from "./status";
import { skillRoot } from "./home";

export const SKILL_ROOT = skillRoot();

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  root: string;
  references: Array<{ file: string; title: string }>;
  tables: string[];
  scenes: string[];
  capabilities: Array<{ title: string; detail: string }>;
  loadedAt: string;
}

let cache: SkillInfo | null = null;

export async function loadSkillInfo(): Promise<SkillInfo> {
  if (cache) return cache;
  let version = "unknown";
  let description = "从进口报关原件提取通用表头与表体，审单并生成标准草单。";
  const references: Array<{ file: string; title: string }> = [];
  const tables: string[] = [];
  try {
    version = (await fs.readFile(path.join(SKILL_ROOT, "VERSION"), "utf8")).trim() || version;
  } catch {
    /* keep default */
  }
  try {
    const skillMd = await fs.readFile(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
    const match = skillMd.match(/description:\s*(.+)/);
    if (match) description = match[1].trim();
  } catch {
    /* keep default */
  }
  try {
    const dir = path.join(SKILL_ROOT, "references");
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".md")).sort();
    for (const file of files) {
      let title = file.replace(/\.md$/, "");
      try {
        const text = await fs.readFile(path.join(dir, file), "utf8");
        const h1 = text.match(/^#\s+(.+)$/m);
        if (h1) title = h1[1].trim();
      } catch {
        /* keep filename */
      }
      references.push({ file, title });
    }
  } catch {
    /* references missing */
  }
  try {
    const dir = path.join(SKILL_ROOT, "data");
    const files = (await fs.readdir(dir)).filter((name) => /\.(xlsx|xls)$/i.test(name)).sort();
    tables.push(...files);
  } catch {
    /* data missing */
  }
  cache = {
    name: "customs-extraction",
    version,
    description,
    root: SKILL_ROOT,
    references,
    tables,
    scenes: ["一般贸易", "海运", "空运", "邮政", "食品", "危险品"],
    capabilities: [
      { title: "材料接入与场景判定", detail: "逐份识别单证类型、页面范围与贸易/运输场景" },
      { title: "表头与表体抽取", detail: "54 项表头 + 20 项表体字段，带来源页与区域" },
      { title: "标准表依赖查询", detail: "HS 编码 → 监管证件、法定/第二单位、CIQ、规格型号槽位" },
      { title: "风险与校验", detail: "P0–P3 风险分级、跨单据一致性、字段状态判定" },
      { title: "草单渲染", detail: "按《进口报关草单模板》生成标准格式 Excel" },
    ],
    loadedAt: new Date().toISOString(),
  };
  return cache;
}

const tool = (
  name: string,
  title: string,
  output: string,
  extra: Partial<ToolCall> = {},
): ToolCall => ({ name, title, status: "done", output, ...extra });

export function pipelineTrace(task: Task): ToolCall[] {
  const c = counts(task.draft);
  const pages = task.materials.reduce((sum, material) => sum + (material.pages || 1), 0);
  const types = Array.from(new Set(task.materials.map((material) => material.type))).join("、");
  return [
    tool(
      "mcp.connect",
      "连接 MCP · business-draft",
      "endpoint=/api/mcp\ntransport=streamable-http\ntools=11\nserver=business-draft v1.0.0",
      { meta: "MCP" },
    ),
    tool("skill.load", "加载 skill · customs-extraction v1.0.0", "profile=import-declaration\nreferences=19\ntables=18\nstatus=ready", {
      meta: "38ms",
      args: "skill=customs-extraction",
    }),
    tool(
      "materials.read",
      `读取 ${task.materials.length} 份材料 · ${pages} 页`,
      task.materials.map((material) => `${material.name}  [${material.type}] ${material.pages}p`).join("\n"),
      { meta: `${pages} 页`, args: types },
    ),
    tool(
      "draft.extract",
      "抽取表头与表体",
      `header=54 fields\nrows=${task.draft?.rows.length ?? 0}\nsource=document(page,region)\nstate=low ${c.low} / missing ${c.missing}`,
      { meta: "多模态直读" },
    ),
    tool(
      "hs.query",
      "查询标准表依赖（2 个 HS）",
      "8414301400 → 监管证件: 空 · 法定单位: 台 · 第二单位: 千克 · CIQ 999\n9026100000 → 监管证件: 空 · 法定单位: 个 · 第二单位: 千克 · CIQ 102(待核)",
      { meta: "内置 data/", args: "resolve_hs_dependencies" },
    ),
    tool(
      "draft.render",
      "生成草单初稿",
      `version=${task.version}\nrows=${task.draft?.rows.length ?? 0}\nlow=${c.low}\nmissing=${c.missing}`,
      { meta: "draft v1" },
    ),
    tool(
      "ask.user",
      "发起待确认事项（不阻塞制单）",
      "questions=3\n1 主体  2 进口日期  3 原产地证第 14 项\nblocking=false",
      { meta: "3 项待确认" },
    ),
    tool(
      "draft.writeback",
      "回写草单并刷新工作区",
      `draft=v${task.version}\nrows=${task.draft?.rows.length ?? 0}\nstatus=completed\nworkspace=refreshed`,
      { meta: "已完成" },
    ),
  ];
}

export function sourceTool(docName: string, page: number, region?: string): ToolCall {
  return tool("source.locate", `定位来源 · ${docName} 第 ${page} 页`, `${docName}\npage=${page}\nregion=${region ?? "整页"}\nhighlight=on`, {
    meta: "右侧资料定位",
  });
}
