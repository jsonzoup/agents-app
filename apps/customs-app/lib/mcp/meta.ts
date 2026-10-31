export const MCP_SERVER = {
  name: "business-draft",
  version: "1.0.0",
  endpoint: "/api/mcp",
  transport: "streamable-http",
  protocol: "2026-07-28",
  description: "报关业务域 MCP：草单字段、资料、会话消息与业务事件",
  tools: [
    { name: "task_snapshot", description: "读取整票任务与草单快照" },
    { name: "task_summary", description: "任务状态、待补充/低置信度计数与进度" },
    { name: "draft_get_field", description: "按路径读取单个字段及来源" },
    { name: "draft_set_field", description: "写入字段值并记录版本与事件" },
    { name: "draft_confirm_field", description: "人工确认字段" },
    { name: "draft_apply_answers", description: "提交 Ask 表单答案并回写字段" },
    { name: "materials_list", description: "列出本票资料与页数" },
    { name: "task_set_session", description: "绑定任务与对话会话" },
    { name: "messages_append", description: "向任务会话追加消息" },
    { name: "events_poll", description: "按游标拉取业务事件" },
    { name: "events_append", description: "追加业务事件" },
    { name: "skill_info", description: "读取 customs-extraction 技能元数据" },
    { name: "draft_commit", description: "把技能最终 JSON 回写为工作台草单" },
  ],
};
export type McpServerInfo = typeof MCP_SERVER;
