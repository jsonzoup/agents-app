"use client";

import * as React from "react";
import { X } from "lucide-react";
import { FileTypeIcon } from "../../../../deepseek-harness/packages/client/ui-primitives/src/FileTypeIcon.tsx";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const PDF = /\.pdf$/i;

export function FilePreview({ taskId, path, onClose }: { taskId: string; path: string; onClose: () => void }) {
  const url = `/api/tasks/${encodeURIComponent(taskId)}/workspace?path=${encodeURIComponent(path)}`;
  const name = path.split("/").filter(Boolean).pop() || path;
  const [text, setText] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const image = IMAGE.test(path);
  const pdf = PDF.test(path);

  React.useEffect(() => {
    if (image || pdf) return;
    const controller = new AbortController();
    setText(null);
    setError("");
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("打不开这个文件");
        const body = await res.text();
        setText(body.length > 200_000 ? `${body.slice(0, 200_000)}\n\n…已截断` : body);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "打不开这个文件");
      });
    return () => controller.abort();
  }, [image, pdf, url]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-[#E4E0D8] px-3 py-2">
        <FileTypeIcon path={path} size={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[#1A1D21]">{name}</div>
          <div className="truncate font-mono text-[10.5px] text-[#8C8F94]">{path}</div>
        </div>
        <button type="button" aria-label="关闭预览" onClick={onClose} className="grid size-7 place-items-center rounded-full text-[#6B6F76] hover:bg-[#F4F2ED]">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#F7F5F1]">
        {image && <img src={url} alt={name} className="mx-auto max-w-full p-3" />}
        {pdf && <iframe title={name} src={url} className="h-full min-h-[480px] w-full border-0 bg-white" />}
        {!image && !pdf && error && <p className="p-4 text-[13px] text-[#9F2D24]">{error}</p>}
        {!image && !pdf && !error && text === null && <p className="p-4 text-[13px] text-[#8C8F94]">正在打开…</p>}
        {!image && !pdf && text !== null && (
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-relaxed text-[#1A1D21]">{text}</pre>
        )}
      </div>
    </div>
  );
}
