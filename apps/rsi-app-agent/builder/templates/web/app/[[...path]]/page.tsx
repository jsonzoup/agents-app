"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { connect } from "@/lib/rsi";
import type { Platform } from "@/lib/rsi";
import App from "@/views";

/** Every page of the app: the platform context (app, user, api) and the path, handed to the app's view. */
export default function Page() {
  const params = useParams<{ path?: string[] }>();
  const router = useRouter();
  const path = useMemo(() => (params.path ?? []).map(decodeURIComponent), [params.path]);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connect().then(setPlatform, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-red-600">连不上平台：{error}</p>;
  if (!platform) return <p className="text-muted-foreground">加载中…</p>;
  return <App app={platform.app} user={platform.user} api={platform.api} path={path} navigate={(sub) => router.push(`/${sub.replace(/^\/+/, "")}`)} />;
}
