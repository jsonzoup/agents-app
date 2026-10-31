"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { AppSuggest } from "@/components/app-suggest";
import { AppSidebar, MANAGE_TABS, SYSTEM_TABS } from "@/components/shell/app-sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { SessionContext } from "@/lib/session";
import type { AppSummary, Me } from "@/lib/session";

function Crumbs({ apps }: { apps: AppSummary[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const items: { label: string; href?: string }[] = [];
  const title = (name: string) => apps.find((a) => a.name === name)?.title ?? name;
  if (parts[0] === "use" && parts[1]) {
    items.push({ label: title(parts[1]), href: `/use/${parts[1]}` });
  } else if (parts[0] === "manage") {
    items.push({ label: "应用管理", href: "/manage" });
    if (parts[1] === "new") items.push({ label: "新建应用" });
    else if (parts[1] === "build") items.push({ label: "AI 编码" });
    else if (parts[1]) {
      items.push({ label: title(parts[1]), href: `/manage/${parts[1]}` });
      const tab = MANAGE_TABS.find((t) => t.key === parts[2]);
      if (tab) items.push({ label: tab.label, href: `/manage/${parts[1]}/${tab.key}` });
      if (parts[3]) items.push({ label: parts.slice(3).join(" / ") });
    }
  } else if (parts[0] === "system") {
    items.push({ label: "系统管理" });
    const tab = SYSTEM_TABS.find((t) => t.key === parts[1]);
    if (tab) items.push({ label: tab.label });
  }
  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm">
      {items.map((it, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground/60">/</span>}
          {it.href && i < items.length - 1 ? (
            <Link href={it.href} className="truncate text-muted-foreground hover:text-foreground">
              {it.label}
            </Link>
          ) : (
            <span className={i === items.length - 1 ? "truncate font-medium" : "truncate text-muted-foreground"}>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function AppShortcuts({ apps }: { apps: AppSummary[] }) {
  const parts = usePathname().split("/").filter(Boolean);
  const app = parts[0] === "use" ? apps.find((a) => a.name === decodeURIComponent(parts[1] ?? "")) : undefined;
  if (!app) return null;
  return (
    <div className="ml-auto flex items-center gap-1">
      <AppSuggest app={app} />
      {app.level === "manage" && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link href={`/manage/${app.name}`}>
            <Settings2 /> 管理此应用
          </Link>
        </Button>
      )}
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ me: Me; apps: AppSummary[] } | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api<Me>("/api/me"), api<AppSummary[]>("/api/apps")])
      .then(([me, apps]) => setState({ me, apps }))
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(refresh, [refresh]);

  if (!state) return <div className="p-10 text-muted-foreground">加载中…</div>;

  return (
    <SessionContext.Provider value={{ ...state, refresh }}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Crumbs apps={state.apps} />
            <AppShortcuts apps={state.apps} />
          </header>
          <div className="min-w-0 flex-1 p-5">
            <Suspense fallback={<div className="text-muted-foreground">加载中…</div>}>{children}</Suspense>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SessionContext.Provider>
  );
}
