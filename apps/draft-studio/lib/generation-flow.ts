/** Persisted generation steps shared by the progress view and task writers. */
export type GenerationWorkflow = {
  steps: Array<{ id: string; label: string; status: "pending" | "running" | "complete" | "failed" }>;
  current: string;
  repairAttempt?: number;
};
export type GenerationRunView = {
  status: "运行中" | "完成" | "失败";
  stage: string;
  error?: string;
  completed?: number;
  total?: number;
  workflow?: GenerationWorkflow;
};

/** Keep failed tasks on their actual step; older records have no invented history. */
export function generationFlowSteps(run: GenerationRunView): GenerationWorkflow["steps"] {
  if (!run.workflow?.steps.length) return [{
    id: "legacy", label: "生成任务",
    status: run.status === "完成" ? "complete" : run.status === "失败" ? "failed" : "running",
  }];
  return run.workflow.steps.map(step => ({ ...step,
    status: run.status === "失败" && step.id === run.workflow?.current ? "failed" : step.status,
  }));
}

/** Polling compares persisted workflow updates even when the stage detail stays unchanged. */
export function generationWorkflowChanged(previous?: GenerationRunView, fresh?: GenerationRunView): boolean {
  return JSON.stringify(previous?.workflow) !== JSON.stringify(fresh?.workflow);
}
