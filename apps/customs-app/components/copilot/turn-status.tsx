"use client";

import * as React from "react";
import { TextShimmer } from "../../../../deepseek-harness/packages/client/ui-primitives/src/TextShimmer.tsx";
import { IconCheckOutlineRegular, IconCopyOutlineRegular } from "../../../../deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx";
import { writeClipboard } from "../../../../deepseek-harness/packages/client/ui-primitives/src/clipboard.ts";
import type { Message } from "@/lib/types";

function formatDuration(ms: number, live: boolean): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, "0")}分${live ? seconds : String(seconds).padStart(2, "0")}秒`;
  if (minutes > 0) return `${minutes}分${live ? seconds : String(seconds).padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

export function turnClosings(messages: Message[], live: boolean): Map<string, { start: number; end: number; text: string }> {
  const closings = new Map<string, { start: number; end: number; text: string }>();
  let start = -1;
  const close = (end: number) => {
    if (start < 0 || end < start) return;
    const slice = messages.slice(start, end + 1);
    const text = [...slice].reverse().find((message) => message.role === "agent" && message.kind === "text" && message.text.trim())?.text.trim() ?? "";
    if (!text) return;
    const started = Date.parse(messages[start].at);
    const ended = Date.parse(messages[end].at);
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return;
    closings.set(messages[end].id, { start: started, end: Math.max(ended, started), text });
  };
  messages.forEach((message, index) => {
    if (message.role !== "user" || message.kind !== "text") return;
    if (start >= 0) close(index - 1);
    start = index;
  });
  if (start >= 0 && !live) close(messages.length - 1);
  return closings;
}

export function liveTurnStart(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.kind === "text") {
      const time = Date.parse(message.at);
      if (Number.isFinite(time)) return time;
    }
  }
  return Date.now();
}

const SHIMMER = `
.dsh-live-status [data-text-shimmer] {
  background-image: linear-gradient(90deg, currentColor calc(50% - var(--dsh-text-shimmer-spread, 48px)), color-mix(in oklab, currentColor 50%, transparent), currentColor calc(50% + var(--dsh-text-shimmer-spread, 48px)));
  background-position: 100% center;
  background-repeat: no-repeat;
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: dsh-text-shimmer 1.5s cubic-bezier(0.33, 0, 0.67, 1) infinite;
}
@keyframes dsh-text-shimmer {
  66.6667%, 100% { background-position: 0% center; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-live-status [data-text-shimmer] {
    background-image: none;
    -webkit-text-fill-color: currentColor;
    animation: none;
  }
}
`;

export function TurnLive({ startedAt }: { startedAt: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const duration = formatDuration(Math.max(1000, now - startedAt), true);
  return (
    <div className="dsh-live-status" role="status" style={{ padding: "4px 0 8px", color: "#8C8F94", fontSize: 13, lineHeight: "24px" }}>
      <style>{SHIMMER}</style>
      <TextShimmer active>{`深度求索中，用时${duration}`}</TextShimmer>
    </div>
  );
}

export function TurnActions({ text, start, end }: { text: string; start: number; end: number }) {
  const [copied, setCopied] = React.useState(false);
  const duration = formatDuration(Math.max(1000, end - start), false);
  return (
    <div className="dsh-turn-actions" style={{ display: "flex", alignItems: "center", gap: 8, height: 28, marginTop: 2, color: "#8C8F94", fontSize: 12, lineHeight: "24px" }}>
      <button
        type="button"
        aria-label={copied ? "已复制" : "复制"}
        title={copied ? "已复制" : "复制"}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: 0, borderRadius: 28, background: "transparent", color: "inherit", cursor: "pointer" }}
        onMouseEnter={(event) => { event.currentTarget.style.background = "#F4F2ED"; event.currentTarget.style.color = "#4A4F57"; }}
        onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; event.currentTarget.style.color = "inherit"; }}
        onClick={() => {
          void writeClipboard(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1000);
          });
        }}
      >
        {copied ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
      </button>
      <span>用时 {duration}</span>
    </div>
  );
}
