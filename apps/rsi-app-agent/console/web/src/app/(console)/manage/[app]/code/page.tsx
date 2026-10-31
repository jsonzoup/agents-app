"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitCompare, Loader2, Lock, Maximize2, MessageSquare, Minimize2, Pencil, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ChatColumn, ChatRail, Workbench } from "@/components/build/workbench";
import { FileTree, type TreeEntry } from "@/components/file-tree";
import { ResizeHandle, useColumnWidth } from "@/components/resize-handle";
import { Failure, Loading, PageHeader, Pill } from "@/components/shell/page";
import { VersionPicker, useVersions } from "@/components/version-picker";
import { FileViewer } from "@/components/viewer/file-viewer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, useApi } from "@/lib/api";
import type { BuildSummary, BuildView } from "@/lib/builder";
import { fileKind, formatBytes } from "@/lib/files";
import { fmtTime, TIER } from "@/lib/format";
import type { Proposal, TreeFile } from "@/lib/kernel";
import { useApp, useSession } from "@/lib/session";
import { FULLSCREEN, useFullscreen } from "@/lib/use-fullscreen";
import { cn } from "@/lib/utils";

const CodeDiff = dynamic(() => import("@/components/viewer/code-editor").then((m) => m.CodeDiff), { ssr: false, loading: () => <Loading /> });

function TierBadge({ tier }: { tier: string }) {
  return <Pill className={TIER[tier]?.className}>{TIER[tier]?.label ?? tier}</Pill>;
}

/** A change waiting to be submitted: edited text, an uploaded file, or a deletion. */
type Pending =
  | { kind: "edit"; path: string; before: string; text: string }
  | { kind: "upload"; path: string; file: File; url: string; text: string | null; existed: boolean }
  | { kind: "delete"; path: string };

const isTextFile = (name: string) => ["code", "markdown", "csv"].includes(fileKind(name));

export default function CodePage() {
  const { app } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  const issue = search.get("issue");
  const [version, setVersion] = useState<string>(search.get("version") ?? search.get("release") ?? app.stable);
  const { data: versions } = useVersions(app.name);
  const { data: tree, error } = useApi<{ release: string; files: TreeFile[] }>(`/api/apps/${app.name}/tree?version=${version}`);
  const [path, setPath] = useState<string | null>(search.get("path"));
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [submit, setSubmit] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { me } = useSession();
  const build = search.get("build");
  const [chatOpen, setChatOpen] = useState(Boolean(build) || search.has("chat"));
  const canChange = app.permissions.includes("proposal.create");
  const treeWidth = useColumnWidth("file-tree", 260, 140, 560);
  const [fullscreen, setFullscreen] = useFullscreen();
  const { data: sessions } = useApi<BuildSummary[]>(chatOpen && !build && canChange ? "/api/builds" : null);
  const resumable = (sessions ?? []).filter((s) => s.app === app.name && s.mode === "existing" && !s.published);

  function setQuery(change: Record<string, string | null>) {
    const q = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(change)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`/manage/${app.name}/code${q.size ? `?${q}` : ""}`);
  }
  useEffect(() => {
    if (!search.has("chat")) return;
    setChatOpen(true);
    setQuery({ chat: null });
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startChat(text: string) {
    try {
      const v = await api<BuildView>("/api/builds", { body: { app: app.name, goal: text, issue: issue ?? undefined } });
      setQuery({ build: v.id, issue: null, path: null });
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  const info = versions?.find((v) => v.id === version);
  const canEdit = app.permissions.includes("proposal.create") && version === app.stable;
  const meta = tree?.files.find((f) => f.path === path);
  const real = (p: Pending | undefined) => (p && (p.kind !== "edit" || p.text !== p.before) ? p : undefined);
  const change = path ? real(pending[path]) : undefined;
  const { data: file } = useApi<{ path: string; tier: string; text: string | null; size: number }>(
    path && meta && pending[path]?.kind !== "upload" ? `/api/apps/${app.name}/file?path=${encodeURIComponent(path)}&version=${version}` : null,
  );

  useEffect(() => {
    if (!path && tree) setPath(tree.files.find((f) => f.path === "AGENTS.md")?.path ?? tree.files[0]?.path ?? null);
  }, [tree, path]);
  useEffect(() => {
    setPending({});
    setEditing(null);
  }, [version]);

  const entries: TreeEntry[] = useMemo(() => {
    const out: TreeEntry[] = (tree?.files ?? []).map((f) => ({
      path: f.path,
      size: f.size,
      dot: f.tier === "knowledge" ? "bg-emerald-500" : f.tier === "code" ? "bg-amber-500" : "bg-slate-400",
      dotTitle: TIER[f.tier]?.label,
      mark: pending[f.path]?.kind === "delete" ? "removed" : real(pending[f.path]) ? "changed" : undefined,
      tag: f.web ? <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">web</span> : undefined,
    }));
    for (const p of Object.values(pending)) if (p.kind === "upload" && !p.existed) out.push({ path: p.path, size: p.file.size, mark: "added" });
    return out;
  }, [tree, pending]);

  const pendingList = Object.values(pending).filter((p) => real(p));
  const rawUrl = (p: string) => `/api/apps/${app.name}/raw?path=${encodeURIComponent(p)}&version=${version}`;

  function startEdit() {
    if (!path || !file || file.text === null) return;
    if (!pending[path]) setPending((s) => ({ ...s, [path]: { kind: "edit", path, before: file.text!, text: file.text! } }));
    setEditing(path);
  }
  function discard(p: string) {
    setPending((s) => {
      const next = { ...s };
      const old = next[p];
      if (old?.kind === "upload") URL.revokeObjectURL(old.url);
      delete next[p];
      return next;
    });
    if (editing === p) setEditing(null);
  }

  if (build) {
    return (
      <div className="h-[calc(100svh-13rem)] min-h-[520px]">
        <Workbench
          key={build}
          id={build}
          embedded
          chatOpen={chatOpen}
          onChatOpenChange={setChatOpen}
          onLeave={() => setQuery({ build: null })}
          fullscreen={fullscreen}
          onFullscreenChange={setFullscreen}
        />
      </div>
    );
  }
  if (error) return <Failure error={error} />;

  let viewer: React.ReactNode = path ? <Loading /> : <p className="p-6 text-muted-foreground">选择左侧的文件查看。</p>;
  if (path && change?.kind === "upload") {
    viewer = <FileViewer key={`${path}:upload`} path={path} url={change.url} text={change.text} size={change.file.size} scope="upload" />;
  } else if (path && change?.kind === "delete") {
    viewer = (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <Trash2 className="size-8 opacity-40" />
        <p>这个文件会在提交的提案里删除。</p>
        <Button size="sm" variant="outline" onClick={() => discard(path)}>
          <Undo2 /> 撤销删除
        </Button>
      </div>
    );
  } else if (path && file && file.path === path) {
    viewer = (
      <FileViewer
        key={`${version}:${path}`}
        path={path}
        url={rawUrl(path)}
        text={file.text}
        size={file.size}
        scope={version}
        editing={editing === path}
        value={change?.kind === "edit" ? change.text : undefined}
        onChange={(text) => setPending((s) => ({ ...s, [path]: { kind: "edit", path, before: file.text ?? "", text } }))}
      />
    );
  }

  const tier = meta?.tier ?? (change?.kind === "upload" ? "新文件" : null);

  return (
    <div className={fullscreen ? cn(FULLSCREEN, "p-4") : "flex h-[calc(100svh-13rem)] min-h-[520px] flex-col"}>
      <PageHeader
        description="每个版本都是不可变的快照。知识、代码和界面文件可以在这里修改或上传（表格、文档、图片都可以），一起提交成一个提案，过了验证和批准才发布；契约文件只能在源目录修改、评审后导入。"
        actions={
          <>
            <VersionPicker app={app.name} value={version} onChange={setVersion} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/manage/${app.name}/releases?compare=${version}`}>
                <GitCompare /> 对比
              </Link>
            </Button>
            <Button variant="ghost" size="icon-sm" title={fullscreen ? "退出全屏（Esc）" : "全屏"} onClick={() => setFullscreen(!fullscreen)}>
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </>
        }
      />
      {issue && (
        <Alert className="mb-3">
          <AlertDescription>正在为改进问题 {issue} 修正：可以手动改好文件后提交，也可以在左侧和 AI 对话让它改；提案都会关联到这个问题。</AlertDescription>
        </Alert>
      )}
      {info?.kind === "candidate" && (
        <Alert className="mb-3">
          <AlertDescription>
            这是提案 <Link className="font-medium underline" href={`/manage/${app.name}/proposals/${version}`}>{version}</Link> 的候选版本：稳定版加上它的改动，还没有发布。可以在“评测”里评测它，或在应用里试用它。
          </AlertDescription>
        </Alert>
      )}
      {info && info.kind === "release" && !info.stable && (
        <Alert className="mb-3">
          <AlertDescription>这是历史版本 {version}，只读。修改要基于稳定版 {app.stable}。</AlertDescription>
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {canChange &&
          (chatOpen ? (
            <ChatColumn
              mode="existing"
              messages={[]}
              running={false}
              harness={me.platform.harness}
              onSend={startChat}
              onCollapse={() => setChatOpen(false)}
              before={
                <>
                  {resumable.length > 0 && (
                    <div className="rounded-lg border bg-muted/30 p-2 text-[13px]">
                      <div className="mb-1 px-1 text-xs text-muted-foreground">继续之前的对话</div>
                      {resumable.slice(0, 3).map((s) => (
                        <button key={s.id} onClick={() => setQuery({ build: s.id, issue: null, path: null })} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted">
                          {s.running ? <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600" /> : <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />}
                          <span className="truncate">{s.createdByName} · {s.messages} 条消息</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{fmtTime(s.updatedAt)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {issue && <div className="rounded-lg border bg-muted/30 p-3 text-[13px]">会关联改进问题 {issue}：助手先读这个问题下所有人的修正，再按你说的改。</div>}
                </>
              }
            />
          ) : (
            <ChatRail running={resumable.some((s) => s.running)} onOpen={() => setChatOpen(true)} />
          ))}
        <FileTree
          className="shrink-0"
          style={{ width: treeWidth.width }}
          entries={entries}
          selected={path}
          onSelect={(p) => {
            setPath(p);
            if (editing && editing !== p) setEditing(null);
          }}
          toolbar={
            canEdit && (
              <Button size="icon" variant="outline" className="size-8" title="上传文件到这个版本的副本" onClick={() => setUploadOpen(true)}>
                <Upload />
              </Button>
            )
          }
          footer={
            <div className="flex gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-emerald-500" />知识</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500" />代码</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-slate-400" />契约</span>
              {!tree && <span className="ml-auto">加载中…</span>}
            </div>
          }
        />

        <ResizeHandle width={treeWidth.width} onResize={treeWidth.setWidth} onReset={treeWidth.reset} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {path && (
            <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 py-1.5">
              <code className="min-w-0 flex-1 basis-40 truncate text-[13px]" title={path}>{path}</code>
              {tier && (TIER[tier] ? <TierBadge tier={tier} /> : <Pill>{tier}</Pill>)}
              {meta?.web && <Pill className="border-violet-200 bg-violet-50 text-violet-700">web 应用</Pill>}
              {meta?.tier === "contract" ? (
                <Pill className="text-muted-foreground">
                  <Lock className="size-3" />
                  只有人改
                </Pill>
              ) : (
                canEdit && (
                  <>
                    {change && (
                      <Button size="sm" variant="ghost" onClick={() => discard(path)}>
                        <Undo2 /> 撤销改动
                      </Button>
                    )}
                    {editing === path ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        完成编辑
                      </Button>
                    ) : (
                      file?.text !== null && file?.path === path && change?.kind !== "delete" && change?.kind !== "upload" && (
                        <Button size="sm" variant="outline" onClick={startEdit}>
                          <Pencil /> 修改
                        </Button>
                      )
                    )}
                    {meta && !change && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPending((s) => ({ ...s, [path]: { kind: "delete", path } }))}>
                        <Trash2 /> 删除
                      </Button>
                    )}
                  </>
                )
              )}
            </div>
          )}
          {meta?.tier && TIER[meta.tier] && path && <div className="border-b bg-muted/30 px-3 py-1 text-xs text-muted-foreground">{TIER[meta.tier].note}</div>}
          <div className="min-h-0 flex-1">{viewer}</div>
        </div>
      </div>

      {pendingList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <span className="font-medium">待提交的改动 {pendingList.length} 个：</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {pendingList.map((p) => `${p.kind === "delete" ? "删除" : p.kind === "upload" ? (p.existed ? "替换" : "新增") : "修改"} ${p.path}`).join("、")}
          </span>
          <Button size="sm" variant="ghost" onClick={() => (setPending({}), setEditing(null))}>
            全部放弃
          </Button>
          <Button size="sm" onClick={() => setSubmit(true)}>
            提交为提案
          </Button>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        dir={path?.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}
        exists={(p) => Boolean(tree?.files.some((f) => f.path === p))}
        contract={(p) => tree?.files.find((f) => f.path === p)?.tier === "contract"}
        onAdd={async (target, f) => {
          const text = isTextFile(target) ? await f.text() : null;
          const existed = Boolean(tree?.files.some((x) => x.path === target));
          setPending((s) => ({ ...s, [target]: { kind: "upload", path: target, file: f, url: URL.createObjectURL(f), text, existed } }));
          setPath(target);
          setEditing(null);
        }}
      />
      <SubmitDialog
        open={submit}
        onOpenChange={setSubmit}
        app={app.name}
        pending={pendingList}
        issue={issue}
        onDone={(p) => {
          setPending({});
          router.push(`/manage/${app.name}/proposals/${p.id}`);
        }}
      />
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  dir,
  exists,
  contract,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dir: string;
  exists: (path: string) => boolean;
  contract: (path: string) => boolean;
  onAdd: (path: string, file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("");
  useEffect(() => {
    if (open) {
      setFile(null);
      setTarget(dir ? `${dir}/` : "");
    }
  }, [open, dir]);
  const clean = target.replace(/^\/+/, "");
  const bad = !clean || clean.endsWith("/") || clean.split("/").some((s) => s === ".." || s === ".");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
          <DialogDescription>任何文件都可以：参考表格（xlsx）、说明文档（docx、pdf）、图片、脚本。它会和其他改动一起成为提案。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <input
            ref={input}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) setTarget((t) => (t.endsWith("/") || !t ? `${t}${f.name}` : `${t.slice(0, t.lastIndexOf("/") + 1)}${f.name}`));
            }}
          />
          <Button variant="outline" onClick={() => input.current?.click()} className="justify-start">
            <Upload /> {file ? `${file.name}（${formatBytes(file.size)}）` : "选择文件"}
          </Button>
          <div className="grid gap-1.5">
            <Label>放到包里的位置</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="skills/xxx/references/样例.xlsx" className="font-mono text-xs" />
            {!bad && contract(clean) && <p className="text-xs text-destructive">这是契约文件，提案不能改，只能在源目录修改后导入。</p>}
            {!bad && exists(clean) && !contract(clean) && <p className="text-xs text-amber-700">这个位置已有文件，会被替换。</p>}
            <p className="text-xs text-muted-foreground">知识放在 skills/*/references/ 下；web 应用的文件放在 web/ 下。</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!file || bad || contract(clean)}
            onClick={async () => {
              await onAdd(clean, file!);
              onOpenChange(false);
            }}
          >
            加入改动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitDialog({ open, onOpenChange, app, pending, issue, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; app: string; pending: Pending[]; issue: string | null; onDone: (p: Proposal) => void }) {
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [decision, setDecision] = useState("");
  const [impact, setImpact] = useState("");
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(0);
  const current = pending[Math.min(shown, pending.length - 1)];
  async function go() {
    setBusy(true);
    try {
      const edits = pending.flatMap((p) => (p.kind === "edit" ? [{ path: p.path, text: p.text }] : []));
      const puts = [];
      for (const p of pending) {
        if (p.kind !== "upload") continue;
        if (p.text !== null) edits.push({ path: p.path, text: p.text });
        else {
          const b = await api<{ blob: string; size: number }>(`/api/apps/${app}/blobs`, { raw: p.file });
          puts.push({ path: p.path, blob: b.blob, size: b.size });
        }
      }
      const deletes = pending.flatMap((p) => (p.kind === "delete" ? [p.path] : []));
      const p = await api<Proposal>(`/api/apps/${app}/proposals`, { body: { title, issue, edits, puts, deletes, record: { title, background, decision, impact, review } } });
      toast.success(`已提交提案 ${p.id}，下一步：验证`);
      onDone(p);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>提交手动修正</DialogTitle>
          <DialogDescription>每个提案带一份决策记录，说清为什么改、改了会影响什么。它和 AI 起草的提案走同一套验证与批准。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {pending.map((p, i) => (
            <button key={p.path} onClick={() => setShown(i)} className={`rounded-md border px-2 py-1 font-mono text-xs ${i === shown ? "bg-muted font-medium" : "text-muted-foreground"}`}>
              {p.kind === "delete" ? "删除" : p.kind === "upload" ? (p.existed ? "替换" : "新增") : "修改"} {p.path}
            </button>
          ))}
        </div>
        <div className="h-72 overflow-hidden rounded-md border">
          {current?.kind === "edit" ? (
            <CodeDiff path={current.path} before={current.before} after={current.text} />
          ) : current?.kind === "upload" ? (
            current.text !== null ? (
              <CodeDiff path={current.path} before="" after={current.text} />
            ) : (
              <FileViewer path={current.path} url={current.url} text={null} size={current.file.size} />
            )
          ) : (
            current && <p className="p-4 text-sm text-muted-foreground">删除 {current.path}</p>
          )}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话说清改了什么" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>背景：遇到了什么问题</Label>
              <Textarea value={background} onChange={(e) => setBackground(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>决定：怎么改</Label>
              <Textarea value={decision} onChange={(e) => setDecision(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>影响：哪些任务会变</Label>
              <Textarea value={impact} onChange={(e) => setImpact(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>复核：怎么确认改对了</Label>
              <Textarea value={review} onChange={(e) => setReview(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            继续修改
          </Button>
          <Button onClick={go} disabled={busy || !title.trim() || !background.trim() || !decision.trim()}>
            提交提案
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
