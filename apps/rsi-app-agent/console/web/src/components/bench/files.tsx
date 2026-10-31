"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, Loader2, Pencil, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FileTree, type TreeEntry } from "@/components/file-tree";
import { Failure, Loading, Pill } from "@/components/shell/page";
import { FileViewer } from "@/components/viewer/file-viewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, useApi } from "@/lib/api";
import { formatBytes } from "@/lib/files";
import { fmtTime } from "@/lib/format";
import type { AppSummary } from "@/lib/session";

type Role = "case" | "material" | "expected" | "spec" | "judge" | "test" | "expect" | "tool" | "other";
interface BenchFile {
  path: string;
  size: number;
  text: boolean;
  role: Role;
}

export const ROLE: Record<Role, { label: string; className: string; note: string }> = {
  case: { label: "用例", className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", note: "一个用例：输入、期望结果、验证规则、验证程序，放在开发集还是留出集" },
  material: { label: "材料", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", note: "用例的输入材料（单据、表格、扫描件），放在用例文件夹的 input/ 里" },
  expected: { label: "期望", className: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300", note: "写成文件的期望结果，放在用例文件夹的 expected/ 里" },
  spec: { label: "清单", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300", note: "评测集清单 eval.json：规范版本、验证程序、标签" },
  judge: { label: "验证", className: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300", note: "验证程序：比对输出和期望结果、检查硬规则，分数只由它和验证规则算" },
  test: { label: "自测", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300", note: "应用自测：代码级提案必须通过" },
  expect: { label: "期望生成", className: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300", note: "把确认后的单据结果转换成期望值格式" },
  tool: { label: "工具", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", note: "维护评测集用的脚本，不参与打分" },
  other: { label: "其他", className: "bg-muted text-muted-foreground", note: "评测用到的其他文件" },
};

interface Snapshot {
  id: string;
  parent: string | null;
  at: string;
  by: string;
  note: string;
  files: number;
  changed: string[];
  changedCount: number;
}

export function BenchFiles({ app }: { app: AppSummary }) {
  const { data, error, setData } = useApi<{ files: BenchFile[]; evalset: string | null }>(`/api/apps/${app.name}/bench/files`);
  const [path, setPath] = useState<string | null>(null);
  const meta = data?.files.find((f) => f.path === path);
  const { data: file, setData: setFile } = useApi<{ path: string; text: string | null; size: number }>(path && meta ? `/api/apps/${app.name}/bench/file?path=${encodeURIComponent(path)}` : null);
  const [draft, setDraft] = useState<string | null>(null);
  const [save, setSave] = useState(false);
  const [upload, setUpload] = useState(false);
  const [history, setHistory] = useState(false);
  const canManage = app.permissions.includes("eval.manage");

  useEffect(() => setDraft(null), [path]);
  useEffect(() => {
    if (!path && data?.files.length) setPath(data.files.find((f) => f.role === "case")?.path ?? data.files[0].path);
  }, [data, path]);

  const entries: TreeEntry[] = useMemo(
    () =>
      (data?.files ?? []).map((f) => ({
        path: f.path,
        size: f.size,
        tag: f.role !== "other" && f.role !== "material" ? <span className={`rounded px-1 text-[10px] ${ROLE[f.role].className}`}>{ROLE[f.role].label}</span> : undefined,
      })),
    [data],
  );

  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;

  async function remove() {
    if (!path || !confirm(`从评测集删除 ${path}？会生成新的评测集快照。`)) return;
    try {
      setData(await api(`/api/apps/${app.name}/bench/file?path=${encodeURIComponent(path)}`, { method: "PUT", body: { text: null, note: `删除 ${path}` } }));
      setPath(null);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex h-[calc(100svh-17rem)] min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          评测集的全部文件。当前快照 <b className="font-mono text-foreground">{data.evalset ?? "—"}</b>，每次保存都会生成新快照，评测结果会记下用的是哪一个。
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setHistory(true)}>
          <History /> 快照历史
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr] overflow-hidden rounded-xl border bg-card">
        <FileTree
          className="border-r"
          entries={entries}
          selected={path}
          onSelect={setPath}
          toolbar={
            canManage && (
              <Button size="icon" variant="outline" className="size-8" title="上传文件到评测集" onClick={() => setUpload(true)}>
                <Upload />
              </Button>
            )
          }
        />
        <div className="flex min-h-0 min-w-0 flex-col">
          {path && meta && (
            <div className="flex min-h-11 items-center gap-2 border-b px-3 py-1.5">
              <code className="min-w-0 flex-1 truncate text-[13px]">{path}</code>
              <Pill className={ROLE[meta.role].className}>{ROLE[meta.role].label}</Pill>
              <span className="hidden text-xs text-muted-foreground xl:inline">{ROLE[meta.role].note}</span>
              {canManage &&
                (draft === null ? (
                  <>
                    {file?.text !== null && file?.path === path && (
                      <Button size="sm" variant="outline" onClick={() => setDraft(file.text)}>
                        <Pencil /> 修改
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                      放弃
                    </Button>
                    <Button size="sm" disabled={draft === file?.text} onClick={() => setSave(true)}>
                      <Save /> 保存
                    </Button>
                  </>
                ))}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {path && meta && file?.path === path ? (
              <FileViewer
                key={path}
                path={path}
                url={`/api/apps/${app.name}/bench/raw?path=${encodeURIComponent(path)}`}
                text={file.text}
                size={file.size}
                scope="evals"
                editing={draft !== null}
                value={draft ?? undefined}
                onChange={setDraft}
              />
            ) : path ? (
              <Loading />
            ) : (
              <p className="p-6 text-muted-foreground">选择左侧的文件。</p>
            )}
          </div>
        </div>
      </div>

      <SaveDialog
        open={save}
        onOpenChange={setSave}
        path={path ?? ""}
        onSave={async (note) => {
          setData(await api(`/api/apps/${app.name}/bench/file?path=${encodeURIComponent(path!)}`, { method: "PUT", body: { text: draft, note } }));
          setFile({ path: path!, text: draft, size: new TextEncoder().encode(draft ?? "").length });
          setDraft(null);
          toast.success("已保存，评测集已生成新快照");
        }}
      />
      <UploadDialog
        open={upload}
        onOpenChange={setUpload}
        dir={path?.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}
        onUpload={async (target, f, note) => {
          setData(await api(`/api/apps/${app.name}/bench/upload?path=${encodeURIComponent(target)}&note=${encodeURIComponent(note)}`, { raw: f }));
          setPath(target);
          toast.success(`已上传 ${target}`);
        }}
      />
      <HistorySheet app={app.name} open={history} onOpenChange={setHistory} />
    </div>
  );
}

function SaveDialog({ open, onOpenChange, path, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; path: string; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setNote("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>保存 {path}</DialogTitle>
          <DialogDescription>评测集的改动只能由人做，会生成新的快照。改了裁判或期望值后，各版本需要重评才能比较。</DialogDescription>
        </DialogHeader>
        <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="改了什么、为什么（如：毛重允许 0.01 误差）" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={busy || !note.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(note.trim());
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onOpenChange, dir, onUpload }: { open: boolean; onOpenChange: (v: boolean) => void; dir: string; onUpload: (path: string, f: File, note: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setNote("");
      setTarget(dir ? `${dir}/` : "cases/");
    }
  }, [open, dir]);
  const clean = target.replace(/^\/+/, "");
  const bad = !clean || clean.endsWith("/") || clean.split("/").some((s) => s === ".." || s === ".");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>上传到评测集</DialogTitle>
          <DialogDescription>材料（pdf、xlsx、docx、图片）放在用例文件夹的 input/ 下（cases/&lt;编号&gt;/input/），用例在输入里引用它的路径；也可以替换验证程序或自测。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <input
            ref={input}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) setTarget((t) => `${t.slice(0, t.lastIndexOf("/") + 1)}${f.name}`);
            }}
          />
          <Button variant="outline" className="justify-start" onClick={() => input.current?.click()}>
            <Upload /> {file ? `${file.name}（${formatBytes(file.size)}）` : "选择文件"}
          </Button>
          <div className="grid gap-1.5">
            <Label>位置</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid gap-1.5">
            <Label>说明</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：补充 C 单的装箱单" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={busy || !file || bad}
            onClick={async () => {
              setBusy(true);
              try {
                await onUpload(clean, file!, note.trim() || `上传 ${clean}`);
                onOpenChange(false);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} 上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistorySheet({ app, open, onOpenChange }: { app: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useApi<Snapshot[]>(open ? `/api/apps/${app}/bench/history` : null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>评测集快照</SheetTitle>
          <SheetDescription>每次改动都留一份快照，评测结果记下用的是哪一个；用例只增不改的话，历史分数仍可比较。</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-6">
          {!data && <Loading />}
          {data?.map((s, i) => (
            <div key={s.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center gap-2">
                <b className="font-mono">{s.id}</b>
                {i === 0 && <Pill className="border-emerald-200 text-emerald-700">当前</Pill>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.by} · {fmtTime(s.at)}
                </span>
              </div>
              <p className="mt-1">{s.note}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.files} 个文件{s.parent ? `，相对 ${s.parent} 改了 ${s.changedCount} 个` : ""}
                {s.changed.length > 0 && s.parent && `：${s.changed.slice(0, 6).join("、")}${s.changedCount > 6 ? "…" : ""}`}
              </p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
