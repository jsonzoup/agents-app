"use client";

import Link from "next/link";
import { ArrowRight, Bot, ExternalLink, Loader2, Plus } from "lucide-react";
import { PageHeader, Pill } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useApi } from "@/lib/api";
import type { BuildSummary } from "@/lib/builder";
import { fmtTime } from "@/lib/format";
import { hasSystem, manages, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Where a session stands, from the person's side. */
function stateOf(b: BuildSummary) {
  if (b.running) return { label: "助手工作中", className: "border-sky-200 bg-sky-50 text-sky-700", spin: true };
  if (b.waiting) return { label: `等你处理 ${b.waiting} 项`, className: "border-amber-200 bg-amber-50 text-amber-800", spin: false };
  return { label: "等你回复", className: "text-muted-foreground", spin: false };
}

function SessionState({ b }: { b: BuildSummary }) {
  const st = stateOf(b);
  return (
    <Pill className={st.className}>
      {st.spin && <Loader2 className="size-3 animate-spin" />} {st.label}
    </Pill>
  );
}

const AiMark = ({ className }: { className?: string }) => (
  <span className={cn("grid place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-white", className)}>
    <Bot className="size-4" />
  </span>
);

/** An app the AI coding assistant is still creating: it sits with the apps, marked as a draft. */
function DraftCard({ b }: { b: BuildSummary }) {
  return (
    <Link href={`/manage/build/${b.id}`} className="group flex flex-col rounded-xl border border-dashed border-indigo-300 bg-indigo-50/30 p-4 transition hover:border-indigo-400 hover:shadow-sm dark:border-indigo-800 dark:bg-indigo-950/20">
      <div className="flex items-center gap-2.5">
        <AiMark className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{b.title}</div>
          <div className="font-mono text-xs text-muted-foreground">{b.app} · 未发布</div>
        </div>
        <Pill className="border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300">AI 创建中</Pill>
      </div>
      <p className="mt-2 flex-1 text-[13px] text-muted-foreground">
        {b.createdByName} 发起 · {b.messages} 条消息 · {fmtTime(b.updatedAt)}
      </p>
      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <SessionState b={b} />
        <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-700 group-hover:underline dark:text-indigo-300">
          继续对话 <ArrowRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}

export default function ManageIndex() {
  const { me, apps } = useSession();
  const managed = apps.filter(manages);
  const canCreate = hasSystem(me, "app.create");
  const { data: builds } = useApi<BuildSummary[]>("/api/builds");
  const drafts = (builds ?? []).filter((b) => b.mode === "new" && !b.published);
  const editing = (app: string) => (builds ?? []).filter((b) => b.mode === "existing" && b.app === app && !b.published);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="应用管理"
        description="你管理的应用，以及 AI 编码助手正在创建的应用。进入后可以看代码、处理改进信号和提案、跑评测、发布与回滚、设置谁能使用和管理。"
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/manage/new">
                <Plus /> 新建应用
              </Link>
            </Button>
          )
        }
      />

      {managed.length === 0 && drafts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>还没有你管理的应用</EmptyTitle>
            <EmptyDescription>{canCreate ? "点“新建应用”，描述你要做什么，AI 编码助手会边聊边把它做出来。" : "需要应用的管理权限，或“创建应用”的系统权限。"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {drafts.map((b) => (
            <DraftCard key={b.id} b={b} />
          ))}
          {managed.map((app) => {
            const edits = editing(app.name);
            const latest = edits[0];
            return (
              <div key={app.name} className="group flex flex-col rounded-xl border bg-card p-4 transition hover:border-foreground/30 hover:shadow-sm">
                <Link href={`/manage/${app.name}`} className="flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background">{app.title.slice(0, 1)}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{app.title}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {app.name} · {app.stable}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{app.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    <Pill className={app.counts.issues ? "border-amber-200 bg-amber-50 text-amber-800" : "text-muted-foreground"}>待处理问题 {app.counts.issues}</Pill>
                    <Pill className={app.counts.openProposals ? "border-sky-200 bg-sky-50 text-sky-800" : "text-muted-foreground"}>进行中提案 {app.counts.openProposals}</Pill>
                    <Pill className="text-muted-foreground">任务 {app.counts.tasks}</Pill>
                    <Pill className="text-muted-foreground">有权限的人 {app.counts.users}</Pill>
                  </div>
                </Link>
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/manage/${app.name}`}>管理</Link>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/use/${app.name}`}>
                      <ExternalLink /> 打开应用
                    </Link>
                  </Button>
                  {latest && (
                    <Link
                      href={edits.length === 1 ? `/manage/${app.name}/code?build=${latest.id}` : `/manage/${app.name}/code?chat`}
                      title={edits.length === 1 ? `${latest.createdByName} 发起的 AI 修改` : `${edits.length} 个 AI 修改会话`}
                      className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                    >
                      {latest.running ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Bot className="size-3.5 shrink-0" />}
                      <span className="truncate">
                        AI 修改中{edits.length > 1 && ` ×${edits.length}`}
                        {!latest.running && latest.waiting > 0 && ` · 等你处理`}
                      </span>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
