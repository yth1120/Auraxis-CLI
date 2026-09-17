# @auraxis/cli

GitHub: [yth1120/Auraxis-CLI](https://github.com/yth1120/Auraxis-CLI)

终端交互式 Auraxis Agent。

```bash
auraxis
auraxis --no-banner
auraxis --theme neon
auraxis --run "修复登录 bug" --auto-approve
auraxis --code-file scripts/agent.ts
auraxis --api-family responses --run "读取 README.md"
auraxis --complete "function add(a, b) {"
auraxis --fim "function add(a, b) {|| return a + b; }"
auraxis --files list
auraxis --sessions
auraxis --doctor
```

交互模式支持：

- 流式文本 / 思考 / 工具输出
- 首次启动的 API Key、模型与思考深度引导
- `ask` / `plan` / `auto` 权限模式
- `deepseek` / `openai` / `anthropic` / `gemini` / `ollama` / `custom` 模型供应商
- 交互式危险工具审批
- 计划生成与批准
- 核心命令：`/help`、`/model`、`/permission`、`/reasoning`、`/sandbox`、
  `/provider`、`/theme`、`/config`、`/mcp`、`/sessions`、`/status`、
  `/clear`、`/quit`
- `/model` 会实时读取当前供应商的模型列表，使用 `↑↓` 选择、`Enter` 切换，
  不需要手动输入模型 ID
- `/permission`、`/reasoning`、`/sandbox`、`/provider`、`/theme` 等可选项
  命令都使用相同的选择面板；`/config` 打开统一设置面板
- `/files`、`/plugins`、`/worktree`、`/checkpoint`、`/complete`、`/fim` 等
  高级命令可直接输入，但不占用核心命令面板
- CLI 以编码任务为核心，不提供 Chat / Work / Code 模式切换
- Git、工作流、代码执行、插件、技能、记忆、符号、LSP 等高级能力由
  Agent 内置工具和自然语言使用。
- `--app-server` 启动 JSON-RPC 2.0 App Server，配套 `@auraxis/core` 的 `AuraxisClient` SDK
- 项目 MCP 配置需 `AURAXIS_TRUST_PROJECT_MCP=1` 后才加载
- Code Mode 的 `RunCode` 支持 TypeScript 工具编排与 JS / Python / Shell 隔离运行
- `RunWorkflow` 支持 `.auraxis/workflows` JSON / Markdown 工作流与内联编排脚本
- `Task*` / `Job*` 管理后台任务，`Pty` / `Terminal*` 提供持久交互终端
- `NotebookEdit` 支持 `.ipynb` 单元格读写，`Delete` 支持带撤销快照删除
- `/reasoning` 设置思考强度，`--reasoning-effort` 可在无头模式使用
- 命令历史自动保存到本地并跨重启恢复
- 输入 `/` 打开命令联想面板，支持 ↑↓ / Tab 选择、Enter 执行、Esc 关闭
- 鼠标滚轮或 PgUp/PgDn 滚动历史消息
- 执行中可继续输入并排队，当前任务完成后自动执行下一条，`Ctrl+Z` 撤回最后一条
- `--max-steps <n>` 设置单次任务的工具轮次上限，`0` 或 `-1` 表示不设上限；
  旧的 `--max-iterations` 仍兼容
- `Ctrl+P` 帮助面板、`Ctrl+O` 执行输出、`Ctrl+L` 清空对话、`Ctrl+U` 清空输入、`Ctrl+W` 删除单词
- `/status` 查看模型、沙箱、权限、分支、会话和项目路径
- 启动首页提供模型、审批、思考、MCP 与帮助快捷入口
- 会话创建、保存与恢复
- 执行视图按工具状态流展示，输出默认折叠并可 `Ctrl+O` 展开；工具与
  Code Mode 子调用统一图标、状态和耗时
- AGENTS.md 分层规则注入；Write/Edit 自动快照 + `Undo` 工具恢复
- Hooks 生命周期：`session_start` / `user_prompt_submit` / `pre_tool_use` /
  `post_tool_use` / `stop`，支持 JSON 协议、阻断、超时与敏感环境变量隔离；
  Code Mode 的 `tools.*` 子调用同样受 hooks 保护
- 回答中的 `diff` 代码块按增删行着色
- `read` / `workspace-write` / `full` / `container` 沙箱策略，container 支持
  Docker/Podman 隔离；自动上下文摘要、长期记忆、插件市场、HTTP MCP、跨会话消息、
  并行子 Agent、符号查找、产物发布和 GitHub PR

CLI 可独立发布，不需要 Auraxis 桌面端。

## 原生二进制

项目同时在 GitHub Releases 发布不依赖 Node 的自包含可执行文件。Windows、
macOS 和 Linux（glibc/musl、x64/arm64）共 8 个变体，每个文件内置 Bun 运行时、
`@auraxis/core` 与 CLI，下载后可直接运行：

```bash
./auraxis-linux-x64 --doctor
./auraxis-windows-x64.exe --code-file program.ts
```

在仓库内可运行 `npm run build:native` 构建当前平台，
`npm run build:native:all` 构建全部平台；构建结果位于
`packages/cli/native/`，`SHA256SUMS.txt` 包含校验和，不会被 npm 包携带。
