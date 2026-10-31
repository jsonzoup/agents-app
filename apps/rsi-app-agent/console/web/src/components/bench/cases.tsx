"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, ClipboardCopy, FileInput, Loader2, Lock, Paperclip, Pencil, Play, Plus, Search, Stethoscope, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Failure, Loading, Pill, Section } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VersionPicker } from "@/components/version-picker";
import { api, useApi } from "@/lib/api";
import { encodePath, formatBytes } from "@/lib/files";
import { fmtTime, pct } from "@/lib/format";
import { ABLATION_LABEL, DIFFICULTY_LABEL } from "@/lib/kernel";
import type { CaseHistoryRow, Difficulty, EvalAudit, EvalCaseRow, EvalRun, Oracle } from "@/lib/kernel";
import type { AppSummary } from "@/lib/session";
import type { Material, Task } from "@/sdk";
import { cn } from "@/lib/utils";
import { SplitBadge, tone } from "./common";

const CodeEditor = dynamic(() => import("@/components/viewer/code-editor").then((m) => m.CodeEditor), { ssr: false, loading: () => <Loading /> });

interface CasesView {
  cases: EvalCaseRow[];
  dir: string;
  evalset: string | null;
  hasExpect: boolean;
  validators: { name: string; title: string; command: string }[];
  tags: Record<string, string>;
  capabilities: Record<string, string>;
}

/** `null` in the select means “rules only”. */
const RULES_ONLY = "__rules__";

interface Draft {
  id: string;
  title: string;
  split: "dev" | "holdout";
  source: string;
  input: string;
  expected: string;
  rules: string;
  validator: string | null;
  tags: string;
  difficulty: Difficulty | null;
  why: string;
  capabilities: string;
  note: string;
  isNew: boolean;
  locked?: boolean;
  via?: string;
  /** A reference run to save with the case, e.g. the confirmed result of a real task. */
  oracle?: Oracle;
}

const pretty = (v: unknown) => JSON.stringify(v ?? {}, null, 2);
const RULE_EXAMPLE = `[
  { "path": "status", "op": "equals", "value": "result" }
]`;
const blankDraft = (): Draft => ({ id: "", title: "", split: "dev", source: "", input: "{\n  \n}", expected: "{\n  \n}", rules: "[]", validator: "judge", tags: "", difficulty: null, why: "", capabilities: "", note: "", isNew: true });
const NO_DIFFICULTY = "__none__";
const splitList = (text: string) => text.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);

function validatorLabel(c: EvalCaseRow) {
  const rules = c.rules.length ? `${c.rules.length} 条规则` : "";
  const v = c.validator === null ? "" : c.validator === "judge" ? "裁判" : c.validator;
  return [v, rules].filter(Boolean).join(" + ") || "—";
}

export function Cases({ app, focus }: { app: AppSummary; focus?: string | null }) {
  const { data, error, setData } = useApi<CasesView>(`/api/apps/${app.name}/bench/cases`);
  const [filter, setFilter] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(app.stable);
  const [starting, setStarting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fromTask, setFromTask] = useState(false);
  const router = useRouter();
  const canManage = app.permissions.includes("eval.manage");
  const canRun = app.permissions.includes("eval.run");

  useEffect(() => {
    if (!focus || !data || draft) return;
    const c = data.cases.find((x) => x.id === focus);
    if (c) edit(c);
    // only when arriving with ?case=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, data]);

  const shown = useMemo(
    () =>
      (data?.cases ?? []).filter(
        (c) => (!tag || c.tags.includes(tag)) && (!filter || `${c.id} ${c.title} ${c.source ?? ""} ${c.tags.join(" ")} ${c.capabilities.join(" ")}`.toLowerCase().includes(filter.toLowerCase())),
      ),
    [data, filter, tag],
  );
  const allTags = useMemo(() => [...new Set([...Object.keys(data?.tags ?? {}), ...(data?.cases ?? []).flatMap((c) => c.tags)])].sort(), [data]);
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;

  function edit(c: EvalCaseRow) {
    setDraft({
      id: c.id,
      title: c.title,
      split: c.split,
      source: c.source ?? "",
      input: pretty(c.input),
      expected: c.expected === undefined || c.expected === null ? "" : pretty(c.expected),
      rules: JSON.stringify(c.rules, null, 2),
      validator: c.validator,
      tags: c.tags.join(", "),
      difficulty: c.difficulty,
      why: c.why ?? "",
      capabilities: c.capabilities.join(", "),
      note: "",
      isNew: false,
      locked: c.locked,
    });
  }
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((c) => picked.has(c.id));
  async function runPicked() {
    setStarting(true);
    try {
      const cases = data!.cases.filter((c) => picked.has(c.id)).map((c) => c.id);
      const run = await api<EvalRun>(`/api/apps/${app.name}/bench/runs`, { body: { version, cases } });
      toast.success(`已开始评测 ${run.version}（${run.id}），所选 ${cases.length} 个用例`, { description: "部分用例的结果只用来看问题，不作为发布依据。" });
      router.replace("?tab=results");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function remove(c: EvalCaseRow) {
    if (!confirm(`删除用例 ${c.id}「${c.title}」？评测集会生成新快照，历史结果保留。`)) return;
    try {
      setData(await api<CasesView>(`/api/apps/${app.name}/bench/cases/${c.id}`, { method: "DELETE" }));
      toast.success(`已删除 ${c.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const dev = data.cases.filter((c) => c.split === "dev").length;
  return (
    <div className="space-y-4">
      <AuditPanel app={app.name} evalset={data.evalset} onOpen={(id) => {
        const c = data.cases.find((x) => x.id === id);
        if (c) edit(c);
      }} />
      <Section
        title={
          <span>
            用例 {data.cases.length} 个 <span className="ml-1 text-xs font-normal text-muted-foreground">开发集 {dev} · 留出集 {data.cases.length - dev} · 评测集 {data.evalset ?? "—"}</span>
          </span>
        }
        actions={
          canManage && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setFromTask(true)}>
                <FileInput /> 从真实单据生成
              </Button>
              <Button size="sm" onClick={() => setDraft(blankDraft())}>
                <Plus /> 新增用例
              </Button>
            </div>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="按编号、标题、来源、标签筛选" className="h-8 pl-7" />
          </div>
          {allTags.length > 0 && <span className="ml-2 text-xs text-muted-foreground">标签</span>}
          {allTags.map((t) => (
            <button
              key={t}
              title={data.tags[t]}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn("rounded-full border px-2 py-0.5 text-xs", tag === t ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
            >
              {t}
            </button>
          ))}
        </div>
        {canRun && picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b bg-blue-50/60 px-3 py-2 text-sm dark:bg-blue-950/30">
            <span>
              已选 <b className="tabular-nums">{picked.size}</b> 个用例
            </span>
            <VersionPicker app={app.name} value={version} onChange={setVersion} />
            <Button size="sm" onClick={runPicked} disabled={starting}>
              {starting ? <Loader2 className="animate-spin" /> : <Play />} 运行所选
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              <X /> 清除选择
            </Button>
            <span className="text-xs text-muted-foreground">部分用例的结果只用来看问题，不作为发布依据。</span>
          </div>
        )}
        <table className="w-full text-[13px]">
          <thead className="text-xs text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-normal [&>th]:whitespace-nowrap">
              {canRun && (
                <th className="w-8">
                  <Checkbox
                    aria-label="全选"
                    checked={allShown}
                    onCheckedChange={(v) => setPicked((p) => new Set(v ? [...p, ...shown.map((c) => c.id)] : [...p].filter((id) => !shown.some((c) => c.id === id))))}
                  />
                </th>
              )}
              <th className="w-20">编号</th>
              <th>标题</th>
              <th className="w-28">范围</th>
              <th className="w-32">验证</th>
              <th className="w-24">材料</th>
              <th>来源</th>
              <th className="w-28">稳定版得分</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={cn("border-t hover:bg-muted/30 [&>td]:px-3 [&>td]:py-2", picked.has(c.id) && "bg-blue-50/40 dark:bg-blue-950/20")}>
                {canRun && (
                  <td>
                    <Checkbox aria-label={`选择 ${c.id}`} checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, Boolean(v))} />
                  </td>
                )}
                <td className="font-mono">{c.id}</td>
                <td>
                  <button className="text-left hover:underline" onClick={() => edit(c)}>
                    {c.title}
                  </button>
                  {c.tags.map((t) => (
                    <Pill key={t} className="ml-1">
                      {t}
                    </Pill>
                  ))}
                  {c.oracle && <BadgeCheck className="ml-1 inline size-3.5 text-emerald-600" aria-label="有参考答案" />}
                  {(c.difficulty || c.capabilities.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                      {c.difficulty && (
                        <span className={cn("rounded px-1", c.difficulty === "hard" ? "bg-red-50 text-red-700" : c.difficulty === "medium" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")} title={c.why ?? undefined}>
                          {DIFFICULTY_LABEL[c.difficulty]}
                        </span>
                      )}
                      {c.capabilities.map((k) => (
                        <span key={k} className="rounded bg-sky-50 px-1 text-sky-800" title={data.capabilities[k]}>
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.scope && Object.keys(c.scope).length > 0 && <div className="text-xs text-muted-foreground">{Object.entries(c.scope).map(([k, v]) => `${k}=${v}`).join(" ")}</div>}
                </td>
                <td>
                  <SplitBadge split={c.split} locked={c.locked} />
                </td>
                <td className="text-xs">{validatorLabel(c)}</td>
                <td className="text-xs">
                  {c.materials.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={c.materials.some((m) => !m.exists) ? "text-red-700" : ""} title={c.materials.map((m) => m.path).join("\n")}>
                      {c.materials.length} 个{c.materials.some((m) => !m.exists) && "（有缺失）"}
                    </span>
                  )}
                </td>
                <td className="max-w-64 truncate text-xs text-muted-foreground" title={c.source}>
                  {c.source}
                </td>
                <td>{c.stable ? <span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", tone(c.stable.score))}>{pct(c.stable.score)}</span> : <span className="text-xs text-muted-foreground">未评</span>}</td>
                <td className="text-right">
                  {canManage && (
                    <>
                      <Button size="icon" variant="ghost" className="size-7" title="修改" onClick={() => edit(c)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive" title={c.locked ? "在契约的留出集名单里，不能删" : "删除"} disabled={c.locked} onClick={() => remove(c)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.cases.length === 0 && <p className="p-6 text-muted-foreground">还没有用例。用例来自真实业务样本：从已确认的单据生成最省事。</p>}
      </Section>

      <CaseEditor app={app} view={data} draft={draft} onClose={() => setDraft(null)} onSaved={(v) => (setData(v), setDraft(null))} readOnly={!canManage} />
      <FromTaskDialog app={app} open={fromTask} onOpenChange={setFromTask} onDraft={(d) => (setFromTask(false), setDraft(d))} />
    </div>
  );
}

function CaseEditor({ app, view, draft, onClose, onSaved, readOnly }: { app: AppSummary; view: CasesView; draft: Draft | null; onClose: () => void; onSaved: (v: CasesView) => void; readOnly: boolean }) {
  const hasExpect = view.hasExpect;
  const row = draft && !draft.isNew ? view.cases.find((c) => c.id === draft.id) : undefined;
  const [d, setD] = useState<Draft | null>(draft);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Material[]>([]);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setD(draft);
    setUploads([]);
  }, [draft]);
  if (!d) return null;
  const parse = (text: string) => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  };
  const input = parse(d.input);
  const rulesOnly = d.validator === null;
  const expected = rulesOnly && !d.expected.trim() ? { ok: true as const, value: null as unknown } : parse(d.expected);
  const rules = parse(d.rules.trim() || "[]");
  const rulesOk = rules.ok && Array.isArray(rules.value);
  const lacksCheck = rulesOk && (rules.value as unknown[]).length === 0 && (expected.value === null || rulesOnly);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const m = await api<Material>(`/api/apps/${app.name}/uploads?name=${encodeURIComponent(f.name)}`, { raw: f });
        setUploads((x) => [...x, m]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  async function save() {
    if (!d || !input.ok || !expected.ok || !rulesOk) return;
    setBusy(true);
    try {
      const tags = d.tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
      const body = {
        id: d.id.trim(),
        title: d.title,
        split: d.split,
        source: d.source,
        input: input.value,
        expected: expected.value,
        rules: rules.value,
        validator: d.validator,
        tags,
        difficulty: d.difficulty,
        why: d.why,
        capabilities: splitList(d.capabilities),
        ...(d.oracle ? { oracle: d.oracle } : {}),
        note: d.note,
      };
      const v = d.isNew ? await api<CasesView>(`/api/apps/${app.name}/bench/cases`, { body }) : await api<CasesView>(`/api/apps/${app.name}/bench/cases/${d.id}`, { method: "PUT", body });
      toast.success(`已保存用例 ${d.id}，评测集更新为 ${v.evalset}`, { description: "已有的评测结果会标记为“评测集已更新”，重评后才能和新期望值对比。" });
      onSaved(v);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[94svh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{d.isNew ? "新增用例" : `用例 ${d.id}`}</DialogTitle>
          <DialogDescription>
            一个用例一个文件夹（{view.dir}/{d.id || "编号"}/）：输入交给应用运行，期望结果交给验证程序比对，验证规则逐条检查。期望值必须来自真实业务、由人确认。{d.via && <b className="ml-1">期望值来源：{d.via}</b>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 overflow-auto">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
            <div className="grid gap-1.5">
              <Label>编号</Label>
              <Input value={d.id} disabled={!d.isNew || readOnly} onChange={(e) => setD({ ...d, id: e.target.value })} placeholder="如 C12" className="font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label>标题：这个用例在测什么</Label>
              <Input value={d.title} disabled={readOnly} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="如：多发票合并、币种为欧元" />
            </div>
            <div className="grid gap-1.5">
              <Label>放在</Label>
              <RadioGroup value={d.split} onValueChange={(v) => setD({ ...d, split: v as Draft["split"] })} className="flex h-9 items-center gap-4" disabled={readOnly || d.locked}>
                <label className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="dev" /> 开发集
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="holdout" /> 留出集 {d.locked && <Lock className="size-3" />}
                </label>
              </RadioGroup>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px_260px]">
            <div className="grid gap-1.5">
              <Label>来源：样本从哪里来</Label>
              <Input value={d.source} disabled={readOnly} onChange={(e) => setD({ ...d, source: e.target.value })} placeholder="如：2026-08 单据 T-120，张三确认" />
            </div>
            <div className="grid gap-1.5">
              <Label>标签（逗号分隔）</Label>
              <Input value={d.tags} disabled={readOnly} onChange={(e) => setD({ ...d, tags: e.target.value })} placeholder="如 smoke, 多币种" />
            </div>
            <div className="grid gap-1.5">
              <Label>验证程序</Label>
              <Select value={d.validator ?? RULES_ONLY} disabled={readOnly} onValueChange={(v) => setD({ ...d, validator: v === RULES_ONLY ? null : v })}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {view.validators.map((v) => (
                    <SelectItem key={v.name} value={v.name}>
                      {v.title}
                    </SelectItem>
                  ))}
                  <SelectItem value={RULES_ONLY}>不用验证程序，只用规则</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr_1fr]">
            <div className="grid gap-1.5">
              <Label>难度</Label>
              <Select value={d.difficulty ?? NO_DIFFICULTY} disabled={readOnly} onValueChange={(v) => setD({ ...d, difficulty: v === NO_DIFFICULTY ? null : (v as Difficulty) })}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DIFFICULTY}>未标</SelectItem>
                  <SelectItem value="easy">易</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="hard">难</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>难在哪里</Label>
              <Input value={d.why} disabled={readOnly} onChange={(e) => setD({ ...d, why: e.target.value })} placeholder="如：三张发票同 HS，毛重要跨单据核对" />
            </div>
            <div className="grid gap-1.5">
              <Label>考什么能力（逗号分隔）</Label>
              <Input value={d.capabilities} disabled={readOnly} onChange={(e) => setD({ ...d, capabilities: e.target.value })} placeholder={Object.keys(view.capabilities).slice(0, 3).join(", ") || "在 eval.json 的 capabilities 里定义词表"} />
              {!readOnly && Object.keys(view.capabilities).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(view.capabilities).map(([k, title]) => {
                    const on = splitList(d.capabilities).includes(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        title={title}
                        onClick={() => setD({ ...d, capabilities: (on ? splitList(d.capabilities).filter((x) => x !== k) : [...splitList(d.capabilities), k]).join(", ") })}
                        className={cn("rounded border px-1.5 text-[11px]", on ? "border-sky-300 bg-sky-50 text-sky-800" : "text-muted-foreground hover:bg-muted")}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <OracleLine row={row} draft={d} />
          <div className="grid min-h-[420px] gap-3 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label>输入</Label>
                {!input.ok && <span className="text-xs text-destructive">JSON 有误：{input.error}</span>}
                {!readOnly && (
                  <>
                    <input ref={file} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
                    <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => file.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />} 上传材料
                    </Button>
                  </>
                )}
              </div>
              {uploads.length > 0 && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
                  <div className="text-muted-foreground">把路径填进输入里引用材料；保存时会复制进这个用例的文件夹（{view.dir}/{d.id || "编号"}/input/）。</div>
                  {uploads.map((m) => (
                    <div key={m.path} className="flex items-center gap-2">
                      <a className="truncate underline" href={`/files/${encodePath(m.path)}`} target="_blank" rel="noreferrer">
                        {m.name}
                      </a>
                      <span className="text-muted-foreground">{formatBytes(m.size)}</span>
                      <button className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => (navigator.clipboard.writeText(m.path), toast.success("已复制路径"))}>
                        <ClipboardCopy className="size-3" /> 复制路径
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <CodeEditor path={`${d.id || "new"}/input.json`} scope="case" value={d.input} readOnly={readOnly} onChange={(v) => setD({ ...d, input: v })} />
              </div>
            </div>
            <div className="flex min-h-0 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label>期望结果{rulesOnly && <span className="ml-1 font-normal text-muted-foreground">（只用规则时可以留空）</span>}</Label>
                {!expected.ok && <span className="text-xs text-destructive">JSON 有误：{expected.error}</span>}
                {row?.expectedFile && <span className="text-xs text-muted-foreground">保存在 {row.expectedFile}</span>}
                {hasExpect && <span className="ml-auto text-xs text-muted-foreground">格式见 evals/expect.ts</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                <CodeEditor path={`${d.id || "new"}/expected.json`} scope="case" value={d.expected} readOnly={readOnly} onChange={(v) => setD({ ...d, expected: v })} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Label>验证规则</Label>
              {!rulesOk && <span className="text-xs text-destructive">{rules.ok ? "规则要写成数组" : `JSON 有误：${rules.error}`}</span>}
              {lacksCheck && <span className="text-xs text-destructive">需要期望结果或至少一条规则</span>}
              <span className="ml-auto min-w-0 text-xs text-muted-foreground">
                op：equals、number（tolerance / relative）、oneOf、contains、matches、count、present、absent；路径如 output.total、output.rows[0].price
              </span>
              {!readOnly && d.rules.trim() === "[]" && (
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setD({ ...d, rules: RULE_EXAMPLE })}>
                  插入示例
                </Button>
              )}
            </div>
            <div className="h-40 overflow-hidden rounded-md border">
              <CodeEditor path={`${d.id || "new"}/rules.json`} scope="case" value={d.rules} readOnly={readOnly} onChange={(v) => setD({ ...d, rules: v })} />
            </div>
          </div>
          {row && <CaseFolder app={app.name} dir={view.dir} row={row} />}
          {!readOnly && (
            <div className="grid gap-1.5">
              <Label>改动说明（记在评测集快照上）</Label>
              <Input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder={d.isNew ? "如：补充多币种样本" : "如：毛重以提单为准，修正期望值"} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {readOnly ? "关闭" : "取消"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={busy || !input.ok || !expected.ok || !rulesOk || lacksCheck || !d.id.trim() || !d.title.trim()}>
              {busy && <Loader2 className="animate-spin" />} 保存用例
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FromTaskDialog({ app, open, onOpenChange, onDraft }: { app: AppSummary; open: boolean; onOpenChange: (v: boolean) => void; onDraft: (d: Draft) => void }) {
  const { data: tasks } = useApi<Task[]>(open ? `/api/apps/${app.name}/tasks` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const confirmed = (tasks ?? []).filter((t) => t.confirmed);
  async function pick(t: Task) {
    setBusy(t.id);
    try {
      const d = await api<{ id: string; title: string; input: unknown; expected: unknown; oracle: Oracle; source: string; via: string }>(`/api/apps/${app.name}/bench/draft`, { body: { task: t.id } });
      onDraft({ ...blankDraft(), id: d.id, title: d.title, source: d.source, input: pretty(d.input), expected: pretty(d.expected), oracle: d.oracle, note: `从单据 ${t.id} 生成`, via: d.via });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>从真实单据生成用例</DialogTitle>
          <DialogDescription>选一张人工确认过的单据：输入原样作为用例输入，确认后的结果作为期望值，同时整份存为参考答案（裁判必须给它满分）；上传的材料会复制进评测集。生成后可以再检查、修改再保存。</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50svh] divide-y overflow-auto rounded-md border">
          {!tasks && <Loading />}
          {confirmed.map((t) => (
            <button key={t.id} disabled={busy !== null} onClick={() => pick(t)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50">
              <code className="text-xs text-muted-foreground">{t.id}</code>
              <span className="flex-1 truncate">{t.title}</span>
              {t.corrections.length > 0 && <Pill>修正 {t.corrections.length} 处</Pill>}
              <span className="text-xs text-muted-foreground">
                {t.confirmed!.by} 确认 · {fmtTime(t.confirmed!.at)}
              </span>
              {busy === t.id && <Loader2 className="size-4 animate-spin" />}
            </button>
          ))}
          {tasks && confirmed.length === 0 && <p className="p-4 text-sm text-muted-foreground">还没有人工确认过的单据。先在应用里办理并确认几单。</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What the case folder holds, and how the case did in every run. */
function CaseFolder({ app, dir, row }: { app: string; dir: string; row: EvalCaseRow }) {
  const { data: history } = useApi<CaseHistoryRow[]>(`/api/apps/${app}/bench/cases/${row.id}/history`);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-md border">
        <div className="border-b px-3 py-1.5 text-sm font-medium">
          用例文件夹 <span className="font-mono text-xs font-normal text-muted-foreground">{dir}/{row.id}/</span>
        </div>
        <div className="max-h-48 divide-y overflow-auto text-xs">
          {row.files.map((f) => (
            <a key={f} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/40" href={`/api/apps/${app}/bench/raw?path=${encodeURIComponent(`${dir}/${row.id}/${f}`)}`} target="_blank" rel="noreferrer">
              <span className="truncate font-mono">{f}</span>
            </a>
          ))}
        </div>
      </div>
      <div className="rounded-md border">
        <div className="border-b px-3 py-1.5 text-sm font-medium">历次结果</div>
        <div className="max-h-48 divide-y overflow-auto text-xs">
          {!history && <Loading />}
          {history?.length === 0 && <p className="px-3 py-2 text-muted-foreground">还没有评测过。</p>}
          {history?.map((h) => (
            <a key={h.run} href={`?tab=results&version=${h.version}`} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/40">
              <span className="w-12 font-mono text-muted-foreground">{h.run}</span>
              <span className="w-16 font-mono">{h.version}</span>
              {h.error || h.invalid ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600" title={h.error ?? h.invalid ?? undefined}>
                  {h.error ? "出错" : "无效"}
                </span>
              ) : (
                <span className={cn("rounded px-1.5 py-0.5 tabular-nums", tone(h.score))}>{pct(h.score)}</span>
              )}
              <span className="text-muted-foreground">
                {h.error ? "执行出错，不计分" : h.invalid ? "参考答案没得满分" : h.failed > 0 ? `${h.failed} 项不符` : "全部通过"}
                {h.violations > 0 && ` · 违反 ${h.violations} 条`}
                {h.passRate !== null && ` · ${h.trials} 次里通过 ${pct(h.passRate)}`}
                {h.ablate && ` · ${ABLATION_LABEL[h.ablate]}`}
              </span>
              <span className="ml-auto text-muted-foreground">
                评测集 {h.evalset ?? "—"} · {fmtTime(h.at)}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function OracleLine({ row, draft }: { row?: EvalCaseRow; draft: Draft }) {
  if (draft.oracle) return <p className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs text-emerald-800">保存时会把确认后的整份结果存为参考答案（expected/oracle.json）：以后裁判必须给它满分，否则这个用例判为无效、不参与评测。</p>;
  if (!row) return null;
  if (!row.oracle)
    return <p className="rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground">没有参考答案：无法证明期望值和裁判对正确答案给满分。从已确认的单据生成用例，或在 AI 编码里确认运行结果，会自动带上参考答案。</p>;
  const from = row.oracle.provenance && typeof row.oracle.provenance === "object" ? (row.oracle.provenance as Record<string, unknown>) : null;
  return (
    <p className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs text-emerald-800">
      <BadgeCheck className="mr-1 inline size-3.5" />
      参考答案：{row.oracle.file ?? "写在 case.json 里"}（状态 {row.oracle.status}）
      {from && <span className="text-emerald-700">。出处：{String(from.statement ?? from.kind ?? "")}{from.by ? `，${String(from.by)} 确认` : ""}</span>}
    </p>
  );
}

/** The case check: reference runs, materials, provenance and metadata, and which capabilities have cases. */
function AuditPanel({ app, evalset, onOpen }: { app: string; evalset: string | null; onOpen: (id: string) => void }) {
  const { data, error, reload } = useApi<EvalAudit>(`/api/apps/${app}/bench/audit`);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (data && data.evalset !== evalset) reload();
  }, [data, evalset, reload]);
  if (error) return <Failure error={error} />;
  if (!data) return null;
  const problems = data.cases.filter((c) => c.problems.length).length + data.problems.length;
  const warned = data.cases.filter((c) => c.warnings.length).length;
  const oracles = data.cases.filter((c) => c.oracle?.ok).length;
  const empty = data.coverage.filter((c) => c.cases.length === 0);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Stethoscope className="size-4" /> 用例体检
          <span className="text-xs font-normal text-muted-foreground">
            {problems ? <b className="text-red-700">{problems} 个用例有问题</b> : "没有问题"} · {warned} 个有提醒 · 参考答案得满分 {oracles}/{data.cases.length} · 能力 {data.coverage.length - empty.length}/{data.coverage.length} 有用例
          </span>
        </span>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "收起" : "展开"}
        </Button>
      }
    >
      {open && (
        <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            {[...data.problems.map((p) => ({ id: null, text: p, bad: true })), ...data.warnings.map((p) => ({ id: null, text: p, bad: false }))].map((x, i) => (
              <p key={i} className={cn("text-xs", x.bad ? "text-red-700" : "text-amber-700")}>
                {x.text}
              </p>
            ))}
            <div className="divide-y rounded-md border text-xs">
              {data.cases.map((c) => (
                <button key={c.id} onClick={() => onOpen(c.id)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/40">
                  <span className="w-14 shrink-0 font-mono">{c.id}</span>
                  <span className="w-16 shrink-0">
                    {c.oracle ? (
                      c.oracle.ok ? (
                        <span className="text-emerald-700">参考 ✓</span>
                      ) : (
                        <span className="text-red-700">参考 {pct(c.oracle.score)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground">无参考</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    {c.problems.map((p) => (
                      <span key={p} className="block text-red-700">
                        {p}
                      </span>
                    ))}
                    {c.warnings.map((p) => (
                      <span key={p} className="block text-amber-700">
                        {p}
                      </span>
                    ))}
                    {c.problems.length === 0 && c.warnings.length === 0 && <span className="text-muted-foreground">没问题</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border">
            <div className="border-b px-3 py-1.5 text-sm font-medium">
              能力覆盖
              <span className="ml-2 text-xs font-normal text-muted-foreground">{data.scoredBy ? `得分取自稳定版 ${data.scoredBy.version} 的完整评测 ${data.scoredBy.run}` : "稳定版还没有完整评测"}</span>
            </div>
            {data.coverage.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">还没有定义能力。在 eval.json 里写 capabilities（能力 → 含义），用例的 capabilities 引用它们，这里就能看出哪些能力没有用例。</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {data.coverage.map((c) => (
                    <tr key={c.capability} className="border-t first:border-t-0 [&>td]:px-3 [&>td]:py-1 [&>td]:align-top">
                      <td className="w-40">
                        <div className="font-medium">{c.capability}</div>
                        {c.title && <div className="text-muted-foreground">{c.title}</div>}
                      </td>
                      <td>{c.cases.length ? c.cases.join("、") : <span className="text-red-700">没有用例</span>}</td>
                      <td className="w-20 text-right tabular-nums">{c.score === null ? <span className="text-muted-foreground">—</span> : <span className={cn("rounded px-1.5 py-0.5", tone(c.score))}>{`${c.passed}/${c.scored}`}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
