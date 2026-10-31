"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Database, FileCode2, FlaskConical, GitCompare, Hammer, History, Import, Loader2, PlayCircle, RotateCcw, Server } from "lucide-react";
import { toast } from "sonner";
import { ExportButton, ImportButton } from "@/components/app-archive";
import { LineDiff } from "@/components/line-diff";
import { Failure, Loading, PageHeader, Pill, Section } from "@/components/shell/page";
import { VersionPicker, useVersions } from "@/components/version-picker";
import { tone } from "@/components/bench/common";
import { redeploy, WebDeploy } from "@/components/web-deploy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, useApi } from "@/lib/api";
import { formatBytes } from "@/lib/files";
import { fmtTime, pct, PROPOSAL_STATUS, TIER } from "@/lib/format";
import type { Channels, FileDiff, ReleaseRow, StorageInfo, SuiteResult } from "@/lib/kernel";
import { useApp, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Latest = Record<string, { run: string; evalset: string | null; dev?: SuiteResult; holdout?: SuiteResult }>;

function Diffs({ app, diffs, from, to }: { app: string; diffs: FileDiff[]; from: string; to: string }) {
  if (diffs.length === 0) return <p className="p-3 text-muted-foreground">两个版本内容相同。</p>;
  const raw = (v: string, p: string) => `/api/apps/${app}/raw?path=${encodeURIComponent(p)}&version=${v}`;
  return (
    <div className="space-y-2">
      {diffs.map((d) => (
        <details key={d.path} open={diffs.length <= 6} className="overflow-hidden rounded-md border">
          <summary className="flex cursor-pointer items-center gap-2 bg-muted/40 px-3 py-1.5">
            <code className="text-xs">{d.path}</code>
            <Pill className={TIER[d.tier]?.className}>{TIER[d.tier]?.label}</Pill>
            <span className={cn("text-xs", d.status === "added" ? "text-emerald-700" : d.status === "removed" ? "text-red-700" : "text-amber-700")}>{d.status === "added" ? "新增" : d.status === "removed" ? "删除" : "修改"}</span>
          </summary>
          {d.binary ? (
            <div className="flex gap-3 p-3 text-sm text-muted-foreground">
              二进制文件，
              {d.status !== "added" && (
                <a className="underline" href={raw(from, d.path)} target="_blank" rel="noreferrer">
                  查看 {from} 的
                </a>
              )}
              {d.status !== "removed" && to !== "source" && (
                <a className="underline" href={raw(to, d.path)} target="_blank" rel="noreferrer">
                  查看 {to} 的
                </a>
              )}
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <LineDiff before={d.before} after={d.after} />
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

function Score({ s }: { s?: SuiteResult }) {
  if (!s || s.total === 0) return null;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", tone(s.score))}>
      {s.split === "dev" ? "开发" : "留出"} {pct(s.score)}
    </span>
  );
}

export default function ReleasesPage() {
  const { app, refresh: refreshApp } = useApp();
  const { refresh } = useSession();
  const search = useSearchParams();
  const { data, error, reload } = useApi<{ channels: Channels; releases: ReleaseRow[]; storage: StorageInfo }>(`/api/apps/${app.name}/releases`);
  const { data: versions } = useVersions(app.name);
  const { data: overview } = useApi<{ latest: Latest; evalset: string | null }>(`/api/apps/${app.name}/bench/overview`);
  const { data: proposals } = useApi<{ id: string; title: string; status: string; author: string; createdAt: string; passed: boolean | null }[]>(`/api/apps/${app.name}/proposals`);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>(search.get("compare") ?? app.stable);
  const [diffs, setDiffs] = useState<{ key: string; list: FileDiff[] } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [rollbackTo, setRollbackTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [importing, setImporting] = useState<FileDiff[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);

  useEffect(() => {
    if (from || !data) return;
    const target = data.releases.find((r) => r.id === to);
    setFrom(target?.parent ?? (to !== app.stable ? app.stable : data.releases[1]?.id ?? app.stable));
  }, [data, from, to, app.stable]);

  async function compare(a = from, b = to) {
    if (!a || !b) return;
    setComparing(true);
    try {
      setDiffs({ key: `${a}→${b}`, list: await api<FileDiff[]>(`/api/apps/${app.name}/diff?from=${a}&to=${b}`) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setComparing(false);
    }
  }
  useEffect(() => {
    if (search.get("compare") && from) compare(from, to);
    // run once when arriving from another page with ?compare=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setRollbackTo(null);
      setImporting(null);
      setReason("");
      setNote("");
      reload();
      refreshApp();
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  const canRollback = app.permissions.includes("release.rollback");
  const canImport = app.permissions.includes("release.import");
  const canTrial = app.permissions.includes("app.trial");
  const candidates = (versions ?? []).filter((v) => v.kind === "candidate");
  const latest = overview?.latest ?? {};

  const actions = (id: string) => (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      <Button size="sm" variant="ghost" asChild>
        <Link href={`/manage/${app.name}/code?version=${id}`}>
          <FileCode2 /> 文件
        </Link>
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link href={`/manage/${app.name}/evals?tab=results&version=${id}`}>
          <PlayCircle /> 评测
        </Link>
      </Button>
      {canTrial && id !== data.channels.stable && (
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/use/${app.name}?version=${id}`}>
            <FlaskConical /> 试用
          </Link>
        </Button>
      )}
      {canRollback && (
        <Button
          size="sm"
          variant="ghost"
          disabled={deploying !== null}
          title="重新安装依赖、构建并重启这个版本的应用"
          onClick={async () => {
            setDeploying(id);
            try {
              await redeploy(app.name, id);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setDeploying(null);
            }
          }}
        >
          {deploying === id ? <Loader2 className="animate-spin" /> : <Hammer />} 重新部署
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        description="每个版本都是不可变的完整快照；“稳定版”指针决定大家用哪个版本。新版本先以提案的候选版本出现，可以试用、评测，验证和批准后才发布；回滚只是移动指针，不删历史。"
        actions={
          <div className="flex flex-wrap gap-2">
            {canTrial && <ExportButton app={app.name} stable={app.stable} />}
            {canTrial && <ImportButton label="导入新版本" />}
            {canImport && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    setImporting(await api<FileDiff[]>(`/api/apps/${app.name}/diff?from=${app.stable}&to=source`));
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                <Import /> 导入人工变更
              </Button>
            )}
          </div>
        }
      />

      <Section title="新版本怎么上线">
        <ol className="grid gap-px overflow-hidden rounded-b-xl bg-border text-[13px] sm:grid-cols-5">
          {[
            ["改", "在“代码包”手动改，或用 AI 在工作区改；也可以从改进信号起草"],
            ["候选版本", "提交后成为提案，它的候选版本 = 稳定版 + 改动，立即可用"],
            ["试用 + 评测", "在应用里切到候选版本办几单；在“评测”里选它跑评测集"],
            ["验证", "和稳定版逐项对比：不退步、确有改进、留出集把关"],
            ["批准发布", "按级别批准后自动生成新版本并设为稳定版"],
          ].map(([t, d], i) => (
            <li key={t} className="bg-card p-3">
              <div className="flex items-center gap-1.5 font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-foreground text-[11px] text-background">{i + 1}</span>
                {t}
                {i < 4 && <ArrowRight className="ml-auto hidden size-3.5 text-muted-foreground sm:block" />}
              </div>
              <p className="mt-1 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {candidates.length > 0 && (
            <Section title={`候选版本（${candidates.length} 个提案待发布）`}>
              <ul className="divide-y">
                {candidates.map((v) => {
                  const p = proposals?.find((x) => x.id === v.id);
                  const l = latest[v.id];
                  return (
                    <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <FlaskConical className="size-4 text-amber-600" />
                      <Link href={`/manage/${app.name}/proposals/${v.id}`} className="font-mono font-semibold hover:underline">
                        {v.id}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{v.note}</span>
                      {p && <Pill className={PROPOSAL_STATUS[p.status]?.className}>{PROPOSAL_STATUS[p.status]?.label}</Pill>}
                      {l ? (
                        <span className="flex gap-1">
                          <Score s={l.dev} />
                          <Score s={l.holdout} />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">未评测</span>
                      )}
                      {actions(v.id)}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          <Section
            title="对比任意两个版本"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <VersionPicker app={app.name} value={from} onChange={setFrom} className="h-8 w-48" />
                <ArrowRight className="size-4 text-muted-foreground" />
                <VersionPicker app={app.name} value={to} onChange={setTo} className="h-8 w-48" />
                <Button size="sm" onClick={() => compare()} disabled={comparing || !from || from === to}>
                  {comparing ? <Loader2 className="animate-spin" /> : <GitCompare />} 对比
                </Button>
              </div>
            }
          >
            <div className="p-3">{diffs ? <Diffs app={app.name} diffs={diffs.list} from={diffs.key.split("→")[0]} to={diffs.key.split("→")[1]} /> : <p className="text-sm text-muted-foreground">选两个版本（含候选版本）看文件差异。</p>}</div>
          </Section>

          <Section title="发布版本">
            <ol className="divide-y">
              {data.releases.map((r) => {
                const l = latest[r.id];
                return (
                  <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", r.id === data.channels.stable ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-muted-foreground/30")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{r.id}</span>
                        {r.id === data.channels.stable && <Pill className="border-emerald-200 bg-emerald-50 text-emerald-700">稳定版</Pill>}
                        <Pill>{r.origin === "source" ? "人工导入" : "提案发布"}</Pill>
                        {r.proposal && (
                          <Link href={`/manage/${app.name}/proposals/${r.proposal.id}`} className="text-[13px] hover:underline">
                            {r.proposal.id} · {r.proposal.title}
                          </Link>
                        )}
                        {l && (
                          <span className="flex gap-1">
                            <Score s={l.dev} />
                            <Score s={l.holdout} />
                            {l.evalset !== overview?.evalset && <span className="text-[11px] text-amber-700">（旧评测集 {l.evalset}）</span>}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{r.note}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtTime(r.createdAt)} · {r.files} 个文件 · {formatBytes(r.bytes)}
                        {r.parent ? ` · 基于 ${r.parent}，改了 ${r.changed} 个文件` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {actions(r.id)}
                      <div className="flex gap-1">
                        {r.parent && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setFrom(r.parent!);
                              setTo(r.id);
                              compare(r.parent!, r.id);
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            <GitCompare /> 和 {r.parent} 对比
                          </Button>
                        )}
                        {canRollback && r.id !== data.channels.stable && (
                          <Button size="sm" variant="ghost" onClick={() => setRollbackTo(r.id)}>
                            <RotateCcw /> 设为稳定版
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title={
              <span className="flex items-center gap-1.5">
                <Server className="size-4" /> 应用部署（稳定版）
              </span>
            }
          >
            <WebDeploy app={app.name} version={data.channels.stable} canDeploy={canRollback} />
          </Section>
          <Section
            title={
              <span className="flex items-center gap-1.5">
                <Database className="size-4" /> 版本怎么存
              </span>
            }
          >
            <div className="space-y-2 p-4 text-[13px] leading-6">
              <p className="text-muted-foreground">
                每个文件按内容哈希只存一份，版本只记“路径 → 哈希”，所以多个版本共享没变的文件；候选版本不另存，打开时由稳定版加改动生成。
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">存储方式</dt>
                <dd>{data.storage.driver === "minio" ? "MinIO（对象存储）" : "本机文件"}</dd>
                <dt className="text-muted-foreground">位置</dt>
                <dd className="break-all font-mono text-xs">{data.storage.location}</dd>
                <dt className="text-muted-foreground">版本内容</dt>
                <dd>
                  {data.storage.unique} 个不同文件，共 {formatBytes(data.storage.bytes)}
                </dd>
              </dl>
              <p className="text-xs text-muted-foreground">{data.storage.note}</p>
            </div>
          </Section>
          <Section
            title={
              <span className="flex items-center gap-1.5">
                <History className="size-4" /> 稳定版指针记录
              </span>
            }
          >
            <ol className="space-y-3 p-4">
              {[...data.channels.history].reverse().map((h, i) => (
                <li key={i} className="text-[13px]">
                  <div className="font-mono">
                    {h.from ?? "∅"} → <b>{h.to}</b>
                  </div>
                  <div className="text-muted-foreground">{h.reason}</div>
                  <div className="text-xs text-muted-foreground">{fmtTime(h.at)}</div>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <Dialog open={rollbackTo !== null} onOpenChange={(v) => !v && setRollbackTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>把稳定版设为 {rollbackTo}</DialogTitle>
            <DialogDescription>之后新建的任务都会用 {rollbackTo}。当前的 {data.channels.stable} 仍然保留，随时可以再切回来。</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（必填），例如：r3 上线后某类单据的单价换算出错" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRollbackTo(null)}>
              取消
            </Button>
            <Button disabled={busy || !reason.trim()} onClick={() => act(() => api(`/api/apps/${app.name}/rollback`, { body: { to: rollbackTo, reason } }), `稳定版已切到 ${rollbackTo}`)}>
              {busy && <Loader2 className="animate-spin" />} 确认切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importing !== null} onOpenChange={(v) => !v && setImporting(null)}>
        <DialogContent className="max-h-[90svh] overflow-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>导入源目录的人工变更</DialogTitle>
            <DialogDescription>契约这类只能由人改的文件，在源目录改好并经过评审后从这里导入，成为新版本并设为稳定版。下面是源目录与 {app.stable} 的差异。</DialogDescription>
          </DialogHeader>
          {importing && <Diffs app={app.name} diffs={importing} from={app.stable} to="source" />}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="变更说明（必填）：改了什么、谁评审过" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImporting(null)}>
              取消
            </Button>
            <Button disabled={busy || !note.trim() || importing?.length === 0} onClick={() => act(() => api(`/api/apps/${app.name}/import`, { body: { note } }), "已导入为新版本")}>
              {busy && <Loader2 className="animate-spin" />} 导入并发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
