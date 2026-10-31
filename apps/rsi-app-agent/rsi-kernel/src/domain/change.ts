/**
 * Changes a proposal makes to an app. Text edits are anchored and fail loudly when the
 * anchor is missing or ambiguous; whole files (any content, e.g. a spreadsheet) are put by
 * content hash; files can be deleted.
 */

export interface Change {
  /** App-relative path. */
  path: string
  /**
   * `replace` swaps one unique `find`; `create` adds a new text file; `append` adds to the end;
   * `put` sets the whole file to the blob `blob` (any content); `delete` removes the file.
   */
  op: 'replace' | 'create' | 'append' | 'put' | 'delete'
  find?: string
  text?: string
  /** Content hash of the stored blob, for `put`. */
  blob?: string
  /** Size in bytes of the blob, for display. */
  size?: number
}

/** A file's content while changes apply: UTF-8 text, or a stored blob that is not edited as text. */
export type FileContent = string | { blob: string }

export class ChangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChangeError'
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count++
    from = at + needle.length
  }
}

/**
 * Apply changes to a snapshot.
 * @param files - path to content (text, or a blob reference for files that are not text); untouched paths are carried over.
 * @param changes - changes applied in order.
 * @returns a new map; the input is not mutated.
 * @throws ChangeError when an anchor is missing or repeated, a created file exists, a text edit targets a non-text file, or a deleted file is missing.
 */
export function applyChanges(files: ReadonlyMap<string, FileContent>, changes: Change[]): Map<string, FileContent> {
  const out = new Map<string, FileContent>(files)
  for (const change of changes) {
    const current = out.get(change.path)
    if (change.op === 'put') {
      if (!change.blob) throw new ChangeError(`${change.path} 的 put 缺少 blob`)
      out.set(change.path, { blob: change.blob })
      continue
    }
    if (change.op === 'delete') {
      if (current === undefined) throw new ChangeError(`${change.path} 不存在，不能删除`)
      out.delete(change.path)
      continue
    }
    if (typeof change.text !== 'string') throw new ChangeError(`${change.path} 的 ${change.op} 缺少 text`)
    if (current !== undefined && typeof current !== 'string') throw new ChangeError(`${change.path} 不是文本文件，只能整体替换或删除`)
    if (change.op === 'create') {
      if (current !== undefined) throw new ChangeError(`${change.path} 已存在，不能 create`)
      out.set(change.path, change.text)
    } else if (change.op === 'append') {
      if (current === undefined) throw new ChangeError(`${change.path} 不存在，不能 append`)
      out.set(change.path, current.endsWith('\n') || current === '' ? current + change.text : `${current}\n${change.text}`)
    } else {
      if (current === undefined) throw new ChangeError(`${change.path} 不存在`)
      if (!change.find) throw new ChangeError(`${change.path} 的 replace 缺少 find`)
      const n = countOccurrences(current, change.find)
      if (n !== 1) throw new ChangeError(`${change.path} 中锚点出现 ${n} 次，必须恰好 1 次`)
      const text = change.text
      out.set(change.path, current.replace(change.find, () => text))
    }
  }
  return out
}

/** Paths a change list touches, in first-touch order. */
export function touchedPaths(changes: Change[]): string[] {
  return [...new Set(changes.map((c) => c.path))]
}
