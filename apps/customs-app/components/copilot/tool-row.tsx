"use client";

import * as React from "react";
import { zh } from "../../../../deepseek-harness/packages/client/ui-conversation/src/client/locales.ts";
import { GenericToolCard } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx";
import { TodoRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/todo-row.tsx";
import { BashRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx";
import { ReadRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx";
import { SearchRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx";
import { FileMutationRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/file-mutation-row.tsx";
import { WebRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/web-row.tsx";
import { AskQuestionRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/ask-question-row.tsx";
import { DetailsRow } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/toolviews/details-row.tsx";
import type { TodoHistory } from "../../../../deepseek-harness/packages/client/ui-tool/src/client/tool/models/todo-history.ts";
import type { ToolCallBlock } from "../../../../deepseek-harness/packages/client/ui-conversation/src/client/contract/records.ts";
import type { TodoItem } from "../../../../deepseek-harness/packages/todo/tool-todo/src/types.ts";
import type { ToolCall } from "@/lib/types";
import "../../../../deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css";
import "../../../../deepseek-harness/packages/client/ui-theme/src/styles/shiki.css";

const dictionary = zh as Record<string, string>;

function t(key: string, vars?: Record<string, string | number>): string {
  const template = dictionary[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

function useDisclosure() {
  const [expanded, setExpanded] = React.useState(false);
  const toggle = React.useCallback(() => setExpanded((value) => !value), []);
  return { expanded, setExpanded, toggle };
}

function useSessions<T>(select: (list: { byId: Record<string, { cwd?: string }> }) => T): T {
  return select({ byId: {} });
}

function useSession<T>(select: (snapshot: { hasMore: boolean }) => T): T {
  return select({ hasMore: false });
}

const HistoryContext = React.createContext<TodoHistory | undefined>(undefined);

function useTodoHistory<T>(select: (snapshot: TodoHistory | undefined) => T): T {
  return select(React.useContext(HistoryContext));
}

const DETAIL_TOOLS = new Set([
  "create_goal", "get_goal", "update_goal",
  "schedule_create", "schedule_list", "schedule_delete",
  "cordis_inspect_list", "cordis_inspect_query", "cordis_inspect_self",
  "workflow", "ralph",
  "session_event_read", "session_event_search", "session_event_trace",
  "session_search", "session_trace",
  "list_subagent_models", "subagent", "list_agents", "send_message", "interrupt_agent",
  "job_list", "job_output", "job_kill",
  "terminal_open", "terminal_read", "terminal_list", "terminal_signal", "terminal_close",
  "lsp",
  "spawn_teammate", "team_task_create", "team_task_get", "team_task_update", "team_task_list",
  "wait_agent",
]);

function todosFrom(args: string | undefined): TodoItem[] | undefined {
  if (!args) return undefined;
  try {
    const parsed = JSON.parse(args) as { todos?: unknown };
    if (!Array.isArray(parsed.todos)) return undefined;
    const items: TodoItem[] = [];
    for (const item of parsed.todos) {
      if (typeof item !== "object" || item === null) continue;
      const content = (item as { content?: unknown }).content;
      const status = (item as { status?: unknown }).status;
      if (typeof content !== "string" || !content.trim()) continue;
      if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
      items.push({ content, status });
    }
    return items;
  } catch {
    return undefined;
  }
}

export function DshToolHistory({
  messages,
  children,
}: {
  messages: readonly { id: string; tool?: ToolCall }[];
  children: React.ReactNode;
}) {
  const history = React.useMemo<TodoHistory>(() => {
    const baselines = new Map<string, { todos: readonly TodoItem[] | undefined }>();
    let previous: readonly TodoItem[] | undefined;
    for (const message of messages) {
      if (message.tool?.name !== "todo_write") continue;
      baselines.set(message.id, { todos: previous });
      const next = todosFrom(message.tool.args);
      if (next) previous = next;
    }
    return { get: (callId) => baselines.get(callId) };
  }, [messages]);
  return <HistoryContext.Provider value={history}>{children}</HistoryContext.Provider>;
}

function blockOf(callId: string, tool: ToolCall): ToolCallBlock {
  const argsRaw = tool.args ?? "";
  if (tool.status === "running") {
    return { callId, name: tool.name, argsRaw, turn: 0, step: 0, time: Date.now(), subCalls: [] };
  }
  return {
    kind: "tool-result",
    seq: 0,
    time: Date.now(),
    callId,
    call: { name: tool.name, argsRaw },
    callTime: null,
    content: tool.output ? [{ type: "text", text: tool.output }] : [],
    isError: tool.status === "error",
    subCalls: [],
  };
}

export function ToolRow({
  tool,
  callId,
  onOpenFile,
}: {
  tool: ToolCall;
  callId: string;
  onOpenFile?: (path: string, options?: { line?: number }) => void;
}) {
  const block = React.useMemo(() => blockOf(callId, tool), [callId, tool]);
  const props = {
    callId,
    toolName: tool.name,
    block,
    useDisclosure,
    useTodoHistory,
    useSession,
    useSessions,
    sessionId: "",
    t,
    openFile: onOpenFile,
  };
  if (tool.name === "todo_write") return <TodoRow {...(props as React.ComponentProps<typeof TodoRow>)} />;
  if (tool.name === "bash" || tool.name === "pwsh") return <BashRow {...(props as React.ComponentProps<typeof BashRow>)} />;
  if (tool.name === "read") return <ReadRow {...(props as React.ComponentProps<typeof ReadRow>)} />;
  if (tool.name === "grep" || tool.name === "glob") return <SearchRow {...(props as React.ComponentProps<typeof SearchRow>)} />;
  if (tool.name === "edit" || tool.name === "write") return <FileMutationRow {...(props as React.ComponentProps<typeof FileMutationRow>)} />;
  if (tool.name === "web_search" || tool.name === "web_fetch") return <WebRow {...(props as React.ComponentProps<typeof WebRow>)} />;
  if (tool.name === "ask_user_question") return <AskQuestionRow {...(props as React.ComponentProps<typeof AskQuestionRow>)} />;
  if (DETAIL_TOOLS.has(tool.name)) return <DetailsRow {...(props as React.ComponentProps<typeof DetailsRow>)} />;
  return <GenericToolCard {...(props as React.ComponentProps<typeof GenericToolCard>)} />;
}
