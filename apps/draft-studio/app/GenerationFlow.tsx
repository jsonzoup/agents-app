import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { generationFlowSteps, type GenerationRunView } from "@/lib/generation-flow";

const stepLabels = { pending: "待进行", running: "进行中", complete: "已完成", failed: "失败" };

/** Show each generated asset's persisted workflow without estimating a percentage. */
export function GenerationFlow({ title, run }: { title: string; run?: GenerationRunView }) {
  if (!run) return null;
  const steps = generationFlowSteps(run);
  const current = run.workflow?.current || "legacy";
  return <section className={`generation-flow generation-flow-${run.status === "失败" ? "failed" : run.status === "完成" ? "complete" : "running"}`} aria-label={`${title}生成流程`}>
    <div className="generation-flow-heading">
      <b>{title}</b><span>{run.status}</span>
      {!!run.workflow?.repairAttempt && <span className="generation-flow-repair">自动修复第 {run.workflow.repairAttempt} 轮</span>}
      {run.status === "运行中" && <small>后台继续执行，刷新可查看进度</small>}
    </div>
    <ol className="generation-flow-steps">
      {steps.map((step, index) => <li key={step.id} className={`generation-flow-step ${step.status}`} aria-current={step.id === current && run.status !== "完成" ? "step" : undefined}>
        <span className="generation-flow-marker" aria-hidden="true">
          {step.status === "complete" ? <Check size={13} /> : step.status === "failed" ? <CircleAlert size={14} /> : step.status === "running" ? <LoaderCircle className="spin" size={14} /> : index + 1}
        </span>
        <span>{step.label}<small>{stepLabels[step.status]}</small></span>
      </li>)}
    </ol>
    <div className="generation-flow-detail" role="status" aria-live="polite">
      <span>{run.stage}</span>
      {typeof run.total === "number" && run.total > 0 && <small>成图 {run.completed || 0}/{run.total}</small>}
      {run.error && <p>{run.error}</p>}
    </div>
  </section>;
}
