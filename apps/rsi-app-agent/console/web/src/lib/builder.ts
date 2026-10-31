/** Shapes returned by the coding assistant endpoints (`/api/builds`). */

import type { SuiteResult } from "./kernel";

export interface Activity {
  id: string;
  name: string;
  detail: string;
  ok: boolean | null;
}

export interface BuildMessage {
  id: string;
  role: "user" | "assistant";
  at: string;
  by?: string;
  text: string;
  activity?: Activity[];
  running?: boolean;
  error?: string | null;
}

export interface Published {
  at: string;
  by: string;
  kind: "install" | "proposal" | "import" | "evals";
  release?: string;
  proposal?: string;
  /** Evaluation-set snapshot saved with this publish, when evaluation cases changed. */
  evalset?: string;
}

/** Files the assistant asked the person to upload. */
export interface FileRequest {
  id: string;
  at: string;
  title: string;
  why: string;
  /** Workspace folder the files go into. */
  target: string;
  accept: string | null;
  multiple: boolean;
  status: "open" | "done" | "declined";
  files: string[];
  note?: string;
  /** A run result to confirm instead of files. */
  kind?: "confirm";
  case?: string;
  /** The run's output as path → value. */
  fields?: { path: string; value: unknown }[];
  run?: { status: string; ms: number; note?: string };
  answer?: "yes" | "no";
  corrections?: { path: string; was: unknown; value: unknown }[];
}

export interface BuildSummary {
  id: string;
  app: string;
  title: string;
  mode: "new" | "existing";
  createdByName: string;
  updatedAt: string;
  running: boolean;
  published: Published | null;
  messages: number;
  /** Requests waiting for the person: files to upload or results to confirm. */
  waiting: number;
}

export interface WorkspaceFile {
  path: string;
  /** Tier from the manifest for `code/…`, `evals` for `evals/…`, null when the manifest does not parse. */
  tier: string | null;
  size: number;
}

export interface BuildView {
  id: string;
  app: string;
  title: string;
  goal: string;
  mode: "new" | "existing";
  base: string | null;
  issue: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  messages: BuildMessage[];
  edited: string[];
  published: Published | null;
  files: WorkspaceFile[];
  requests: FileRequest[];
  lastTest?: TestReport;
  harness: { available: boolean; note: string };
}

export interface CheckReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  /** Cases waiting for the person to confirm a run result. */
  pending: string[];
  app: { name: string; title: string } | null;
  cases: { id: string; title: string; holdout: boolean }[];
}

export interface TestReport {
  at: string;
  /** Who ran it: a person's name, or 助手 when the assistant ran it with its tool. */
  by: string;
  /** Case ids tested; null for every case. */
  cases: string[] | null;
  dev: SuiteResult;
  holdout: SuiteResult;
  executor: string;
}

export interface WorkspaceChange {
  path: string;
  tier: string;
  status: "added" | "changed" | "removed";
  binary: boolean;
  before: string | null;
  after: string | null;
  /** Set when someone else changed this evaluation file after the session started. */
  conflict?: string;
}
