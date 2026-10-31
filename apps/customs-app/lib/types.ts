export type FieldState = "normal" | "low" | "missing" | "edited";

export type Status = "待补充" | "待确认" | "待复核" | "处理中" | "可交付" | "已交付";

export interface SourceRef {
  docId: string;
  docName: string;
  file?: string;
  page: number;
  region?: string;
  /** 相对页面的高亮框：[x, y, w, h]，0-1 比例 */
  rect?: [number, number, number, number];
}

export interface FieldHistory {
  by: string;
  at: string;
  before: string;
  after: string;
}

export interface Cell {
  value: string;
  state: FieldState;
  confidence: number;
  rule: string;
  sources: SourceRef[];
  history: FieldHistory[];
}

export interface DraftRow {
  [field: string]: Cell;
}

export interface Draft {
  header: Record<string, Cell>;
  rows: DraftRow[];
  origin: Array<Record<string, { value: string }>>;
  containers: Array<Record<string, { value: string }>>;
  footer: Record<string, Cell>;
}

export interface Material {
  id: string;
  key?: string;
  name: string;
  type: string;
  size: number;
  sizeLabel?: string;
  pages: number;
  demo?: boolean;
  dshSessionId?: string;
  model?: string;
}

export interface AskOption {
  value: string;
  label: string;
  desc?: string;
}

export interface AskQuestion {
  id: string;
  label: string;
  hint?: string;
  options: AskOption[];
}

export interface ToolCall {
  name: string;
  title: string;
  status: "running" | "done" | "error";
  args?: string;
  output?: string;
  meta?: string;
  duration?: string;
}

export interface SessionContext {
  provider?: string;
  model?: string;
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  pressureTokens?: number;
  imageOffloads?: number;
  hydrated?: boolean;
  updatedAt?: string;
}

export interface CompactionView {
  id: string;
  mode: "summary" | "prune";
  status: "running" | "done" | "error";
  summary?: string;
  shadowedItemCount?: number;
  shadowedTokenCount?: number;
  error?: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  kind: "text" | "ask" | "tool" | "compaction";
  tool?: ToolCall;
  compaction?: CompactionView;
  text: string;
  at: string;
  cites?: SourceRef[];
  askId?: string;
  questions?: AskQuestion[];
  answered?: boolean;
  selection?: Record<string, string>;
  by?: string;
}

export interface Task {
  id: string;
  title: string;
  customer: string;
  name: string;
  owner: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  version: number;
  sessionId: string;
  materials: Material[];
  prompt?: string;
  method?: string;
  progress?: { stage: number; pct: number; text: string };
  draft: Draft | null;
  codeRefs?: import("./code-refs").CodeRef[];
  demo?: boolean;
  dshSessionId?: string;
  model?: string;
  sessionEpoch?: number;
  context?: SessionContext;
  messages: Message[];
  events: Array<Record<string, unknown>>;
  deliveredAt?: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  customer: string;
  name: string;
  owner: string;
  status: Status;
  updatedAt: string;
  createdAt: string;
  missing: number;
  low: number;
  total: number;
  filled: number;
  materialCount: number;
  missingDocs: string[];
  codeTotal: number;
  codeUnmatched: number;
  version: number;
  step: string;
  itemCount: number;
}

export interface Metrics {
  all: number;
  todo: number;
  deliverable: number;
  delivered: number;
}

export interface PendingUpload {
  id: string;
  name: string;
  size: number;
  pages: number;
  type: string;
  typeGuess: string;
  confidence: "high" | "medium" | "low";
  at: string;
}

export interface Db {
  version: number;
  seq: number;
  tasks: Task[];
  pending: PendingUpload[];
}
