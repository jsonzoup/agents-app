/**
 * Copy browser assets the console serves itself (no CDN at runtime):
 * - `public/monaco/vs`: the Monaco editor's AMD build;
 * - `public/monaco/types/*.d.ts`: declarations the editor loads for completions in app code
 *   (the app SDK, the UI kit and React), so `import … from "@/sdk"` autocompletes.
 * Runs before `dev`, `build` and `typecheck`; skips the copy when the version is unchanged.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(WEB, 'public/monaco')
const pkg = JSON.parse(await readFile(join(WEB, 'node_modules/monaco-editor/package.json'), 'utf8')) as { version: string }
const stamp = join(OUT, 'VERSION')

if (!existsSync(stamp) || (await readFile(stamp, 'utf8')).trim() !== pkg.version) {
  await rm(join(OUT, 'vs'), { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  await cp(join(WEB, 'node_modules/monaco-editor/min/vs'), join(OUT, 'vs'), { recursive: true })
  await writeFile(stamp, `${pkg.version}\n`)
}

/** Declarations of a source module, wrapped as an ambient module under the name apps import. */
async function declare(file: string, name: string): Promise<string> {
  const source = await readFile(join(WEB, file), 'utf8')
  const out = ts.transpileDeclaration(source, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, strict: true } })
  return `declare module "${name}" {\n${out.outputText.replace(/^export declare /gm, 'export ')}\n}\n`
}

await mkdir(join(OUT, 'types'), { recursive: true })
await writeFile(join(OUT, 'types/sdk.d.ts'), await declare('src/sdk/index.ts', '@/sdk'))
await writeFile(join(OUT, 'types/kit.d.ts'), await declare('src/components/kit/index.tsx', '@/components/kit'))
const types = join(WEB, 'node_modules/@types/react')
for (const f of ['index.d.ts', 'global.d.ts', 'jsx-runtime.d.ts']) if (existsSync(join(types, f))) await cp(join(types, f), join(OUT, 'types/react', f))
const csstype = join(WEB, 'node_modules/csstype/index.d.ts')
if (existsSync(csstype)) await cp(csstype, join(OUT, 'types/csstype/index.d.ts'))
console.log(`vendor-assets: monaco ${pkg.version}，类型声明已更新`)
