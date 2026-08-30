# Auraxis CLI v1.0.0

GitHub: [yth1120/Auraxis-CLI](https://github.com/yth1120/Auraxis-CLI)

纯本地运行的 Auraxis Agent 命令行工作台。

该项目不依赖 Electron，也不依赖 Auraxis 桌面端。CLI 直接运行本地 Agent 核心，
提供终端交互、工具执行、权限确认、计划审批、会话恢复和 DeepSeek 流式输出。
npm 安装版需要 Node.js 22.12+；GitHub Releases 提供不依赖 Node 的
Bun 原生二进制。

首次启动会依次引导填写 API Key、选择模型和思考深度，配置完成后进入交互主页。

## 快速开始

```bash
npm install
npm run build
npm run cli
```

不想安装 Node 时，可以直接从 GitHub Releases 下载对应平台的原生二进制：

- Windows x64 / arm64：`auraxis-windows-x64.exe`、`auraxis-windows-arm64.exe`
- macOS x64 / arm64：`auraxis-darwin-x64`、`auraxis-darwin-arm64`
- Linux glibc x64 / arm64：`auraxis-linux-x64`、`auraxis-linux-arm64`
- Linux musl x64 / arm64：`auraxis-linux-x64-musl`、`auraxis-linux-arm64-musl`

每个二进制都已内置 Bun 运行时、`@auraxis/core` 和 CLI，不需要 Node、Bun 或
额外的 npm 依赖；同目录的 `SHA256SUMS.txt` 可用于校验。发布流程会在 CI
中交叉编译并自动上传全部产物。

本地构建一种或全部平台：

```bash
npm run build:native          # 当前平台
npm run build:native:all      # 全部 8 个平台
npm run check:native          # 构建当前平台并运行原生冒烟测试
```

可选的真实环境集成测试（需要对应外部服务）：

```bash
npm run e2e:live              # 调用已配置的模型供应商
npm run e2e:lsp               # 使用 typescript-language-server 验证定义/引用
npm run e2e:container         # 使用 Docker 容器沙箱执行隔离命令
```

需要提供 DeepSeek API Key：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
npx auraxis
```

或在项目根目录创建 `.env`：

```dotenv
DEEPSEEK_API_KEY=sk-...
```

## 常用命令

```bash
auraxis                          # 交互式 TUI
auraxis --no-banner              # 跳过启动卡片，直接进入输入
auraxis --run "修复登录 bug"      # 非交互一次执行
auraxis --code-file scripts/agent.ts  # 以 Code Mode 运行 TypeScript 程序
auraxis --model deepseek-v4-pro --reasoning-effort high
auraxis --provider anthropic --model claude-sonnet-4-5
auraxis --provider deepseek --api-family responses --run "读取 README.md"
auraxis --provider deepseek --api-family anthropic --run "读取 README.md"
auraxis --complete "function add(a, b) {"
auraxis --fim "function add(a, b) {|| return a + b; }"
auraxis --files list
auraxis --vision-detail low --model deepseek-v4-flash-vision-exp
auraxis --sandbox container --run "运行测试"
auraxis --context-budget 120000 --run "处理大型项目"
auraxis --sessions               # 查看历史会话
auraxis --cwd D:/projects/demo
auraxis --doctor                 # 检查配置
auraxis --theme neon
```

## 模型供应商

内置 `deepseek`、`openai`、`anthropic`、`gemini`、`ollama` 和 `custom` 六种
provider。使用 `--provider` 在启动时指定，交互模式下 `/provider` 会打开
供应商选择面板，`--model` 选择具体模型：

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
auraxis --provider anthropic --model claude-sonnet-4-5

$env:OPENAI_API_KEY = "sk-..."
auraxis --provider openai --model gpt-5.3-codex

auraxis --provider ollama --model qwen2.5-coder
```

`customModels` 支持注册 provider、apiBase、apiKeyEnv、maxTokens、strictTools、
headers、contextWindow 和 supportsImages：

```json
{
  "customModels": [
    {
      "id": "my-gateway",
      "name": "My Gateway",
      "provider": "openai",
      "apiBase": "https://gw.example.com/v1/chat/completions"
    }
  ]
}
```

## 环境变量

以下变量都会被真实代码消费：

| 分类 | 变量 |
| --- | --- |
| 密钥 | `DEEPSEEK_API_KEY`、`AURAXIS_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`OPENAI_API_KEY`、`OLLAMA_API_KEY` |
| 运行配置 | `AURAXIS_PROVIDER`、`AURAXIS_MODEL`、`AURAXIS_API_BASE`、`DEEPSEEK_BASE_URL`、`AURAXIS_API_FAMILY`、`AURAXIS_REASONING_EFFORT`、`AURAXIS_TOOL_CHOICE`、`AURAXIS_CONTEXT_BUDGET`、`AURAXIS_MODE`、`AURAXIS_SANDBOX`、`AURAXIS_THEME`、`AURAXIS_VISION_DETAIL`、`AURAXIS_STRICT_TOOLS` |
| 运行时 | `AURAXIS_HOME`、`AURAXIS_ALLOW_UNSAFE_CODE`、`AURAXIS_PYTHON_BIN`、`AURAXIS_PWSH`、`AURAXIS_SHELL` |
| 集成 | `AURAXIS_LSP_COMMAND`、`AURAXIS_LSP_ARGS`、`AURAXIS_LSP_INIT_OPTIONS`、`AURAXIS_MCP_SERVERS`、`AURAXIS_TRUST_PROJECT_MCP`、`AURAXIS_TRUST_PROJECT_HOOKS`、`AURAXIS_PLUGIN_MARKETPLACE`、`AURAXIS_REMOTE_API`、`AURAXIS_REMOTE_TOKEN` |
| 容器 | `AURAXIS_CONTAINER_RUNNER`、`AURAXIS_CONTAINER_IMAGE`、`AURAXIS_CONTAINER_WORKDIR`、`AURAXIS_CONTAINER_NETWORK` |

项目 `.env` 会被读取，但 `AURAXIS_HOME`、`AURAXIS_ALLOW_UNSAFE_CODE`、容器、
LSP、MCP 和插件市场等安全相关变量不会从项目 `.env` 注入，只能通过真实环境或
全局配置设置。

## DeepSeek 接口协议

默认使用 OpenAI 兼容的 Chat Completions。可以通过 `--api-family` / `/api-family`
切换三种协议：

- `chat`：默认，支持 Thinking、Tool Calls、JSON Output、strict Function Calling。
- `responses`：DeepSeek 原生 Responses API，面向 Codex 生态，支持流式输出和
  `file_id` 图片；启用后仍复用同一套 Agent 工具循环。
- `anthropic`：DeepSeek 官方的 Anthropic 兼容端点，可以通过 Claude Code 生态工具
  或使用 `AnthropicClient` 调用 DeepSeek 模型。

`--strict-tools` / `/strict-tools on` 会为 DeepSeek Chat Completions 启用
strict Function Calling，并自动规范化工具 JSON Schema；默认开启，
`--no-strict-tools` 可以关闭。

## 图片与 Files API

`deepseek-v4-flash-vision-exp` 支持 JPEG / PNG / GIF / WebP。`--vision-detail`
可控制图片精度（`low` 会先将图片缩放为 512×512，适合截图和 UI 预览）。

`ReadImage` 会在图片较大时自动通过 DeepSeek Files API 上传；也可以手动管理：

```bash
auraxis --files list
auraxis --files upload ./screenshot.png
auraxis --files info file-api-xxxxxxxxxxxxxxxx
auraxis --files delete file-api-xxxxxxxxxxxxxxxx
```

交互模式对应 `/files list`、`/files upload <path>`、`/files info <id>` 和
`/files delete <id>`。

## 补全

DeepSeek 官方 Beta 能力可以直接通过 CLI 使用：

```bash
auraxis --complete "function add(a, b) {"
auraxis --fim "function add(a, b) {|| return a + b; }"
```

交互模式使用 `/complete <前缀>` 和 `/fim <前缀>||<后缀>`。

## MCP

将以下文件放到 `~/.auraxis/config/mcp.json`，或在项目 `.auraxis/mcp.json` 中配置：

```json
{
  "servers": [
    {
      "name": "deepseek-harness",
      "command": "npx.cmd",
      "args": ["-y", "deepseek-harness-mcp"]
    }
  ]
}
```

全局 MCP 配置始终加载；项目目录中的 `.auraxis/mcp.json` 和 `.auraxis.json#mcpServers`
默认不信任，只有设置 `AURAXIS_TRUST_PROJECT_MCP=1` 才会加载。
安全开关（项目 MCP/Hooks 信任、任意代码执行、容器和 LSP 配置等）只从
用户环境读取；项目目录中的 `.env` 不会提升这些信任级别。

MCP 工具会自动出现在 Agent 工具列表中，并在执行前经过同样的权限审批。
HTTP MCP 使用 `transport: "http"`：

```json
{
  "servers": [
    {
      "name": "remote-tools",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  ]
}
```

## Hooks

Hooks 允许你在 Agent 生命周期中挂载自己的命令，用于安全门禁、审计、日志或动态
上下文注入。配置文件放在 `~/.auraxis/config/hooks.json`；项目级
`.auraxis/hooks.json` 只有设置 `AURAXIS_TRUST_PROJECT_HOOKS=1` 时才会加载。
全局与项目 hooks 会按顺序合并执行。

支持的事件：

- `session_start`：会话开始，payload 包含 `projectRoot`、`model`、`sessionId`
- `user_prompt_submit`：用户输入被提交前
- `pre_tool_use`：工具调用前，可阻断
- `post_tool_use`：工具执行成功或失败后（包含 `ok` / `error`）
- `stop`：Agent 返回结果前
- `session_end`：会话结束，与 `stop` 一起在返回结果前触发

示例：

```json
{
  "hooks": {
    "pre_tool_use": [
      {
        "command": "node ~/.auraxis/hooks/pre-tool.mjs",
        "timeout": 5000
      }
    ],
    "post_tool_use": [
      { "command": "node ~/.auraxis/hooks/post-tool.mjs" }
    ]
  }
}
```

Hook 通过 stdin 接收 JSON payload，并可通过 stdout 返回 JSON 协议：

```json
{
  "decision": "block",
  "stopReason": "policy",
  "additionalContext": "提示模型注意的策略"
}
```

`pre_tool_use` 返回 `decision: "block"` 或退出码非零时工具不会执行；
`user_prompt_submit` 返回 `continue: false` 时阻止输入进入模型。
`additionalContext` 会被追加到后续对话上下文。命令默认 10 秒超时，并且不会
收到 `API_KEY` / `TOKEN` / `SECRET` / `PASSWORD` / `AUTH` / `CREDENTIAL` /
`PRIVATE_KEY` 等敏感环境变量。

Code Mode 的 `tools.*` 子调用同样经过 `pre_tool_use` / `post_tool_use`，
因此 worker 中的写文件、执行命令等动作也不会绕过 hooks 门禁。

## 沙箱、记忆与插件

- `read`：只允许读取，禁止写入、执行和网络访问。
- `workspace-write`：允许项目内修改，文件路径会被限制在项目根目录。
- `full`：完全访问，危险命令仍会经过权限审批。
- `container`：通过 Docker/Podman 隔离执行。默认使用
  `docker run --rm -v <项目>:/workspace -w /workspace --network none node:24-alpine`；
  可通过 `AURAXIS_CONTAINER_RUNNER`、`AURAXIS_CONTAINER_IMAGE`、
  `AURAXIS_CONTAINER_WORKDIR` 和 `AURAXIS_CONTAINER_NETWORK` 自定义。

长期记忆保存在项目 `.auraxis/memory.json` 和全局
`~/.auraxis/memory.json`。Agent 可以通过 `MemoryRemember` / `MemorySearch`
读写；超预算的历史对话会在需要时自动摘要压缩。

插件放在 `~/.auraxis/plugins` 或项目 `.auraxis/plugins`，每个插件目录需要
`plugin.json`，可声明 `skills`、`hooks` 和 `mcp`：

```json
{
  "id": "team-rules",
  "name": "Team Rules",
  "skills": ["review"],
  "hooks": {
    "post_tool_use": [
      { "command": "node ~/.auraxis/hooks/log-tool.mjs" }
    ]
  }
}
```

CLI 中可用 `/plugins`、`/plugins install <目录>` 和 `/plugins discover`；
Agent 也有 `PluginManage` 工具。项目插件默认需要
`AURAXIS_TRUST_PROJECT_HOOKS=1` 才会加载 hooks / MCP。

还提供跨会话消息（`SendMessage` / `ReadMessages`）、项目产物
（`PublishArtifact` / `ListArtifacts`）、符号查找（`FindSymbol`）、并行子 Agent
（`SpawnAgents`）和 GitHub PR（`CreatePullRequest`）。所有运行事件会写入
项目 `.auraxis/audit/<session>.jsonl`。

配置 `AURAXIS_LSP_COMMAND`（可选 `AURAXIS_LSP_ARGS` JSON 数组）后，
`LspDefinition` / `LspReferences` 会通过真正的语言服务器定位符号和引用；
未配置时自动回退到 `FindSymbol`。配置 `AURAXIS_REMOTE_API` 和
`AURAXIS_REMOTE_TOKEN` 后，`RemoteAgent` 可以把任务委派给远程云网关。

LSP 客户端使用标准 `Content-Length` 帧协议，并支持通过
`AURAXIS_LSP_INIT_OPTIONS` 传入 JSON 初始化选项，例如指定
`typescript-language-server` 使用的 TypeScript：

```powershell
$env:AURAXIS_LSP_COMMAND = 'typescript-language-server --stdio'
$env:AURAXIS_LSP_INIT_OPTIONS = '{"tsserver":{"path":"C:/path/to/lib/tsserver.js"}}'
```

## 终端交互

```text
/model                              选择模型（实时获取 DeepSeek 模型列表）
/permission                         选择审批模式
/reasoning                          选择思考强度
/sandbox                            选择沙箱策略
/provider                           选择供应商
/theme                              选择主题
/config                             打开设置面板
/mcp                                管理 MCP 服务
/sessions                           选择并恢复会话
/status                             查看当前状态
/clear                              清空当前会话
/help                               查看可用命令
/quit                               退出
```

交互模式下 `/model` 会实时请求当前模型供应商的模型列表，`↑↓` 选择、
`Enter` 切换、`Esc` 取消，不需要手动输入模型 ID。

执行中仍可继续输入并回车排入等待队列；当前任务结束后会按顺序自动执行下一条，
队列区域显示等待中的任务，按 `Ctrl+Z` 可撤回最后一条。

权限、思考、沙箱、供应商、接口协议、视觉精度、主题等可选项命令采用相同
的选择面板；`/config` 是统一的设置入口。

命令面板保持精简；`/files`、`/plugins`、`/worktree`、`/checkpoint`、
`/complete`、`/fim`、`/memory`、`/symbol`、`/review`、`/git` 等高级
命令仍然可直接输入，但不会出现在核心面板中。

Git、工作流、代码执行、工具编排、插件、技能、记忆、符号查找等高级能力
同时通过 Agent 内置工具和自然语言使用。

快捷键:

```text
Ctrl+P      打开/关闭帮助面板
Ctrl+T      展开/收起思考
Ctrl+O      展开/收起执行输出
Ctrl+Z      撤回最后一条排队任务
Ctrl+L      清空当前对话
Ctrl+U      清空输入
Ctrl+W      删除上一个单词
PgUp/PgDn   浏览历史
鼠标滚轮     滚动消息
Ctrl+C      取消当前任务，再按一次退出
↑/↓          命令历史或命令联想
Tab          操作命令面板 / 首页权限切换
输入 /       打开命令联想面板
```

## Code Mode

`/code <file.ts>`（或 `--code-file`）在独立 worker 线程中运行 TypeScript
程序，程序里的 `await tools.工具名(args)` 会调用全部内置/MCP 工具，返回
内容字符串作为 Promise 结果：

```ts
const out = await tools.Read({ file_path: 'src/index.ts' });
console.log(out.slice(0, 200));
await tools.Write({ file_path: 'out.txt', content: 'hi' });
```

- 每个子调用都经过同一套权限审批（ask/plan/auto），可交互拒绝
- 只读工具（Read/Grep/Glob/…）最多 8 路并行，写类工具自动串行
- 默认 120s 硬超时，Ctrl+C 可中止，输出按 50KB 裁剪
- TUI 实时展示子调用图标、状态和耗时，使用工具状态流执行视图
- `RunCode` 模型工具支持 `typescript` / `javascript` / `python` / `shell`；
  TypeScript 模式会先编译再进入 worker
- `RunWorkflow` 支持 `.auraxis/workflows/*.json|*.md` 与内联编排脚本
- `Task*` / `Job*` 管理后台 Bash 任务，`Pty` / `Terminal*` 提供持久交互终端
- `NotebookEdit` 读写 `.ipynb`，`Delete` 删除前保存撤销快照
- 模型代码子进程使用白名单环境，API Key 与 Token 不会泄漏；所有运行环境默认关闭
  任意代码执行，需显式设置 `AURAXIS_ALLOW_UNSAFE_CODE=1`

## App Server 与 SDK

`auraxis --app-server` 提供 JSON-RPC 2.0 over stdio 协议，支持：

- `initialize` / `initialized`
- `thread/start` / `thread/resume` / `thread/fork` / `thread/list`
- `turn/start` / `shutdown`
- 事件流：`item/agentMessage/delta`、`item/tool/*`、`turn/completed`

TypeScript 客户端可以直接调用：

```ts
import { AuraxisClient } from '@auraxis/core';

const client = new AuraxisClient({ projectRoot: process.cwd(), apiKey: process.env.DEEPSEEK_API_KEY });
await client.connect();
const threadId = await client.startThread();
const result = await client.run(threadId, '实现登录功能');
```

SDK 还提供 `resumeThread`、`listThreads`、`forkThread` 和
`archiveThread`，并支持将 `reasoningEffort`、`toolChoice`、`contextBudget`
等选项传给 App Server。

Git 工作树与检查点命令：

```text
/worktree create [branch]
/worktree list
/worktree remove <id>
/checkpoint create [name]
/checkpoint list
/checkpoint restore <id>
```

## 规则、撤销与模型

- AGENTS.md 分层注入：全局 `~/.auraxis/config/AGENTS.md` → 项目
  `.auraxis/AGENTS.md` → 项目 `AGENTS.md`，进入每个任务的系统提示。
- Write / Edit 修改前自动保存快照，Agent 可调用 `Undo` 工具恢复最近一次修改，
  避免无法回滚的误覆盖。
- 自定义模型：在 `~/.auraxis/config/config.json` 的 `customModels` 注册
  `{ id, name, apiBase }`，`--model <id>` 选择后自动使用对应 API 地址；
  `--doctor` 可用于检查；交互模式下 `/model` 会从供应商实时列表选择。
- 回答中的 `diff` 代码块会自动着色：`+` 新增行为绿色、`-` 删除行为红色、
  其他行使用弱化色。

## 架构

```text
packages/core  纯 Node Agent 核心：LLM、ReAct、工具、权限、会话
packages/cli   终端 TUI、参数解析、非交互输出
```

CLI 不依赖桌面端。后续桌面端可以复用 `@auraxis/core`，但反过来不成立。

## 发布

```bash
npm run check
npm run pack:check
npm run build:native:all
```

核心包先发布，再发布 CLI 包：`npm publish -w @auraxis/core && npm publish -w @auraxis/cli`。
推送到 `v*` tag 后，GitHub Actions 会自动发布 npm 包，并把原生二进制上传到
GitHub Releases。
