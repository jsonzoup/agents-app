"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Loader2, Maximize, Minus, Plus, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RightPanel } from "@/components/copilot/panel";
import { PanelResizer } from "@/components/panel-resizer";
import { useShellLayout } from "@/components/app-shell";
import { DraftPaper } from "@/components/workbench/draft-paper";
import { MaterialsStrip } from "@/components/workbench/materials-strip";
import { StatusBadge } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { api, type SessionItem } from "@/lib/api";
import { useRole } from "@/components/providers";
import type { Cell, Task } from "@/lib/types";
import { describeToolCall } from "@/lib/activity";
import type { DocTarget } from "@/components/docs/viewer";
import { formatTime } from "@/lib/utils";

export default function TaskWorkspacePage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId ?? "";
  const router = useRouter();
  const { role, readOnly } = useRole();
  const [task, setTask] = React.useState<Task | null>(null);
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [error, setError] = React.useState("");
  const [tab, setTab] = React.useState<"chat" | "docs" | "skill">("chat");
  const [docTarget, setDocTarget] = React.useState<DocTarget | null>(null);
  const [sourceField, setSourceField] = React.useState<string | null>(null);
  const [selectedField, setSelectedField] = React.useState<string | null>(null);
  const [panelWidth, setPanelWidth] = React.useState(400);
  const { focus, navWidth } = useShellLayout();
  const extraWidth = focus ? navWidth : 0;
  const effectivePanelWidth = Math.min(980, panelWidth + extraWidth);
  const [zoom, setZoom] = React.useState(1);
  const paperRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const [{ task: next }, state] = await Promise.all([api.task(taskId), api.bootstrap()]);
      setTask(next);
      setSessions(state.sessions);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [taskId]);

  React.useEffect(() => {
    if (!taskId) return;
    const saved = Number(window.localStorage.getItem("bgl-panel-width") || 0);
    if (saved >= 320) setPanelWidth(saved);
    load();
  }, [taskId, load]);

  const resizePanel = React.useCallback(
    (value: number) => {
      const base = Math.max(320, Math.min(820, Math.round(value - extraWidth)));
      setPanelWidth(base);
      window.localStorage.setItem("bgl-panel-width", String(base));
    },
    [extraWidth],
  );

  const processing = Boolean(task && (task.status === "处理中" || (task.progress?.pct ?? 100) < 100));

  React.useEffect(() => {
    if (!processing) return;
    const timer = setInterval(async () => {
      try {
        const { task: next } = await api.task(taskId);
        setTask(next);
      } catch {
        /* 轮询失败时保持当前内容 */
      }
    }, 650);
    return () => clearInterval(timer);
  }, [processing, taskId]);

  React.useEffect(() => {
    if (processing) return;
    api.bootstrap().then((state) => setSessions(state.sessions)).catch(() => undefined);
  }, [processing]);

  const save = async (path: string, value: string) => {
    if (!task) return;
    try {
      await api.setField(task.id, path, value);
      setSelectedField(path);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const confirm = async (path: string) => {
    if (!task) return;
    try {
      await api.confirmField(task.id, path);
      toast.success("已确认该字段");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const openMaterial = (docId: string) => {
    setDocTarget({ docId, page: 1 });
    setSourceField(null);
    setTab("docs");
  };

  const trace = (path: string, cell: Cell) => {
    const source = cell.sources?.[0];
    setSelectedField(path);
    if (!source) {
      toast.message("该字段暂无结构化来源");
      return;
    }
    setDocTarget({ docId: source.docId, page: source.page, rect: source.rect ?? null, region: source.region });
    setSourceField(path.split("|").slice(-1)[0]);
    setTab("docs");
  };

  const doExport = async () => {
    if (!task) return;
    const filename = await api.exportDraft(task.id);
    toast.success(`已导出 ${filename}`);
    await load();
  };

  const fitWidth = () => {
    const element = paperRef.current;
    if (!element) return;
    const available = element.clientWidth - 6;
    const natural = 860;
    setZoom(Number(Math.min(1, Math.max(0.62, available / natural)).toFixed(2)));
  };

  const rerun = async () => {
    try {
      await api.rerun(taskId, window.localStorage.getItem("bgl-model"));
      await load();
      toast.success("已按当前资料重新解析");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const review = async () => {
    if (!task) return;
    try {
      await api.review(task.id, "pass");
      toast.success("已模拟复核通过，任务进入可交付");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted-foreground">
        <AlertCircle className="size-6 text-destructive" />
        {error}
        <Button variant="outline" size="sm" onClick={() => router.push("/tasks")}>返回任务中心</Button>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const panelTask: Task = task;

  return (
    <>
      <main className="scroll-thin min-w-0 flex-1 overflow-auto">
        <div className="px-3 pb-16 pt-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[17px] font-semibold tracking-tight">{task.title}</h1>
                <StatusBadge status={task.status} />

              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                <span className="font-mono text-[11px]">{task.id}</span>
                <span className="text-[#D6D2CA]">|</span>
                <span>{task.customer}</span>
                <span className="text-[#D6D2CA]">|</span>
                <span>{task.draft ? ([task.draft.header["监管方式"]?.value, task.draft.header["运输方式"]?.value].filter(Boolean).join(" · ") || "—") : "资料解析中"}</span>
                <span className="text-[#D6D2CA]">|</span>
                <span>当前 v{task.version}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {role === "陈宁" && task.status === "待复核" && (
                <Button size="sm" variant="primary" onClick={review}>
                  <ShieldCheck className="size-3.5" /> 模拟复核通过
                </Button>
              )}
              {task.draft && (
                <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white px-0.5">
                  <button
                    className="grid size-7 place-items-center rounded-md text-[#4A4F57] hover:bg-[#F4F2ED]"
                    onClick={() => setZoom((value) => Math.max(0.62, Number((value - 0.06).toFixed(2))))}
                    aria-label="缩小草单"
                    title="缩小草单"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-10 text-center text-[11px] tabular-nums text-[#4A4F57]">{Math.round(zoom * 100)}%</span>
                  <button
                    className="grid size-7 place-items-center rounded-md text-[#4A4F57] hover:bg-[#F4F2ED]"
                    onClick={() => setZoom((value) => Math.min(1.4, Number((value + 0.06).toFixed(2))))}
                    aria-label="放大草单"
                    title="放大草单"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  <button
                    className="ml-0.5 flex h-7 items-center gap-1 rounded-md border-l border-border px-2 text-[10.5px] text-[#4A4F57] hover:bg-[#F4F2ED]"
                    onClick={fitWidth}
                    title="按当前宽度缩放整张草单"
                  >
                    <Maximize className="size-3" /> 适宽
                  </button>
                </div>
              )}
              <Button size="sm" variant="outline" onClick={rerun} disabled={processing} title="重新读取资料并按 skill 再跑一次">
                <RotateCcw className={cn("size-3.5", processing && "animate-spin")} /> 重新解析
              </Button>
              <Button size="sm" variant="outline" onClick={load}>
                <RefreshCw className="size-3.5" /> 刷新
              </Button>
            </div>
          </div>

          <MaterialsStrip task={task} onOpen={openMaterial} />

          {processing ? (
            <LoadingView task={task} />
          ) : (
            <div ref={paperRef} className="overflow-x-auto">
              <div style={{ zoom }}>
                <DraftPaper
                  task={task}
                  readOnly={readOnly || task.status === "已交付"}
                  onSave={save}
                  onConfirm={confirm}
                  onTrace={trace}
                  onExport={doExport}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <PanelResizer width={effectivePanelWidth} onChange={resizePanel} onReset={() => resizePanel(400 + extraWidth)} />
      <RightPanel
        task={panelTask}
        width={effectivePanelWidth}
        sessions={sessions}
        tab={tab}
        onTab={setTab}
        docTarget={docTarget}
        onDocTarget={setDocTarget}
        sourceField={sourceField}
        onCloseSource={() => setSourceField(null)}
        onOpenTask={(id) => router.push(`/work/${id}`)}
        onTaskUpdate={(next) => {
          setTask(next);
          api.bootstrap().then((state) => setSessions(state.sessions)).catch(() => undefined);
        }}
        selectedField={selectedField}
        readOnly={readOnly}
      />
    </>
  );
}

function LoadingView({ task }: { task: Task }) {
  const last = [...task.messages].reverse().find((message) => message.kind === "tool" && message.tool);
  const fromTool = last?.tool ? describeToolCall(last.tool.name, last.tool.args) : "";
  const stored = (task.progress?.text ?? "").replace(/\s*Harness\s*/gi, "");
  const step = fromTool || stored || "正在读取本票资料";
  return (
    <div className="flex flex-col items-center pb-10 pt-6 text-center">
      <div className="mb-5 size-14 animate-spin rounded-full border-[5px] border-[#D9E2F5] border-t-primary" />
      <h2 className="text-[17px] font-semibold">正在准备制单工作台</h2>
      <div className="mt-2 max-w-[560px] text-[12.5px] leading-6 text-muted-foreground">{step}</div>
    </div>
  );
}
