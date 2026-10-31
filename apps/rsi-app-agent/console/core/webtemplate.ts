/**
 * The web application a new app starts with: a Next.js project (`builder/templates/web/`) plus
 * the platform's improvement kit, SDK types and UI components, copied in so the app builds on
 * its own and looks like the platform.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE = fileURLToPath(new URL('../../builder/templates/web/', import.meta.url))
const WEB_SRC = fileURLToPath(new URL('../web/src/', import.meta.url))

/** Platform files the app gets a copy of: template path ← platform path (relative to `console/web/src`). */
const SHARED: [string, string][] = [
  ['sdk/index.ts', 'sdk/index.ts'],
  ['lib/utils.ts', 'lib/utils.ts'],
  ['components/kit/index.tsx', 'components/kit/index.tsx'],
]
/** UI components that need the platform's own shell (sidebar, theme). */
const SKIP_UI = new Set(['sidebar.tsx', 'sonner.tsx'])

async function walk(dir: string, root = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(abs, root)))
    else out.push(relative(root, abs).split(sep).join('/'))
  }
  return out
}

/** @returns web-directory-relative path → bytes. */
export async function webTemplate(): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const path of await walk(TEMPLATE)) files[path === 'env.template' ? '.env' : path] = await readFile(join(TEMPLATE, path))
  for (const [to, from] of SHARED) files[to] = await readFile(join(WEB_SRC, from))
  for (const name of await readdir(join(WEB_SRC, 'components/ui'))) {
    if (!SKIP_UI.has(name)) files[`components/ui/${name}`] = await readFile(join(WEB_SRC, 'components/ui', name))
  }
  return files
}
