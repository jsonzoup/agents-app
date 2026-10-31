"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NewTask } from "@/components/workbench/new-task";
import { PanelResizer } from "@/components/panel-resizer";
import { useShellLayout } from "@/components/app-shell";
import { RightPanel } from "@/components/copilot/panel";
import { api, type SessionItem } from "@/lib/api";
import type { DocTarget } from "@/components/docs/viewer";

export default function WorkPage() {
  const router = useRouter();
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [tab, setTab] = React.useState<"chat" | "docs" | "skill">("chat");
  const [docTarget, setDocTarget] = React.useState<DocTarget | null>(null);
  const [sourceField, setSourceField] = React.useState<string | null>(null);
  const [panelWidth, setPanelWidth] = React.useState(400);
  const { focus, navWidth } = useShellLayout();
  const extraWidth = focus ? navWidth : 0;
  const effectivePanelWidth = Math.min(980, panelWidth + extraWidth);

  React.useEffect(() => {
    const saved = Number(window.localStorage.getItem("bgl-panel-width") || 0);
    if (saved >= 320) setPanelWidth(saved);
    api.bootstrap().then((state) => setSessions(state.sessions)).catch(() => undefined);
  }, []);

  const resizePanel = React.useCallback(
    (value: number) => {
      const base = Math.max(320, Math.min(820, Math.round(value - extraWidth)));
      setPanelWidth(base);
      window.localStorage.setItem("bgl-panel-width", String(base));
    },
    [extraWidth],
  );

  return (
    <>
      <main className="scroll-thin min-w-0 flex-1 overflow-auto">
        <NewTask />
      </main>
      <PanelResizer width={effectivePanelWidth} onChange={resizePanel} onReset={() => resizePanel(400 + extraWidth)} />
      <RightPanel
        task={null}
        width={effectivePanelWidth}
        sessions={sessions}
        tab={tab}
        onTab={setTab}
        docTarget={docTarget}
        onDocTarget={setDocTarget}
        sourceField={sourceField}
        onCloseSource={() => setSourceField(null)}
        onOpenTask={(id) => router.push(`/work/${id}`)}
        onTaskUpdate={() => undefined}
      />
    </>
  );
}
