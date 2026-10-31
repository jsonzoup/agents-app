import { expect, test } from "bun:test";
import { reportHarnessProgress } from "../lib/harness.ts";

test("parses Copilot stream frames independently from tool progress", () => {
  const messages = [];
  const progress = [];
  const tools = new Map();
  reportHarnessProgress(JSON.stringify({ type: "stream", kind: "start" }), tools, progress.push.bind(progress), messages.push.bind(messages));
  reportHarnessProgress(JSON.stringify({ type: "stream", kind: "reasoning", text: "先读取文章" }), tools, progress.push.bind(progress), messages.push.bind(messages));
  reportHarnessProgress(JSON.stringify({ type: "stream", kind: "text", text: "已完成分析" }), tools, progress.push.bind(progress), messages.push.bind(messages));
  reportHarnessProgress(JSON.stringify({ type: "stream", kind: "end", status: "committed" }), tools, progress.push.bind(progress), messages.push.bind(messages));
  expect(messages).toEqual([
    { kind: "start", status: undefined },
    { kind: "reasoning", text: "先读取文章" },
    { kind: "text", text: "已完成分析" },
    { kind: "end", status: "committed" },
  ]);
  expect(progress).toEqual([]);
});

test("keeps existing tool progress parsing", () => {
  const progress = [];
  const tools = new Map();
  reportHarnessProgress(JSON.stringify({ type: "tool_call", callId: "c1", tool: "draft_studio_get_draft_context", input: {} }), tools, progress.push.bind(progress));
  reportHarnessProgress(JSON.stringify({ type: "tool_result", callId: "c1", status: "completed", result: "ok" }), tools, progress.push.bind(progress));
  expect(progress.map(({ kind, callId, tool, status }) => ({ kind, callId, tool, status }))).toEqual([
    { kind: "tool_call", callId: "c1", tool: "draft_studio_get_draft_context", status: undefined },
    { kind: "tool_result", callId: "c1", tool: "draft_studio_get_draft_context", status: "completed" },
  ]);
});

test("parses the DSH headless JSON thinking and text events", () => {
  const messages = [];
  const tools = new Map();
  const onMessage = messages.push.bind(messages);
  reportHarnessProgress(JSON.stringify({ type: "status", phase: "step_start" }), tools, undefined, onMessage);
  reportHarnessProgress(JSON.stringify({ type: "thinking", text: "先核对事实" }), tools, undefined, onMessage);
  reportHarnessProgress(JSON.stringify({ type: "text", text: "已完成核对" }), tools, undefined, onMessage);
  reportHarnessProgress(JSON.stringify({ type: "status", phase: "step_end" }), tools, undefined, onMessage);
  expect(messages).toEqual([
    { kind: "start", status: "step_start" },
    { kind: "reasoning", text: "先核对事实" },
    { kind: "text", text: "已完成核对" },
    { kind: "end", status: "step_end" },
  ]);
});
