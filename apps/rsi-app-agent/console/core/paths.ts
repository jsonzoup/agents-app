/**
 * Dotted paths into JSON output, e.g. `a.b[0].c`. Used to apply a person's correction
 * to a task's working copy without knowing anything about the app.
 */

export type Token = string | number

export function parsePath(path: string): Token[] {
  const tokens: Token[] = []
  for (const part of path.split('.')) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part)
    if (!m) throw new Error(`路径不合法：${path}`)
    if (m[1]) tokens.push(m[1])
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) tokens.push(Number(idx[1]))
  }
  if (tokens.length === 0) throw new Error('路径为空')
  return tokens
}

export function getPath(root: unknown, path: string): unknown {
  let node = root
  for (const t of parsePath(path)) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string | number, unknown>)[t]
  }
  return node
}

/**
 * Set a value at an existing parent; creates the last key only.
 * @returns a deep copy with the value set.
 * @throws Error when an intermediate node is missing.
 */
export function setPath<T>(root: T, path: string, value: unknown): T {
  const copy = structuredClone(root)
  const tokens = parsePath(path)
  let node: unknown = copy
  for (const t of tokens.slice(0, -1)) {
    const next = node !== null && typeof node === 'object' ? (node as Record<string | number, unknown>)[t] : undefined
    if (next === null || typeof next !== 'object') throw new Error(`路径 ${path} 在 ${String(t)} 处不存在`)
    node = next
  }
  if (node === null || typeof node !== 'object') throw new Error(`路径 ${path} 不存在`)
  ;(node as Record<string | number, unknown>)[tokens[tokens.length - 1]] = value
  return copy
}

/**
 * Every leaf of a JSON value as `{path, value}`, in output order; empty arrays and objects count as leaves.
 * Keys that would not read back as a path (containing `.`, `[` or `]`) are skipped.
 */
export function leaves(root: unknown, prefix = ''): { path: string; value: unknown }[] {
  if (Array.isArray(root)) {
    if (root.length === 0) return prefix ? [{ path: prefix, value: [] }] : []
    return root.flatMap((v, i) => leaves(v, `${prefix}[${i}]`))
  }
  if (root !== null && typeof root === 'object') {
    const entries = Object.entries(root).filter(([k]) => k && !/[.[\]]/.test(k))
    if (entries.length === 0) return prefix ? [{ path: prefix, value: {} }] : []
    return entries.flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return prefix ? [{ path: prefix, value: root }] : []
}
