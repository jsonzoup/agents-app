"use client";

import { useState } from "react";
import { KeyRound, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Failure, Loading, PageHeader, Pill } from "@/components/shell/page";
import { MIN_PASSWORD, PasswordDialog } from "@/components/shell/password-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, useApi } from "@/lib/api";
import { hasSystem, useSession } from "@/lib/session";
import { LEVEL_TEXT } from "@/lib/system";
import type { SystemUser, SystemView } from "@/lib/system";

type Draft = { id: string; name: string; title: string; roles: string[]; disabled: boolean; password: string };

export default function UsersPage() {
  const { me, refresh } = useSession();
  const { data, error, setData } = useApi<SystemView>("/api/system");
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [resetting, setResetting] = useState<SystemUser | null>(null);

  if (!hasSystem(me, "system.users")) return <Failure error={{ message: "需要“用户与用户组”系统权限。" }} />;
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;

  const groupName = (id: string) => data.groups.find((g) => g.id === id)?.name ?? id;
  const roleName = (id: string) => data.roles.find((r) => r.id === id)?.name ?? id;
  const shown = data.users.filter((u) => !filter || [u.id, u.name, u.title].some((x) => x.includes(filter)));

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { draft, isNew } = editing;
      const body = { name: draft.name, title: draft.title, roles: draft.roles, disabled: draft.disabled, ...(isNew ? { id: draft.id, password: draft.password } : {}) };
      setData({ ...(await api<SystemView>(isNew ? "/api/system/users" : `/api/system/users/${draft.id}`, { method: isNew ? "POST" : "PUT", body })), permissions: data!.permissions });
      setEditing(null);
      refresh();
      toast.success("已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const open = (u?: SystemUser) =>
    setEditing(
      u
        ? { draft: { id: u.id, name: u.name, title: u.title, roles: u.roles, disabled: Boolean(u.disabled), password: "" }, isNew: false }
        : { draft: { id: "", name: "", title: "", roles: [], disabled: false, password: "" }, isNew: true },
    );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="用户"
        description="系统角色决定一个人在平台上能做什么（管理用户、创建应用等）；能用、能管哪些应用，由各应用的管理者在应用的“权限”里授权。"
        actions={
          <>
            <Input className="h-8 w-48" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索姓名、账号、职务" />
            <Button onClick={() => open()}>
              <Plus /> 新增用户
            </Button>
          </>
        }
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
              <th className="w-[22%]">姓名</th>
              <th className="w-[16%]">系统角色</th>
              <th className="w-[16%]">用户组</th>
              <th>应用权限</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((u) => (
              <tr key={u.id} className={u.disabled ? "text-muted-foreground [&>td]:px-4 [&>td]:py-2.5" : "[&>td]:px-4 [&>td]:py-2.5"}>
                <td>
                  <div className="font-medium">
                    {u.name}
                    {u.disabled && <Pill className="ml-1.5 text-muted-foreground">已停用</Pill>}
                    {!u.passwordSet && <Pill className="ml-1.5 border-amber-200 bg-amber-50 font-normal text-amber-700">未设密码</Pill>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {u.id} · {u.title}
                  </div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length ? u.roles.map((r) => <Pill key={r}>{roleName(r)}</Pill>) : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="text-xs">{u.groups.map(groupName).join("、") || <span className="text-muted-foreground">—</span>}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.apps.length ? (
                      u.apps.map((a) => (
                        <Pill key={a.app} className={a.level === "manage" ? "border-violet-200 bg-violet-50 font-normal text-violet-700" : "border-sky-200 bg-sky-50 font-normal text-sky-700"}>
                          {a.title} · {LEVEL_TEXT[a.level]}
                        </Pill>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap text-right">
                  <Button size="icon-xs" variant="ghost" onClick={() => setResetting(u)} title={u.passwordSet ? "重置密码" : "设置密码"} aria-label={u.passwordSet ? "重置密码" : "设置密码"}>
                    <KeyRound />
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => open(u)}>
                    <Pencil /> 编辑
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.isNew ? "新增用户" : `编辑「${editing?.draft.name}」`}</DialogTitle>
            <DialogDescription>{editing?.isNew ? "账号用于登录，创建后不能改。" : "停用后这个人不能登录，所有授权暂时失效。"}</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>姓名</Label>
                  <Input value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label>账号</Label>
                  <Input
                    className="font-mono"
                    value={editing.draft.id}
                    disabled={!editing.isNew}
                    placeholder="zhangsan"
                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, id: e.target.value.toLowerCase() } })}
                  />
                </div>
              </div>
              {editing.isNew && (
                <div className="space-y-1.5">
                  <Label>初始密码</Label>
                  <Input type="password" autoComplete="new-password" value={editing.draft.password} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, password: e.target.value } })} />
                  <p className="text-xs text-muted-foreground">至少 {MIN_PASSWORD} 位，请线下告知本人，登录后可在左下角菜单修改。</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>职务</Label>
                <Input value={editing.draft.title} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })} />
              </div>
              <div className="space-y-1.5">
                <Label>系统角色</Label>
                <div className="space-y-1 rounded-md border p-1">
                  {data.roles.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted">
                      <Checkbox
                        className="mt-0.5"
                        checked={editing.draft.roles.includes(r.id)}
                        onCheckedChange={(v) =>
                          setEditing({ ...editing, draft: { ...editing.draft, roles: v ? [...editing.draft.roles, r.id] : editing.draft.roles.filter((x) => x !== r.id) } })
                        }
                      />
                      <span>
                        <span className="text-sm">{r.name}</span>
                        <span className="block text-xs text-muted-foreground">{r.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">不选也可以：普通用户只能用被授权的应用。</p>
              </div>
              {!editing.isNew && (
                <label className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">停用</span>
                  <Switch checked={editing.draft.disabled} onCheckedChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, disabled: v } })} />
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={busy || !editing?.draft.name.trim() || !editing?.draft.id || (editing.isNew && editing.draft.password.length < MIN_PASSWORD)}>
              {busy && <Loader2 className="animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PasswordDialog
        open={resetting !== null}
        onOpenChange={(o) => !o && setResetting(null)}
        target={resetting ?? undefined}
        onSaved={() => setData({ ...data, users: data.users.map((u) => (u.id === resetting?.id ? { ...u, passwordSet: true } : u)) })}
      />
    </div>
  );
}
