/**
 * Stand-in for `dsh --profile headless --json -` in tests. Emits the documented event
 * shapes; the content is constructed test data. Mode comes from argv[2].
 */

import { readFileSync } from 'node:fs'

const patchAt = process.argv.indexOf('--patch')
const jsonAt = process.argv.indexOf('--json')
if (jsonAt >= 0 && patchAt > jsonAt) process.exit(5)
if (patchAt < 0 || !readFileSync(process.argv[patchAt + 1], 'utf8').includes('customSkillDirs')) process.exit(4)

let task = ''
process.stdin.on('data', (c) => (task += c))
process.stdin.on('end', () => {
  const mode = process.argv[2] ?? 'ok'
  const emit = (e: unknown) => process.stdout.write(`${JSON.stringify(e)}\n`)
  emit({ type: 'session', sessionId: 'sess-test', cwd: process.cwd() })
  emit({ type: 'status', phase: 'turn_start', turn: 1 })
  emit({ type: 'status', phase: 'step_start', turn: 1, step: 1 })
  emit({ type: 'tool_call', callId: 'c1', tool: 'skill', input: { name: 'digest' } })
  emit({ type: 'tool_result', callId: 'c1', status: 'completed', result: 'loaded' })
  emit({ type: 'tool_call', callId: 'c2', tool: 'read', input: { path: 'AGENTS.md' } })
  emit({ type: 'tool_result', callId: 'c2', status: mode === 'tool-error' ? 'error' : 'completed', result: 'denied' })
  emit({ type: 'status', phase: 'step_end', turn: 1, step: 1 })
  if (mode === 'crash') process.exit(3)
  const sawTask = task.includes('周会：Alice Wang 负责发布。')
  const answer = mode === 'no-json' ? '做完了' : `结果如下\n\`\`\`json\n${JSON.stringify({ status: 'result', output: { title: '周会', owner: sawTask ? 'Alice' : '?' } })}\n\`\`\``
  emit({ type: 'text', text: answer })
  emit({ type: 'status', phase: 'turn_end', turn: 1, reason: 'completed' })
  emit({ type: 'final', text: answer })
})
