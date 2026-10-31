"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, X } from "lucide-react";
import { GenericTasks } from "@/components/generic-tasks";
import { Failure } from "@/components/shell/page";
import { VersionPicker } from "@/components/version-picker";
import { WebFrame } from "@/components/web-frame";
import { Button } from "@/components/ui/button";
import { hostApi } from "@/lib/api";
import { useApp, useSession } from "@/lib/session";

export default function UsePage() {
  const { app } = useApp();
  const { me } = useSession();
  const router = useRouter();
  const search = useSearchParams();
  const params = useParams<{ path?: string[] }>();
  const path = useMemo(() => (params.path ?? []).map(decodeURIComponent), [params.path]);
  const canTrial = app.permissions.includes("app.trial");
  const canDeploy = app.permissions.includes("release.rollback");
  const asked = search.get("version");
  const trial = canTrial && asked && asked !== app.stable ? asked : null;
  const version = trial ?? app.stable;
  const api = useMemo(() => hostApi(app.name, trial), [app.name, trial]);

  if (!app.permissions.includes("app.use")) return <Failure error={{ message: "你在这个应用里没有办理业务的权限。" }} />;
  const suffix = trial ? `?version=${encodeURIComponent(trial)}` : "";
  const generic = (
    <GenericTasks
      app={app}
      user={{ id: me.user.id, name: me.user.name, title: me.user.title }}
      path={path}
      navigate={(sub: string) => router.push(`/use/${app.name}${sub ? `/${sub.replace(/^\//, "")}` : ""}${suffix}`)}
      api={api}
    />
  );
  const switchTo = (v: string) => router.push(`/use/${app.name}${path.length ? `/${path.map(encodeURIComponent).join("/")}` : ""}${v === app.stable ? "" : `?version=${encodeURIComponent(v)}`}`);

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col">
      {canTrial && (
        <div className={trial ? "mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" : "mb-2 flex shrink-0 items-center justify-end gap-2 text-xs text-muted-foreground"}>
          {trial ? (
            <>
              <FlaskConical className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                正在试用 <b className="font-mono">{trial}</b>：web 应用和处理逻辑都是这个版本的。试用单据单独存放，只有管理者看得到，不会成为改进信号。
              </span>
              <VersionPicker app={app.name} value={version} onChange={switchTo} className="h-8 w-56 bg-background" />
              <Button size="sm" variant="ghost" onClick={() => switchTo(app.stable)}>
                <X /> 退出试用
              </Button>
            </>
          ) : (
            <>
              <span>试用其他版本</span>
              <VersionPicker app={app.name} value={version} onChange={switchTo} className="h-7 w-52 text-xs" />
            </>
          )}
        </div>
      )}
      <WebFrame
        key={version}
        status={`/api/apps/${app.name}/web?version=${encodeURIComponent(version)}`}
        path={path.map(encodeURIComponent).join("/")}
        canRebuild={false}
        operator={canDeploy}
        failedHint={
          canDeploy ? (
            <Link href={`/manage/${app.name}/releases`} className="text-sm underline">
              到“版本与发布”查看原因并重新部署
            </Link>
          ) : (
            <span className="text-muted-foreground">请联系这个应用的管理者处理。</span>
          )
        }
        fallback={<div className="min-h-0 flex-1 overflow-y-auto">{generic}</div>}
      />
    </div>
  );
}
