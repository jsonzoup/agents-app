/**
 * The home directory: one folder per app (`<app>/code`, `<app>/evals`) plus the platform's
 * own state under `.rsi/`. Chosen by `RSI_HOME`, else `home` in `rsi.config.json` beside the
 * platform, else `~/.rsi-app-agent`. Relative paths resolve against the platform directory.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'

/** Platform state inside the home: kernel store, console state, uploads. */
export const STATE_DIR = '.rsi'
export const UPLOAD_DIR = `${STATE_DIR}/uploads`

export function resolveHome(platform: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.RSI_HOME) return resolve(platform, env.RSI_HOME)
  try {
    const config = JSON.parse(readFileSync(join(platform, 'rsi.config.json'), 'utf8')) as { home?: unknown }
    if (typeof config.home === 'string' && config.home) return resolve(platform, config.home)
  } catch {
    // no config file
  }
  return join(homedir(), '.rsi-app-agent')
}

/**
 * The platform's environment: the process's own, over the variables in the file named by
 * `RSI_ENV_FILE` or `envFile` in `rsi.config.json` (e.g. `deploy/.env` with cluster addresses
 * and credentials). The file's variables are not put into `process.env`, so app processes the
 * platform starts never inherit them.
 */
export function platformEnv(platform: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  let name = env.RSI_ENV_FILE ?? ''
  if (!name) {
    try {
      const config = JSON.parse(readFileSync(join(platform, 'rsi.config.json'), 'utf8')) as { envFile?: unknown }
      if (typeof config.envFile === 'string') name = config.envFile
    } catch {
      // no config file
    }
  }
  if (!name) return env
  const file = resolve(platform, name)
  if (!existsSync(file)) throw new Error(`找不到环境文件 ${file}（rsi.config.json 的 envFile）`)
  return { ...parseEnv(readFileSync(file, 'utf8')), ...env }
}

/** App folders in a home: visible directories with `code/app.json`. */
export function appDirs(home: string): string[] {
  if (!existsSync(home)) return []
  return readdirSync(home, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(home, e.name, 'code/app.json')))
    .map((e) => e.name)
    .sort()
}
