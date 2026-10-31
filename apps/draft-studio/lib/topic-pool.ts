import type { Draft, Topic } from "./types";

/** Author-facing stages for the topic queue. */
export const topicPoolStages = ["待选", "已选", "已发"] as const;

/** Classify persisted topics; a linked article counts as selected.
 * @param topic - Topic to classify.
 * @param drafts - Existing articles.
 * @returns Queue stage, with publication taking precedence.
 */
export function topicPoolStage(
  topic: Pick<Topic, "id" | "status">,
  drafts: readonly Pick<Draft, "topicId">[],
): (typeof topicPoolStages)[number] {
  if (topic.status === "已发布") return "已发";
  if (topic.status === "准备写作" || drafts.some((draft) => draft.topicId === topic.id))
    return "已选";
  return "待选";
}
