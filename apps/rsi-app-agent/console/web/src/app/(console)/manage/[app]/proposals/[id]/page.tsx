"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, CircleCheck, CircleX, FileCode2, FlaskConical, Loader2, PlayCircle, Rocket, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { LineDiff } from "@/components/line-diff";
import { Failure, Loading, PageHeader, Pill, Section } from "@/components/shell/page";
import { FileViewer } from "@/components/viewer/file-viewer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, useApi } from "@/lib/api";
import { fmtTime, pct, PROPOSAL_STATUS, TIER } from "@/lib/format";
import { applyChanges, type ProposalDetail, type SuiteResult } from "@/lib/kernel";
import { useApp, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

function Suite({ label, base, cand, regressions, fixed }: { label: string; base: SuiteResult; cand: SuiteResult; regressions: string[]; fixed: string[] }) {
  const delta = cand.score - base.score;
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-muted-foreground">{pct(base.score)}</span>→<span className="text-lg font-semibold">{pct(cand.score)}</span>
        <span className={cn("text-xs", delta > 0 ? "text-emerald-700" : delta < 0 ? "text-red-700" : "text-muted-foreground")}>
          {delta >= 0 ? "+" : ""}
          {(delta * 100).toFixed(1)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          通过 {base.passed}/{base.total} → {cand.passed}/{cand.total}
        </span>
      </div>
      {fixed.length > 0 && <div className="mt-1 text-xs text-emerald-700">修好：{fixed.join("、")}</div>}
      {regressions.length > 0 && <div className="mt-1 text-xs text-red-700">退步：{regressions.join("、")}</div>}
    </div>
  );
}

export default function ProposalPage() {
  const { app, refresh: refreshApp } = useApp();
  const { me, refresh } = useSession();
  const { id } = useParams<{ id: string }>();
  const { data: p, error, setData } = useApi<ProposalDetail>(`/api/apps/${app.name}/proposals/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function run(kind: string, fn: () => Promise<unknown>) {
    setBusy(kind);
    try {
      await fn();
      setData(await api<ProposalDetail>(`/api/apps/${app.name}/proposals/${id}`));
      refreshApp();
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <Failure error={error} />;
  if (!p) return <Loading />;
  const v = p.verification;
  const paths = [...new Set(p.changes.map((c) => c.path))];
  const need = p.required;
  const SLOT = { owner: "第一位管理者", engineer: "第二位管理者" } as const;
  const approvedBy = (r: string) => p.approvals.find((a) => a.role === r);
  const iApproved = p.approvals.some((a) => a.by === me.user.name);
  const canApprove = app.permissions.includes("approve.owner");
  const slot = need.find((r) => !approvedBy(r));
  const lastSlot = slot !== undefined && need.filter((r) => !approvedBy(r)).length === 1;
  const satisfied = p.status === "verified" && need.length > 0 && slot === undefined;
  const canSetPolicy = app.permissions.includes("access.manage");
  const open = p.status === "draft" || p.status === "verified" || p.status === "failed";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href={`/manage/${app.name}/proposals`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> 提案
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-muted-foreground">{p.id}</code> {p.title}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Pill className={PROPOSAL_STATUS[p.status]?.className}>{PROPOSAL_STATUS[p.status]?.label}</Pill>
            <Pill className={TIER[p.tier]?.className}>{TIER[p.tier]?.label}</Pill>
            <span>{p.author.startsWith("human:") ? `${p.author.slice(6)} 手动修正` : `AI 起草（${p.author}）`}</span>
            <span>· 基于 {p.base}</span>
            {p.issue && (
              <Link className="underline" href={`/manage/${app.name}/signals`}>
                · 来自问题 {p.issue}
              </Link>
            )}
            {p.release && <span>· 已发布为 {p.release}</span>}
            <span>· {fmtTime(p.createdAt)}</span>
            {p.webOnly && <Pill className="border-violet-200 bg-violet-50 text-violet-700">只改 web 应用</Pill>}
          </span>
        }
        actions={
          open && (
            <>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/manage/${app.name}/code?version=${p.id}`}>
                  <FileCode2 /> 候选版本的文件
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/manage/${app.name}/evals?tab=results&version=${p.id}`}>
                  <PlayCircle /> 评测候选版本
                </Link>
              </Button>
              {app.permissions.includes("app.trial") && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/use/${app.name}?version=${p.id}`}>
                    <FlaskConical /> 试用
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Tabs defaultValue="diff">
            <TabsList>
              <TabsTrigger value="diff">改动（{paths.length} 个文件）</TabsTrigger>
              <TabsTrigger value="record">决策记录</TabsTrigger>
            </TabsList>
            <TabsContent value="diff" className="space-y-3">
              {paths.map((path) => {
                const changes = p.changes.filter((c) => c.path === path);
                const last = changes.at(-1)!;
                const put = last.op === "put" ? last : null;
                return (
                  <Section
                    key={path}
                    title={
                      <span className="flex items-center gap-2">
                        <code className="text-[13px]">{path}</code>
                        <span className={cn("text-xs font-normal", last.op === "delete" ? "text-red-700" : p.existed[path] ? "text-amber-700" : "text-emerald-700")}>
                          {last.op === "delete" ? "删除" : p.existed[path] ? "修改" : "新增"}
                        </span>
                      </span>
                    }
                  >
                    {last.op === "delete" ? (
                      <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Trash2 className="size-4" /> 这个文件会被删除。
                      </p>
                    ) : put ? (
                      <div className="h-96">
                        <FileViewer path={path} url={`/api/apps/${app.name}/raw?path=${encodeURIComponent(path)}&version=${p.status === "released" && p.release ? p.release : p.id}`} size={put.size} />
                      </div>
                    ) : (
                      <LineDiff before={p.before[path]} after={applyChanges(p.before[path], changes)} />
                    )}
                  </Section>
                );
              })}
            </TabsContent>
            <TabsContent value="record">
              <Section>
                <div className="grid gap-4 p-4">
                  {(
                    [
                      ["背景", p.record.background],
                      ["决定", p.record.decision],
                      ["影响", p.record.impact],
                      ["复核", p.record.review],
                    ] as const
                  ).map(([k, t]) => (
                    <div key={k}>
                      <div className="mb-0.5 text-xs text-muted-foreground">{k}</div>
                      <p className="whitespace-pre-wrap">{t || "—"}</p>
                    </div>
                  ))}
                  {p.record.options.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">考虑过的方案</div>
                      {p.record.options.map((o) => (
                        <div key={o.title} className="mb-1.5 rounded-md border p-2">
                          <div className="font-medium">{o.title}</div>
                          <div className="text-xs text-emerald-700">优点：{o.pros}</div>
                          <div className="text-xs text-red-700">缺点：{o.cons}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.record.source && <div className="text-xs text-muted-foreground">对应人工记录：{p.record.source}</div>}
                </div>
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <Section
            title={
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-4" /> 验证
              </span>
            }
            actions={
              p.status === "draft" &&
              app.permissions.includes("proposal.verify") && (
                <Button size="sm" onClick={() => run("verify", () => api(`/api/apps/${app.name}/proposals/${p.id}/verify`, { body: {} }))} disabled={busy !== null}>
                  {busy === "verify" && <Loader2 className="animate-spin" />} 运行验证
                </Button>
              )
            }
          >
            <div className="space-y-3 p-3">
              {!v ? (
                <p className="text-muted-foreground">还没验证。验证会在基线 {p.stable} 和候选版本上各跑一遍评测，由裁判打分。</p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {v.gates.map((g) => (
                      <li key={g.gate} className="flex items-start gap-2">
                        {g.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" />}
                        <div>
                          <div>{g.gate}</div>
                          <div className="text-xs text-muted-foreground">{g.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Suite label={`开发集（基线 ${v.baseline}）`} base={v.dev.baseline} cand={v.dev.candidate} regressions={v.dev.comparison.regressions} fixed={v.dev.comparison.fixed} />
                  {v.holdout && <Suite label="留出集（只看一次）" base={v.holdout.baseline} cand={v.holdout.candidate} regressions={v.holdout.comparison.regressions} fixed={v.holdout.comparison.fixed} />}
                  <div className="text-xs text-muted-foreground">验证于 {fmtTime(v.at)}</div>
                </>
              )}
            </div>
          </Section>

          <Section title="批准">
            <div className="space-y-2 p-3">
              {p.tier === "contract" && <p className="text-red-700">契约层级的改动不能经由进化回路发布。</p>}
              {(["owner", "engineer"] as const).filter((r) => need.includes(r) || approvedBy(r)).map((r, _, shown) => {
                const a = approvedBy(r);
                return (
                  <div key={r} className="flex items-center gap-2">
                    <span className="w-24 text-muted-foreground">{shown.length > 1 ? SLOT[r] : "管理者"}</span>
                    {a ? (
                      <span className={a.ok ? "text-emerald-700" : "text-red-700"}>
                        {a.ok ? <Check className="inline size-4" /> : <X className="inline size-4" />} {a.by} · {fmtTime(a.at)}
                        {a.note && <span className="text-muted-foreground"> · {a.note}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">待批准</span>
                    )}
                  </div>
                );
              })}
              {open && p.tier !== "contract" && (
                <p className="text-xs text-muted-foreground">
                  {p.tier === "knowledge" ? "知识层级的改动由一位管理者批准。" : need.length > 1 ? "这个应用的代码层级改动需要两位不同的管理者批准。" : "这个应用的代码层级改动只需一位管理者批准。"}
                  {p.tier === "code" &&
                    (canSetPolicy ? (
                      <>
                        可以在
                        <Link className="underline" href={`/manage/${app.name}/access`}>
                          权限
                        </Link>
                        里设置。
                      </>
                    ) : (
                      "人数由应用的管理者在权限里设置。"
                    ))}
                  批准就是发布：最后一位批准后，候选版本立即成为新的稳定版本，新的单据开始使用它，没有单独的发布按钮。之后若有问题，可以在“版本与发布”里回滚。
                </p>
              )}
              {satisfied && canApprove && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs text-amber-700">批准人数已改为一位，已有的批准已经满足要求。确认后发布。</p>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() =>
                      run("ok", () =>
                        api<ProposalDetail>(`/api/apps/${app.name}/proposals/${p.id}/decide`, { body: { role: "owner", ok: true, note: "按当前批准规则确认发布" } }).then((out) =>
                          toast.success(`已发布为 ${out.release}，现在是稳定版本`),
                        ),
                      )
                    }
                  >
                    <Rocket /> 确认发布
                  </Button>
                </div>
              )}
              {p.status === "verified" && canApprove && slot && !iApproved && (
                <div className="space-y-2 border-t pt-3">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="意见（驳回时必填）" />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy !== null}
                      onClick={() =>
                        run("ok", () =>
                          api<ProposalDetail>(`/api/apps/${app.name}/proposals/${p.id}/decide`, { body: { role: slot, ok: true, note } }).then((out) =>
                            toast.success(out.release ? `已批准并发布为 ${out.release}，现在是稳定版本` : "已批准；还需要另一位管理者批准，批准后自动发布"),
                          ),
                        )
                      }
                    >
                      {lastSlot ? <Rocket /> : <Check />}
                      {lastSlot ? "批准并发布" : `批准（${SLOT[slot]}）`}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null || !note.trim()} onClick={() => run("no", () => api(`/api/apps/${app.name}/proposals/${p.id}/decide`, { body: { role: slot, ok: false, note } }))}>
                      驳回
                    </Button>
                  </div>
                </div>
              )}
              {p.status === "verified" && iApproved && slot && <p className="text-xs text-amber-700">你已经批准过；还需要另一位管理者批准，他批准后自动发布。</p>}
              {p.status === "verified" && slot && !canApprove && <p className="text-xs text-muted-foreground">等待这个应用的管理者批准，批准后自动发布。</p>}
              {p.status === "draft" && <p className="text-xs text-muted-foreground">先通过验证才能批准。</p>}
              {p.status === "released" && p.release && (
                <p className="text-emerald-700">
                  已发布为 <Link className="underline" href={`/manage/${app.name}/releases`}>{p.release}</Link>，新的单据会使用它。
                </p>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
