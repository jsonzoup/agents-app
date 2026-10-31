# Harness 应用适配层

`deepseek-harness` 是只读开源子模块。应用与上游之间的专用兼容逻辑放在本目录或各应用自己的适配目录，不修改子模块源码。

- `dsh/embedded.mjs` 保存原报关应用的进程内运行器装配逻辑，针对固定的 Harness CLI 构建产物。上游 CLI 及其依赖必须先在独立构建环境准备好；该文件不会自行安装或构建上游。
- `dsh-ui/` 保存从迁移前本地 Harness UI 提取的 Draft Studio 展示组件，含原 MIT 许可；React 19 兼容调整保留在此。其 npm 依赖在适配层和 Draft Studio 中声明；新检出后在 `apps/adapters/dsh-ui` 执行 `bun install`。

迁移前整个本地 Harness 目录保存在工作区 `.harness-local-backup/`，包含原有上游修改和构建产物；该目录不提交。不要删除备份，直到各应用兼容与用户数据经验证。纯净子模块不含旧版自定义 Azure 图像数量限制或未发布的 `dsh-embedded` 包。报关 AI 会话需要在应用侧补齐等效能力后才能宣称迁移完成。
