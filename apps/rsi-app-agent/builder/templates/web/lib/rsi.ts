/**
 * The platform, seen from this app's pages. The app is served from the platform's origin, so the
 * browser calls the platform's API with the person's own session and every call is checked
 * there. Tasks run on this app's version: trials of that version, or the stable release.
 */

import type { HostApi, HostApp, Material } from "@/sdk";

const API = process.env.NEXT_PUBLIC_RSI_API ?? "";
const APP = process.env.NEXT_PUBLIC_RSI_APP ?? "";
const VERSION = process.env.NEXT_PUBLIC_RSI_VERSION ?? "";
const PREVIEW = process.env.NEXT_PUBLIC_RSI_PREVIEW === "1";

/** Where the platform mounts this app; `appUrl("api/x")` is a URL of this app's own route. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const appUrl = (path: string) => `${basePath}/${path.replace(/^\/+/, "")}`;

async function call<T>(url: string, init: { body?: unknown; raw?: Blob } = {}): Promise<T> {
  const post = init.body !== undefined || init.raw !== undefined;
  const res = await fetch(url, {
    method: post ? "POST" : "GET",
    credentials: "same-origin",
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export interface Platform {
  app: HostApp;
  user: { id: string; name: string; title: string };
  api: HostApi;
}

/** The app as the platform describes it, the signed-in person and the task API. */
export async function connect(): Promise<Platform> {
  if (!API) throw new Error("没有 NEXT_PUBLIC_RSI_API：这个应用要由平台构建和打开");
  const [app, me] = await Promise.all([
    PREVIEW ? call<{ app: HostApp }>(API).then((v) => v.app) : call<HostApp>(API),
    call<{ user: { id: string; name: string; title: string } }>("/api/me"),
  ]);
  const trial = PREVIEW ? VERSION : VERSION && VERSION !== app.stable ? VERSION : null;
  const api: HostApi = {
    version: trial,
    tasks: () => call(`${API}/tasks${trial && !PREVIEW ? `?version=${encodeURIComponent(trial)}` : ""}`),
    task: (id) => call(`${API}/tasks/${id}`),
    createTask: (body) => call(`${API}/tasks`, { body: trial && !PREVIEW ? { ...body, version: trial } : body }),
    rerun: (id, input) => call(`${API}/tasks/${id}/rerun`, { body: { input } }),
    correct: (id, body) => call(`${API}/tasks/${id}/corrections`, { body }),
    suggest: (id, body) => call(`${API}/tasks/${id}/suggestions`, { body }),
    suggestApp: (body) =>
      PREVIEW ? Promise.reject(new Error("预览里对界面和功能的意见，请直接在对话里告诉助手")) : call(`${API}/suggestions`, { body: { ...body, version: trial } }),
    confirm: (id) => call(`${API}/tasks/${id}/confirm`, { body: {} }),
    action: (id, name) => call(`${API}/tasks/${id}/actions/${name}`, { body: {} }),
    upload: (file: File) => call<Material>(`${API}/uploads?name=${encodeURIComponent(file.name)}`, { raw: file }),
    contributions: () => (PREVIEW ? Promise.resolve([]) : call(`${API}/contributions`)),
    fileUrl: (path) => `/files/${path.split("/").map(encodeURIComponent).join("/")}`,
    artifactUrl: (taskId, artifactId) => (PREVIEW ? `${API}/tasks/${taskId}/artifacts/${artifactId}` : `/artifacts/${APP}/${taskId}/${artifactId}`),
  };
  return { app, user: { id: me.user.id, name: me.user.name, title: me.user.title }, api };
}
