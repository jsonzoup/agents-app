"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { ContributionBanner, EditableValue, SuggestButton, SuggestionList, scopeOptions } from "@/components/kit";
import { PageHeader, Pill } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtTime } from "@/lib/format";
import type { AppUiProps, Task } from "@/sdk";

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Fallback business UI: tasks as JSON in, top-level output fields out. */
export function GenericTasks({ app, path, navigate, api }: AppUiProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const reload = useCallback(() => api.tasks().then(setTasks), [api]);
  useEffect(() => {
    reload();
  }, [reload]);
  if (path[0] === "new") return <NewTask app={app} api={api} navigate={navigate} />;
  if (path[0]) return <TaskView id={path[0]} app={app} api={api} navigate={navigate} />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={app.title}
        description={`${app.description}（这个应用没有自带界面，使用平台的通用任务视图）`}
        actions={
          <Button onClick={() => navigate("new")}>
            <Plus /> 新建任务
          </Button>
        }
      />
      <ContributionBanner api={api} appStable={app.stable} />
      <div className="divide-y rounded-xl border bg-card">
        {(tasks ?? []).map((t) => (
          <button key={t.id} onClick={() => navigate(t.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
            <code className="text-xs text-muted-foreground">{t.id}</code>
            <span className="flex-1 truncate">{t.title}</span>
            <Pill className={t.outcome === "error" ? "border-red-200 bg-red-50 text-red-700" : undefined}>{t.state === "confirmed" ? "已确认" : t.outcome === "error" ? "出错" : t.outcome ?? "执行中"}</Pill>
            <span className="text-xs text-muted-foreground">{fmtTime(t.createdAt)}</span>
          </button>
        ))}
        {tasks?.length === 0 && <p className="p-6 text-muted-foreground">还没有任务。</p>}
      </div>
    </div>
  );
}

function NewTask({ app, api, navigate }: Pick<AppUiProps, "app" | "api" | "navigate">) {
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("{\n  \n}");
  const [busy, setBusy] = useState(false);
  async function submit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return toast.error("输入不是合法 JSON");
    }
    setBusy(true);
    try {
      const t = await api.createTask({ title, input: parsed });
      navigate(t.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Button variant="ghost" size="sm" onClick={() => navigate("")}>
        <ArrowLeft /> 返回
      </Button>
      <PageHeader title={`新建任务 · ${app.title}`} />
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题" />
      <Textarea className="min-h-48 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} />
      <Button onClick={submit} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} 提交并执行
      </Button>
    </div>
  );
}

function TaskView({ id, app, api, navigate }: { id: string } & Pick<AppUiProps, "app" | "api" | "navigate">) {
  const [task, setTask] = useState<Task | null>(null);
  useEffect(() => {
    api.task(id).then(setTask);
  }, [api, id]);
  if (!task) return <p className="text-muted-foreground">加载中…</p>;
  const out = (task.working ?? {}) as Record<string, unknown>;
  const scopes = scopeOptions(app.scopes.map((s) => ({ ...s, value: task.run?.scope[s.key] })));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("")}>
        <ArrowLeft /> 返回
      </Button>
      <PageHeader
        title={`${task.id} · ${task.title}`}
        description={`版本 ${task.run?.release ?? "—"} · ${task.run?.result.executor ?? ""}${task.run?.result.note ? ` · ${task.run.result.note}` : ""}`}
        actions={
          task.working !== null && (
            <SuggestButton api={api} taskId={task.id} options={scopes} regions={Object.keys(out).map((k) => ({ path: k, label: k }))} onDone={setTask} label="提改进建议" />
          )
        }
      />
      <SuggestionList task={task} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 font-medium">输入</h3>
          <pre className="overflow-auto text-xs">{JSON.stringify(task.input, null, 2)}</pre>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 font-medium">输出（点值修正）</h3>
          {task.working === null ? (
            <p className="text-muted-foreground">没有输出：{task.run?.result.note}</p>
          ) : (
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5">
              {Object.entries(out).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>
                    <EditableValue
                      value={show(v)}
                      options={scopes}
                      disabled={Boolean(task.confirmed)}
                      changed={task.corrections.some((c) => c.path === k)}
                      onSave={async ({ value, note, scope }) => setTask(await api.correct(task.id, { path: k, field: k, value, note, scope }))}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {task.state === "ready" && task.working !== null && (
            <Button className="mt-4" onClick={async () => setTask(await api.confirm(task.id))}>
              确认无误
            </Button>
          )}
          {task.confirmed && <p className="mt-3 text-xs text-muted-foreground">已由 {task.confirmed.by} 于 {fmtTime(task.confirmed.at)} 确认</p>}
        </div>
      </div>
    </div>
  );
}
