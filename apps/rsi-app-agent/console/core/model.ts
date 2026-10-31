/**
 * Model access for the console's assistant and the kernel's model-backed learner.
 * The key comes from the environment only and never enters prompts, files or responses.
 */

import type { Model } from '../../rsi-kernel/src/index.ts'

export interface ModelStatus {
  configured: boolean
  name: string | null
  note: string
}

/**
 * DeepSeek chat completions as a kernel {@link Model}.
 * @returns the model, or null when `DEEPSEEK_API_KEY` is not set.
 */
export function deepseekModel(env: NodeJS.ProcessEnv = process.env): Model | null {
  const key = env.DEEPSEEK_API_KEY
  if (!key) return null
  const base = (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
  const model = env.DEEPSEEK_MODEL ?? 'deepseek-chat'
  return {
    async complete({ system, user }) {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2 }),
      })
      if (!response.ok) throw new Error(`模型调用失败：HTTP ${response.status}`)
      const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error('模型没有返回文本')
      return text
    },
  }
}

export function modelStatus(env: NodeJS.ProcessEnv = process.env): ModelStatus {
  return env.DEEPSEEK_API_KEY
    ? { configured: true, name: env.DEEPSEEK_MODEL ?? 'deepseek-chat', note: '已从环境变量读取模型配置' }
    : { configured: false, name: null, note: '没有配置模型（环境变量 DEEPSEEK_API_KEY）。AI 助手、AI 起草提案不可用；手动创建、手动修正照常可用。' }
}
