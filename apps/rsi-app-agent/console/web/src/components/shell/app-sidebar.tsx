"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  ChevronsUpDown,
  FlaskConical,
  FolderTree,
  GitPullRequestArrow,
  History,
  KeyRound,
  LockKeyhole,
  LogOut,
  MessageSquareWarning,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { hasSystem, manages, useSession } from "@/lib/session";
import { PasswordDialog } from "./password-dialog";

/** Tabs inside one managed app. */
export const MANAGE_TABS = [
  { key: "code", label: "应用包与代码", icon: FolderTree },
  { key: "signals", label: "改进信号", icon: MessageSquareWarning },
  { key: "proposals", label: "提案", icon: GitPullRequestArrow },
  { key: "evals", label: "评测", icon: FlaskConical },
  { key: "releases", label: "版本与发布", icon: History },
  { key: "access", label: "权限", icon: KeyRound },
] as const;

export const SYSTEM_TABS = [
  { key: "users", label: "用户", icon: Users, permission: "system.users" },
  { key: "groups", label: "用户组", icon: UsersRound, permission: "system.users" },
  { key: "roles", label: "角色", icon: ShieldCheck, permission: "system.roles" },
] as const;

function AppMark({ title }: { title: string }) {
  return <span className="grid size-5 shrink-0 place-items-center rounded bg-foreground/90 text-[10px] font-semibold text-background">{title.slice(0, 1)}</span>;
}

export function AppSidebar() {
  const { me, apps } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const managed = apps.filter(manages);
  const showManage = managed.length > 0 || hasSystem(me, "app.create");
  const systemTabs = SYSTEM_TABS.filter((t) => hasSystem(me, t.permission));
  const pending = managed.reduce((n, a) => n + a.counts.openProposals + a.counts.issues, 0);
  const [changing, setChanging] = useState(false);

  async function logout() {
    await api("/api/logout", { body: {} });
    router.push("/login");
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-white">
                  <Sparkles className="size-4" />
                </div>
                <div className="grid leading-tight">
                  <span className="font-semibold">自进化应用平台</span>
                  <span className="text-xs text-muted-foreground">rsi-kernel · deepseek-harness</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>使用</SidebarGroupLabel>
          <SidebarMenu>
            {apps.map((app) => {
              const href = `/use/${app.name}`;
              return (
                <SidebarMenuItem key={app.name}>
                  <SidebarMenuButton asChild tooltip={app.title} isActive={pathname === href || pathname.startsWith(`${href}/`)}>
                    <Link href={href}>
                      <AppMark title={app.title} />
                      <span className="truncate">{app.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            {apps.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">还没有可以使用的应用，请联系应用的管理者授权。</p>}
          </SidebarMenu>
        </SidebarGroup>

        {showManage && (
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="应用管理" isActive={pathname === "/manage" || pathname.startsWith("/manage/")}>
                  <Link href="/manage">
                    <Boxes />
                    <span>应用管理</span>
                  </Link>
                </SidebarMenuButton>
                {pending > 0 && <SidebarMenuBadge>{pending}</SidebarMenuBadge>}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}

        {systemTabs.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>系统管理</SidebarGroupLabel>
            <SidebarMenu>
              {systemTabs.map((t) => {
                const href = `/system/${t.key}`;
                return (
                  <SidebarMenuItem key={t.key}>
                    <SidebarMenuButton asChild tooltip={t.label} isActive={pathname === href}>
                      <Link href={href}>
                        <t.icon />
                        <span>{t.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <div className="grid gap-1 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2" title={me.platform.harness.note}>
            <span className={`size-1.5 rounded-full ${me.platform.harness.available ? "bg-emerald-500" : "bg-red-400"}`} />
            AI 编码：{me.platform.harness.available ? "harness 可用" : "harness 未接入"}
          </div>
          <div className="flex items-center gap-2" title={me.platform.executor.note}>
            <span className={`size-1.5 rounded-full ${me.platform.executor.available ? "bg-emerald-500" : "bg-red-400"}`} />
            单据执行：{me.platform.executor.available ? "harness 可用" : "harness 未接入"}
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">{me.user.name.slice(-1)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{me.user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{me.user.title}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-medium">{me.user.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {me.roles.length > 0 && <div>角色：{me.roles.join("、")}</div>}
                    <div>{me.apps.map((a) => `${apps.find((x) => x.name === a.name)?.title ?? a.name}（${a.label}）`).join("、") || "没有应用权限"}</div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setChanging(true)}>
                  <LockKeyhole /> 修改密码
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  <LogOut /> 退出
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      <PasswordDialog open={changing} onOpenChange={setChanging} />
    </Sidebar>
  );
}
