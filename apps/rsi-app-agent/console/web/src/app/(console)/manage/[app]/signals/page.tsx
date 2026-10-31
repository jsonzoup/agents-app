"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Bot, FileSearch, LayoutTemplate, Lightbulb, Loader2, Paperclip, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { JsonBlock } from "@/components/bench/common";
import { Failure, Loading, PageHeader, Pill } from "@/components/shell/page";
import { suggestionPlace } from "@/components/kit";
import { FileViewer } from "@/components/viewer/file-viewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, useApi } from "@/lib/api";
import { encodePath, formatBytes } from "@/lib/files";
import { fmtTime, PROPOSAL_STATUS, scopeLabel, SIGNAL_KIND } from "@/lib/format";
import { displayName } from "@/lib/files";
import type { IssueView, Signal } from "@/lib/kernel";
import { useApp, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Improvements {
  issues: IssueView[];
  taskOnly: number;
  confirmations: number;
  suggestions: number;
  total: number;
}

type Filter = "open" | "proposed" | "released" | "dismissed";

const stageOf = (i: IssueView): Filter =>
  i.state?.status === "dismissed" ? "dismissed" : i.proposals.some((p) => p.status === "released") ? "released" : i.proposals.some((p) => p.status === "draft" || p.status === "verified") ? "proposed" : "open";

const targetOf = (s: Signal) => (s.kind === "suggestion" && s.target ? suggestionPlace(s.target) : s.kind === "suggestion" ? "整单" : (s.field ?? "—"));

/** Interface and feature suggestions change the app's code; the knowledge learner can't act on them. */
const productOf = (i: IssueView): "ui" | "feature" | null => (i.field?.startsWith("ui:") ? "ui" : i.field?.startsWith("feature:") ? "feature" : null);
const PRODUCT = {
  ui: { label: "界面建议", icon: LayoutTemplate, className: "border-sky-200 bg-sky-50 text-sky-800" },
  feature: { label: "功能建议", icon: Sparkles, className: "border-violet-200 bg-violet-50 text-violet-800" },
};

/** Home-relative files an input names (uploads, evaluation materials). */
function materialsIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string" && (/^\.rsi\/uploads\//.test(v) || /^[a-z][a-z0-9-]*\/evals\/(materials|cases)\//.test(v))) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

export default function SignalsPage() {
  const { app } = useApp();
  const { me } = useSession();
  const router = useRouter();
  const { data, error, setData } = useApi<Improvements>(`/api/apps/${app.name}/improvements`);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [signal, setSignal] = useState<string | null>(null);
  const [dismiss, setDismiss] = useState<IssueView | null>(null);
  const canPropose = app.permissions.includes("proposal.create");
  const titles = Object.fromEntries(app.scopes.map((s) => [s.key, s.title]));

  async function draft(issue: string) {
    setBusy(issue);
    try {
      const b = await api<{ id: string }>("/api/builds", { body: { app: app.name, issue } });
      router.push(`/manage/${app.name}/code?build=${b.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }
  async function reopen(i: IssueView) {
    try {
      setData(await api<Improvements>(`/api/apps/${app.name}/issues/${i.id}/state`, { method: "PUT", body: { dismissed: false } }));
      toast.success("已重新打开");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  const groups: Record<Filter, IssueView[]> = { open: [], proposed: [], released: [], dismissed: [] };
  for (const i of data.issues) groups[stageOf(i)].push(i);
  const shown = groups[filter];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader description="办理时的修正、改进建议和确认都会留下信号，连同当时整张单据的内容。标了“这个范围 / 所有单据”的反馈按对象和范围归成问题；“只这一单”和确认无误只计数。对界面和功能的建议按页面区域归并（每个新功能单独一条），交给 AI 编码助手改应用的代码。" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["信号总数", data.total],
          ["待处理问题", groups.open.length],
          ["改进建议", data.suggestions],
          ["只这一单", data.taskOnly],
          ["确认无误", data.confirmations],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="open">待处理 {groups.open.length}</TabsTrigger>
          <TabsTrigger value="proposed">修改中 {groups.proposed.length}</TabsTrigger>
          <TabsTrigger value="released">已发布 {groups.released.length}</TabsTrigger>
          <TabsTrigger value="dismissed">不采纳 {groups.dismissed.length}</TabsTrigger>
        </TabsList>
        <TabsContent value={filter} className="mt-4 space-y-4">
          {shown.length === 0 && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>{filter === "open" ? "没有待处理的问题" : "这里是空的"}</EmptyTitle>
                <EmptyDescription>业务员修正某个值、或对一块区域 / 整张单据提改进建议，并选择“这个范围”或“所有单据”时，这里会出现问题。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {shown.map((i) => {
            const stage = stageOf(i);
            const product = productOf(i);
            return (
              <section key={i.id} className={cn("rounded-xl border bg-card", stage === "dismissed" && "opacity-75")}>
                <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
                  {product ? (
                    <Pill className={PRODUCT[product].className}>
                      {(() => {
                        const Icon = PRODUCT[product].icon;
                        return <Icon className="size-3" />;
                      })()}
                      {PRODUCT[product].label}
                    </Pill>
                  ) : (
                    <Pill className={i.kind === "suggestion" ? "border-amber-200 bg-amber-50 text-amber-800" : undefined}>
                      {i.kind === "suggestion" && <Lightbulb className="size-3" />}
                      {SIGNAL_KIND[i.kind] ?? i.kind}
                    </Pill>
                  )}
                  <span className="font-medium">{i.summary}</span>
                  {!product && <Pill className="text-muted-foreground">{scopeLabel(i.scope, titles)}</Pill>}
                  <span className="text-xs text-muted-foreground">{i.signals.length} 条</span>
                  <span className="flex-1" />
                  {i.proposals.map((p) => (
                    <Link key={p.id} href={`/manage/${app.name}/proposals/${p.id}`}>
                      <Pill className={PROPOSAL_STATUS[p.status]?.className}>
                        {p.id} · {PROPOSAL_STATUS[p.status]?.label}
                        {p.release ? ` · ${p.release}` : ""}
                      </Pill>
                    </Link>
                  ))}
                  {canPropose && stage === "open" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => draft(i.id)} disabled={busy !== null} title={!me.platform.harness.available ? me.platform.harness.note : product ? "AI 编码助手读这些建议、截图和当时的页面，在副本上改应用的界面和功能，你在预览里试用，发布后成为提案" : "AI 编码助手读这个问题下所有反馈及当时的单据，在副本上修改并评测，发布后成为提案"}>
                        {busy === i.id ? <Loader2 className="animate-spin" /> : <Bot />} AI 修改
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/manage/${app.name}/code?issue=${encodeURIComponent(i.id)}`}>
                          <Pencil /> 手动修正
                        </Link>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDismiss(i)}>
                        <Ban /> 不采纳
                      </Button>
                    </>
                  )}
                  {canPropose && stage === "dismissed" && (
                    <Button size="sm" variant="ghost" onClick={() => reopen(i)}>
                      <RotateCcw /> 重新打开
                    </Button>
                  )}
                </div>
                {i.state && (
                  <div className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
                    {i.state.by} 于 {fmtTime(i.state.at)} 决定不采纳：{i.state.reason}（提出的人会看到）
                  </div>
                )}
                <table className="w-full text-[13px]">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="[&>th]:px-4 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-normal">
                      <th className="w-32">时间</th>
                      <th className="w-20">谁</th>
                      <th className="w-14">版本</th>
                      <th className="w-32">对象</th>
                      <th>内容</th>
                      <th className="w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {i.signals.map((s) => (
                      <tr key={s.id} className="border-t align-top [&>td]:px-4 [&>td]:py-1.5">
                        <td className="text-muted-foreground">{fmtTime(s.at)}</td>
                        <td>{s.by}</td>
                        <td className="font-mono text-xs">{s.release}</td>
                        <td className={cn("text-xs", s.kind !== "suggestion" && "font-mono")}>{targetOf(s)}</td>
                        <td>
                          {s.kind === "correction" ? (
                            <>
                              <span className="text-red-700 line-through decoration-red-300">{s.before || "（空）"}</span> → <span className="text-emerald-700">{s.after || "（空）"}</span>
                              {s.note && <div className="text-xs text-muted-foreground">原因：{s.note}</div>}
                            </>
                          ) : (
                            <span>{s.note ?? "—"}</span>
                          )}
                          {(s.attachments?.length ?? 0) > 0 && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Paperclip className="size-3" />
                              {s.attachments!.length}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          {s.hasContext && (
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSignal(s.id)}>
                              <FileSearch /> {s.target?.level === "ui" || s.target?.level === "feature" ? "看详情" : "看单据"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </TabsContent>
      </Tabs>
      {!me.platform.model.configured && canPropose && data.issues.length > 0 && <p className="text-xs text-amber-700">AI 起草不可用：{me.platform.model.note.replace(/。$/, "")}。可以用“手动修正”。</p>}

      <SignalSheet app={app.name} id={signal} onClose={() => setSignal(null)} />
      <DismissDialog
        issue={dismiss}
        onClose={() => setDismiss(null)}
        onDone={async (reason) => {
          setData(await api<Improvements>(`/api/apps/${app.name}/issues/${dismiss!.id}/state`, { method: "PUT", body: { dismissed: true, reason } }));
          setDismiss(null);
          toast.success("已标记为不采纳");
        }}
      />
    </div>
  );
}

function DismissDialog({ issue, onClose, onDone }: { issue: IssueView | null; onClose: () => void; onDone: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={Boolean(issue)} onOpenChange={(v) => !v && (onClose(), setReason(""))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>不采纳：{issue?.summary}</DialogTitle>
          <DialogDescription>不改应用，关闭这个问题。提出反馈的人会在应用里看到你的原因；之后可以重新打开。</DialogDescription>
        </DialogHeader>
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填）：如这是个别客户的临时要求，已单独沟通" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onDone(reason.trim());
                setReason("");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            确定不采纳
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SignalSheet({ app, id, onClose }: { app: string; id: string | null; onClose: () => void }) {
  const { data } = useApi<Signal>(id ? `/api/apps/${app}/signals/${id}` : null);
  const s = data && data.id === id ? data : null;
  const ctx = s?.context;
  const [preview, setPreview] = useState<{ path: string; name: string } | null>(null);
  const materials = materialsIn(ctx?.input);
  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && (onClose(), setPreview(null))}>
      <SheetContent className="w-full overflow-auto sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>
            {s ? `${SIGNAL_KIND[s.kind] ?? s.kind} · ${targetOf(s)}` : "加载中…"}
            {ctx?.task && <span className="ml-2 font-normal text-muted-foreground">单据 {ctx.task} · {ctx.title}</span>}
          </SheetTitle>
          <SheetDescription>{s ? `${s.by} 于 ${fmtTime(s.at)} 在版本 ${s.release} 上提出 · ${scopeLabel(s.scope)}${ctx?.executor ? ` · ${ctx.executor}` : ""}` : ""}</SheetDescription>
        </SheetHeader>
        {s && (
          <div className="space-y-4 px-4 pb-8">
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              {s.kind === "correction" ? (
                <>
                  <b>{s.field}</b>：<span className="text-red-700 line-through">{s.before || "（空）"}</span> → <span className="text-emerald-700">{s.after || "（空）"}</span>
                </>
              ) : (
                <b>{targetOf(s)}</b>
              )}
              {s.note && <p className="mt-1">{s.note}</p>}
            </div>

            {(s.attachments?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium">附件</div>
                <div className="flex flex-wrap gap-2">
                  {s.attachments!.map((a) => (
                    <button key={a.path} onClick={() => setPreview(a)} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-muted", preview?.path === a.path && "bg-muted")}>
                      <Paperclip className="mr-1 inline size-3" />
                      {a.name} <span className="text-muted-foreground">{formatBytes(a.size)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {materials.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium">单据材料</div>
                <div className="flex flex-wrap gap-2">
                  {materials.map((p) => (
                    <button key={p} onClick={() => setPreview({ path: p, name: displayName(p) })} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-muted", preview?.path === p && "bg-muted")}>
                      {displayName(p)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {preview && (
              <div className="h-[420px] overflow-hidden rounded-lg border">
                <FileViewer key={preview.path} path={preview.name} url={`/files/${encodePath(preview.path)}`} />
              </div>
            )}

            {ctx && (s.target?.level === "ui" || s.target?.level === "feature") && (
              <div className="text-sm text-muted-foreground">
                {ctx.page ? (
                  <>
                    所在页面 <span className="font-mono text-foreground">{ctx.page}</span>，
                  </>
                ) : null}
                版本 <span className="font-mono text-foreground">{ctx.version ?? s.release}</span>
                {ctx.task ? `，当时在看单据 ${ctx.task}` : ""}
              </div>
            )}
            {ctx && "output" in ctx ? (
              <>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm font-medium">应用当时的输出</div>
                    <JsonBlock value={ctx.output} className="max-h-[420px]" />
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium">人工修正后的结果</div>
                    <JsonBlock value={ctx.working} className="max-h-[420px]" />
                  </div>
                </div>
                {(ctx.corrections?.length ?? 0) > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium">这张单据上的全部修正</div>
                    <table className="w-full rounded-md border text-[13px]">
                      <tbody>
                        {ctx.corrections!.map((c, i) => (
                          <tr key={i} className="border-t first:border-t-0 [&>td]:px-3 [&>td]:py-1">
                            <td className="font-mono text-xs">{c.field}</td>
                            <td>
                              <span className="text-red-700 line-through">{c.before || "（空）"}</span> → <span className="text-emerald-700">{c.after || "（空）"}</span>
                            </td>
                            <td className="text-xs text-muted-foreground">
                              {c.by}
                              {c.note ? `：${c.note}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(ctx.suggestions?.length ?? 0) > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium">这张单据上的全部建议</div>
                    <ul className="space-y-1 text-[13px]">
                      {ctx.suggestions!.map((x, i) => (
                        <li key={i}>
                          <Pill className="mr-1">{x.target ? suggestionPlace(x.target) : "整单"}</Pill>
                          {x.note} <span className="text-xs text-muted-foreground">— {x.by}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(ctx.instructions?.length ?? 0) > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium">运行时用到的范围知识</div>
                    <ul className="list-disc pl-5 text-[13px] text-muted-foreground">
                      {ctx.instructions!.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-medium">单据输入</summary>
                  <JsonBlock value={ctx.input} className="mt-1 max-h-96" />
                </details>
              </>
            ) : ctx ? null : (
              <p className="text-sm text-muted-foreground">这条信号产生时还没有记录单据上下文。</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
