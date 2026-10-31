"use client";

import * as React from "react";

export function PanelResizer({
  width,
  onChange,
  onReset,
  min = 320,
  max = 820,
}: {
  width: number;
  onChange: (width: number) => void;
  onReset?: () => void;
  min?: number;
  max?: number;
}) {
  const drag = React.useRef<{ x: number; width: number } | null>(null);

  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖拽调整右侧面板宽度"
      title="拖拽调整宽度，双击恢复默认"
      className="group relative z-10 w-2 flex-none cursor-col-resize touch-none select-none bg-transparent"
      onDoubleClick={() => (onReset ? onReset() : onChange(400))}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const delta = event.clientX - drag.current.x;
        onChange(clamp(drag.current.width - delta));
      }}
      onPointerUp={(event) => {
        if (drag.current) {
          drag.current = null;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[#c8a45c]/60 group-active:bg-[#c8a45c]" />
      <span className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-[#c8a45c]/30" />
    </div>
  );
}
