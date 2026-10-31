/**
 * rsi-kernel public API. Industry-agnostic; imports no execution harness.
 * @module rsi-kernel
 */

export * from './domain/manifest.ts'
export * from './domain/change.ts'
export * from './domain/release.ts'
export * from './domain/signal.ts'
export * from './domain/evaluation.ts'
export * from './domain/rules.ts'
export * from './domain/proposal.ts'
export type * from './ports.ts'
export * from './extensions/gates.ts'
export * from './extensions/learners.ts'
export { RsiKernel, KernelError } from './application/kernel.ts'
export type { CaseAudit, EvaluateOptions, KernelOptions, LoadedApp, Run } from './application/kernel.ts'
export { FsAppSource, FsStore, FsTree, LocalLocks } from './adapters/fs.ts'
export { McpStdioClient, mcpJudge } from './adapters/mcp-stdio.ts'
export type { CallToolResult, McpTool } from './adapters/mcp-stdio.ts'
export { commandAppTests, systemClock, steppingClock } from './adapters/local.ts'
