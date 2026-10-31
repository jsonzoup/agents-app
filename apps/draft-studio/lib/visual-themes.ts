import type { Draft, Topic, VisualThemeId } from "./types";

export type VisualTheme = {
  id: VisualThemeId;
  label: string;
  styleGuide: string;
  keywords: string[];
  colors: {
    surfaceStart: string;
    surfaceEnd: string;
    ink: string;
    body: string;
    muted: string;
    line: string;
    accent: string;
    glowOne: string;
    glowTwo: string;
    anchorFill: string;
    anchorStroke: string;
    scrim: string;
    imageTitle: string;
    imageLead: string;
    imageBody: string;
    imageMuted: string;
    imageLine: string;
  };
};

export const visualThemes: VisualTheme[] = [
  {
    id: "forest",
    label: "森林编辑",
    styleGuide:
      "森林编辑主题：墨绿、暖象牙白、琥珀和少量薄荷绿；磨砂玻璃、纸雕、金属与木材组合，低饱和高对比，保留克制的自然生长感。",
    keywords: ["生态", "能源", "农业", "可持续", "绿色", "协作", "系统", "增长"],
    colors: {
      surfaceStart: "#f8f5ec",
      surfaceEnd: "#eef3eb",
      ink: "#173c30",
      body: "#31483b",
      muted: "#75837a",
      line: "#c9d5ca",
      accent: "#d39a50",
      glowOne: "#d6e3d6",
      glowTwo: "#edd3aa",
      anchorFill: "#e8f1e9",
      anchorStroke: "#173c30",
      scrim: "#081e17",
      imageTitle: "#fffdf7",
      imageLead: "#dce7de",
      imageBody: "#f5f1e8",
      imageMuted: "#d8e2da",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "cobalt",
    label: "钴蓝科技",
    styleGuide:
      "钴蓝科技主题：深钴蓝、冷灰白、雾银和少量珊瑚橙；磨砂玻璃、精密金属、半透明界面与冷色光学结构组合，清晰、锐利、有工程感。",
    keywords: ["AI", "Agent", "模型", "算力", "芯片", "云", "企业", "软件", "编程", "开发", "平台", "机器人", "科技"],
    colors: {
      surfaceStart: "#f3f6fb",
      surfaceEnd: "#e5ecf8",
      ink: "#1c3558",
      body: "#344e6b",
      muted: "#73849a",
      line: "#c4d0e0",
      accent: "#e8764a",
      glowOne: "#cedcf1",
      glowTwo: "#e7d1c4",
      anchorFill: "#e4edf8",
      anchorStroke: "#1c3558",
      scrim: "#0d1f35",
      imageTitle: "#f8fbff",
      imageLead: "#d5e2f1",
      imageBody: "#eff5fb",
      imageMuted: "#cedbea",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "terracotta",
    label: "陶土人文",
    styleGuide:
      "陶土人文主题：陶土橙、亚麻白、深棕和少量青绿色；纸张、陶器、木材、织物与柔和自然光组合，温和、可触摸、有人情味。",
    keywords: ["组织", "人才", "职场", "教育", "消费", "商业", "创业", "市场", "用户", "沟通"],
    colors: {
      surfaceStart: "#fbf3ea",
      surfaceEnd: "#f0ddcd",
      ink: "#522e22",
      body: "#654437",
      muted: "#92776a",
      line: "#d9c0ae",
      accent: "#2d8079",
      glowOne: "#efd2be",
      glowTwo: "#d9e4de",
      anchorFill: "#f3dfd2",
      anchorStroke: "#522e22",
      scrim: "#2f1812",
      imageTitle: "#fff9f3",
      imageLead: "#efd8cb",
      imageBody: "#fff1e7",
      imageMuted: "#e7cbbb",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "aubergine",
    label: "茄紫创意",
    styleGuide:
      "茄紫创意主题：深茄紫、雾粉白、灰紫和少量金色；舞台纸景、半透明薄膜、柔光与细腻颗粒组合，富有叙事性和编辑感。",
    keywords: ["创意", "设计", "文化", "艺术", "品牌", "内容", "写作", "媒体", "游戏", "动画", "叙事"],
    colors: {
      surfaceStart: "#f7f1f7",
      surfaceEnd: "#eaddea",
      ink: "#40223f",
      body: "#5b3d57",
      muted: "#886f86",
      line: "#d9c2d6",
      accent: "#d28d3b",
      glowOne: "#ead4e8",
      glowTwo: "#f0d7c6",
      anchorFill: "#f0e0ee",
      anchorStroke: "#40223f",
      scrim: "#241322",
      imageTitle: "#fff8fe",
      imageLead: "#e7d5e4",
      imageBody: "#f9eff7",
      imageMuted: "#dcc6d8",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "ocean",
    label: "海雾科研",
    styleGuide:
      "海雾科研主题：深青、雾蓝、珍珠白和少量暖橙；水汽、玻璃、矿物、光学器件和细腻数据纹理组合，理性、清澈、有探索感。",
    keywords: ["医疗", "生物", "科学", "研究", "实验", "数据", "海洋", "气候", "环境", "论文"],
    colors: {
      surfaceStart: "#eff8f8",
      surfaceEnd: "#dcebef",
      ink: "#123d48",
      body: "#2d5761",
      muted: "#6d8c91",
      line: "#bdd4d8",
      accent: "#e68c43",
      glowOne: "#cde5e7",
      glowTwo: "#f2ddc9",
      anchorFill: "#d8ebed",
      anchorStroke: "#123d48",
      scrim: "#0a242b",
      imageTitle: "#f7feff",
      imageLead: "#d4e8eb",
      imageBody: "#effbfc",
      imageMuted: "#c9dfe2",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "ink",
    label: "墨黑评论",
    styleGuide:
      "墨黑评论主题：暖黑、灰米色、旧纸白和醒目的朱红；粗粝纸张、黑色金属、干墨质感和克制侧光组合，观点鲜明、适合风险与边界讨论。",
    keywords: ["政策", "监管", "安全", "风险", "法律", "伦理", "边界", "争议", "失败", "隐私"],
    colors: {
      surfaceStart: "#f7f4ef",
      surfaceEnd: "#ebe6df",
      ink: "#242321",
      body: "#46433e",
      muted: "#817b72",
      line: "#d4cec4",
      accent: "#b94736",
      glowOne: "#e6dfd5",
      glowTwo: "#e4cbc2",
      anchorFill: "#ede7de",
      anchorStroke: "#242321",
      scrim: "#1d1b19",
      imageTitle: "#fffaf2",
      imageLead: "#ded7cc",
      imageBody: "#f7efe5",
      imageMuted: "#d2c9bc",
      imageLine: "#ffffff66",
    },
  },
  {
    id: "sand",
    label: "沙金知识",
    styleGuide:
      "沙金知识主题：沙金、暖米、深棕和少量青蓝；砂岩、黄铜、亚麻纸、木材与斜射日光组合，沉静、可靠、适合教程与知识梳理。",
    keywords: ["历史", "开源", "社区", "教程", "方法", "经验", "知识", "学习", "复盘"],
    colors: {
      surfaceStart: "#fbf5e8",
      surfaceEnd: "#efe1c8",
      ink: "#51391e",
      body: "#66523b",
      muted: "#978366",
      line: "#ddcbaa",
      accent: "#376d78",
      glowOne: "#eadcbe",
      glowTwo: "#d1e1dc",
      anchorFill: "#f1e4c9",
      anchorStroke: "#51391e",
      scrim: "#2d2111",
      imageTitle: "#fffaf0",
      imageLead: "#ead9bd",
      imageBody: "#fff5e5",
      imageMuted: "#ddc8a8",
      imageLine: "#ffffff66",
    },
  },
];

export function visualThemeById(id?: string): VisualTheme {
  return visualThemes.find((theme) => theme.id === id) || visualThemes[0];
}

export function selectVisualTheme(
  draft: Draft,
  _topic?: Topic,
): VisualTheme {
  if (draft.visualThemeId) return visualThemeById(draft.visualThemeId);
  // Topic keywords must not force every AI article into the same blue palette.
  const seed = stableHash(`palette-v1:${draft.id}`);
  return visualThemes[seed % visualThemes.length];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
