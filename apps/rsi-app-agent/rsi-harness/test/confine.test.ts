import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { canConfine, confinedCommand, seatbeltProfile } from '../src/index.ts'

test('隔离配置：先拒绝再放行，放行写在后面', () => {
  const profile = seatbeltProfile({ hide: ['/h'], read: ['/h/v', '/h/in/a.pdf'], readOnly: ['/u'], write: ['/h/v'] })
  const lines = profile.split('\n')
  assert.ok(lines.indexOf('(deny file-read-data file-write* (subpath "/h"))') < lines.indexOf('(allow file-read-data (subpath "/h/in/a.pdf"))'))
  assert.ok(lines.includes('(deny file-write* (subpath "/u"))'))
  assert.ok(lines.at(-1)!.startsWith('(allow file-read-data file-write* (subpath "/h/v"))'))
})

test('隔离的进程读不到 home 里别的东西，只能读版本目录和本次材料', { skip: !canConfine() && '这台机器不能隔离进程' }, async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'confine-')))
  after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, 'app/evals/cases/c1/input'), { recursive: true })
  await mkdir(join(home, 'release'), { recursive: true })
  await writeFile(join(home, 'app/evals/cases/c1/case.json'), '{"expected":"secret"}')
  await writeFile(join(home, 'app/evals/cases/c1/input/a.txt'), 'material')
  await writeFile(join(home, 'release/AGENTS.md'), 'rules')
  const c = confinedCommand({ hide: [home], read: [join(home, 'app/evals/cases/c1/input/a.txt')], readOnly: [], write: [join(home, 'release')] })!
  assert.equal(c.env.DSH_PERMISSION_MODE, 'danger-full-access')
  const sh = (script: string) => spawnSync(c.command, [...c.args, '/bin/sh', '-c', script], { cwd: join(home, 'release'), encoding: 'utf8' })
  assert.equal(sh('cat AGENTS.md').stdout, 'rules')
  assert.equal(sh(`cat '${home}/app/evals/cases/c1/input/a.txt'`).stdout, 'material')
  assert.notEqual(sh(`cat '${home}/app/evals/cases/c1/case.json'`).status, 0)
  assert.notEqual(sh(`ls '${home}/app'`).status, 0)
  assert.equal(sh('echo out > note.txt && cat note.txt').stdout, 'out\n')
  assert.notEqual(sh(`echo x > '${home}/app/evals/cases/c1/case.json'`).status, 0)
})
