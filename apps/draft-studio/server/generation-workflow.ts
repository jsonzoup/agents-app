import type { GenerationWorkflow } from "../lib/types";

const steps = {
  content: [["research", "检索与知识"], ["create", "内容创作"], ["review", "双技能审校"], ["repair", "自动完善"], ["recheck", "复检与保存"]],
  images: [["plan", "视觉企划"], ["create", "生成图片"], ["review", "双技能审校"], ["repair", "自动完善"], ["recheck", "复检与保存"]],
  video: [["cover", "封面首帧"], ["create", "分镜与代码"], ["render", "动画预览"], ["review", "双技能审校"], ["repair", "自动完善"], ["recheck", "复检与正式渲染"], ["voice", "配音与同步"], ["delivery", "成片检查与保存"]],
} as const;

/** Persist actual execution steps; the UI never infers progress from stage text. */
export function workflowAt(kind: keyof typeof steps, current: string, repairAttempt = 0): GenerationWorkflow {
  const index = steps[kind].findIndex(([id]) => id === current);
  return { current, repairAttempt, steps: steps[kind].map(([id, label], i) => ({ id, label, status: i < index ? "complete" : i === index ? "running" : "pending" })) };
}

/** Retain the active failure location or finish every step on terminal status. */
export function finishWorkflow(workflow: GenerationWorkflow | undefined, failed = false): GenerationWorkflow | undefined {
  return workflow && { ...workflow, steps: workflow.steps.map(step => ({ ...step, status: failed ? step.id === workflow.current ? "failed" : step.status : "complete" })) };
}
