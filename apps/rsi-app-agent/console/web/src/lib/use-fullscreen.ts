"use client";

import { useEffect, useState } from "react";

/** Class for a container laid over the whole window. */
export const FULLSCREEN = "fixed inset-0 z-50 flex flex-col bg-background";

/**
 * Whether a panel covers the whole window; Esc leaves unless it was meant for an editor or a dialog.
 * Controlled when `value` and `onChange` are given, so a page can keep it across the panels it swaps.
 */
export function useFullscreen(value?: boolean, onChange?: (v: boolean) => void): [boolean, (v: boolean) => void] {
  const [own, setOwn] = useState(false);
  const on = value ?? own;
  const set = onChange ?? setOwn;

  useEffect(() => {
    if (!on) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "Escape" && !e.defaultPrevented && !target?.closest(".monaco-editor, [role=dialog]")) set(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [on, set]);

  return [on, set];
}
