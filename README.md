# agents-app

本仓库的应用位于 `apps/`，`deepseek-harness/` 是固定版本的开源 Git 子模块，只作为上游引用，不在其中修改、安装或构建。业务定制及兼容层放在 `apps/`。

```bash
git submodule update --init --recursive
```

- `apps/draft-studio/`：内容创作工作台，数据默认保存在 `~/xhs-home/`。
- `apps/customs-app/`：报关工作台，本地数据保存在应用的 `data/`。
- `apps/rsi-app-agent/`：自进化应用平台。
- `apps/adapters/`：应用侧 Harness 兼容组件及边界说明。

纯净上游源码不带 CLI 构建产物。Draft Studio 可通过 `DSH_RUNTIME_ROOT` 指定独立目录中准备好的兼容 Harness 构建；RSI 可通过 `RSI_DSH_COMMAND` 指定 CLI。报关应用另有旧版私有模型插件与 UI 接口依赖，仍需完成适配后才能恢复 AI 会话和构建。请勿在子模块内安装或编译。

迁移前的本地 Harness 和其改动保存在忽略的 `.harness-local-backup/` 中，不属于版本库；请保留该备份直至迁移完全验证。各应用的依赖、启动和数据说明见各自文档。
