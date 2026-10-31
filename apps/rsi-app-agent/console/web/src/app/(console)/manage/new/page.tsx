"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ImportButton } from "@/components/app-archive";
import { Failure, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { hasSystem, useSession } from "@/lib/session";

const NAME = /^[a-z][a-z0-9-]{1,48}$/;

const EXAMPLE = `例：把会议纪要整理成一份摘要。
- 输入：会议纪要原文（可以上传文本文件）
- 输出：一段 100 字以内的摘要、待办事项列表（每条有负责人和截止日期）
- 负责人写纪要里出现的完整姓名，没写截止日期的留空
- 界面上能逐条修改待办事项`;

export default function NewAppPage() {
  const { me, apps } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  if (!hasSystem(me, "app.create")) return <Failure error={{ message: "你没有“创建应用”的系统权限，请联系系统管理员。" }} />;

  const nameProblem = name && !NAME.test(name) ? "只能用小写字母、数字和连字符，以字母开头" : apps.some((a) => a.name === name) || name === "new" || name === "build" ? "这个标识已被占用" : "";
  const ready = title.trim() && NAME.test(name) && !nameProblem && goal.trim();

  async function start() {
    setBusy(true);
    try {
      const s = await api<{ id: string }>("/api/builds", { body: { name, title, goal } });
      router.push(`/manage/build/${s.id}`);
    } catch (e) {
      toast.error((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="新建应用" description="起个名字、说清楚要做什么就行。AI 编码助手会边和你对话边写出应用的技能、契约、web 应用和评测，你随时能看到文件、检查、测试，满意了再发布。已有导出的压缩包，可以直接导入。" actions={<ImportButton />} />
      {!me.platform.harness.available && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {me.platform.harness.note}。可以先建好工作区，手动编辑文件；接入 harness 后再让助手继续。
        </p>
      )}
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">应用名称</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="会议纪要摘要" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">标识</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="meeting-digest" className="font-mono" />
            <p className={nameProblem ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>{nameProblem || "用在地址和目录名里，发布后不能改"}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="goal">目标与需求</Label>
          <Textarea id="goal" rows={10} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={EXAMPLE} />
          <p className="text-xs text-muted-foreground">写清输入是什么、要产出什么、有哪些口径。不用一次写全，后面可以继续在对话里补充。评测用的真实样例和期望值由你提供，助手不会编造。</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={start} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Bot />} 开始创建
          </Button>
        </div>
      </div>
    </div>
  );
}
