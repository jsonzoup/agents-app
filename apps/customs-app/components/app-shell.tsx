"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronDown,
  LayoutDashboard,
  ListChecks,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useRole } from "@/components/providers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const ShellLayoutContext = React.createContext({ focus: false, navWidth: 232 });

export function useShellLayout() {
  return React.useContext(ShellLayoutContext);
}

const NAV = [
  { href: "/work", label: "制单工作台", icon: LayoutDashboard },
  { href: "/tasks", label: "任务中心", icon: ListChecks },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { role, setRole } = useRole();
  const [navCollapsed, setNavCollapsed] = React.useState(false);
  const [focus, setFocus] = React.useState(false);

  React.useEffect(() => {
    setNavCollapsed(window.localStorage.getItem("bgl-nav-collapsed") === "1");
  }, []);

  React.useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus]);

  const toggleNav = () => {
    setNavCollapsed((prev) => {
      window.localStorage.setItem("bgl-nav-collapsed", prev ? "0" : "1");
      return !prev;
    });
  };

  const toggleFocus = () => setFocus((prev) => !prev);
  const navWidth = navCollapsed ? 74 : 232;

  const isTasks = pathname.startsWith("/tasks");
  const detail = isTasks ? "" : pathname === "/work" ? "新建制单" : "草单工作区";

  return (
    <ShellLayoutContext.Provider value={{ focus, navWidth }}>
    <div className="flex h-screen overflow-hidden bg-background">
      {!focus && (
        <nav
          className={cn(
            "relative flex flex-none flex-col overflow-y-auto bg-[#080d15] py-5 text-slate-300 transition-[width] duration-200",
            navCollapsed ? "w-[74px] px-2.5" : "w-[232px] px-3",
          )}
        >
          <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" />
          <div className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-[#2c5be6]/15 blur-3xl" />
          <div className="relative flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Link href="/work" className={cn("flex items-center gap-2.5", navCollapsed && "justify-center")} title="报关灵">
                <span className="grid size-9 flex-none place-items-center rounded-[11px] bg-gradient-to-br from-[#C8A45C] to-[#8A6A2B] text-[17px] font-bold text-white shadow-lg shadow-black/20">
                  关
                </span>
                {!navCollapsed && (
                  <span className="flex min-w-0 flex-col leading-none">
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold text-white">
                      报关灵
                      <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-medium tracking-wide text-[#A8B7CC]">2.0</span>
                    </span>
                    <span className="mt-1 text-[10.5px] font-normal text-[#7E8FA8]">AI 制单工作台</span>
                  </span>
                )}
              </Link>
              {!navCollapsed && (
                <button
                  onClick={toggleNav}
                  className="grid size-6 place-items-center rounded-md text-[#7E8FA8] transition-colors hover:bg-white/10 hover:text-white"
                  title="收起菜单"
                  aria-label="收起菜单"
                >
                  <PanelLeftClose className="size-4" />
                </button>
              )}
            </div>

            {navCollapsed ? (
              <button
                onClick={toggleNav}
                className="grid h-8 w-full place-items-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-[#7E8FA8] hover:text-white"
                title="展开菜单"
                aria-label="展开菜单"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            ) : (
              <button className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]">
                <span className="grid size-7 flex-none place-items-center rounded-lg bg-[#1a2733] text-[12px] font-medium text-[#D9C48A]">关</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[12.5px] text-slate-100">报关团队</span>
                </span>
                <ChevronDown className="size-3.5 flex-none text-[#7E8FA8]" />
              </button>
            )}

            {!navCollapsed && <div className="px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5F728C]">工作空间</div>}
            <div className="space-y-1">
              {NAV.map((item) => {
                const active = pathname === item.href || (item.href === "/work" && pathname.startsWith("/work/"));
                const link = (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center rounded-[10px] text-[13px] text-[#A8B7CC] transition-colors hover:bg-white/[0.05] hover:text-white",
                      navCollapsed ? "h-10 w-full justify-center" : "gap-2.5 px-2.5 py-2.5",
                      active && "bg-white/[0.08] font-medium text-white",
                    )}
                  >
                    {active && !navCollapsed && <span className="absolute -left-1 h-4 w-[3px] rounded-full bg-[#C8A45C]" />}
                    <item.icon className={cn("size-4 flex-none", active ? "text-[#D9C48A]" : "text-[#6B7F9A]")} />
                    {!navCollapsed && <span>{item.label}</span>}
                  </Link>
                );
                return navCollapsed ? (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </div>
          </div>

          <div className="relative mt-auto pt-6">
            <div
              className={cn(
                "rounded-xl border border-white/[0.07] bg-white/[0.03] p-3",
                navCollapsed && "flex justify-center p-2.5",
              )}
              title="制单助手已就绪"
            >
              {navCollapsed ? (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[#4F9A78] opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-[#4F9A78]" />
                </span>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-slate-200">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-2 animate-ping rounded-full bg-[#4F9A78] opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-[#4F9A78]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">制单助手已就绪</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#7E8FA8]">
                    <Activity className="size-3" />
                    可以开始制单
                  </div>
                </>
              )}
            </div>
          </div>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!focus && (
          <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-border/80 bg-white/85 px-6 backdrop-blur">
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <span className="text-[#8C8F94]">报关灵</span>
              <span className="text-[#D6D2CA]">/</span>
              <span className={isTasks ? "font-medium text-foreground" : ""}>{isTasks ? "任务中心" : "制单工作台"}</span>
              {detail && (
                <>
                  <span className="text-[#D6D2CA]">/</span>
                  <strong className="font-medium text-foreground">{detail}</strong>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleFocus}
                    className="grid size-8 place-items-center rounded-lg border border-border bg-white text-[#4A4F57] transition-colors hover:border-[#C8A45C]/60 hover:text-[#1A1D21]"
                    aria-label="全屏"
                    title="全屏（隐藏左侧菜单与顶栏）"
                  >
                    <Maximize2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>全屏</TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-2 rounded-full border border-border bg-white py-1 pl-1 pr-1.5">
                <span className="grid size-6 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
                  {role.slice(0, 1)}
                </span>
                <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                  <SelectTrigger className="h-7 border-0 bg-transparent px-0 text-[12px] text-foreground shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="林岚">林岚 · 制单</SelectItem>
                    <SelectItem value="陈宁">陈宁 · 审核</SelectItem>
                    <SelectItem value="许悦">许悦 · 只读</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </header>
        )}

        <div className="relative flex min-h-0 flex-1">
          {focus && (
            <button
              onClick={toggleFocus}
              className="fixed right-3 top-3 z-50 grid size-8 place-items-center rounded-full border border-[#3a3f47] bg-[#1A1D21]/90 text-white shadow-lg backdrop-blur transition-colors hover:bg-[#1A1D21]"
              title="退出全屏（Esc）"
              aria-label="退出全屏"
            >
              <Minimize2 className="size-4" />
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
    </ShellLayoutContext.Provider>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    待补充: "border-[#EFCDC7] bg-[#FBF0EE] text-[#9F2D24]",
    待确认: "border-[#ECD8A8] bg-[#FBF5E8] text-[#8A5A12]",
    待复核: "border-[#ECD8A8] bg-[#FBF5E8] text-[#8A5A12]",
    处理中: "border-[#CFDAE8] bg-[#EBF1F7] text-[#1E3A5F]",
    可交付: "border-[#CBE3D6] bg-[#EDF6F1] text-[#2F6B4F]",
    已交付: "border-[#CFE0EA] bg-[#EEF4F8] text-[#2B5C74]",
  };
  const dot =
    status === "待补充"
      ? "bg-[#B23A2E]"
      : status === "可交付" || status === "已交付"
        ? "bg-[#4F9A78]"
        : status === "处理中"
          ? "bg-[#1E3A5F]"
          : "bg-[#B4791F]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        map[status] ?? "border-border text-muted-foreground",
      )}
    >
      <i className={cn("size-1.5 rounded-full", dot)} />
      {status}
    </span>
  );
}
