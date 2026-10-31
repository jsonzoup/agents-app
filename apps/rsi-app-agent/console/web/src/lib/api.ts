"use client";

import { useCallback, useEffect, useState } from "react";
import type { HostApi, Material } from "@/sdk";

export class ApiError extends Error {
  status: number;
  problems?: string[];
  constructor(message: string, status: number, problems?: string[]) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; raw?: BodyInit }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined || init?.raw ? "POST" : "GET"),
    headers: init?.raw ? undefined : { "content-type": "application/json" },
    body: init?.raw ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; problems?: string[] };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login";
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.problems);
  }
  return data as T;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: ApiError) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** The app UI's view of the platform; with a version, tasks are trials of that version. */
export function hostApi(app: string, version: string | null = null): HostApi {
  const base = `/api/apps/${app}`;
  return {
    version,
    tasks: () => api(`${base}/tasks${version ? `?version=${encodeURIComponent(version)}` : ""}`),
    task: (id) => api(`${base}/tasks/${id}`),
    createTask: (body) => api(`${base}/tasks`, { body: version ? { ...body, version } : body }),
    rerun: (id, input) => api(`${base}/tasks/${id}/rerun`, { body: { input } }),
    correct: (id, body) => api(`${base}/tasks/${id}/corrections`, { body }),
    suggest: (id, body) => api(`${base}/tasks/${id}/suggestions`, { body }),
    suggestApp: (body) => api(`${base}/suggestions`, { body: { ...body, version } }),
    confirm: (id) => api(`${base}/tasks/${id}/confirm`, { body: {} }),
    action: (id, name) => api(`${base}/tasks/${id}/actions/${name}`, { body: {} }),
    upload: (file: File) => api<Material>(`${base}/uploads?name=${encodeURIComponent(file.name)}`, { raw: file }),
    contributions: () => api(`${base}/contributions`),
    fileUrl: (path) => `/files/${path.split("/").map(encodeURIComponent).join("/")}`,
    artifactUrl: (taskId, artifactId) => `/artifacts/${app}/${taskId}/${artifactId}`,
  };
}

/** The same view for a build session's preview: tasks run on the workspace and stay in the session. */
export function previewApi(build: string, label: string): HostApi {
  const base = `/api/builds/${encodeURIComponent(build)}/preview`;
  return {
    version: label,
    tasks: () => api(`${base}/tasks`),
    task: (id) => api(`${base}/tasks/${id}`),
    createTask: (body) => api(`${base}/tasks`, { body }),
    rerun: (id, input) => api(`${base}/tasks/${id}/rerun`, { body: { input } }),
    correct: (id, body) => api(`${base}/tasks/${id}/corrections`, { body }),
    suggest: (id, body) => api(`${base}/tasks/${id}/suggestions`, { body }),
    suggestApp: async () => {
      throw new Error("预览里对界面和功能的意见，请直接在对话里告诉助手");
    },
    confirm: (id) => api(`${base}/tasks/${id}/confirm`, { body: {} }),
    action: (id, name) => api(`${base}/tasks/${id}/actions/${name}`, { body: {} }),
    upload: (file: File) => api<Material>(`${base}/uploads?name=${encodeURIComponent(file.name)}`, { raw: file }),
    contributions: async () => [],
    fileUrl: (path) => `/files/${path.split("/").map(encodeURIComponent).join("/")}`,
    artifactUrl: (taskId, artifactId) => `${base}/tasks/${taskId}/artifacts/${artifactId}`,
  };
}
