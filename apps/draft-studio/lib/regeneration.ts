import type { Draft, DraftVariant } from "./types";

type Selection = { content: boolean; images: boolean; cover?: boolean };
/** Clear only the selected output; retain article identity and art direction. */
export function clearRegeneratedOutput(target: Draft | DraftVariant, selection: Selection): string[] {
  const files: string[] = [];
  if (selection.content) {
    target.body = "";
    target.tags = "";
    target.wechatSummary = "";
  }
  if (selection.images) {
    for (const file of [target.imageFile, ...target.images.map(image => image.fileName)]) {
      if (file) files.push(file);
    }
    target.images = [];
    target.imagePlacements = {};
    target.imageFile = undefined;
    target.imagePrompt = undefined;

  }
  if (selection.cover) {
    if (target.wechatCover?.fileName) files.push(target.wechatCover.fileName);
    target.wechatCover = undefined;
    target.wechatCoverImageId = undefined;
  }
  target.wechatDraft = undefined;
  return files;
}

export function draftMediaFiles(draft: Draft): string[] {
  return [draft.video?.projectFile, draft.video?.fileName, draft.video?.subtitleFile, draft.video?.planFile, ...[draft, ...Object.values(draft.channelVariants).filter((variant): variant is DraftVariant => Boolean(variant))]
    .flatMap(target => [target.imageFile, target.wechatCover?.fileName, ...target.images.map(image => image.fileName)])
    ].filter((file): file is string => Boolean(file));
}
