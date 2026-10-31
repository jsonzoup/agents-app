"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Hammer, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Failure } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface WebStatus {
  /** Where the application is mounted, e.g. `/apps/notes/v/r4`; null when there is none. */
  base: string | null;
  state: "none" | "off" | "idle" | "building" | "ready" | "failed";
  step?: string;
  error?: string;
  log: string[];
}

/**
 * An app's own web application, run by the platform and shown in a frame. Asking for its
 * status starts the build; while it builds, the steps and log show here.
 * @param status - URL of the status endpoint (`…/web`); `${status}/rebuild` rebuilds.
 * @param path - path inside the application to open.
 * @param fallback - shown when the version has no web application.
 * @param operator - show build steps and logs; people doing business see a plain message instead.
 * @param failedHint - what to do when the application fails to start and there is no rebuild button.
 */
export function WebFrame({
  status,
  path = "",
  reload = 0,
  canRebuild,
  operator = canRebuild,
  failedHint,
  fallback,
  className,
}: {
  status: string;
  path?: string;
  reload?: number;
  canRebuild: boolean;
  operator?: boolean;
  failedHint?: React.ReactNode;
  fallback: React.ReactNode;
  className?: string;
}) {
  const [web, setWeb] = useState<WebStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setWeb(null);
    setError(null);
    setUseFallback(false);
    const poll = () =>
      api<WebStatus>(status).then(
        (s) => {
          if (!live) return;
          setWeb(s);
          if (s.state === "building" || s.state === "idle") timer = setTimeout(poll, 1500);
        },
        (e: Error) => live && setError(e.message),
      );
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [status, reload]);

  useEffect(() => setFrameKey((k) => k + 1), [reload]);

  async function rebuild() {
    try {
      const [path, query = ""] = status.split("?");
      setWeb(await api<WebStatus>(`${path}/rebuild${query ? `?${query}` : ""}`, { body: {} }));
      const poll = async (): Promise<void> => {
        const s = await api<WebStatus>(status);
        setWeb(s);
        if (s.state === "building" || s.state === "idle") return new Promise((r) => setTimeout(() => r(poll()), 1500));
        if (s.state === "ready") setFrameKey((k) => k + 1);
      };
      await poll();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (error) return <Failure error={{ message: `应用的 web 状态读不到：${error}` }} />;
  if (!web) return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载中…</div>;
  if (web.state === "none" || useFallback) return <>{fallback}</>;
  if (web.state === "off") return <Failure error={{ message: web.error ?? "这个部署没有开启应用的 web 运行" }} />;

  if (web.state !== "ready") {
    const failed = web.state === "failed";
    if (!operator)
      return (
        <div className={cn("mx-auto max-w-xl space-y-3 p-10 text-center", className)}>
          <div className={cn("flex items-center justify-center gap-2 text-sm font-medium", failed ? "text-red-700" : "text-foreground")}>
            {!failed && <Loader2 className="size-4 animate-spin" />}
            {failed ? "应用暂时打不开" : "应用正在启动，请稍候…"}
          </div>
          <p className="text-xs text-muted-foreground">{failed ? "这个版本的应用没能启动。" : "版本更新后第一次打开需要一两分钟，页面会自动进入。"}</p>
          {failed && (
            <div className="flex flex-col items-center gap-2 text-sm">
              {failedHint}
              <Button size="sm" variant="outline" onClick={() => setUseFallback(true)}>
                先用通用任务视图办理
              </Button>
            </div>
          )}
        </div>
      );
    return (
      <div className={cn("mx-auto max-w-3xl space-y-3 p-6", className)}>
        <div className={cn("flex items-center gap-2 text-sm font-medium", failed ? "text-red-700" : "text-foreground")}>
          {failed ? <Hammer className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          {failed ? `应用没能启动：${web.error}` : `应用正在准备：${web.step ?? "排队"}`}
        </div>
        {!failed && <p className="text-xs text-muted-foreground">第一次打开某个版本时，平台要安装依赖并执行 next build，通常一两分钟；之后直接打开。</p>}
        {web.log.length > 0 && <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">{web.log.join("\n")}</pre>}
        {failed && (
          <div className="flex flex-wrap items-center gap-2">
            {canRebuild ? (
              <Button size="sm" onClick={rebuild}>
                <RotateCw /> 重新构建
              </Button>
            ) : (
              failedHint
            )}
            <Button size="sm" variant="outline" onClick={() => setUseFallback(true)}>
              用通用任务视图继续
            </Button>
          </div>
        )}
      </div>
    );
  }

  const sub = path.replace(/^\/+/, "");
  const src = sub ? `${web.base}/${sub}` : web.base!;
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-40 transition-opacity hover:opacity-100">
        <Button size="icon-sm" variant="outline" className="bg-background" title="刷新应用" onClick={() => setFrameKey((k) => k + 1)}>
          <RotateCw />
        </Button>
        {canRebuild && (
          <Button size="icon-sm" variant="outline" className="bg-background" title="重新构建" onClick={rebuild}>
            <Hammer />
          </Button>
        )}
        <Button size="icon-sm" variant="outline" className="bg-background" title="在新标签页打开" asChild>
          <a href={src} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <iframe key={frameKey} src={src} title="应用" data-app-frame className="min-h-0 w-full flex-1 rounded-lg border bg-background" />
    </div>
  );
}
