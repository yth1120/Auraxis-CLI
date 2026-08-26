# Auraxis CLI

纯 Node.js 的 Auraxis Agent 命令行工作台。

该项目不依赖 Electron，也不依赖 Auraxis 桌面端。CLI 直接运行本地 Agent 核心，
提供终端交互、工具执行、权限确认、计划审批、会话恢复和 DeepSeek 流式输出。

## 快速开始

```bash
npm install
npm run build
npm run cli
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
auraxis --run "修复登录 bug"      # 非交互一次执行
auraxis --model deepseek-v4-pro --deep-think
auraxis session                  # 查看历史会话
auraxis --cwd D:/projects/demo
auraxis doctor                   # 检查配置
```

## MCP

将以下文件放到 `~/.auraxis/mcp.json`，或在项目 `.auraxis/mcp.json` 中配置：

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

MCP 工具会自动出现在 Agent 工具列表中，并在执行前经过同样的权限审批。

## 架构

```text
packages/core  纯 Node Agent 核心：LLM、ReAct、工具、权限、会话
packages/cli   终端 TUI、参数解析、非交互输出
```

CLI 不依赖桌面端。后续桌面端可以复用 `@auraxis/core`，但反过来不成立。
