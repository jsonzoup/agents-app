"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Square,
  Check,
  ChevronDown,
  CornerDownLeft,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { DocViewer, type DocTarget } from "@/components/docs/viewer";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DshToolHistory, ToolRow } from "@/components/copilot/tool-row";
import { FilePreview } from "@/components/copilot/file-preview";
import { TurnActions, TurnLive, liveTurnStart, turnClosings } from "@/components/copilot/turn-status";
import { FileTypeIcon } from "../../../../deepseek-harness/packages/client/ui-primitives/src/FileTypeIcon.tsx";
import { CompactionRow, ContextBar } from "@/components/copilot/context-bar";
import { SkillPanel } from "@/components/copilot/skill-panel";
import { api, type DshModelGroup, type SessionItem, type SkillInfo } from "@/lib/api";
import { DEFAULT_MODEL, modelSelection } from "@/lib/dsh/route";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MCP_SERVER } from "@/lib/mcp/meta";

import type { AskQuestion, Message, Task } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

interface RightPanelProps {
  task: Task | null;
  sessions: SessionItem[];
  tab: "chat" | "docs" | "skill";
  onTab: (tab: "chat" | "docs" | "skill") => void;
  docTarget: DocTarget | null;
  onDocTarget: (target: DocTarget | null) => void;
  sourceField: string | null;
  onCloseSource: () => void;
  onOpenTask: (id: string) => void;
  onTaskUpdate: (task: Task) => void;
  selectedField?: string | null;
  readOnly?: boolean;
  width?: number;
}


export function RightPanel(props: RightPanelProps) {
  const {
    task, sessions, tab, onTab, docTarget, onDocTarget, sourceField, onCloseSource,
    onOpenTask, onTaskUpdate, selectedField, readOnly, width = 420,
  } = props;
  const [collapsed, setCollapsed] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [sessionOpen, setSessionOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [skill, setSkill] = React.useState<SkillInfo | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setMounted(true);
    api.skill().then((data) => setSkill(data.skill)).catch(() => undefined);
  }, []);
  React.useEffect(() => { setPreviewPath(null); }, [task?.id]);

  const [atBottom, setAtBottom] = React.useState(true);
  const [pending, setPending] = React.useState<Message[]>([]);
  React.useEffect(() => {
    if (atBottom && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [task?.messages.length, pending.length, sending, atBottom]);
  const abortRef = React.useRef<AbortController | null>(null);

  const [stopping, setStopping] = React.useState(false);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [localContext, setLocalContext] = React.useState<Task["context"]>(undefined);
  const epochRef = React.useRef(0);
  const [model, setModel] = React.useState(DEFAULT_MODEL);
  const [modelGroups, setModelGroups] = React.useState<DshModelGroup[] | null>(null);
  const pickedModel = React.useRef<string | null>(null);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("bgl-model");
    if (saved) setModel(modelSelection(saved));
  }, []);

  React.useEffect(() => {
    pickedModel.current = null;
  }, [task?.id]);

  React.useEffect(() => {
    if (!task?.model) return;
    const stored = modelSelection(task.model);
    if (pickedModel.current && pickedModel.current !== stored) return;
    pickedModel.current = null;
    setModel(stored);
  }, [task?.id, task?.model]);

  React.useEffect(() => {
    epochRef.current = task?.sessionEpoch ?? 0;
    setLocalContext(undefined);
    setConfirmClear(false);
  }, [task?.id, task?.sessionEpoch, task?.context?.updatedAt]);

  React.useEffect(() => {
    let cancelled = false;
    api.models().then((data) => { if (!cancelled) setModelGroups(data.groups); }).catch(() => { if (!cancelled) setModelGroups([]); });
    return () => { cancelled = true; };
  }, []);

  const knownModels = React.useMemo(
    () => new Set((modelGroups ?? []).flatMap((group) => group.models.map((item) => `${group.id}/${item.id}`))),
    [modelGroups],
  );
  const modelValue = knownModels.size === 0 || knownModels.has(model) ? model : (knownModels.has(DEFAULT_MODEL) ? DEFAULT_MODEL : [...knownModels][0]);
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    abortRef.current?.abort();
    if (task) await api.stopTask(task.id).catch(() => undefined);
  };

  const clearSession = async () => {
    if (!task || clearing) return;
    setClearing(true);
    abortRef.current?.abort();
    try {
      const result = await api.clearSession(task.id);
      epochRef.current = result.task.sessionEpoch ?? epochRef.current;
      setPending([]);
      setLocalContext(undefined);
      onTaskUpdate(result.task);
      toast.success("会话已清空");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  };


  const running = sending || Boolean(task && (task.status === "处理中" || (task.progress && task.progress.pct > 0 && task.progress.pct < 100)));
  const live = sending || task?.status === "处理中";
  const transcript = [...(task?.messages ?? []), ...pending];
  const closings = turnClosings(transcript, live);

  React.useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);

  const send = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!task || !content || sending) return;
    setSending(true);
    setDraft("");
    setPending([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/tasks/${task.id}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content, selected: selectedField, model: modelValue }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("对话流式请求失败");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          if (message.type === "event") {
            if (message.context) {
              setLocalContext((prev) => ({
                ...(prev ?? task?.context ?? {}),
                ...Object.fromEntries(Object.entries(message.context).filter(([, value]) => value !== undefined && value !== null)),
                imageOffloads: (prev?.imageOffloads ?? task?.context?.imageOffloads ?? 0) + (message.context.imageOffloadDelta ?? 0),
              }));
            }
            if (message.kind !== "context" && message.kind !== "usage") setPending((prev) => appendLive(prev, message));
          }
          if (message.type === "done") {
            if ((message.task?.sessionEpoch ?? 0) >= epochRef.current) onTaskUpdate(message.task);
          }
          if (message.type === "error") throw new Error(message.message);
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
    } finally {
      abortRef.current = null;
      setSending(false);
      setPending([]);
    }
  };

  const answer = async (askId: string, answers: Record<string, string>) => {
    if (!task) return;
    try {
      const result = await api.answerAsk(task.id, askId, answers);
      onTaskUpdate(result.task);
      toast.success("已记录你的选择");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const locate = (target: DocTarget) => {
    onDocTarget(target);
    onTab("docs");
  };

  const reopenTab =
    collapsed && mounted
      ? createPortal(
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="展开 Copilot"
            title="展开 Copilot"
            className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-xl border border-r-0 border-[#E4E0D8] bg-white py-3 pl-1.5 pr-1.5 text-[#344054] shadow-[0_8px_28px_rgba(15,23,42,0.16)] transition-colors hover:bg-[#FBFAF7]"
          >
            <Sparkles className="size-4 text-[#1E3A5F]" />
            <span className="text-[10.5px] tracking-[0.18em]" style={{ writingMode: "vertical-rl" }}>
              Copilot
            </span>
            <PanelRightOpen className="size-3.5 text-[#8C8F94]" />
          </button>,
          document.body,
        )
      : null;

  return (
    <>
      {reopenTab}
      <aside
      className={cn(
        "flex flex-none flex-col border-l border-border/80 bg-white",
        collapsed ? "w-0 overflow-hidden border-l-0" : "",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <Tabs value={tab} onValueChange={(value) => onTab(value as RightPanelProps["tab"])} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-[52px] flex-none items-center gap-1 px-3">
          <TabsList>
            <TabsTrigger value="chat" className="gap-1.5 data-[state=active]:bg-[#EDF2F8]">
              <Sparkles className="size-3.5" /> Copilot
            </TabsTrigger>
            <TabsTrigger value="docs">资料</TabsTrigger>
            <TabsTrigger value="skill">技能</TabsTrigger>
          </TabsList>
          <button
            className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
          </button>
        </div>

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex-none bg-white/70">
            <div className="flex items-center">
            <button
              className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-[#F8F6F2]"
              onClick={() => setSessionOpen((prev) => !prev)}
            >
              <span className="size-1.5 rounded-full bg-[#4F9A78]" />
              <span className="text-[10.5px] text-muted-foreground">会话</span>
              <strong className="max-w-[140px] truncate text-[12px] font-medium">{task ? task.id : "新会话"}</strong>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{task?.dshSessionId || "一票一个会话"}</span>
              <ChevronDown className="ml-auto size-3 shrink-0 text-[#8C8F94]" />
            </button>
            {task && <ContextBar context={localContext ?? task.context} compactions={task.messages.filter((message) => message.kind === "compaction")} />}
            {task && (
              confirmClear ? (
                <span className="flex flex-none items-center gap-1 pr-3">
                  <button
                    type="button"
                    disabled={clearing}
                    onClick={() => void clearSession()}
                    className="rounded-full bg-[#9F2D24] px-2 py-0.5 text-[10.5px] text-white disabled:opacity-60"
                  >
                    {clearing ? "清空中" : "确认清空"}
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)} className="rounded-full px-2 py-0.5 text-[10.5px] text-[#8C8F94] hover:bg-[#F4F2ED]">
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="mr-3 flex-none rounded-full px-2 py-0.5 text-[10.5px] text-[#8C8F94] hover:bg-[#F4F2ED] hover:text-[#9F2D24]"
                >
                  清空会话
                </button>
              )
            )}
            </div>
            {sessionOpen && (
              <div className="absolute left-2.5 right-2.5 top-10 z-30 max-h-[300px] overflow-auto rounded-xl border bg-white p-1.5 shadow-xl">
                {sessions.length === 0 && <div className="px-2 py-3 text-[12px] text-muted-foreground">暂无会话</div>}
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#F7F5F1]"
                    onClick={() => {
                      onOpenTask(session.id);
                      setSessionOpen(false);
                    }}
                  >
                    <strong className="text-[12px] font-medium">{session.id} · {session.customer}</strong>
                    <small className="line-clamp-1 text-[10.5px] text-muted-foreground">
                      {session.lastText || `${session.step} · ${formatTime(session.updatedAt)}`}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            ref={listRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
            }}
            className={cn("scroll-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-3 pt-4", previewPath && "hidden")}
          >
            <button onClick={() => onTab("skill")} className="dsh-skill flex w-full items-start gap-2.5 text-left transition-shadow hover:shadow-sm">
              <span className="mt-0.5 grid size-7 flex-none place-items-center rounded-lg bg-[#1E3A5F] text-white">
                <Sparkles className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1A1D21]">
                  {skill?.name ?? "customs-extraction"}
                  <span className="rounded bg-white px-1.5 py-0.5 text-[9.5px] font-medium text-[#16294A] ring-1 ring-[#D8E1EC]">v{skill?.version ?? "1.0.0"}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-[#4F9A78]">
                    <Check className="size-3" /> home
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] text-[#6B6F76]">
                  {skill ? `${skill.root} · ${skill.references.length} 篇规则 · MCP ${MCP_SERVER.name}` : "正在读取技能…"}
                </span>
              </span>
            </button>

            {!task && <WelcomeMessages sessions={sessions} onOpen={onOpenTask} />}

            <DshToolHistory messages={[...(task?.messages ?? []), ...pending]}>
            {task && (task.sessionEpoch ?? 0) > 0 && task.messages.length === 0 && pending.length === 0 && (
              <div className="dsh-assistant">
                <p className="dsh-prose">这一票的对话已清空。发送消息会开始新的会话，草单和资料仍保留。</p>
              </div>
            )}
            {task?.messages.map((message) => {
              const body = message.kind === "compaction" ? <CompactionRow message={message} />
                : message.kind === "tool" ? (message.tool ? <ToolRow callId={message.id} tool={message.tool} onOpenFile={setPreviewPath} /> : null)
                : message.kind === "ask" ? (
                  <AskCard message={message} readOnly={readOnly} onAnswer={(answers) => message.askId && answer(message.askId, answers)} />
                ) : (
                  <MessageBubble message={message} taskId={task.id} onOpenFile={setPreviewPath} onCite={(doc, page, region) => locate({ docId: doc, page, region })} />
                );
              const closing = closings.get(message.id);
              return (
                <React.Fragment key={message.id}>
                  {body}
                  {closing && <TurnActions text={closing.text} start={closing.start} end={closing.end} />}
                </React.Fragment>
              );
            })}
            {pending.map((message) => {
              const body = message.kind === "compaction" ? <CompactionRow message={message} />
                : message.kind === "tool" ? (message.tool ? <ToolRow callId={message.id} tool={message.tool} onOpenFile={setPreviewPath} /> : null)
                : (
                  <MessageBubble message={message} taskId={task?.id} onOpenFile={setPreviewPath} onCite={() => undefined} />
                );
              const closing = closings.get(message.id);
              return (
                <React.Fragment key={message.id}>
                  {body}
                  {closing && <TurnActions text={closing.text} start={closing.start} end={closing.end} />}
                </React.Fragment>
              );
            })}
            {live && <TurnLive startedAt={liveTurnStart(transcript)} />}
            </DshToolHistory>

          </div>

          {previewPath && task && <FilePreview taskId={task.id} path={previewPath} onClose={() => setPreviewPath(null)} />}

          <div className="flex-none px-3 pb-3">
            <div className="rounded-[22px] border border-[#E4E0D8] bg-white px-3 pb-1.5 pt-2 shadow-[0_6px_24px_rgba(26,29,33,0.08)] transition-colors focus-within:border-[#C8A45C]">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={2}
                disabled={!task || readOnly}
                placeholder={task ? "继续追问这一票" : "上传资料并开始制单后，可与 Copilot 对话"}
                className="max-h-40 w-full resize-none border-0 bg-transparent px-1.5 py-1 text-[13.5px] leading-6 outline-none placeholder:text-[#8C8F94]"
              />
              <div className="mt-1 flex items-center gap-1.5 px-0.5 pb-0.5">
                <select
                  value={modelValue}
                  onChange={(event) => {
                    const next = event.target.value;
                    pickedModel.current = next;
                    setModel(next);
                    window.localStorage.setItem("bgl-model", next);
                    if (task) void api.setModel(task.id, next);
                  }}
                  className="h-6 max-w-[11rem] flex-none rounded-md border border-[#E4E0D8] bg-white px-1 text-[10px] text-[#4A4F57] outline-none"
                  aria-label="选择模型"
                >
                  {modelGroups === null ? <option value={modelValue}>加载模型…</option> : modelGroups.map((group) => (
                    <optgroup key={group.id} label={group.name}>
                      {group.models.map((item) => {
                        const value = `${group.id}/${item.id}`;
                        return <option key={value} value={value}>{item.name}</option>;
                      })}
                    </optgroup>
                  ))}
                </select>
                <span className="ml-auto flex-none text-[9.5px] text-[#8C8F94]">Enter 发送</span>
                {running ? (
                  <button
                    onClick={stop}
                    disabled={stopping}
                    className="flex h-7 flex-none items-center gap-1 rounded-full bg-[#9F2D24] px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-[#7f241c] disabled:bg-[#D8A9A2]"
                    aria-label={stopping ? "暂停中" : "暂停"}
                    title={stopping ? "暂停中" : "暂停"}
                  >
                    {stopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-2.5 fill-current" />}
                    {stopping ? "暂停中" : "暂停"}
                  </button>
                ) : (
                  <button
                    onClick={() => send()}
                    disabled={!task || readOnly || !draft.trim()}
                    className="grid size-7 flex-none place-items-center rounded-full bg-[#1E3A5F] text-white transition-colors hover:bg-[#16294A] disabled:bg-[#C6D3E2]"
                    aria-label="发送"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
          </div>
        </TabsContent>

        <TabsContent value="docs" className="flex min-h-0 flex-1 flex-col">
          {task ? (
            <DocViewer task={task} target={docTarget} onTarget={onDocTarget} sourceField={sourceField} onCloseSource={onCloseSource} readOnly={readOnly} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12px] text-muted-foreground">
              <PanelRightOpen className="size-6 opacity-40" />
              发起制单后，可在这里按字段定位到资料原件页。
            </div>
          )}
        </TabsContent>

        <TabsContent value="skill" className="flex min-h-0 flex-1 flex-col">
          <SkillPanel task={task} />
        </TabsContent>
      </Tabs>
      </aside>
    </>
  );
}

function appendLive(prev: Message[], event: { kind?: string; text?: string; name?: string; id?: string; args?: string; isError?: boolean; compaction?: Message["compaction"] }): Message[] {
  const next = [...prev];
  if (event.kind === "compaction" && event.compaction) {
    const info = event.compaction;
    const messageId = info.mode === "prune" ? `cmp-prune-${info.id}` : `cmp-${info.id}`;
    const index = next.findIndex((message) => message.id === messageId);
    const row: Message = {
      id: messageId,
      role: "agent",
      kind: "compaction",
      text: "",
      at: "",
      compaction: { ...(index >= 0 ? next[index].compaction : {}), ...info },
    };
    if (index >= 0) next[index] = row;
    else next.push(row);
    return next;
  }
  if (event.kind === "tool/call") {
    next.push({
      id: event.id || `live-${next.length}`,
      role: "agent",
      kind: "tool",
      text: "",
      at: "",
      tool: { name: event.name || "tool", title: event.name || "工具", status: "running", args: event.args },
    });
    return next;
  }
  if (event.kind === "tool/result") {
    const index = event.id ? next.findIndex((message) => message.id === event.id) : next.findLastIndex((message) => message.tool?.status === "running");
    const target = index >= 0 ? next[index] : undefined;
    if (target?.tool) {
      next[index] = { ...target, tool: { ...target.tool, status: event.isError ? "error" : "done", output: event.text || "（无输出）", name: event.name || target.tool.name } };
    }
    return next;
  }
  const text = event.text?.trim();
  if (!text) return next;
  const last = next[next.length - 1];
  if (last?.kind === "text" && last.role === "agent" && text.startsWith(last.text)) {
    next[next.length - 1] = { ...last, text };
    return next;
  }
  next.push({ id: `live-text-${next.length}`, role: "agent", kind: "text", text, at: "" });
  return next;
}

function WelcomeMessages({ sessions, onOpen }: { sessions: SessionItem[]; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="dsh-assistant">
        <p className="dsh-prose">
          你好，我是报关灵 Copilot。先上传合同、发票、装箱单、提运单与报关委托书，我会加载 customs-extraction 技能逐份识别并生成草单。
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["可上传哪些资料？", "上传后会发生什么？"].map((text) => (
          <span key={text} className="rounded-full border bg-white px-2 py-1 text-[10.5px] text-[#6B6F76]">{text}</span>
        ))}
      </div>
      {sessions.length > 0 && (
        <div className="rounded-xl border bg-white p-2.5">
          <div className="mb-1.5 px-1 text-[10.5px] text-[#8C8F94]">最近会话</div>
          {sessions.slice(0, 3).map((session) => (
            <button key={session.id} onClick={() => onOpen(session.id)} className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#F7F5F1]">
              <strong className="text-[12px] font-medium">{session.id} · {session.customer}</strong>
              <small className="line-clamp-1 text-[10.5px] text-muted-foreground">
                {session.lastText || `${session.step} · ${formatTime(session.updatedAt)}`}
              </small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const DOWNLOAD_FILE = /\.(xlsx|xls|docx|doc|zip|pptx)$/i;

function localFileHref(href: string | undefined): string | null {
  if (!href) return null;
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^(https?|mailto|javascript|data):/i.test(raw)) return null;
  try {
    return decodeURIComponent(raw.split("#")[0].split("?")[0]);
  } catch {
    return null;
  }
}

async function downloadWorkspaceFile(taskId: string, filePath: string) {
  const url = `/api/tasks/${encodeURIComponent(taskId)}/workspace?path=${encodeURIComponent(filePath)}&download=1`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("这个产物不在本票目录里");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filePath.split("/").filter(Boolean).pop() || "download";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function MessageBubble({ message, taskId, onOpenFile, onCite }: {
  message: Message;
  taskId?: string;
  onOpenFile: (path: string) => void;
  onCite: (docId: string, page: number, region?: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="dsh-user-row">
        <div className="dsh-bubble">{message.text}</div>
      </div>
    );
  }
  return (
    <div className="dsh-assistant">
      <div className="dsh-prose">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a({ href, children }) {
              const file = localFileHref(href);
              if (!file || !taskId) return <a href={href}>{children}</a>;
              return (
                <button
                  type="button"
                  className="artifact-link"
                  title={file}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    margin: "1px 2px 1px 0",
                    padding: "1px 8px 1px 4px",
                    border: "1px solid #D8E1EC",
                    borderRadius: 6,
                    background: "#F7F5F1",
                    color: "#16294A",
                    font: "inherit",
                    fontWeight: 500,
                    lineHeight: "22px",
                    cursor: "pointer",
                    verticalAlign: "baseline",
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = "#EDF2F8";
                    event.currentTarget.style.borderColor = "#C5D0DE";
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = "#F7F5F1";
                    event.currentTarget.style.borderColor = "#D8E1EC";
                  }}
                  onClick={() => {
                    if (DOWNLOAD_FILE.test(file)) {
                      void downloadWorkspaceFile(taskId, file).catch((error: unknown) => {
                        toast.error(error instanceof Error ? error.message : "这个产物打不开");
                      });
                      return;
                    }
                    onOpenFile(file);
                  }}
                >
                  <FileTypeIcon path={file} size={14} />
                  {children}
                </button>
              );
            },
          }}
        >{message.text}</Markdown>
      </div>
      {!!message.cites?.length && (
        <div className="flex flex-wrap gap-1.5">
          {message.cites.map((cite, index) => (
            <button
              key={`${cite.docId}-${cite.page}-${index}`}
              onClick={() => onCite(cite.docId, cite.page, cite.region)}
              className="rounded-md border border-[#D8E1EC] bg-[#F7F5F1] px-1.5 py-0.5 text-[10.5px] text-[#16294A] hover:bg-[#EDF2F8]"
            >
              {cite.docName} · 第{cite.page}页
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AskCard({ message, onAnswer, readOnly }: { message: Message; onAnswer: (answers: Record<string, string>) => void; readOnly?: boolean }) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const questions = message.questions ?? [];
  const complete = questions.every((question) => answers[question.id]);

  return (
    <div className="overflow-hidden rounded-xl border border-[#D8E1EC] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-1.5 border-b border-[#E4EAF2] bg-[#F7F5F1] px-3 py-2 text-[11px] font-medium text-[#16294A]">
        <Sparkles className="size-3.5" /> 需要你确认
        <span className="ml-auto text-[10px] font-normal text-[#6B6F76]">{questions.length} 项</span>
      </div>
      <div className="space-y-3.5 px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-[#4A4F57]">{message.text}</p>
        {questions.map((question: AskQuestion) => (
          <div key={question.id} className="space-y-1.5">
            <div className="text-[12px] font-medium text-[#1A1D21]">{question.label}</div>
            {question.hint && <div className="text-[10.5px] leading-relaxed text-[#6B6F76]">{question.hint}</div>}
            <RadioGroup
              value={answers[question.id] ?? message.selection?.[question.id] ?? ""}
              onValueChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))}
              disabled={message.answered || readOnly}
            >
              {question.options.map((option) => {
                const checked = (answers[question.id] ?? message.selection?.[question.id]) === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors hover:border-[#C6D3E2] hover:bg-[#f9fbff]",
                      checked && "border-[#8FA6C0] bg-[#F7F5F1]",
                    )}
                  >
                    <RadioGroupItem value={option.value} id={`${message.id}-${question.id}-${option.value}`} />
                    <span className="min-w-0">
                      <strong className="block text-[11.5px] font-medium">{option.label}</strong>
                      {option.desc && <small className="mt-0.5 block text-[10px] leading-snug text-[#6B6F76]">{option.desc}</small>}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </div>
        ))}
      </div>
      {message.answered ? (
        <div className="border-t border-[#E4EAF2] bg-[#f9fbff] px-3 py-2 text-[10.5px] text-[#6B6F76]">
          已提交：
          {questions.map((question) => {
            const value = message.selection?.[question.id];
            const option = question.options.find((item) => item.value === value);
            return option ? ` ${question.label} → ${option.label}` : "";
          })}
        </div>
      ) : (
        <div className="flex justify-end gap-2 px-3 pb-2.5">
          <Button size="sm" variant="primary" disabled={!complete || readOnly} onClick={() => onAnswer(answers)}>
            <CornerDownLeft className="size-3.5" /> 提交选择
          </Button>
        </div>
      )}
    </div>
  );
}
