"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GroupDraft {
  id?: string;
  name: string;
  description: string;
  members: string[];
}

/** Create or edit a user group: a name, a short note and its members. */
export function GroupDialog({
  open,
  onOpenChange,
  users,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: { id: string; name: string; title: string }[];
  initial?: GroupDraft;
  onSubmit: (g: GroupDraft) => Promise<void>;
}) {
  const [g, setG] = useState<GroupDraft>({ name: "", description: "", members: [] });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (open) {
      setG(initial ?? { name: "", description: "", members: [] });
      setFilter("");
    }
  }, [open, initial]);

  async function submit() {
    setBusy(true);
    try {
      await onSubmit(g);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setG({ ...g, members: g.members.includes(id) ? g.members.filter((m) => m !== id) : [...g.members, id] });
  const shown = users.filter((u) => !filter || u.name.includes(filter) || u.id.includes(filter) || u.title.includes(filter));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? `编辑用户组「${initial.name}」` : "新建用户组"}</DialogTitle>
          <DialogDescription>给用户组授权后，组里每个人都获得相应权限；成员变化时权限自动跟着变。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>名称</Label>
            <Input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="例如：一线录入组" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>说明</Label>
            <Input value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} placeholder="可不填" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>成员（已选 {g.members.length} 人）</Label>
              <Input className="h-7 w-36 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜索" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border p-1">
              {shown.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={g.members.includes(u.id)} onCheckedChange={() => toggle(u.id)} />
                  {u.name}
                  <span className="text-xs text-muted-foreground">{u.title}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={busy || !g.name.trim()}>
            {busy && <Loader2 className="animate-spin" />} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
