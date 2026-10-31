"use client";

import { useEffect, useRef, useState } from "react";
import { Loading } from "@/components/shell/page";
import { cn } from "@/lib/utils";

async function bytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`读取文件失败：HTTP ${res.status}`);
  return res.arrayBuffer();
}

function Problem({ error }: { error: string }) {
  return <p className="p-4 text-sm text-destructive">无法预览：{error}</p>;
}

const MAX_ROWS = 2000;

/** Spreadsheet preview: every sheet as a grid with column letters and row numbers. */
export function SheetPreview({ url }: { url: string }) {
  const [sheets, setSheets] = useState<{ name: string; rows: string[][]; total: number }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await bytes(url), { type: "array", cellDates: true });
      const out = wb.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
        return { name, rows: rows.slice(0, MAX_ROWS), total: rows.length };
      });
      if (live) setSheets(out);
    })().catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [url]);
  if (error) return <Problem error={error} />;
  if (!sheets) return <Loading />;
  const sheet = sheets[active];
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const col = (i: number) => {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="sticky left-0 z-20 w-10 border bg-muted px-1 text-muted-foreground" />
              {Array.from({ length: width }, (_, i) => (
                <th key={i} className="min-w-20 border px-2 py-1 font-normal text-muted-foreground">{col(i)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 border bg-muted px-1 text-right text-muted-foreground">{r + 1}</td>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="max-w-80 truncate border px-2 py-1 whitespace-nowrap" title={row[c] ?? ""}>{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.total > MAX_ROWS && <p className="p-2 text-xs text-muted-foreground">只显示前 {MAX_ROWS} 行，共 {sheet.total} 行；完整内容请下载。</p>}
        {sheet.rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">这个工作表是空的。</p>}
      </div>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-t bg-muted/40 px-2 py-1">
        {sheets.map((s, i) => (
          <button key={s.name} onClick={() => setActive(i)} className={cn("rounded px-2.5 py-1 text-xs whitespace-nowrap", i === active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:bg-background/60")}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Word document preview, rendered page by page in the browser. */
export function DocxPreview({ url }: { url: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | string>("loading");
  useEffect(() => {
    let live = true;
    (async () => {
      const { renderAsync } = await import("docx-preview");
      const data = await bytes(url);
      if (!live || !body.current) return;
      body.current.innerHTML = "";
      await renderAsync(data, body.current, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, experimental: true });
      if (live) setState("ok");
    })().catch((e) => live && setState((e as Error).message));
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div className="h-full min-h-0 overflow-auto bg-muted/50">
      {state === "loading" && <Loading />}
      {state !== "loading" && state !== "ok" && <Problem error={state} />}
      <div ref={body} className="docx-host" />
    </div>
  );
}

/** PowerPoint preview: slides one under another. */
export function PptxPreview({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ok" | string>("loading");
  useEffect(() => {
    let live = true;
    let previewer: { destroy(): void } | null = null;
    (async () => {
      const { init } = await import("pptx-preview");
      const data = await bytes(url);
      if (!live || !host.current) return;
      host.current.innerHTML = "";
      const width = Math.min(960, host.current.clientWidth - 32 || 960);
      const p = init(host.current, { width, height: Math.round((width * 9) / 16), mode: "list" });
      previewer = p;
      await p.preview(data);
      if (live) setState("ok");
    })().catch((e) => live && setState((e as Error).message));
    return () => {
      live = false;
      previewer?.destroy();
    };
  }, [url]);
  return (
    <div className="h-full min-h-0 overflow-auto bg-muted/50 p-4">
      {state === "loading" && <Loading />}
      {state !== "loading" && state !== "ok" && <Problem error={state} />}
      <div ref={host} className="mx-auto" />
    </div>
  );
}
