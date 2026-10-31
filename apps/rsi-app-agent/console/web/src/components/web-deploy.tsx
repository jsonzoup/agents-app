"use client";

import { useEffect, useState } from "react";
import { Hammer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WebStatus } from "./web-frame";

const STATE: Record<WebStatus["state"], { label: string; className: string }> = {
  none: { label: "没有 web 应用", className: "text-muted-foreground" },
  off: { label: "未开启 web 运行", className: "text-muted-foreground" },
  idle: { label: "排队中", className: "text-amber-700" },
  building: { label: "构建中", className: "text-amber-700" },
  ready: { label: "运行中", className: "text-emerald-700" },
  failed: { label: "启动失败", className: "text-red-700" },
};

const statusUrl = (app: string, version: string) => `/api/apps/${app}/web?version=${encodeURIComponent(version)}`;

async function follow(app: string, version: string, on: (s: WebStatus) => void): Promise<WebStatus> {
  for (;;) {
    const s = await api<WebStatus>(statusUrl(app, version));
    on(s);
    if (s.state !== "building" && s.state !== "idle") return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Rebuild and restart one version's web application; reports the outcome as a toast. */
export async function redeploy(app: string, version: string, on: (s: WebStatus) => void = () => {}): Promise<WebStatus> {
  on(await api<WebStatus>(`/api/apps/${app}/web/rebuild?version=${encodeURIComponent(version)}`, { body: {} }));
  const s = await follow(app, version, on);
  if (s.state === "ready") toast.success(`${version} 已重新部署`);
  else if (s.state === "failed") toast.error(`${version} 部署失败：${s.error ?? "见构建日志"}`);
  return s;
}

/** Deployment of the stable version's web application: state, build log and a redeploy button. */
export function WebDeploy({ app, version, canDeploy }: { app: string; version: string; canDeploy: boolean }) {
  const [web, setWeb] = useState<WebStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setWeb(null);
    follow(app, version, (s) => live && setWeb(s)).catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [app, version]);

  async function run() {
    setBusy(true);
    try {
      await redeploy(app, version, setWeb);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="p-4 text-[13px] text-red-700">读不到部署状态：{error}</p>;
  if (!web)
    return (
      <p className="flex items-center gap-1.5 p-4 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> 读取中…
      </p>
    );
  const s = STATE[web.state];
  const building = web.state === "building" || web.state === "idle";
  return (
    <div className="space-y-2 p-4 text-[13px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">版本</dt>
        <dd className="font-mono">{version}</dd>
        <dt className="text-muted-foreground">状态</dt>
        <dd className={cn("flex items-center gap-1", s.className)}>
          {building && <Loader2 className="size-3 animate-spin" />}
          {s.label}
          {building && web.step ? `：${web.step}` : ""}
        </dd>
        {web.state === "failed" && web.error && (
          <>
            <dt className="text-muted-foreground">原因</dt>
            <dd className="text-red-700">{web.error}</dd>
          </>
        )}
      </dl>
      {web.log.length > 0 && (web.state === "failed" || building) && (
        <pre className="max-h-56 overflow-auto rounded-md bg-slate-950 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-200">{web.log.join("\n")}</pre>
      )}
      <p className="text-xs text-muted-foreground">重新部署会重新安装依赖、构建并重启这个版本的应用；期间正在办理业务的人会看到“应用正在启动”，通常一两分钟。</p>
      {canDeploy && web.state !== "none" && web.state !== "off" && (
        <Button size="sm" variant="outline" disabled={busy || building} onClick={run}>
          {busy || building ? <Loader2 className="animate-spin" /> : <Hammer />} 重新部署
        </Button>
      )}
    </div>
  );
}
