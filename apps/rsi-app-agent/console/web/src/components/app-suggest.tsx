"use client";

import { useMemo } from "react";
import { SuggestButton, appPageOf } from "@/components/kit";
import { hostApi } from "@/lib/api";
import type { AppSummary } from "@/lib/session";
import type { HostApi } from "@/sdk";

/** Where the person is in an app: the page in its frame (or the platform's own task view) and the task on it. */
function locate(): { page: string; task?: string } {
  let pathname = window.location.pathname;
  const frame = document.querySelector<HTMLIFrameElement>("iframe[data-app-frame]");
  try {
    if (frame?.contentWindow) pathname = frame.contentWindow.location.pathname;
  } catch {
    // a frame from another origin keeps its page to itself
  }
  const page = appPageOf(pathname);
  return { page, task: /\bT-\d{4,}\b/.exec(page)?.[0] };
}

/**
 * Suggestions about an app's interface and abilities, from the platform's bar above every app:
 * it works for apps whatever their own pages offer. Suggestions about a task's result are made
 * in the task, where the app knows which part is meant.
 */
export function AppSuggest({ app }: { app: AppSummary }) {
  const api = useMemo<HostApi>(() => {
    const base = hostApi(app.name);
    const trial = () => {
      const v = new URLSearchParams(window.location.search).get("version");
      return v && v !== app.stable ? v : null;
    };
    return { ...base, suggestApp: (body) => hostApi(app.name, trial()).suggestApp(body) };
  }, [app.name, app.stable]);
  if (!app.permissions.includes("signal.record")) return null;
  return <SuggestButton api={api} about="ui" locate={locate} label="提建议" className="h-8 border-dashed text-muted-foreground" />;
}
