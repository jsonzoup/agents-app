/**
 * Test double for the notes-digest control app: a deterministic executor that follows the
 * version's own rule text, so tests can check that editing a rule changes the result the way a
 * rule-following agent would, without a model. Only tests use it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Executor, RunRequest, RunResult } from '../src/index.ts'

export const notesExecutor: Executor = {
  name: 'notes-double',
  run: async (request: RunRequest): Promise<RunResult> => {
    const skill = readFileSync(join(request.dir, 'skills/digest/SKILL.md'), 'utf8')
    const notes = request.instructions.map((p) => readFileSync(join(request.dir, p), 'utf8')).join('\n')
    const text = (request.input as { text: string }).text
    let title = text.split('：')[0]
    const prefix = /标题前加\s*(\S+)/.exec(notes)
    if (prefix) title = `${prefix[1]} ${title}`
    const name = /：(.+?) 负责/.exec(text)?.[1] ?? ''
    const owner = skill.includes('负责人：写完整姓名') ? name : name.split(' ')[0]
    return {
      status: 'result',
      output: { title, owner },
      trace: [
        { kind: 'skill', name: 'digest', ok: true, ms: 0 },
        { kind: 'note', name: `读取 ${request.instructions.join('、')}`, ok: true, ms: 0 },
      ],
      ms: 1,
      executor: 'notes-double',
    }
  },
}
