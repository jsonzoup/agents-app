"use client";

import Link from "next/link";
import { Failure, Loading, PageHeader, Pill } from "@/components/shell/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/lib/api";
import { fmtTime, PROPOSAL_STATUS, TIER } from "@/lib/format";
import type { ProposalRow } from "@/lib/kernel";
import { useApp } from "@/lib/session";
import { useState } from "react";

const author = (a: string) => (a.startsWith("human:") ? `${a.slice(6)}（手动）` : `AI · ${a}`);

export default function ProposalsPage() {
  const { app } = useApp();
  const { data, error } = useApi<ProposalRow[]>(`/api/apps/${app.name}/proposals`);
  const [filter, setFilter] = useState("open");
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((p) => filter === "all" || (filter === "open" ? ["draft", "verified", "failed"].includes(p.status) : p.status === filter));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        description="对应用包的每次修改都是一个提案：AI 编码助手改或人手动写，先过五道验证闸门，再按层级批准（知识：一位管理者；代码：两位不同的管理者），通过后成为新版本。"
        actions={
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => v && setFilter(v)}>
            <ToggleGroupItem value="open">进行中</ToggleGroupItem>
            <ToggleGroupItem value="released">已发布</ToggleGroupItem>
            <ToggleGroupItem value="rejected">已驳回</ToggleGroupItem>
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>没有提案</EmptyTitle>
            <EmptyDescription>从“改进信号”让 AI 起草，或在“应用包与代码”里手动修改文件。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
                <th className="w-16">编号</th>
                <th>标题</th>
                <th className="w-20">层级</th>
                <th className="w-36">状态</th>
                <th className="w-40">作者</th>
                <th className="w-24">基于 → 发布</th>
                <th className="w-36">提出时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2">
                  <td className="font-mono text-xs">{p.id}</td>
                  <td>
                    <Link className="font-medium hover:underline" href={`/manage/${app.name}/proposals/${p.id}`}>
                      {p.title}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{p.files.join("、")}</div>
                  </td>
                  <td>
                    <Pill className={TIER[p.tier]?.className}>{TIER[p.tier]?.label}</Pill>
                  </td>
                  <td>
                    <Pill className={PROPOSAL_STATUS[p.status]?.className}>{PROPOSAL_STATUS[p.status]?.label}</Pill>
                  </td>
                  <td className="text-muted-foreground">{author(p.author)}</td>
                  <td className="font-mono text-xs">
                    {p.base}
                    {p.release ? ` → ${p.release}` : ""}
                  </td>
                  <td className="text-muted-foreground">{fmtTime(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
