"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, File, FileArchive, FileCode2, FileImage, FileJson, FileSpreadsheet, FileText, FileVideo, Folder, FolderOpen, Presentation, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { displayName, fileKind, formatBytes } from "@/lib/files";
import { cn } from "@/lib/utils";

export interface TreeEntry {
  path: string;
  size?: number | null;
  /** Small colored dot after the name (e.g. tier). */
  dot?: string;
  dotTitle?: string;
  /** Pending change marker. */
  mark?: "added" | "changed" | "removed";
  /** Extra label after the name. */
  tag?: ReactNode;
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const kind = fileKind(path);
  const c = cn("size-3.5 shrink-0", className);
  if (path.endsWith(".json")) return <FileJson className={cn(c, "text-amber-600")} />;
  if (kind === "markdown") return <FileText className={cn(c, "text-sky-600")} />;
  if (kind === "sheet" || kind === "csv") return <FileSpreadsheet className={cn(c, "text-emerald-600")} />;
  if (kind === "docx" || kind === "pdf") return <FileText className={cn(c, "text-blue-700")} />;
  if (kind === "pptx") return <Presentation className={cn(c, "text-orange-600")} />;
  if (kind === "image") return <FileImage className={cn(c, "text-fuchsia-600")} />;
  if (kind === "video" || kind === "audio") return <FileVideo className={cn(c, "text-violet-600")} />;
  if (kind === "code") return <FileCode2 className={cn(c, "text-muted-foreground")} />;
  if (/\.(zip|gz|tar|7z|rar)$/i.test(path)) return <FileArchive className={cn(c, "text-muted-foreground")} />;
  return <File className={cn(c, "text-muted-foreground")} />;
}

interface Node {
  name: string;
  path: string;
  children: Map<string, Node>;
  entry?: TreeEntry;
}

function build(entries: TreeEntry[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const e of entries) {
    const parts = e.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(part)) node.children.set(part, { name: part, path, children: new Map() });
      node = node.children.get(part)!;
      if (i === parts.length - 1) node.entry = e;
    });
  }
  return root;
}

const MARK: Record<NonNullable<TreeEntry["mark"]>, { label: string; className: string }> = {
  added: { label: "新", className: "text-emerald-600" },
  changed: { label: "改", className: "text-amber-600" },
  removed: { label: "删", className: "text-red-600 line-through" },
};

export function FileTree({
  entries,
  selected,
  onSelect,
  className,
  style,
  footer,
  toolbar,
  emptyText = "没有文件",
}: {
  entries: TreeEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
  style?: React.CSSProperties;
  footer?: ReactNode;
  toolbar?: ReactNode;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const shown = useMemo(() => (filter ? entries.filter((e) => `${e.path} ${displayName(e.path)}`.toLowerCase().includes(filter.toLowerCase())) : entries), [entries, filter]);
  const root = useMemo(() => build(shown), [shown]);

  const render = (node: Node, depth: number): ReactNode[] => {
    const kids = [...node.children.values()].sort((a, b) => Number(Boolean(a.entry)) - Number(Boolean(b.entry)) || a.name.localeCompare(b.name));
    return kids.flatMap((n) => {
      const pad = { paddingLeft: `${depth * 12 + 6}px` };
      if (!n.entry) {
        const open = filter.length > 0 || !closed.has(n.path);
        return [
          <button
            key={`d:${n.path}`}
            onClick={() => setClosed((s) => (s.has(n.path) ? new Set([...s].filter((x) => x !== n.path)) : new Set([...s, n.path])))}
            className="flex w-full items-center gap-1 rounded py-1 pr-1.5 text-left text-muted-foreground hover:bg-muted"
            style={pad}
          >
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
            {open ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
            <span className="truncate">{n.name}</span>
          </button>,
          ...(open ? render(n, depth + 1) : []),
        ];
      }
      const e = n.entry;
      return [
        <button
          key={`f:${n.path}`}
          onClick={() => onSelect(n.path)}
          title={`${n.path}${e.size ? ` · ${formatBytes(e.size)}` : ""}`}
          className={cn("flex w-full items-center gap-1.5 rounded py-1 pr-1.5 text-left hover:bg-muted", selected === n.path && "bg-muted font-medium")}
          style={{ paddingLeft: `${depth * 12 + 22}px` }}
        >
          <FileIcon path={n.path} />
          <span className={cn("min-w-0 flex-1 truncate", e.mark && MARK[e.mark].className)} title={n.path}>{displayName(n.name)}</span>
          {e.tag}
          {e.mark && <span className={cn("text-[10px] font-semibold", MARK[e.mark].className.split(" ")[0])}>{MARK[e.mark].label}</span>}
          {e.dot && <span className={cn("size-1.5 shrink-0 rounded-full", e.dot)} title={e.dotTitle} />}
        </button>,
      ];
    });
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)} style={style}>
      <div className="flex items-center gap-1 border-b p-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选文件" className="h-8 pl-7" />
        </div>
        {toolbar}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5 text-[13px]">{shown.length === 0 ? <p className="p-3 text-muted-foreground">{emptyText}</p> : render(root, 0)}</div>
      {footer}
    </div>
  );
}
