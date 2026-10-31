import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { FsAppSource, FsStore, RsiKernel, mcpJudge, steppingClock } from '../../rsi-kernel/src/index.ts'
import { apply, extractJson, HEADLESS_ARGS, headlessExecutor, parseHeadless, releasePatch, taskPrompt, toolStep, traceFromSessionEvents } from '../src/index.ts'
import { resolveHome } from '../../console/core/home.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const NOTES = join(resolveHome(REPO), 'notes-digest')

test('工具名归一：技能、MCP 工具、普通工具', () => {
  assert.deepEqual(toolStep('skill', { name: 'digest' }), { kind: 'skill', name: 'digest' })
  assert.deepEqual(toolStep('mcp__erp__lookup_order', {}), { kind: 'tool', name: 'erp.lookup_order' })
  assert.deepEqual(toolStep('read', { path: 'a' }), { kind: 'tool', name: 'read' })
})

test('headless 事件流：配对工具调用、记录失败、取最终回答', () => {
  const lines = [
    { type: 'session', sessionId: 's1', cwd: '/x' },
    { type: 'status', phase: 'step_start', turn: 1, step: 1 },
    { type: 'tool_call', callId: 'a', tool: 'skill', input: { name: 'digest' } },
    { type: 'tool_call', callId: 'b', tool: 'mcp__erp__get', input: { id: 1 } },
    { type: 'tool_result', callId: 'b', status: 'error', result: 'timeout' },
    { type: 'tool_result', callId: 'a', status: 'completed', result: 'ok' },
    { type: 'status', phase: 'step_end', turn: 1, step: 1 },
    { type: 'final', text: 'done' },
  ].map((e, i) => ({ line: JSON.stringify(e), at: 1000 + i * 10 }))
  const run = parseHeadless([{ line: 'not json' }, ...lines])
  assert.equal(run.sessionId, 's1')
  assert.equal(run.final, 'done')
  assert.deepEqual(run.trace.map((s) => [s.kind, s.name, s.ok, s.ms]), [
    ['skill', 'digest', true, 30],
    ['tool', 'erp.get', false, 10],
    ['model', '第 1 步', true, 50],
  ])
})

test('SessionEvent：模型步耗时、工具耗时、没有结果的调用记为失败', () => {
  const trace = traceFromSessionEvents([
    { type: 'step/start', time: 100, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', time: 900, data: { turn: 1, step: 1 } },
    { type: 'tool/call', time: 1000, data: { turn: 1, step: 1, callId: 'x', name: 'skill', arguments: '{"name":"digest"}' } },
    { type: 'tool/result', time: 1250, data: { turn: 1, step: 1, message: { source: { callId: 'x' } } } },
    { type: 'tool/call', time: 1300, data: { turn: 1, step: 2, callId: 'y', name: 'bash', arguments: '{}' } },
  ])
  assert.deepEqual(trace.map((s) => [s.kind, s.name, s.ok, s.ms]), [
    ['model', '轮 1 步 1', true, 800],
    ['skill', 'digest', true, 250],
    ['tool', 'bash', false, 0],
  ])
})

test('从最终回答里取最后一个 json 代码块', () => {
  assert.deepEqual(extractJson('a\n```json\n{"x":1}\n```\nb\n```json\n{"x":2}\n```'), { x: 2 })
  assert.deepEqual(extractJson('{"x":3}'), { x: 3 })
  assert.throws(() => extractJson('没有'))
})

test('版本补丁：技能根指向版本目录，.mcp.json 变成 mcp-client 条目，密钥只以环境变量引用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rsi-release-'))
  await writeFile(
    join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { erp: { command: 'erp-mcp', args: ['--ro'], env: { ERP_TOKEN: '${ERP_TOKEN}', REGION: 'sh' } } } }),
  )
  const app = { agent: { skills: ['skills/digest', 'skills/other'], mcp: '.mcp.json' } }
  const patch = releasePatch({ app, dir } as unknown as Parameters<typeof releasePatch>[0])
  assert.match(patch, new RegExp(`customSkillDirs: \\["${join(dir, 'skills').replace(/[\\/.]/g, '\\$&')}"\\]`))
  assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/)
  assert.match(patch, /serverName: "erp"/)
  assert.match(patch, /"ERP_TOKEN": !!js process\.env\.ERP_TOKEN/)
  assert.match(patch, /"REGION": "sh"/)
  const bare = releasePatch({ app: { agent: { skills: ['skills/digest'] } }, dir } as unknown as Parameters<typeof releasePatch>[0])
  assert.doesNotMatch(bare, /insert/)
})

async function kernelWith(mode: string) {
  const kernel = new RsiKernel({
    store: new FsStore(await mkdtemp(join(tmpdir(), 'rsi-harness-'))),
    clock: steppingClock('2026-10-09T08:00:00Z'),
    executor: headlessExecutor({ command: process.execPath, args: [join(HERE, 'fake-dsh.ts'), mode, ...HEADLESS_ARGS] }),
    judge: (app, v) => mcpJudge(app.source.evals.root, v.command, v.args),
  })
  await kernel.install(new FsAppSource(NOTES))
  return kernel
}

test('headless 执行器：子进程在版本目录里运行，任务走标准输入，结果回到内核', async () => {
  const kernel = await kernelWith('ok')
  const run = await kernel.runTask('notes-digest', { input: { text: '周会：Alice Wang 负责发布。' } })
  assert.equal(run.result.status, 'result')
  assert.deepEqual(run.result.output, { title: '周会', owner: 'Alice' })
  assert.equal(run.result.session, 'sess-test')
  assert.equal(run.result.executor, 'harness-headless')
  assert.deepEqual(run.result.trace.map((s) => s.name), ['digest', 'read', '第 1 步'])
})

test('headless 执行器：崩溃或没有 JSON 时记为失败，不编造输出', async () => {
  for (const mode of ['crash', 'no-json']) {
    const kernel = await kernelWith(mode)
    const run = await kernel.runTask('notes-digest', { input: { text: '周会：Alice Wang 负责发布。' } })
    assert.equal(run.result.status, 'failed', mode)
    assert.equal(run.result.output, null)
    assert.ok(run.result.note, mode)
  }
})

test('任务提示只描述文件和契约，不带密钥或连接信息', async () => {
  const kernel = await kernelWith('ok')
  const app = kernel.app('notes-digest').manifest
  const prompt = taskPrompt({ app, release: await kernel.stable('notes-digest'), dir: '/tmp/x', input: {}, scope: {}, instructions: ['AGENTS.md'] }, { text: 't' })
  assert.match(prompt, /AGENTS\.md/)
  assert.match(prompt, /contract\/output\.schema\.json/)
  assert.doesNotMatch(prompt, /KEY|TOKEN|password|http/i)
})

test('插件：安装应用并以 rsi 服务提供内核', async () => {
  const provided = new Map<string, unknown>()
  const kernel = await apply({ provide: (n, v) => provided.set(n, v) }, { storeDir: await mkdtemp(join(tmpdir(), 'rsi-plugin-')), apps: [NOTES] })
  assert.equal(provided.get('rsi'), kernel)
  assert.equal((await kernel.stable('notes-digest')).id, 'r1')
})

test('驱动源码不出现行业名词', async () => {
  for (const file of await readdir(join(REPO, 'rsi-harness/src'))) {
    const text = await readFile(join(REPO, 'rsi-harness/src', file), 'utf8')
    assert.doesNotMatch(text, /报关|表头|表体|海关|HS编码|单价/, file)
  }
})
