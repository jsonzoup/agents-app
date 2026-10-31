"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { GroupDialog } from "@/components/group-dialog";
import type { GroupDraft } from "@/components/group-dialog";
import { Failure, Loading, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { api, useApi } from "@/lib/api";
import { hasSystem, useSession } from "@/lib/session";
import { LEVEL_TEXT } from "@/lib/system";
import type { SystemView } from "@/lib/system";

export default function GroupsPage() {
  const { me, refresh } = useSession();
  const { data, error, setData, reload } = useApi<SystemView>("/api/system");
  const [editing, setEditing] = useState<GroupDraft | null>(null);
  const [open, setOpen] = useState(false);

  if (!hasSystem(me, "system.users")) return <Failure error={{ message: "需要“用户与用户组”系统权限。" }} />;
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;

  const userName = (id: string) => data.users.find((u) => u.id === id)?.name ?? id;
  const keep = (v: Omit<SystemView, "permissions">) => setData({ ...v, permissions: data.permissions });

  async function submit(g: GroupDraft) {
    if (g.id) keep(await api<SystemView>(`/api/system/groups/${g.id}`, { method: "PUT", body: g }));
    else {
      await api("/api/groups", { body: g });
      reload();
    }
    refresh();
    toast.success("已保存");
  }

  async function remove(id: string, name: string) {
    if (!confirm(`删除用户组「${name}」？对它的应用授权也会一并取消。`)) return;
    try {
      keep(await api<SystemView>(`/api/system/groups/${id}`, { method: "DELETE" }));
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="用户组"
        description="把一起干活的人编成组，应用管理者就能一次给整组授权；成员进出时权限自动跟着变。"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> 新建用户组
          </Button>
        }
      />
      {data.groups.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>还没有用户组</EmptyTitle>
            <EmptyDescription>应用管理者在授权时也可以就地新建。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.groups.map((g) => (
            <div key={g.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <UsersRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.description || "—"}</div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title="编辑"
                  onClick={() => {
                    setEditing({ id: g.id, name: g.name, description: g.description, members: g.members });
                    setOpen(true);
                  }}
                >
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" title="删除" onClick={() => remove(g.id, g.name)}>
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-3 space-y-1.5 text-[13px]">
                <div>
                  <span className="text-muted-foreground">成员 {g.members.length} 人：</span>
                  {g.members.map(userName).join("、") || "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">应用授权：</span>
                  {g.apps.map((a) => `${a.title}（${LEVEL_TEXT[a.level]}）`).join("、") || "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <GroupDialog open={open} onOpenChange={setOpen} users={data.users.filter((u) => !u.disabled)} initial={editing ?? undefined} onSubmit={submit} />
    </div>
  );
}
