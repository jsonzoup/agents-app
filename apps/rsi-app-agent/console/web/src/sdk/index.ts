/**
 * The contract between the platform and an app's own pages. An app's web application
 * (`<home>/<app>/code/web/`, a copy of this file at `web/sdk/index.ts`) renders a component that
 * receives these props; task calls go through `api`, which the server checks against the
 * user's permissions.
 */

import type { ComponentType } from "react";

export interface Material {
  path: string;
  sha256: string;
  name: string;
  size: number;
}

export type SignalScope = { level: "task" } | { level: "scope"; key: string; value: string } | { level: "app" };

export interface TraceStep {
  kind: "model" | "tool" | "skill" | "human" | "note";
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface Run {
  id: string;
  release: string;
  at: string;
  scope: Record<string, string>;
  instructions: string[];
  result: { status: string; output: unknown; trace: TraceStep[]; ms: number; executor: string; note?: string };
}

export interface Correction {
  at: string;
  by: string;
  path: string;
  field: string;
  before: string;
  after: string;
  note?: string;
  scope: SignalScope;
  signal: string;
}

/**
 * What a suggestion is about. About the result: one field, a region (a table, a section), or the
 * whole task. About the app itself: its interface (`ui`: a page or part of one) or something it
 * should be able to do (`feature`); those go to whoever changes the app's code and are always app-wide.
 */
export interface SuggestTarget {
  level: "field" | "region" | "task" | "ui" | "feature";
  /** Output path of the field or region, e.g. `items` or `header.consignee`; for `ui`, the page inside the app, e.g. `/tasks/T-0003`. */
  path?: string;
  /** What people call it, e.g. “商品明细表”. */
  label?: string;
}

export interface Suggestion {
  at: string;
  by: string;
  run: string;
  target: SuggestTarget;
  note: string;
  scope: SignalScope;
  attachments: Material[];
  /** Empty for trial tasks, which never feed evolution. */
  signal: string;
}

export interface Artifact {
  id: string;
  action: string;
  title: string;
  file: string;
  at: string;
  by: string;
  ok: boolean;
  report: unknown;
}

export interface Task<Input = unknown, Output = unknown> {
  id: string;
  app: string;
  title: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  input: Input;
  runs: string[];
  state: "running" | "ready" | "confirmed";
  /** The run's status (e.g. result, pause), or `error` when it failed. */
  outcome: string | null;
  working: Output | null;
  corrections: Correction[];
  suggestions?: Suggestion[];
  /** Set when a manager tried an unreleased or older version; such tasks never become signals. */
  trial?: { version: string; by: string };
  confirmed: { by: string; at: string } | null;
  artifacts: Artifact[];
  run?: Run | null;
  runCount?: number;
}

export interface Contribution {
  signal: string;
  at: string;
  kind?: string;
  note?: string;
  field?: string;
  before?: string;
  after?: string;
  scope: SignalScope;
  issue: string | null;
  proposal: string | null;
  release: string | null;
  stage: "task-only" | "queued" | "proposed" | "released" | "dismissed";
  /** Why the app's managers decided not to act on it. */
  reason?: string;
}

export interface HostApp {
  name: string;
  title: string;
  description: string;
  stable: string;
  /** The user's level in this app: use, or manage (which includes use). */
  level: "use" | "manage";
  permissions: string[];
  actions: Record<string, { title: string; requiresConfirmed: boolean }>;
  scopes: { key: string; title: string; from: string }[];
}

export interface HostApi {
  tasks<I = unknown, O = unknown>(): Promise<Task<I, O>[]>;
  task<I = unknown, O = unknown>(id: string): Promise<Task<I, O>>;
  createTask<I = unknown, O = unknown>(body: { title: string; input: I }): Promise<Task<I, O>>;
  rerun<I = unknown, O = unknown>(id: string, input?: I): Promise<Task<I, O>>;
  correct<I = unknown, O = unknown>(id: string, body: { path: string; field: string; value: string; note?: string; scope: SignalScope }): Promise<Task<I, O>>;
  /** Suggest an improvement about a region or the whole task (not a single value); the server records the task's full context. */
  suggest<I = unknown, O = unknown>(id: string, body: { target: SuggestTarget; note: string; scope: SignalScope; attachments?: Material[] }): Promise<Task<I, O>>;
  /** Suggest a change to the app's interface or abilities (`target.level` `ui` or `feature`), with or without a task at hand. */
  suggestApp(body: { target: SuggestTarget; note: string; task?: string; attachments?: Material[] }): Promise<{ signal: string; issue: string | null }>;
  confirm<I = unknown, O = unknown>(id: string): Promise<Task<I, O>>;
  action<I = unknown, O = unknown>(id: string, name: string): Promise<Task<I, O>>;
  upload(file: File): Promise<Material>;
  contributions(): Promise<Contribution[]>;
  fileUrl(path: string): string;
  artifactUrl(taskId: string, artifactId: string): string;
  /** The version being tried (a candidate or older release), or null for normal use of the stable release. */
  version: string | null;
}

export interface AppUiProps {
  app: HostApp;
  user: { id: string; name: string; title: string };
  /** Path segments after `/use/<app>/`. */
  path: string[];
  navigate(path: string): void;
  api: HostApi;
}

export type AppUi = ComponentType<AppUiProps>;

export const can = (app: HostApp, permission: string) => app.permissions.includes(permission);
