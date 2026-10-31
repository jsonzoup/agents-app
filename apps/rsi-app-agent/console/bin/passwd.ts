/**
 * Set console passwords from the command line, for operators with access to the home:
 *
 *   RSI_PASSWORD=… node console/bin/passwd.ts <user>…   set the listed users' passwords
 *   RSI_PASSWORD=… node console/bin/passwd.ts --all     set every user's password
 *
 * Without `RSI_PASSWORD` the password is read from the first line of stdin.
 * Existing sessions of those users end.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Accounts, passwordProblem } from '../core/accounts.ts'
import { clusterConfig } from '../core/cluster.ts'
import { STATE_DIR, platformEnv, resolveHome } from '../core/home.ts'
import { PgStore } from '../core/pgstore.ts'
import type { User } from '../core/rbac.ts'

const platform = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const env = platformEnv(platform)
const home = resolveHome(platform, env)
const stateDir = join(home, STATE_DIR, 'console')
const database = clusterConfig(platform, env).database
const docs = database.driver === 'postgres' ? new PgStore(database.url, join(home, STATE_DIR, 'cache')) : null
const args = process.argv.slice(2)
if (args.length === 0) {
  process.stderr.write('用法：RSI_PASSWORD=… node console/bin/passwd.ts <用户>… | --all\n')
  process.exit(2)
}

const users = docs ? ((await docs.get<User[]>('console', 'users.json')) ?? []) : (JSON.parse(await readFile(join(stateDir, 'users.json'), 'utf8').catch(() => '[]')) as User[])
const ids = args.includes('--all') ? users.map((u) => u.id) : args
const unknown = ids.filter((id) => !users.some((u) => u.id === id))
if (unknown.length > 0) {
  process.stderr.write(`没有这些用户：${unknown.join('、')}\n`)
  await docs?.close()
  process.exit(1)
}

const password = process.env.RSI_PASSWORD ?? (await firstLine())
const problem = passwordProblem(password)
if (problem) {
  process.stderr.write(`${problem}\n`)
  process.exit(1)
}

const accounts = new Accounts(join(stateDir, 'credentials.json'), () => new Date().toISOString(), docs)
for (const id of ids) await accounts.set(id, password, 'passwd')
await docs?.close()
process.stdout.write(`已设置 ${ids.length} 个用户的密码：${ids.join('、')}\n`)

async function firstLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    rl.close()
    return line
  }
  return ''
}
