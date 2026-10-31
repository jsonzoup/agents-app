"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** A column width in pixels, remembered per key in this browser. */
export function useColumnWidth(key: string, initial: number, min: number, max: number) {
  const storageKey = `column-width:${key}`;
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved) setWidth(clamp(saved, min, max));
  }, [storageKey, min, max]);
  const set = useCallback(
    (w: number) => {
      const next = clamp(Math.round(w), min, max);
      setWidth(next);
      localStorage.setItem(storageKey, String(next));
    },
    [storageKey, min, max],
  );
  return {
    width,
    setWidth: set,
    reset: () => (setWidth(initial), localStorage.removeItem(storageKey)),
  };
}

/** The draggable border to the right of a column; double-click restores the default width. */
export function ResizeHandle({ width, onResize, onReset, className }: { width: number; onResize: (w: number) => void; onReset?: () => void; className?: string }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const end = () => {
    start.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度，双击还原"
      className={cn(
        "relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 hover:bg-indigo-400",
        dragging && "bg-indigo-500",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.width + e.clientX - start.current.x);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
    />
  );
}
