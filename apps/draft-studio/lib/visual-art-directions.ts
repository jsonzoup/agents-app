import type { Draft } from "./types";
import type { VisualTheme } from "./visual-themes";

/** Editorial art recipes; palette is resolved independently for each article. */
export const visualArtDirections = [
  ["material-editorial", "人文材质", "哑光纸、磨砂玻璃与拉丝金属的真实静物；50mm浅景深、柔侧逆光，温暖克制、有触感。"],
  ["paper-sculpture", "层叠纸雕", "精细纸雕、折叠截面与层叠阴影；用真实空间关系解释机制，避免幼儿手工感。"],
  ["film-still", "胶片静物", "中画幅胶片静物摄影、自然颗粒、柔漫射光与细腻暗部；具体动作讲清变化。"],
  ["ink-wash", "当代水墨", "干湿墨层、宣纸肌理和克制淡彩；以笔触方向表达因果，主体清晰而非泛山水。"],
  ["woodcut", "现代木刻", "精细木刻刀痕、强弱线条与受限套色；正负形建立清晰对照，避免粗糙宣传画。"],
  ["screenprint", "丝网版画", "丝网套印、微细网点与哑光色块；关系图形简洁精密，有编辑插画的完成度。"],
  ["archive-collage", "档案拼贴", "纸张边缘、摄影碎片与半透明叠层构成有因果的编辑拼贴；禁伪造报纸文字。"],
  ["miniature", "等距微缩", "实体微缩模型、准确等距透视、柔光阴影；用部件连接与操作过程解释系统。"],
  ["mineral-optics", "矿物光学", "矿物、磨砂晶体与折射光路；让折射、遮挡和透射解释信息关系，不堆水晶装饰。"],
  ["architectural", "建筑空间", "建筑模型摄影、混凝土与薄木、斜射自然光；通道、阈值与空间尺度表达约束。"],
  ["ceramic", "陶瓷静物", "细腻无釉陶与亚麻、柔和接触阴影；器物之间的受力和连接承担明确的信息任务。"],
  ["copper-etching", "铜版蚀刻", "精密铜版蚀刻、细线排线与纸面压痕；展示结构关系，避免无依据科学刻度。"],
  ["gouache", "哑光水粉", "不透明水粉、可见笔触、细腻纸纹与准确形体；具体场景和动作优于口号。"],
  ["textile", "织物构成", "亚麻编织、细线牵引与柔软层叠；以交织、断点和张力解释依赖关系，避免装饰织毯。"],
  ["light-relief", "浮雕光影", "浅浮雕、精细石膏肌理与长侧影；用层级、深度和遮挡展示机制，不做空白壁饰。"],
  ["editorial-drawing", "精密手绘", "铅笔、彩铅与淡彩的精密编辑手绘；细节准确、线条有节奏，复杂关系可一眼读懂。"],
] as const;

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

/** Stable article assignment survives rewrites, channel switches and retries. */
export function selectVisualArtDirection(draft: Pick<Draft, "id">) {
  return visualArtDirections[hash(`art-v1:${draft.id}`) % visualArtDirections.length];
}

/** Compile the palette lock and material recipe before any model instructions. */
export function articleVisualStyle(draft: Pick<Draft, "id">, theme: VisualTheme): string {
  const [id, label, recipe] = selectVisualArtDirection(draft);
  return `艺术方向：${label}（${id}）。${recipe}\n锁定色调：${theme.label}；主色 ${theme.colors.ink}、底色 ${theme.colors.surfaceStart}、辅色 ${theme.colors.accent}、次辅色 ${theme.colors.glowOne}。所有正文图、重试与横版封面共享此配色与艺术方向，禁止自行新增主色。材质和镜头以艺术方向为准。完整的人文科技编辑视觉，克制、现代、层次丰富；每个对象都服务文章的具体信息，不用无关机器人、桌面或接口装饰凑图。`;
}
