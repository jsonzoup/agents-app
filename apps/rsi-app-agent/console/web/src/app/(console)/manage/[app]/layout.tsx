"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Bot, ExternalLink } from "lucide-react";
import { MANAGE_TABS } from "@/components/shell/app-sidebar";
import { Failure, Loading, Pill } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { AppContext } from "@/lib/session";
import type { AppSummary } from "@/lib/session";
import { cn } from "@/lib/utils";

export default function ManageAppLayout({ children }: { children: React.ReactNode }) {
  const { app: name } = useParams<{ app: string }>();
  const pathname = usePathname();
  const { data: app, error, reload } = useApi<AppSummary>(`/api/apps/${name}`);
  if (error) return <Failure error={error} />;
  if (!app) return <Loading />;
  if (app.level !== "manage") return <Failure error={{ message: `你只有「${app.title}」的使用权限，没有管理权限。` }} />;
  return (
    <AppContext.Provider value={{ app, refresh: reload }}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background">{app.title.slice(0, 1)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{app.title}</h1>
            <Pill className="font-mono">{app.name}</Pill>
            <Pill className="border-emerald-200 bg-emerald-50 text-emerald-700">稳定版 {app.stable}</Pill>
          </div>
          <p className="truncate text-[13px] text-muted-foreground">{app.description}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/use/${app.name}`}>
              <ExternalLink /> 打开应用
            </Link>
          </Button>
          {app.permissions.includes("proposal.create") && (
            <Button size="sm" asChild>
              <Link href={`/manage/${app.name}/code?chat=1`}>
                <Bot /> AI 修改
              </Link>
            </Button>
          )}
        </div>
      </div>
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b">
        {MANAGE_TABS.map((t) => {
          const href = `/manage/${app.name}/${t.key}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const n = t.key === "signals" ? app.counts.issues : t.key === "proposals" ? app.counts.openProposals : 0;
          return (
            <Link
              key={t.key}
              href={href}
              className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <t.icon className="size-4" />
              {t.label}
              {n > 0 && <span className="rounded-full bg-foreground/10 px-1.5 text-[11px] tabular-nums">{n}</span>}
            </Link>
          );
        })}
      </nav>
      {children}
    </AppContext.Provider>
  );
}
