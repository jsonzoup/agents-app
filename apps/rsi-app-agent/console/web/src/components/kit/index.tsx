"use client";

/**
 * Building blocks every app UI can use. Corrections made through `EditableValue` and
 * suggestions made through `SuggestButton` become kernel signals with the scope the user
 * picked and the task's full context — this is how ordinary use feeds evolution.
 */

import { useEffect, useRef, useState } from "react";
import { Check, FlaskConical, Lightbulb, Loader2, Paperclip, Pencil, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Contribution, HostApi, Material, SignalScope, SuggestTarget, Task } from "@/sdk";

export interface ScopeOption {
  scope: SignalScope;
  label: string;
  hint: string;
}

/** Default scope choices: this task, one scope value (e.g. this customer) when known, all tasks. */
export function scopeOptions(scopes: { key: string; title: string; value?: string; label?: string }[]): ScopeOption[] {
  const out: ScopeOption[] = [{ scope: { level: "task" }, label: "只这一单", hint: "只改这一单，不用于改进应用" }];
  for (const s of scopes) if (s.value) out.push({ scope: { level: "scope", key: s.key, value: s.value }, label: `这个${s.title}`, hint: `${s.label ?? s.value} 的单据以后都这样` });
  out.push({ scope: { level: "app", }, label: "所有单据", hint: "这是通用口径，所有单据都这样" });
  return out;
}

export function EditableValue({
  value,
  display,
  options,
  onSave,
  disabled,
  className,
  multiline,
  changed,
}: {
  value: string;
  display?: React.ReactNode;
  options: ScopeOption[];
  onSave: (v: { value: string; note: string; scope: SignalScope }) => Promise<void>;
  disabled?: boolean;
  className?: string;
  multiline?: boolean;
  changed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(value);
      setNote("");
      setPick(0);
    }
  }, [open, value]);

  if (disabled) return <span className={className}>{display ?? (value || <span className="text-muted-foreground/50">—</span>)}</span>;

  async function save() {
    setBusy(true);
    try {
      await onSave({ value: draft, note, scope: options[pick].scope });
      setOpen(false);
      toast.success(options[pick].scope.level === "task" ? "已修改这一单" : "已修改，并记为改进信号", { description: options[pick].scope.level === "task" ? undefined : "负责人会在“改进信号”里看到它；采纳后你会在单据列表上方看到结果。" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn("group/edit -mx-1 inline-flex max-w-full items-start gap-1 rounded px-1 text-left hover:bg-amber-50 hover:ring-1 hover:ring-amber-200", changed && "bg-amber-50 ring-1 ring-amber-200", className)}>
          <span className="min-w-0 break-words">{display ?? (value || <span className="text-muted-foreground/50">—</span>)}</span>
          <Pencil className="mt-0.5 size-3 shrink-0 opacity-0 group-hover/edit:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="grid gap-2">
          {multiline ? <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} /> : <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />}
          <div className="text-xs text-muted-foreground">原值：{value || "（空）"}</div>
          <div className="grid gap-1">
            {options.map((o, i) => (
              <button key={i} onClick={() => setPick(i)} className={cn("rounded-md border px-2 py-1.5 text-left", pick === i ? "border-foreground bg-muted" : "hover:bg-muted/50")}>
                <div className="text-sm font-medium">{o.label}</div>
                <div className="text-xs text-muted-foreground">{o.hint}</div>
              </button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="为什么改（可选，帮助改进）" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={busy || draft === value}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} 保存
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What a suggestion is about: the task's result, the app's interface, or something it should be able to do. */
export type SuggestAbout = "result" | "ui" | "feature";

const ABOUT: Record<SuggestAbout, { label: string; title: string; description: string; placeholder: string }> = {
  result: {
    label: "处理结果",
    title: "对处理结果的建议",
    description: "说说哪里不对、应该怎样。不必是某个值：可以是一块区域的展示和规则，也可以是整张单据的处理口径。这张单据的输入、结果和你的修正会一起附上。",
    placeholder: "例如：明细表应按原始单据的顺序排列；同一合同的多张发票要合并成一单；金额列需要显示币种",
  },
  ui: {
    label: "界面",
    title: "对界面的建议",
    description: "页面哪里不好用、看不清、找不到，希望怎样。会连同你所在的页面一起交给负责改应用的人，可以粘贴截图。",
    placeholder: "例如：列表要能按日期筛选；确认按钮太靠下，每次都要滚动；表格列太多，希望能隐藏不用的列",
  },
  feature: {
    label: "新功能",
    title: "希望增加的功能",
    description: "应用现在做不到、但工作中需要的事。写清楚在什么情况下要用、希望得到什么结果。",
    placeholder: "例如：希望能一次上传多份材料批量建单；办完后能导出 Excel 发给客户；同一客户的历史单据能直接引用",
  },
};

/** A page inside the app, without the platform's mount prefix (`/apps/<app>/v/<version>`, `/use/<app>`). */
export function appPageOf(pathname: string): string {
  return pathname.replace(/^\/apps\/[^/]+\/[vw]\/[^/]+/, "").replace(/^\/use\/[^/]+/, "") || "/";
}

/** The page inside the app the person is on. */
export function currentAppPage(): string {
  return typeof window === "undefined" ? "/" : appPageOf(window.location.pathname);
}

/**
 * Suggest an improvement that is not one value. About the result: a region of the page
 * (“这张表应该按金额排序”) or the whole task (“这类单据要先核对合同”); the server stores the
 * task's input, the app's output and every correction with it. About the app itself: its
 * interface (the current page goes along) or a feature it lacks; those reach whoever changes the
 * app's code and need no task. Without `target`, the person picks what it is about and, for
 * results, the whole task or one of `regions`.
 */
export function SuggestButton({
  api,
  taskId,
  options = [],
  target,
  regions = [],
  about: initial,
  locate,
  onDone,
  label,
  icon,
  disabled,
  className,
}: {
  api: HostApi;
  /** The task at hand; without one, only interface and feature suggestions are possible. */
  taskId?: string;
  options?: ScopeOption[];
  target?: SuggestTarget;
  regions?: { path: string; label: string }[];
  /** What the dialog starts on. */
  about?: SuggestAbout;
  /** Where the person is, when the button sits outside the app's pages (the platform's frame around them). */
  locate?: () => { page: string; task?: string };
  /** Called with the task as it is now, when there is one. */
  onDone?: (task: Task) => void;
  /** Button text; defaults to “提建议”. */
  label?: string;
  /** Show only an icon (for section headers). */
  icon?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fixed: SuggestAbout | null = target ? (target.level === "ui" || target.level === "feature" ? target.level : "result") : null;
  const start: SuggestAbout = fixed ?? initial ?? (taskId ? "result" : "ui");
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState<SuggestAbout>(start);
  const [note, setNote] = useState("");
  const [where, setWhere] = useState<string>("");
  const [part, setPart] = useState("");
  const [page, setPage] = useState("/");
  const [seen, setSeen] = useState<string | undefined>(undefined);
  const [pick, setPick] = useState(0);
  const [files, setFiles] = useState<Material[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const general = Math.max(0, options.findIndex((o) => o.scope.level === "app"));
  useEffect(() => {
    if (open) {
      setAbout(start);
      setNote("");
      setWhere("");
      setPart("");
      const here = locate?.() ?? { page: currentAppPage() };
      setPage(here.page);
      setSeen(here.task);
      setFiles([]);
      setPick(general);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, general, start]);
  const product = about !== "result";
  const chosen: SuggestTarget = product
    ? target && fixed === about
      ? target
      : about === "ui"
        ? { level: "ui", path: page, label: part.trim() || undefined }
        : { level: "feature", label: part.trim() || undefined }
    : (target ?? (where ? { level: "region", path: where, label: regions.find((r) => r.path === where)?.label } : { level: "task", label: "整单" }));
  const title = product ? (chosen.label ? `${ABOUT[about].title} · ${chosen.label}` : ABOUT[about].title) : `改进建议 · ${chosen.label ?? (chosen.level === "task" ? "整单" : chosen.path)}`;
  const choices = (["result", "ui", "feature"] as const).filter((a) => a !== "result" || taskId);

  async function attach(list: File[]) {
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list) {
        const m = await api.upload(f);
        setFiles((x) => [...x, m]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  function paste(e: React.ClipboardEvent) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    attach(images.map((f, i) => new File([f], `截图-${stamp}${images.length > 1 ? `-${i + 1}` : ""}.${f.type.split("/")[1] || "png"}`, { type: f.type })));
  }

  async function save() {
    setBusy(true);
    try {
      let task: Task | null = null;
      if (product) {
        await api.suggestApp({ target: chosen, note: note.trim(), task: taskId ?? seen, attachments: files });
        if (taskId) task = await api.task(taskId);
        toast.success("建议已提交", { description: "会交给负责改应用的人；进展显示在单据列表上方。" });
      } else {
        task = await api.suggest(taskId!, { target: chosen, note: note.trim(), scope: options[pick]?.scope ?? { level: "app" }, attachments: files });
        toast.success(api.version ? "已记下（试用单据，不进入改进队列）" : "建议已提交", { description: api.version ? undefined : "连同这张单据的完整内容一起交给负责改进的人；进展会显示在单据列表上方。" });
      }
      setOpen(false);
      if (task) onDone?.(task);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {icon ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          title={`对「${target?.label ?? "这部分"}」提改进建议`}
          className={cn("inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40", className)}
        >
          <Lightbulb className="size-3.5" />
        </button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} className={className}>
          <Lightbulb /> {label ?? "提建议"}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{ABOUT[about].description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {!fixed && choices.length > 1 && (
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {choices.map((a) => (
                  <button key={a} type="button" onClick={() => setAbout(a)} className={cn("rounded-md px-2 py-1 text-sm", about === a ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {ABOUT[a].label}
                  </button>
                ))}
              </div>
            )}
            {!product && !target && regions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[{ path: "", label: "整单" }, ...regions].map((r) => (
                  <button key={r.path || "-"} type="button" onClick={() => setWhere(r.path)} className={cn("rounded-full border px-2.5 py-1 text-xs", where === r.path ? "border-foreground bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                    {r.label}
                  </button>
                ))}
              </div>
            )}
            {product && !(target && fixed === about) && (
              <div className="grid gap-1">
                <Input value={part} onChange={(e) => setPart(e.target.value)} placeholder={about === "ui" ? "哪一块（可选）：如 单据列表的筛选栏" : "一句话说是什么功能（可选）：如 批量导出"} />
                {about === "ui" && <span className="text-xs text-muted-foreground">所在页面：<span className="font-mono">{page}</span></span>}
              </div>
            )}
            <Textarea autoFocus rows={5} value={note} onChange={(e) => setNote(e.target.value)} onPaste={paste} placeholder={ABOUT[about].placeholder} />
            {!product && options.length > 0 && (
              <div className="grid gap-1">
                {options.map((o, i) => (
                  <button key={i} type="button" onClick={() => setPick(i)} className={cn("rounded-md border px-2 py-1.5 text-left", pick === i ? "border-foreground bg-muted" : "hover:bg-muted/50")}>
                    <div className="text-sm font-medium">{o.label}</div>
                    <div className="text-xs text-muted-foreground">{o.scope.level === "task" ? "只是这一单的特殊情况，记录下来但不用于改进应用" : o.hint}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <input ref={input} type="file" multiple className="hidden" onChange={(e) => attach(Array.from(e.target.files ?? []))} />
              <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} {product ? "附件（截图可直接粘贴）" : "附件（截图、示例表格）"}
              </Button>
              {files.map((f) => (
                <span key={f.path} className="inline-flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 text-xs">
                  {f.name}
                  <button type="button" onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            {api.version && !product && (
              <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <FlaskConical className="size-3.5" /> 这是试用 {api.version} 的单据，建议只记在单据上，不进入改进队列。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={save} disabled={busy || uploading || !note.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} 提交建议
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** How people name what a suggestion is about. */
export function suggestionPlace(target: SuggestTarget): string {
  if (target.level === "ui") return `界面${target.label ? ` · ${target.label}` : ""}`;
  if (target.level === "feature") return `新功能${target.label ? ` · ${target.label}` : ""}`;
  return target.label ?? (target.level === "task" ? "整单" : (target.path ?? "整单"));
}

/** Suggestions already made on a task, so people see theirs and others' before adding more. */
export function SuggestionList({ task }: { task: Task }) {
  const items = task.suggestions ?? [];
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium text-amber-900">
        <Lightbulb className="size-4" /> 这张单据上的改进建议
      </div>
      {items.map((s, i) => (
        <div key={i} className="text-amber-950/80">
          <span className="font-medium">{s.by}</span>
          <span className="mx-1 rounded bg-amber-100 px-1 text-xs">{suggestionPlace(s.target)}</span>
          {s.note}
          {s.attachments.length > 0 && <span className="ml-1 text-xs text-amber-900/60">（附件 {s.attachments.length} 个）</span>}
        </div>
      ))}
    </div>
  );
}

const STAGE: Record<Contribution["stage"], string> = {
  "task-only": "只记在那一单",
  queued: "已进入改进队列",
  proposed: "已据此起草修改",
  released: "已随新版本发布",
  dismissed: "负责人决定不采纳",
};

/** What happened to the current user's corrections; shown in the business UI, no extra work for the user. */
export function ContributionBanner({ api, appStable }: { api: HostApi; appStable: string }) {
  const [items, setItems] = useState<Contribution[] | null>(null);
  useEffect(() => {
    api.contributions().then(setItems).catch(() => setItems([]));
  }, [api]);
  if (!items || items.length === 0) return null;
  const counts = items.reduce<Record<string, number>>((m, c) => ((m[c.stage] = (m[c.stage] ?? 0) + 1), m), {});
  const released = items.filter((c) => c.stage === "released");
  const dismissed = items.filter((c) => c.stage === "dismissed").at(-1);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-indigo-900">
        <Sparkles className="size-4" /> 你的 {items.length} 次修正和建议
      </span>
      {(["released", "proposed", "queued", "dismissed", "task-only"] as const).filter((s) => counts[s]).map((s) => (
        <span key={s} className="text-indigo-900/80">
          {STAGE[s]} {counts[s]}
        </span>
      ))}
      {released.length > 0 && <span className="text-xs text-indigo-900/60">最新：{released.at(-1)!.field ?? released.at(-1)!.note ?? "建议"} 已在 {released.at(-1)!.release} 生效（当前稳定版 {appStable}）</span>}
      {dismissed && <span className="text-xs text-indigo-900/60">未采纳：{dismissed.field ?? dismissed.note}——{dismissed.reason}</span>}
    </div>
  );
}
