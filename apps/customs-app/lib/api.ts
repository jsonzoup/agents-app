import type { Metrics, Task, TaskSummary } from "./types";

export interface SessionItem extends TaskSummary {
  lastText?: string;
}

export interface DshModelGroup {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  root: string;
  references: Array<{ file: string; title: string }>;
  tables: string[];
  scenes: string[];
  capabilities: Array<{ title: string; detail: string }>;
  loadedAt: string;
}

export interface Bootstrap {
  tasks: TaskSummary[];
  sessions: SessionItem[];
  metrics: Metrics;
  requiredTypes: string[];
  statuses: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((data as { error?: string }).error || "请求失败");
  return data as T;
}

export const api = {
  bootstrap: () => request<Bootstrap>("/api/bootstrap"),
  skill: () => request<{ skill: SkillInfo }>("/api/skill"),
  models: () => request<{ groups: DshModelGroup[] }>("/api/models"),
  task: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  rerun: (id: string, model?: string | null) => request<{ task: Task }>(`/api/tasks/${id}/rerun`, { method: "POST", body: JSON.stringify({ model }) }),
  upload: (name: string, data: string) =>
    request<{ upload: { id: string; name: string; type: string; pages: number; size: number; sizeLabel: string; confidence: string; typeGuess: string } }>(
      "/api/upload",
      { method: "POST", body: JSON.stringify({ name, data }) },
    ),
  createTask: (payload: Record<string, unknown>) =>
    request<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  setModel: (id: string, model: string) => request<{ ok: boolean }>(`/api/tasks/${id}/model`, { method: "POST", body: JSON.stringify({ model }) }),
  stopTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/stop`, { method: "POST", body: "{}" }),
  stopChat: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/chat/stop`, { method: "POST", body: "{}" }),
  clearSession: (id: string) => request<{ task: Task }>(`/api/tasks/${id}/session/clear`, { method: "POST", body: "{}" }),
  chat: (id: string, text: string, selected?: string | null) =>
    request<{ replies: unknown[]; task: Task }>(`/api/tasks/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ text, selected }),
    }),
  setField: (id: string, path: string, value: string) =>
    request<{ task: TaskSummary }>(`/api/tasks/${id}/field`, {
      method: "POST",
      body: JSON.stringify({ path, value }),
    }),
  confirmField: (id: string, path: string) =>
    request<{ task: TaskSummary }>(`/api/tasks/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  answerAsk: (id: string, askId: string, answers: Record<string, string>) =>
    request<{ task: Task }>(`/api/tasks/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ askId, answers }),
    }),
  review: (id: string, action: "pass" | "return") =>
    request<{ task: Task }>(`/api/tasks/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  exportDraft: async (id: string) => {
    const res = await fetch(`/api/tasks/${id}/export`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || "导出失败");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : `${id}_进口报关草单.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  },
  fileUrl: (taskId: string, docId: string) => `/api/tasks/${taskId}/file/${docId}`,
  preview: (taskId: string, docId: string) =>
    request<{ preview: { kind: string; text?: string; sheets?: Array<{ name: string; rows: string[][] }>; slides?: Array<{ index: number; text: string }>; note?: string } }>(
      `/api/tasks/${taskId}/preview/${docId}`,
    ),
  demoPdfUrl: (key: string) => `/data-demo/${key}.pdf`,
};
