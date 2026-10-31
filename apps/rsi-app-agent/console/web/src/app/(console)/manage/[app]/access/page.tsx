"use client";

import { useState } from "react";
import { Plus, Trash2, User, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { GroupDialog } from "@/components/group-dialog";
import { Failure, Loading, Pill, Section } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useApi } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { AppLevel } from "@/lib/session";
import { useApp, useSession } from "@/lib/session";

interface Grant {
  kind: "user" | "group";
  id: string;
  level: AppLevel;
}
interface Access {
  grants: (Grant & { name: string; note: string })[];
  effective: { id: string; name: string; title: string; level: AppLevel; sources: string[] }[];
  approval: { codeApprovals: 1 | 2; history: { codeApprovals: 1 | 2; by: string; at: string }[] };
}
interface Principals {
  users: { id: string; name: string; title: string }[];
  groups: { id: string; name: string; description: string; members: string[] }[];
}

const LEVELS: { id: AppLevel; label: string; note: string }[] = [
  { id: "use", label: "使用", note: "打开应用办理业务，修正结果（修正会成为改进信号）" },
  { id: "manage", label: "管理", note: "使用之外，还能改代码、处理信号与提案、评测、发布回滚、设置权限" },
];
const LEVEL_PILL: Record<AppLevel, string> = { use: "border-sky-200 bg-sky-50 text-sky-700", manage: "border-violet-200 bg-violet-50 text-violet-700" };

function LevelSelect({ value, onChange, className }: { value: AppLevel; onChange: (v: AppLevel) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AppLevel)}>
      <SelectTrigger size="sm" className={className ?? "w-24"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function AccessPage() {
  const { app, refresh: refreshApp } = useApp();
  const { me, refresh } = useSession();
  const { data, error, setData } = useApi<Access>(`/api/apps/${app.name}/access`);
  const { data: principals, reload: reloadPrincipals } = useApi<Principals>("/api/principals");
  const [pick, setPick] = useState("");
  const [level, setLevel] = useState<AppLevel>("use");
  const [creating, setCreating] = useState(false);

  async function save(grants: Grant[]) {
    try {
      setData(await api<Access>(`/api/apps/${app.name}/access`, { method: "PUT", body: { grants: grants.map(({ kind, id, level }) => ({ kind, id, level })) } }));
      refreshApp();
      refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  if (error) return <Failure error={error} />;
  if (!data || !principals) return <Loading />;

  const granted = new Set(data.grants.map((g) => `${g.kind}:${g.id}`));
  const freeUsers = principals.users.filter((u) => !granted.has(`user:${u.id}`));
  const freeGroups = principals.groups.filter((g) => !granted.has(`group:${g.id}`));

  const managers = data.effective.filter((u) => u.level === "manage").length;
  const lastChange = data.approval.history.at(-1);

  async function setCodeApprovals(codeApprovals: 1 | 2) {
    try {
      setData(await api<Access>(`/api/apps/${app.name}/approval`, { method: "PUT", body: { codeApprovals } }));
      toast.success(codeApprovals === 1 ? "代码级改动改为一位管理者批准即发布" : "代码级改动改为两位不同的管理者批准");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function add() {
    const [kind, id] = pick.split(":") as ["user" | "group", string];
    if (await save([...data!.grants, { kind, id, level }])) {
      setPick("");
      toast.success("已授权");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {LEVELS.map((l) => (
          <div key={l.id} className="rounded-xl border bg-card px-4 py-3">
            <Pill className={LEVEL_PILL[l.id]}>{l.label}</Pill>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{l.note}</p>
          </div>
        ))}
      </div>

      <Section title="发布批准">
        <div className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span>代码层级的改动（脚本、服务、界面）需要</span>
            <Select value={String(data.approval.codeApprovals)} onValueChange={(v) => setCodeApprovals(Number(v) as 1 | 2)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">两位不同的管理者</SelectItem>
                <SelectItem value="1">一位管理者</SelectItem>
              </SelectContent>
            </Select>
            <span>批准后发布</span>
          </div>
          <p className="text-xs text-muted-foreground">
            知识层级的改动始终由一位管理者批准；契约层级不经提案发布。默认两位：代码会被执行，多一个人把关。改为一位后，已经有一位批准、还没发布的提案需要再点一次“确认发布”。
            {data.approval.codeApprovals === 2 && managers < 2 && <span className="text-amber-700"> 这个应用现在只有 {managers} 位管理者，代码级提案没法凑齐两位：可以再授权一位管理者，或改为一位。</span>}
          </p>
          {lastChange && (
            <p className="text-xs text-muted-foreground">
              {data.approval.history
                .slice(-3)
                .reverse()
                .map((h) => `${h.by} 于 ${fmtTime(h.at)} 改为${h.codeApprovals === 1 ? "一位" : "两位"}`)
                .join("；")}
            </p>
          )}
        </div>
      </Section>

      <Section title="授权" actions={<span className="text-xs text-muted-foreground">授权给用户组时，组里的每个人都获得权限；一个人有多条授权时取最高的</span>}>
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger size="sm" className="w-72">
              <SelectValue placeholder="选择用户或用户组" />
            </SelectTrigger>
            <SelectContent>
              {freeGroups.length > 0 && (
                <SelectGroup>
                  <SelectLabel>用户组</SelectLabel>
                  {freeGroups.map((g) => (
                    <SelectItem key={g.id} value={`group:${g.id}`}>
                      <UsersRound className="size-3.5" /> {g.name} <span className="text-muted-foreground">· {g.members.length} 人</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {freeUsers.length > 0 && (
                <SelectGroup>
                  <SelectLabel>用户</SelectLabel>
                  {freeUsers.map((u) => (
                    <SelectItem key={u.id} value={`user:${u.id}`}>
                      <User className="size-3.5" /> {u.name} <span className="text-muted-foreground">· {u.title}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {freeGroups.length + freeUsers.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">所有用户和用户组都已授权</div>}
            </SelectContent>
          </Select>
          <LevelSelect value={level} onChange={setLevel} />
          <Button size="sm" onClick={add} disabled={!pick}>
            <Plus /> 授权
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCreating(true)}>
            <UsersRound /> 新建用户组
          </Button>
        </div>
        {data.grants.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">还没有授权</p>
        ) : (
          <ul className="divide-y">
            {data.grants.map((g, i) => (
              <li key={`${g.kind}:${g.id}`} className="flex items-center gap-3 px-4 py-2">
                <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">{g.kind === "group" ? <UsersRound className="size-4" /> : <User className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {g.name}
                    {g.kind === "user" && g.id === me.user.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">（你）</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {g.kind === "group" ? "用户组" : "用户"} · {g.note}
                  </div>
                </div>
                <LevelSelect value={g.level} onChange={(v) => save(data.grants.map((x, j) => (j === i ? { ...x, level: v } : x)))} />
                <Button size="icon-sm" variant="ghost" title="取消授权" onClick={() => save(data.grants.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`实际有权限的人（${data.effective.length}）`}>
        <table className="w-full text-[13px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal">
              <th className="w-40">姓名</th>
              <th className="w-24">权限</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody className="divide-y border-t">
            {data.effective.map((u) => (
              <tr key={u.id} className="[&>td]:px-4 [&>td]:py-2">
                <td>
                  {u.name} <span className="text-xs text-muted-foreground">{u.title}</span>
                </td>
                <td>
                  <Pill className={LEVEL_PILL[u.level]}>{LEVELS.find((l) => l.id === u.level)?.label}</Pill>
                </td>
                <td className="text-xs text-muted-foreground">{u.sources.join("；")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <GroupDialog
        open={creating}
        onOpenChange={setCreating}
        users={principals.users}
        onSubmit={async (g) => {
          const created = await api<{ id: string; name: string }>("/api/groups", { body: g });
          reloadPrincipals();
          setPick(`group:${created.id}`);
          toast.success(`已创建用户组「${created.name}」，选好权限后点“授权”`);
        }}
      />
    </div>
  );
}
