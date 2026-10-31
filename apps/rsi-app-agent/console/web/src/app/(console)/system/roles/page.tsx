"use client";

import { useState } from "react";
import { Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Failure, Loading, PageHeader, Pill } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, useApi } from "@/lib/api";
import { hasSystem, useSession } from "@/lib/session";
import type { SystemPermission } from "@/lib/session";
import type { SystemView } from "@/lib/system";

type Draft = { id?: string; name: string; description: string; permissions: SystemPermission[] };

export default function RolesPage() {
  const { me, refresh } = useSession();
  const { data, error, setData } = useApi<SystemView>("/api/system");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasSystem(me, "system.roles")) return <Failure error={{ message: "需要“角色”系统权限。" }} />;
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;

  const label = (p: SystemPermission) => data.permissions.find((x) => x.id === p)?.label ?? p;
  const keep = (v: Omit<SystemView, "permissions">) => setData({ ...v, permissions: data.permissions });

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      keep(await api<SystemView>(editing.id ? `/api/system/roles/${editing.id}` : "/api/system/roles", { method: editing.id ? "PUT" : "POST", body: editing }));
      setEditing(null);
      refresh();
      toast.success("已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`删除角色「${name}」？拥有它的用户会失去这些系统权限。`)) return;
    try {
      keep(await api<SystemView>(`/api/system/roles/${id}`, { method: "DELETE" }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="角色"
        description="角色是一组系统权限，分配给用户后生效（在“用户”里分配）。应用内的使用、管理权限不在这里，由各应用自己授权。"
        actions={
          <Button onClick={() => setEditing({ name: "", description: "", permissions: [] })}>
            <Plus /> 新建角色
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
              <th className="w-56">角色</th>
              <th>系统权限</th>
              <th className="w-20">用户数</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.roles.map((r) => (
              <tr key={r.id} className="[&>td]:px-4 [&>td]:py-2.5">
                <td>
                  <div className="flex items-center gap-1.5 font-medium">
                    {r.name}
                    {r.builtin && (
                      <Pill className="text-muted-foreground">
                        <Lock className="size-3" /> 内置
                      </Pill>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <Pill key={p}>{label(p)}</Pill>
                    ))}
                  </div>
                </td>
                <td className="tabular-nums">{r.users}</td>
                <td className="text-right">
                  {!r.builtin && (
                    <>
                      <Button size="icon-sm" variant="ghost" title="编辑" onClick={() => setEditing({ id: r.id, name: r.name, description: r.description, permissions: r.permissions })}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" title="删除" onClick={() => remove(r.id, r.name)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 font-medium">系统权限说明</div>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          {data.permissions.map((p) => (
            <div key={p.id}>
              <dt className="font-medium">{p.label}</dt>
              <dd className="text-muted-foreground">{p.note}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? `编辑角色「${editing.name}」` : "新建角色"}</DialogTitle>
            <DialogDescription>勾选这个角色包含的系统权限。</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="例如：用户管理员" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>说明</Label>
                <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <div className="space-y-1 rounded-md border p-1">
                {data.permissions.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Checkbox
                      className="mt-0.5"
                      checked={editing.permissions.includes(p.id)}
                      onCheckedChange={(v) => setEditing({ ...editing, permissions: v ? [...editing.permissions, p.id] : editing.permissions.filter((x) => x !== p.id) })}
                    />
                    <span>
                      <span className="text-sm">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.note}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save} disabled={busy || !editing?.name.trim()}>
              {busy && <Loader2 className="animate-spin" />} 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
