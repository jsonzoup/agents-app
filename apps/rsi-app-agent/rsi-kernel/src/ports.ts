/**
 * Ports owned by rsi-kernel. Drivers (e.g. `rsi-harness`) and kernel-shipped adapters
 * implement them; the kernel's use cases depend on nothing else.
 */

import type { Change } from './domain/change.ts'
import type { EvalCase, FieldCheck } from './domain/evaluation.ts'
import type { AppManifest, Tier } from './domain/manifest.ts'
import type { DecisionRecord } from './domain/proposal.ts'
import type { Release } from './domain/release.ts'
import type { Issue, Signal } from './domain/signal.ts'

/** Read-only view of one directory. */
export interface FileTree {
  /** Absolute root. */
  readonly root: string
  /** Root-relative file paths, symlinks followed, hidden files skipped. */
  list(): Promise<string[]>
  read(path: string): Promise<Uint8Array>
}

/**
 * An app's source: its code (what releases snapshot and the loop may evolve) and its
 * evaluation tree (cases, validators, tests), which is never released and never
 * reaches the agent.
 */
export interface AppSource extends FileTree {
  readonly evals: FileTree
}

/**
 * Where blob contents live (local disk, an object store such as MinIO). A store keeps a
 * local cache in front of it, because executors read releases from a local directory.
 */
export interface BlobStore {
  readonly name: string
  put(hash: string, content: Uint8Array): Promise<void>
  get(hash: string): Promise<Uint8Array>
  has(hash: string): Promise<boolean>
}

/** Kernel state: JSON documents per collection plus content-addressed blobs. */
export interface Store {
  get<T>(collection: string, id: string): Promise<T | undefined>
  put(collection: string, id: string, doc: unknown): Promise<void>
  list<T>(collection: string): Promise<T[]>
  putBlob(content: Uint8Array): Promise<string>
  getBlob(hash: string): Promise<Uint8Array>
  /** Write a release's files to a directory an executor can read; idempotent per release. */
  materialize(release: Release): Promise<string>
  /** Atomically add one to a named counter. @returns the new value. Stores shared by several processes must have it. */
  next?(counter: string): Promise<number>
  /** Run `fn` while holding a lock on `key`, across every process sharing the store; reentrant within one call chain. */
  exclusive?<T>(key: string, fn: () => Promise<T>): Promise<T>
}

/** One normalized step of a run, independent of the executor. */
export interface TraceStep {
  kind: 'model' | 'tool' | 'skill' | 'human' | 'note'
  name: string
  ok: boolean
  ms: number
  detail?: string
}

export interface RunRequest {
  app: AppManifest
  release: Release
  /** Materialized release directory. */
  dir: string
  input: unknown
  scope: Record<string, string>
  /** Instruction files that apply, root first. */
  instructions: string[]
  caseId?: string
}

export interface RunResult {
  status: string
  output: unknown
  trace: TraceStep[]
  ms: number
  executor: string
  /** Executor-side session id, for drivers that keep their own logs. */
  session?: string
  /** Free text from the executor about this run, e.g. why it stopped. */
  note?: string
  /**
   * Set when the run failed before the agent could answer, for reasons that are not the agent's:
   * no executor, no isolation, the process or the model service failed. Evaluation does not score
   * such runs. An answer that breaks the output contract is the agent's failure and leaves it unset.
   */
  error?: string
}

/** Runs one task against one release. */
export interface Executor {
  readonly name: string
  run(request: RunRequest): Promise<RunResult>
}

/** App-provided scorer; the kernel calls it, the agent never sees it. */
export interface Judge {
  score(testCase: EvalCase, run: RunResult): Promise<FieldCheck[]>
  check(run: RunResult): Promise<string[]>
  close(): Promise<void>
}

export interface LearnContext {
  app: AppManifest
  issue: Issue
  signals: Signal[]
  /** Evolvable files of the base release with their tier. Contract files are omitted. */
  files: Record<string, { text: string; tier: Tier }>
  base: Release
}

export interface ProposalDraft {
  title: string
  changes: Change[]
  record: DecisionRecord
}

/** Turns an issue into candidate change lists. Built-ins live in `extensions/learners.ts`. */
export interface Learner {
  readonly name: string
  propose(context: LearnContext): Promise<ProposalDraft[]>
}

/** Text completion used by model-backed learners. */
export interface Model {
  complete(request: { system: string; user: string }): Promise<string>
}

/** Runs the app's own tests (kept with its evaluation tree) against a candidate's code. */
export interface AppTests {
  run(code: string, evals: string): Promise<{ ok: boolean; detail: string }>
}

export interface Clock {
  now(): string
}
