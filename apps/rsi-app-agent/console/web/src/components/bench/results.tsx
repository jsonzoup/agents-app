"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Download, FlaskConical, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Failure, Loading, Pill, Section } from "@/components/shell/page";
import { VersionPicker } from "@/components/version-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, useApi } from "@/lib/api";
import { fmtTime, pct } from "@/lib/format";
import { ABLATION_LABEL } from "@/lib/kernel";
import type { Ablation, CaseScore, EvalRun, SuiteResult, Version } from "@/lib/kernel";
import type { AppSummary } from "@/lib/session";
import { cn } from "@/lib/utils";
import { JsonBlock, RUN_STATUS, SplitBadge, tone } from "./common";

interface Overview {
  versions: Version[];
  latest: Record<string, { run: string; at: string; evalset: string | null; dev?: SuiteResult; holdout?: SuiteResult }>;
  running: { id: string; version: string; status: string; progress: EvalRun["progress"] }[];
  cases: { id: string; title: string; split: "dev" | "holdout" }[];
  evalset: string | null;
  executor: { available: boolean; note: string };
}

export function Results({ app, initialVersion }: { app: AppSummary; initialVersion?: string | null }) {
  const { data, error, reload } = useApi<Overview>(`/api/apps/${app.name}/bench/overview`);
  const { data: runs, reload: reloadRuns } = useApi<EvalRun[]>(`/api/apps/${app.name}/bench/runs`);
  const [version, setVersion] = useState(initialVersion ?? app.stable);
  const [splits, setSplits] = useState({ dev: true, holdout: true });
  const [trials, setTrials] = useState("1");
  const [ablate, setAblate] = useState<"none" | Ablation>("none");
  const [starting, setStarting] = useState(false);
  const [baseline, setBaseline] = useState<string>(app.stable);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [cell, setCell] = useState<{ run: string; case: string; fromRun?: boolean } | null>(null);
  const canRun = app.permissions.includes("eval.run");
  const active = (runs ?? []).filter((r) => r.status === "running" || r.status === "queued");

  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => {
      reloadRuns();
      reload();
    }, 1500);
    return () => clearInterval(t);
  }, [active.length, reload, reloadRuns]);

  const rows = useMemo(() => {
    if (!data) return [];
    const order = data.versions.map((v) => v.id);
    return Object.keys(data.latest).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [data]);

  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  const scoreOf = (v: string, c: string): CaseScore | undefined => {
    const l = data.latest[v];
    return [...(l?.dev?.cases ?? []), ...(l?.holdout?.cases ?? [])].find((x) => x.case === c);
  };
  const kindOf = (v: string) => data.versions.find((x) => x.id === v);
  const unevaluated = data.versions.filter((v) => !data.latest[v.id]);

  async function start(v = version) {
    const chosen = (Object.keys(splits) as ("dev" | "holdout")[]).filter((k) => splits[k]);
    if (chosen.length === 0) return toast.error("至少选一个评测范围");
    setStarting(true);
    try {
      const run = await api<EvalRun>(`/api/apps/${app.name}/bench/runs`, { body: { version: v, splits: chosen, trials: Number(trials), ablate: ablate === "none" ? null : ablate } });
      toast.success(`已开始评测 ${run.version}（${run.id}），共 ${run.progress.total} 个用例${run.trials ? `，每个跑 ${run.trials} 次` : ""}${run.ablate ? `，${ABLATION_LABEL[run.ablate]}` : ""}`);
      reloadRuns();
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!data.executor.available && (
        <Alert variant="destructive">
          <AlertDescription>
            <b>不能评测</b>：{data.executor.note}
          </AlertDescription>
        </Alert>
      )}

      {canRun && (
        <Section title="评测一个版本">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <VersionPicker app={app.name} value={version} onChange={setVersion} />
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={splits.dev} onCheckedChange={(v) => setSplits((s) => ({ ...s, dev: Boolean(v) }))} /> 开发集
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={splits.holdout} onCheckedChange={(v) => setSplits((s) => ({ ...s, holdout: Boolean(v) }))} /> 留出集
            </label>
            <Select value={trials} onValueChange={setTrials}>
              <SelectTrigger className="h-8 w-36 text-sm" title="同一个用例跑几次。模型每次输出可能不同，跑多次看通过率，只认稳定的退步">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["1", "2", "3", "4", "5"].map((n) => (
                  <SelectItem key={n} value={n}>
                    每个用例跑 {n} 次
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ablate} onValueChange={(v) => setAblate(v as typeof ablate)}>
              <SelectTrigger className="h-8 w-32 text-sm" title="拿掉一部分再跑，和完整运行对比，看它贡献了多少">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">完整版本</SelectItem>
                <SelectItem value="knowledge">去掉知识</SelectItem>
                <SelectItem value="skills">去掉技能</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => start()} disabled={starting}>
              {starting ? <Loader2 className="animate-spin" /> : <Play />} 开始评测
            </Button>
            <span className="text-xs text-muted-foreground">在后台运行，可以离开这个页面。用的是当前评测集 {data.evalset ?? "—"}。</span>
          </div>
          {(trials !== "1" || ablate !== "none") && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {trials !== "1" && `每个用例跑 ${trials} 次，模型调用和耗时都是 ${trials} 倍；检查项过半次数通过算通过，报告列出时过时不过的检查项。`}
              {ablate === "knowledge" && "去掉知识：保留根说明和各技能的 SKILL.md，拿掉参考资料和客户等范围知识，对比同一版本的完整运行，看知识贡献了多少。"}
              {ablate === "skills" && "去掉技能：整个技能目录都不给智能体，对比同一版本的完整运行，看技能贡献了多少。"}
              {ablate !== "none" && "消融结果不代表这个版本的成绩，不进上面的版本得分表。"}
            </p>
          )}
          {active.length > 0 && (
            <div className="space-y-2 border-t px-4 py-3">
              {active.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <Loader2 className="size-4 animate-spin text-blue-600" />
                  <span className="w-44 shrink-0">
                    <span className="font-mono">{r.version}</span> · {r.id} · {RUN_STATUS[r.status].label}
                  </span>
                  <Progress value={(r.progress.done / Math.max(1, r.progress.total)) * 100} className="h-2 flex-1" />
                  <span className="w-40 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {r.progress.done}/{r.progress.total}
                    {r.progress.current && ` · 正在跑 ${r.progress.current}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section
        title="各版本的最新得分"
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            对比基准
            <Select value={baseline} onValueChange={setBaseline}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rows.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="p-6 text-muted-foreground">还没有评测结果。{canRun ? "在上面选一个版本开始评测。" : "请管理者发起评测。"}</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal [&>th]:whitespace-nowrap">
                  <th>版本</th>
                  <th>开发集</th>
                  <th>留出集</th>
                  <th>评测集</th>
                  {data.cases.map((c) => (
                    <th key={c.id} title={c.title}>
                      <div className="font-medium text-foreground">{c.id}</div>
                      <div className="max-w-32 truncate">
                        {c.split === "holdout" ? "留出 · " : ""}
                        {c.title}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const l = data.latest[v];
                  const info = kindOf(v);
                  const stale = l.evalset !== data.evalset;
                  return (
                    <tr key={v} className={cn("border-t [&>td]:px-3 [&>td]:py-2", v === baseline && "bg-muted/40")}>
                      <td className="whitespace-nowrap">
                        <span className="font-mono">{v}</span>
                        {info?.stable && <Pill className="ml-1 border-emerald-200 text-emerald-700">稳定</Pill>}
                        {info?.kind === "candidate" && <Pill className="ml-1 border-amber-200 text-amber-700">候选</Pill>}
                        <div className="text-[11px] text-muted-foreground">
                          <button className="hover:underline" onClick={() => setOpenRun(l.run)}>
                            {l.run}
                          </button>{" "}
                          · {fmtTime(l.at)}
                        </div>
                      </td>
                      <SuiteCell s={l.dev} />
                      <SuiteCell s={l.holdout} />
                      <td className="whitespace-nowrap text-xs">
                        <span className="font-mono">{l.evalset ?? "—"}</span>
                        {stale && (
                          <div className="text-amber-700" title={`当前评测集是 ${data.evalset}，这个结果用的是旧评测集`}>
                            评测集已更新
                            {canRun && (
                              <button className="ml-1 underline" onClick={() => start(v)}>
                                重评
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      {data.cases.map((c) => {
                        const s = scoreOf(v, c.id);
                        const b = v !== baseline ? scoreOf(baseline, c.id) : undefined;
                        const delta = s && b ? s.score - b.score : 0;
                        return (
                          <td key={c.id}>
                            {s ? (
                              <button
                                onClick={() => setCell({ run: data.latest[v].run, case: c.id })}
                                className={cn(
                                  "inline-flex items-center gap-0.5 rounded px-2 py-0.5 tabular-nums ring-offset-1 hover:ring-1 hover:ring-foreground/30",
                                  s.error || s.invalid ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : tone(s.score),
                                )}
                                title={s.error ? `执行出错，不计分：${s.error}` : s.invalid ? `用例无效：${s.invalid}` : s.passRate !== undefined ? `${s.trials?.length ?? 0} 次里通过 ${pct(s.passRate)}` : undefined}
                              >
                                {s.error ? "出错" : s.invalid ? "无效" : pct(s.score)}
                                {s.violations.length > 0 && " ⚠"}
                                {delta > 0.0001 && <ArrowUp className="size-3 text-emerald-700" />}
                                {delta < -0.0001 && <ArrowDown className="size-3 text-red-700" />}
                              </button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {unevaluated.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            还没评测过：
            {unevaluated.slice(0, 8).map((v) => (
              <button key={v.id} disabled={!canRun} onClick={() => (setVersion(v.id), start(v.id))} className="rounded border px-1.5 py-0.5 font-mono hover:bg-muted disabled:cursor-default">
                {v.id}
                {v.kind === "candidate" ? " 候选" : ""}
                {canRun && " ▶"}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="评测记录">
        <div className="divide-y">
          {(runs ?? []).map((r) => {
            const total = (r.results.dev?.total ?? 0) + (r.results.holdout?.total ?? 0);
            const passed = (r.results.dev?.passed ?? 0) + (r.results.holdout?.passed ?? 0);
            const unscored = [r.results.dev, r.results.holdout].reduce((n, x) => n + (x?.errors?.length ?? 0) + (x?.invalid?.length ?? 0), 0);
            return (
              <button key={r.id} onClick={() => setOpenRun(r.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/40">
                <span className="w-14 font-mono text-xs text-muted-foreground">{r.id}</span>
                <span className="w-24 font-mono">
                  {r.version}
                  {r.kind === "candidate" && <FlaskConical className="ml-1 inline size-3 text-amber-600" />}
                </span>
                <Pill className={RUN_STATUS[r.status].className}>{RUN_STATUS[r.status].label}</Pill>
                <span className="w-28 text-xs text-muted-foreground" title={r.cases?.join("、")}>
                  {r.cases ? <Pill className="border-blue-200 text-blue-700">所选 {r.cases.length} 个</Pill> : r.splits.map((s) => (s === "dev" ? "开发集" : "留出集")).join(" + ")}
                </span>
                {r.trials && <Pill className="border-slate-200 text-slate-700">×{r.trials}</Pill>}
                {r.ablate && <Pill className="border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700">{ABLATION_LABEL[r.ablate]}</Pill>}
                <span className="w-28 tabular-nums">{r.status === "done" ? `${passed}/${total} 通过${unscored ? ` · ${unscored} 未计分` : ""}` : r.status === "failed" ? <span className="text-red-700">{r.error?.slice(0, 40)}</span> : `${r.progress.done}/${r.progress.total}`}</span>
                <span className="text-xs text-muted-foreground">评测集 {r.evalset ?? "—"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.by} · {fmtTime(r.at)}
                </span>
              </button>
            );
          })}
          {runs?.length === 0 && <p className="p-6 text-muted-foreground">还没有评测记录。</p>}
        </div>
      </Section>

      <RunSheet app={app.name} id={openRun} onClose={() => setOpenRun(null)} onCase={(run, c) => (setOpenRun(null), setCell({ run, case: c, fromRun: true }))} onRun={setOpenRun} />
      <CaseSheet app={app.name} cell={cell} onClose={() => setCell(null)} onBack={(run) => (setCell(null), setOpenRun(run))} />
    </div>
  );
}

function SuiteCell({ s }: { s?: SuiteResult }) {
  if (!s) return <td className="text-muted-foreground">未评</td>;
  const unscored = (s.errors?.length ?? 0) + (s.invalid?.length ?? 0);
  if (s.total === 0 && unscored === 0) return <td className="text-muted-foreground">无用例</td>;
  return (
    <td className="whitespace-nowrap tabular-nums">
      <span className={cn("rounded px-1.5 py-0.5", tone(s.score))}>{pct(s.score)}</span> <span className="text-xs text-muted-foreground">{s.passed}/{s.total}</span>
      {unscored > 0 && <Unscored s={s} />}
    </td>
  );
}

function Unscored({ s }: { s: SuiteResult }) {
  return (
    <div className="text-[11px] text-slate-600">
      {s.errors?.length ? `${s.errors.length} 个执行出错` : ""}
      {s.errors?.length && s.invalid?.length ? " · " : ""}
      {s.invalid?.length ? `${s.invalid.length} 个用例无效` : ""}
      ，不计分
    </div>
  );
}

function RunSheet({ app, id, onClose, onCase, onRun }: { app: string; id: string | null; onClose: () => void; onCase: (run: string, c: string) => void; onRun: (run: string) => void }) {
  const { data: run } = useApi<EvalRun>(id ? `/api/apps/${app}/bench/runs/${id}` : null);
  const shown = run && run.id === id ? run : null;
  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            评测 {id} {shown && <span className="font-mono">· {shown.version}</span>}
          </SheetTitle>
          <SheetDescription>
            {shown ? `${shown.by} 于 ${fmtTime(shown.at)} 发起 · 评测集 ${shown.evalset ?? "—"} · ${shown.executor}` : "加载中…"}
          </SheetDescription>
        </SheetHeader>
        {shown && (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {shown.cases && <span className="text-xs text-muted-foreground">所选用例：{shown.cases.join("、")}（部分用例，不作为发布依据）</span>}
              {shown.status === "done" && (
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/apps/${app}/bench/runs/${shown.id}/report?format=md&download`}>
                      <Download /> 报告 Markdown
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/apps/${app}/bench/runs/${shown.id}/report?format=json&download`}>
                      <Download /> 报告 JSON
                    </a>
                  </Button>
                </span>
              )}
            </div>
            {shown.error && <Failure error={{ message: shown.error }} />}
            {(shown.trials || shown.ablate) && (
              <p className="text-xs text-muted-foreground">
                {shown.trials && `每个用例跑 ${shown.trials} 次，检查项过半次数通过算通过。`}
                {shown.ablation && `${shown.ablation.title}。消融结果不代表这个版本的成绩。`}
              </p>
            )}
            {shown.ablation && <AblationBlock ablation={shown.ablation} onRun={onRun} />}
            {(["dev", "holdout"] as const).map((split) => {
              const s = shown.results[split];
              if (!s) return null;
              return (
                <div key={split} className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                    <SplitBadge split={split} />
                    <span className="tabular-nums">
                      {s.passed}/{s.total} 通过 · 平均 {pct(s.score)}
                    </span>
                    {((s.errors?.length ?? 0) > 0 || (s.invalid?.length ?? 0) > 0) && <span className="text-xs text-slate-600">{s.errors?.length ? `${s.errors.join("、")} 执行出错` : ""}{s.errors?.length && s.invalid?.length ? "；" : ""}{s.invalid?.length ? `${s.invalid.join("、")} 用例无效` : ""}，不计分</span>}
                  </div>
                  <div className="divide-y">
                    {s.cases.map((c) => (
                      <button key={c.case} onClick={() => onCase(shown.id, c.case)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-muted/40">
                        <span className="w-16 font-mono">{c.case}</span>
                        {c.error || c.invalid ? (
                          <>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{c.error ? "出错" : "无效"}</span>
                            <span className="min-w-0 truncate text-xs text-slate-600" title={c.error ?? c.invalid}>
                              {c.error ? `执行出错，不计分：${c.error}` : c.invalid}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", tone(c.score))}>{pct(c.score)}</span>
                            <span className="text-xs text-muted-foreground">
                              {c.checks.filter((x) => x.ok).length}/{c.checks.length} 项
                              {c.passRate !== undefined && ` · ${c.trials?.filter((t) => !t.error).length ?? 0} 次里通过 ${pct(c.passRate)}`}
                              {c.violations.length > 0 && ` · 违反 ${c.violations.length} 条硬规则`}
                            </span>
                          </>
                        )}
                        {c.ms !== undefined && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{(c.ms / 1000).toFixed(1)}s</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {shown.status !== "done" && shown.status !== "failed" && (
              <p className="text-sm text-muted-foreground">
                进行中：{shown.progress.done}/{shown.progress.total}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CaseSheet({ app, cell, onClose, onBack }: { app: string; cell: { run: string; case: string; fromRun?: boolean } | null; onClose: () => void; onBack: (run: string) => void }) {
  const { data } = useApi<CaseScore & { expected: unknown; input: unknown; title: string }>(cell ? `/api/apps/${app}/bench/runs/${cell.run}/cases/${cell.case}` : null);
  const shown = data && cell && data.case === cell.case ? data : null;
  const failing = shown ? shown.checks.filter((c) => !c.ok) : [];
  return (
    <Sheet open={Boolean(cell)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-auto sm:max-w-4xl">
        <SheetHeader>
          {cell?.fromRun && (
            <button className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => onBack(cell.run)}>
              <ArrowLeft className="size-3.5" /> 返回评测 {cell.run}
            </button>
          )}
          <SheetTitle>
            {cell?.case} · {shown?.title ?? ""}
          </SheetTitle>
          <SheetDescription>
            {shown ? `评测 ${cell?.run} · 得分 ${pct(shown.score)} · ${shown.checks.filter((c) => c.ok).length}/${shown.checks.length} 项检查通过${shown.ms !== undefined ? ` · 用时 ${(shown.ms / 1000).toFixed(1)}s` : ""}` : "加载中…"}
          </SheetDescription>
        </SheetHeader>
        {shown && (
          <div className="space-y-4 px-4 pb-6">
            {shown.violations.length > 0 && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">违反硬规则：{shown.violations.join("；")}</div>}
            {shown.error && <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">执行出错，不计分：{shown.error}。这不是智能体答错，重新运行即可。</div>}
            {shown.invalid && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                用例无效，没有执行：{shown.invalid}。期望值或参考答案需要人修正，见 <Link className="underline" href={`?tab=cases&case=${cell?.case}`}>用例</Link>。
              </div>
            )}
            {shown.trials && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {shown.trials.length} 次运行：
                {shown.trials.map((t, i) => (
                  <span key={i} title={t.error ?? `${pct(t.score)}${t.ms ? ` · ${(t.ms / 1000).toFixed(1)}s` : ""}`} className={cn("rounded px-1.5 py-0.5 tabular-nums", t.error ? "bg-slate-100 text-slate-600" : tone(t.ok ? 1 : t.score))}>
                    {t.error ? "出错" : t.ok ? "通过" : pct(t.score)}
                  </span>
                ))}
                <span>· 表里的"实际"取自没通过的那次</span>
              </div>
            )}
            <div className="rounded-lg border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                检查项 {failing.length > 0 && <span className="text-red-700">（{failing.length} 项不符）</span>}
              </div>
              <table className="w-full text-[13px]">
                <thead className="text-xs text-muted-foreground">
                  <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-normal">
                    <th>检查项</th>
                    <th>期望</th>
                    <th>实际</th>
                    {shown.trials && <th className="w-16">通过次数</th>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {[...shown.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((c) => (
                    <tr key={c.path} className={cn("border-t [&>td]:px-3 [&>td]:py-1 [&>td]:align-top", !c.ok && "bg-red-50/60 dark:bg-red-950/30")}>
                      <td className="font-mono text-xs">{c.path}</td>
                      <td className="break-all">{c.expected === "" ? <span className="text-muted-foreground">（空）</span> : c.expected}</td>
                      <td className={cn("break-all", !c.ok && "text-red-700")}>{c.actual === "" ? <span className="text-muted-foreground">（空）</span> : c.actual}</td>
                      {shown.trials && <td className={cn("tabular-nums", c.rate !== undefined && c.rate > 0 && c.rate < 1 && "text-amber-700")}>{c.rate === undefined ? "—" : pct(c.rate)}</td>}
                      <td>{c.ok ? "✓" : "✗"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium">期望结果（人维护）</div>
                <JsonBlock value={shown.expected} className="max-h-96" />
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">应用的输出</div>
                <JsonBlock value={shown.output} className="max-h-96" />
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">输入</summary>
              <JsonBlock value={shown.input} className="mt-1 max-h-72" />
            </details>
            <p className="text-xs text-muted-foreground">
              期望值不对？到 <Link className="underline" href={`?tab=cases&case=${cell?.case}`}>用例</Link> 里修改。
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AblationBlock({ ablation, onRun }: { ablation: NonNullable<EvalRun["ablation"]>; onRun: (run: string) => void }) {
  if (!ablation.against) return <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">同一版本、同一评测集上还没有完整运行，没法对比贡献；先用"完整版本"跑一次。</p>;
  const points = (d: number) => `${(Math.abs(d) * 100).toFixed(1)} 个百分点`;
  return (
    <div className="rounded-lg border border-fuchsia-200">
      <div className="border-b border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-sm">
        对照完整运行{" "}
        <button className="font-mono underline" onClick={() => onRun(ablation.against!)}>
          {ablation.against}
        </button>
        ：{ablation.delta === null ? "没有两边都打了分的用例" : ablation.delta > 0 ? `去掉后平均低 ${points(ablation.delta)}，这部分有贡献` : ablation.delta < 0 ? `去掉后平均反而高 ${points(ablation.delta)}，这部分可能有误导` : "去掉后得分不变，这部分在这些用例上没起作用"}
      </div>
      <table className="w-full text-[13px]">
        <thead className="text-xs text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-normal">
            <th>用例</th>
            <th>完整</th>
            <th>消融</th>
            <th>差</th>
          </tr>
        </thead>
        <tbody>
          {ablation.cases.map((c) => (
            <tr key={c.id} className="border-t [&>td]:px-3 [&>td]:py-1">
              <td className="font-mono">{c.id}</td>
              <td className="tabular-nums">{pct(c.full)}</td>
              <td className="tabular-nums">{pct(c.ablated)}</td>
              <td className={cn("tabular-nums", c.delta > 0 && "text-emerald-700", c.delta < 0 && "text-red-700")}>{c.delta === 0 ? "—" : `${c.delta > 0 ? "−" : "+"}${points(c.delta)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
