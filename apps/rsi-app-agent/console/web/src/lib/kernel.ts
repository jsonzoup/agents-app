/** Shapes returned by the management endpoints (mirrors of the kernel's domain objects). */

import type { SignalScope } from "@/sdk";

export interface FieldCheck {
  path: string;
  expected: string;
  actual: string;
  ok: boolean;
  /** With several runs: share of runs that passed. */
  rate?: number;
}
export interface TrialScore {
  ok: boolean;
  score: number;
  error?: string;
  status?: string;
  ms?: number;
}
export interface CaseScore {
  case: string;
  split: "dev" | "holdout";
  ok: boolean;
  score: number;
  checks: FieldCheck[];
  violations: string[];
  run: string;
  status?: string;
  output?: unknown;
  ms?: number;
  /** The run failed outside the agent: not scored, rerun it. */
  error?: string;
  /** The case's reference run does not get full marks: the case is wrong and did not run. */
  invalid?: string;
  passRate?: number;
  trials?: TrialScore[];
}
export interface SuiteResult {
  release: string;
  split: "dev" | "holdout";
  cases: CaseScore[];
  passed: number;
  total: number;
  score: number;
  evalset?: string;
  /** Cases chosen for a partial run. */
  selection?: string[];
  errors?: string[];
  invalid?: string[];
  trials?: number;
}
export interface Comparison {
  regressions: string[];
  fixed: string[];
  fieldRegressions: string[];
  fieldFixes: string[];
  delta: number;
  unstable?: string[];
  skipped?: string[];
}
export interface Change {
  path: string;
  op: "replace" | "create" | "append" | "put" | "delete";
  find?: string;
  text?: string;
  blob?: string;
  size?: number;
}
export interface DecisionRecord {
  title: string;
  date: string;
  background: string;
  options: { title: string; pros: string; cons: string }[];
  decision: string;
  impact: string;
  review: string;
  source?: string;
}
export interface Approval {
  role: "owner" | "engineer";
  by: string;
  at: string;
  ok: boolean;
  note?: string;
}
export interface Verification {
  baseline: string;
  at: string;
  dev: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison };
  holdout: { baseline: SuiteResult; candidate: SuiteResult; comparison: Comparison } | null;
  violations: string[];
  appTests: { ok: boolean; detail: string } | null;
  gates: { gate: string; ok: boolean; detail: string }[];
  passed: boolean;
}
export interface Proposal {
  id: string;
  app: string;
  issue: string | null;
  title: string;
  author: string;
  base: string;
  changes: Change[];
  tier: "knowledge" | "code" | "contract";
  record: DecisionRecord;
  status: "draft" | "verified" | "failed" | "rejected" | "released";
  createdAt: string;
  verification: Verification | null;
  approvals: Approval[];
  release: string | null;
}
export interface ProposalDetail extends Proposal {
  recordMarkdown: string;
  before: Record<string, string | null>;
  existed: Record<string, boolean>;
  webOnly: boolean;
  stable: string;
  /** Approval slots under the app's current policy. */
  required: ("owner" | "engineer")[];
}
export interface ProposalRow {
  id: string;
  title: string;
  author: string;
  tier: Proposal["tier"];
  status: Proposal["status"];
  base: string;
  release: string | null;
  createdAt: string;
  issue: string | null;
  files: string[];
  passed: boolean | null;
}
export interface Signal {
  id: string;
  at: string;
  kind: string;
  release: string;
  run?: string;
  case?: string;
  field?: string;
  before?: string;
  after?: string;
  note?: string;
  scope: SignalScope;
  by: string;
  target?: SignalTarget;
  attachments?: { path: string; name: string; size: number }[];
  /** Brief rows (lists) carry the task they came from; the detail carries the full context. */
  task?: string | null;
  taskTitle?: string | null;
  hasContext?: boolean;
  context?: SignalContext;
  issue?: string | null;
}
export interface SignalTarget {
  level: "field" | "region" | "task" | "ui" | "feature";
  path?: string;
  label?: string;
}
/** What the person saw when they gave the feedback. */
export interface SignalContext {
  task?: string;
  title?: string;
  input?: unknown;
  output?: unknown;
  working?: unknown;
  corrections?: { path: string; field: string; before: string; after: string; note?: string; by: string; at: string }[];
  suggestions?: { target?: SignalTarget; note: string; by: string; at: string }[];
  instructions?: string[];
  executor?: string;
  version?: string;
  /** For interface suggestions: the page inside the app. */
  page?: string | null;
  [key: string]: unknown;
}
export interface IssueView {
  id: string;
  kind: string;
  field: string | null;
  label: string | null;
  scope: SignalScope;
  summary: string;
  signals: Signal[];
  proposals: { id: string; title: string; status: Proposal["status"]; release: string | null }[];
  state: { status: "dismissed"; by: string; at: string; reason: string } | null;
}
export interface TreeFile {
  path: string;
  tier: Proposal["tier"];
  text: boolean;
  size: number | null;
  /** Part of the app's own web application (`web/`). */
  web?: boolean;
}
export interface FileDiff {
  path: string;
  tier: Proposal["tier"];
  status: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
  binary?: boolean;
}
export interface Version {
  id: string;
  kind: "release" | "candidate";
  label: string;
  note: string;
  stable: boolean;
  at: string;
}
export interface EvalRun {
  id: string;
  app: string;
  version: string;
  kind: "release" | "candidate";
  splits: ("dev" | "holdout")[];
  status: "queued" | "running" | "done" | "failed";
  progress: { done: number; total: number; current: string | null };
  by: string;
  at: string;
  finishedAt: string | null;
  evalset: string | null;
  executor: string;
  results: { dev?: SuiteResult; holdout?: SuiteResult };
  error: string | null;
  /** Chosen cases; absent when whole splits ran. A partial run never decides a release. */
  cases?: string[];
  trials?: number;
  ablate?: Ablation;
  /** For an ablation run: the full run it is compared with, per case. */
  ablation?: {
    mode: Ablation;
    title: string;
    against: string | null;
    cases: { id: string; full: number; ablated: number; delta: number; fullOk: boolean; ablatedOk: boolean }[];
    delta: number | null;
  } | null;
}
export type Ablation = "knowledge" | "skills";
export const ABLATION_LABEL: Record<Ablation, string> = { knowledge: "去掉知识", skills: "去掉技能" };
export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "易", medium: "中", hard: "难" };
export interface Oracle {
  status: string;
  output: unknown;
  provenance?: unknown;
}
export interface CapabilityCoverage {
  capability: string;
  title: string | null;
  cases: string[];
  scored: number;
  passed: number;
  score: number | null;
}
export interface CaseAudit {
  id: string;
  title: string;
  split: "dev" | "holdout";
  difficulty: Difficulty | null;
  capabilities: string[];
  problems: string[];
  warnings: string[];
  oracle: { ok: boolean; score: number; failed: FieldCheck[]; violations: string[] } | null;
}
export interface EvalAudit {
  cases: CaseAudit[];
  problems: string[];
  warnings: string[];
  coverage: CapabilityCoverage[];
  scoredBy: { run: string; version: string } | null;
  evalset: string | null;
}
/** A declarative check in `case.json` (spec rsi-eval/1). */
export interface EvalRule {
  path: string;
  op: "equals" | "number" | "oneOf" | "contains" | "matches" | "count" | "present" | "absent";
  value?: unknown;
  values?: unknown[];
  tolerance?: number;
  relative?: number;
  pattern?: string;
  min?: number;
  max?: number;
  label?: string;
}
export interface EvalCaseRow {
  id: string;
  title: string;
  split: "dev" | "holdout";
  locked: boolean;
  scope?: Record<string, string>;
  source?: string;
  input: unknown;
  expected: unknown;
  materials: { path: string; exists: boolean }[];
  stable: { release: string; run: string; score: number; ok: boolean } | null;
  tags: string[];
  /** Path of the expected file inside the case folder, when the case keeps it in a file. */
  expectedFile: string | null;
  rules: EvalRule[];
  /** Validator name; null when the case is checked by its rules only. */
  validator: string | null;
  /** Files in the case folder, relative to it. */
  files: string[];
  difficulty: Difficulty | null;
  why: string | null;
  capabilities: string[];
  /** Reference run, when the case has one. */
  oracle: { status: string; file: string | null; provenance: unknown } | null;
}
export interface CaseHistoryRow {
  run: string;
  version: string;
  kind: "release" | "candidate";
  at: string;
  by: string;
  evalset: string | null;
  executor: string;
  ok: boolean;
  score: number;
  failed: number;
  violations: number;
  ms: number | null;
  error: string | null;
  invalid: string | null;
  passRate: number | null;
  trials: number;
  ablate: Ablation | null;
}
export interface StorageInfo {
  driver: "local" | "minio";
  location: string;
  note: string;
  blobs: string;
  unique?: number;
  bytes?: number;
}
export interface ReleaseRow {
  id: string;
  parent: string | null;
  createdAt: string;
  origin: "source" | "proposal";
  proposal: Proposal | null;
  note: string;
  files: number;
  bytes: number;
  changed: number;
  fingerprint: string;
}
export interface Channels {
  stable: string;
  history: { at: string; from: string | null; to: string; reason: string }[];
}

/** Apply anchored changes to a text, for showing a proposal's result. */
export function applyChanges(before: string | null, changes: Change[]): string {
  let text = before ?? "";
  for (const c of changes) {
    if (c.op === "create") text = c.text ?? "";
    else if (c.op === "append") text = text + (c.text ?? "");
    else if (c.op === "delete") text = "";
    else if (c.op === "replace" && c.find !== undefined) text = text.replace(c.find, () => c.text ?? "");
  }
  return text;
}
