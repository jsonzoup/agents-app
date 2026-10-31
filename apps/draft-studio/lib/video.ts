import type { Draft } from "./types";

/** Text snapshot used to detect videos made before an edit.
 * @param draft - Current video copy.
 * @returns Stable serialized input text.
 */
export function videoSourceText(draft: Pick<Draft, "title" | "coverTitle" | "body" | "wechatSummary">): string {
  return JSON.stringify([draft.title, draft.coverTitle, draft.body, draft.wechatSummary, "sources" in draft ? draft.sources : "", "knowledgeContext" in draft ? draft.knowledgeContext : "", "creativeBrief" in draft ? draft.creativeBrief : null, "wechatCover" in draft ? draft.wechatCover : null]);
}

/** Validate article inputs before handing creative decisions to DSH. */
export function validateVideoInput(draft: Pick<Draft, "title" | "body">): void {
  if (!draft.title.trim()) throw new Error("请先填写视频标题。");
  if (!draft.body.trim()) throw new Error("请先生成或填写视频口播稿。");
  if ([...draft.body.trim()].length > 1600) throw new Error("视频口播稿最多1600字，请精简后再生成。");
}

/** Build captions using the same timing as the renderer.
 * @param scenes - Caption text and durations in seconds.
 * @returns SRT subtitle text.
 */
export function videoSubtitles(scenes: { text: string; duration: number }[]): string {
  const stamp = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 23).replace(".", ",");
  let elapsed = 0;
  return scenes.map((scene, index) => {
    const start = elapsed; elapsed += scene.duration;
    return `${index + 1}\n${stamp(start)} --> ${stamp(elapsed)}\n${scene.text}\n`;
  }).join("\n");
}
