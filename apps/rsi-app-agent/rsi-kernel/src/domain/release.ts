/**
 * Releases are immutable, content-addressed snapshots of an app. Channels point at them.
 */

import { createHash } from 'node:crypto'

export interface Release {
  /** `r1`, `r2`… per app, assigned in creation order. */
  id: string
  app: string
  parent: string | null
  createdAt: string
  /** App-relative path to content hash. */
  files: Record<string, string>
  /** Hash over the sorted file table; equal fingerprints mean identical content. */
  fingerprint: string
  origin: 'source' | 'proposal'
  proposal: string | null
  note: string
}

/** Where each channel of an app currently points, plus the pointer history. */
export interface Channels {
  app: string
  stable: string
  history: { at: string; from: string | null; to: string; reason: string }[]
}

/**
 * Hash bytes or text.
 * @param content - file content.
 * @returns lowercase sha256 hex.
 */
export function hashContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Fingerprint a file table independent of key order.
 * @param files - path to content hash.
 * @returns sha256 hex over `path\0hash\n` lines.
 */
export function fingerprint(files: Record<string, string>): string {
  const lines = Object.keys(files).sort().map((path) => `${path}\0${files[path]}\n`)
  return hashContent(lines.join(''))
}

/**
 * Paths whose content differs between two releases.
 * @returns added, removed and modified paths.
 */
export function diffReleases(from: Release, to: Release): { added: string[]; removed: string[]; modified: string[] } {
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  for (const path of Object.keys(to.files)) {
    if (!(path in from.files)) added.push(path)
    else if (from.files[path] !== to.files[path]) modified.push(path)
  }
  for (const path of Object.keys(from.files)) if (!(path in to.files)) removed.push(path)
  return { added, removed, modified }
}
