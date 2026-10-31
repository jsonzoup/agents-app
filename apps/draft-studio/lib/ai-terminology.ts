/** Shared editorial vocabulary for AI research, writing, visuals and Copilot. */
export const aiTerminologyRules = `AI 术语规范：本工作台关注人工智能。新撰写的中文内容中，AI agent / agent（指可自主执行任务的 AI 系统）译为“智能体”，不得误译为“代理”；multi-agent 译为“多智能体”，sub-agent 译为“子智能体”，coding agent 译为“编程智能体”。agentic 按句意写“智能体式”或“具备自主规划、工具调用与执行能力”，不能机械等同于模型或聊天机器人。model=模型，inference=推理，training=训练，fine-tuning=微调，embedding=嵌入，retrieval=检索，context window=上下文窗口；区分这些概念，不混用、不生造译名。保留官方产品、模型、论文名称（如 nnInteractive Agent、Claude Code、Codex）、代码标识、URL 和逐字原文引语的原始拼写；描述其能力时使用规范术语。网络/HTTP/SOCKS/反向代理、代理商、代理权、统计代理变量/代理指标和 surrogate model（替代模型）不是 AI 智能体，不得误改。输出前按语境自查选题标题、核心判断、读者价值、文章标题与封面标题、正文、图中文字/数据标签、视觉企划、生图提示词，以及 Copilot 的工具写入内容与回复；不要照抄历史生成内容中的误译，也不要擅改事实、引语或官方名称。`;

/** Adds the same vocabulary instruction once without rewriting supplied material. */
export function withAiTerminology(prompt: string): string {
  return prompt.includes(aiTerminologyRules)
    ? prompt
    : `${aiTerminologyRules}\n\n${prompt}`;
}
