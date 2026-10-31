"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ClipboardList, Inbox, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Bootstrap } from "@/lib/api";
import { useRole } from "@/components/providers";
import { formatTime } from "@/lib/utils";

export default function TasksPage() {
  const router = useRouter();
  const { role } = useRole();
  const [state, setState] = React.useState<Bootstrap | null>(null);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("全部状态");
  const [owner, setOwner] = React.useState("全部负责人");

  const load = React.useCallback(async () => {
    try {
      setState(await api.bootstrap());
    } catch (error) {
      toast.error((error as Error).message);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const tasks = state?.tasks ?? [];
  const owners = Array.from(new Set(tasks.map((task) => task.owner)));
  const filtered = tasks.filter((task) => {
    const keyword = query.trim().toLowerCase();
    const matchKeyword =
      !keyword ||
      task.customer.toLowerCase().includes(keyword) ||
      task.id.toLowerCase().includes(keyword) ||
      task.name.toLowerCase().includes(keyword);
    const matchStatus = status === "全部状态" || task.status === status;
    const matchOwner = owner === "全部负责人" || task.owner === owner;
    return matchKeyword && matchStatus && matchOwner;
  });

  const metrics = state?.metrics ?? { all: 0, todo: 0, deliverable: 0, delivered: 0 };

  const review = async (id: string, action: "pass" | "return") => {
    try {
      await api.review(id, action);
      toast.success(action === "pass" ? "已模拟复核通过" : "已退回处理");
      load();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const clear = () => {
    setQuery("");
    setStatus("全部状态");
    setOwner("全部负责人");
  };

  return (
    <main className="scroll-thin min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-[1320px] px-6 pb-16 pt-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">任务中心</h1>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">授权客户范围内的全部制单任务，按最近活动倒序。</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => router.push("/work")}>新建制单</Button>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
          {[
            { key: "all", label: "全部任务", foot: "授权客户范围内", icon: ClipboardList, tone: "" },
            { key: "todo", label: "需要处理", foot: "补充、确认或复核", icon: Inbox, tone: "text-[#B45309]" },
            { key: "deliverable", label: "可交付", foot: "当前版本已审核", icon: ShieldCheck, tone: "text-primary" },
            { key: "delivered", label: "已交付", foot: "保留交付快照", icon: CheckCircle2, tone: "text-primary" },
          ].map((item) => (
            <div key={item.key} className="rounded-xl border bg-white px-4 py-3">
              <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                {item.label}
                <item.icon className={`size-3.5 ${item.tone || "text-[#8C8F94]"}`} />
              </div>
              <div className={`mt-1 text-[24px] font-bold tabular-nums tracking-tight ${item.tone}`}>{metrics[item.key as keyof typeof metrics]}</div>
              <div className="text-[10.5px] text-muted-foreground">{item.foot}</div>
            </div>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] max-w-[360px] flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8C8F94]" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户、任务编号、单据名称" className="pl-8" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="全部状态">全部状态</SelectItem>
              {["待补充", "待确认", "待复核", "处理中", "可交付", "已交付"].map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="全部负责人">全部负责人</SelectItem>
              {owners.map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[11px] text-muted-foreground">按最近活动排序</span>
        </div>

        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[1120px] text-[12.5px]">
            <thead>
              <tr className="bg-[#FAFBFE] text-[11px] text-muted-foreground">
                {["任务 / 客户", "状态", "制单进度", "商品 / 资料", "编码字典", "负责人", "最近活动", "操作"].map((label) => (
                  <th key={label} className="border-b px-4 py-2.5 text-left font-semibold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => {
                const percent = task.total ? Math.round((task.filled / task.total) * 100) : 0;
                return (
                  <tr key={task.id} className="cursor-pointer border-b last:border-b-0 hover:bg-[#FBFAF7]" onClick={() => router.push(`/work/${task.id}`)}>
                    <td className="px-4 py-3">
                      <strong className="block text-[13px] font-semibold">{task.customer}</strong>
                      <small className="mt-0.5 block text-[11px] text-muted-foreground">{task.id} · {task.name}</small>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={task.status} />
                      <small className="mt-1 block text-[10.5px] text-muted-foreground">{task.step} · v{task.version}</small>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium tabular-nums">{task.filled}/{task.total}</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[#EFEBE3]">
                          <span
                            className={`block h-full rounded-full ${percent >= 95 ? "bg-[#4F9A78]" : percent >= 70 ? "bg-[#C8A45C]" : "bg-[#B23A2E]"}`}
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                        <span className="text-[10.5px] text-muted-foreground tabular-nums">{percent}%</span>
                      </div>
                      <small className="mt-1 block text-[10.5px] text-muted-foreground">
                        待补充 {task.missing} · 待确认 {task.low}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-[12px] font-medium">{task.itemCount} 项商品 · {task.materialCount} 份资料</span>
                      <small className={`mt-1 block text-[10.5px] ${task.missingDocs.length ? "text-[#8A5A12]" : "text-[#2F6B4F]"}`}>
                        {task.missingDocs.length ? `缺少 ${task.missingDocs.join("、")}` : "资料齐全"}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-[12px] font-medium tabular-nums">{task.codeTotal ? `${task.codeTotal} 条` : "—"}</span>
                      <small className="mt-1 block text-[10.5px] text-muted-foreground">
                        {task.codeTotal
                          ? `字典命中 ${task.codeTotal - task.codeUnmatched}${task.codeUnmatched ? ` · 未命中 ${task.codeUnmatched}` : ""}`
                          : "待生成"}
                      </small>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full bg-secondary text-[10.5px] font-semibold text-secondary-foreground">{task.owner.slice(0, 1)}</span>
                        {task.owner}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <strong className="block text-[12px] font-medium">{formatTime(task.updatedAt)}</strong>
                      <small className="mt-0.5 block text-[10.5px] text-muted-foreground">{task.missing > 0 ? "等待补充字段" : task.low > 0 ? "等待确认字段" : "字段已完整"}</small>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {role === "陈宁" && task.status === "待复核" && (
                          <>
                            <Button size="sm" variant="primary" onClick={(event) => { event.stopPropagation(); review(task.id, "pass"); }}>
                              复核通过
                            </Button>
                            <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); review(task.id, "return"); }}>
                              退回
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); router.push(`/work/${task.id}`); }}>
                          进入 <ArrowRight className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-5 py-14 text-center text-[12.5px] text-muted-foreground">
              <Inbox className="size-7 opacity-50" />
              没有符合条件的任务
              <Button variant="outline" size="sm" onClick={clear}>
                <X className="size-3.5" /> 清空筛选
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
