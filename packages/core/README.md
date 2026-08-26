# @auraxis/core

纯 Node.js 的 Auraxis Agent 核心。

核心不依赖 Electron、桌面 UI 或 IPC，只依赖 Node 22+ 和 `fast-glob`。

提供：

- DeepSeek OpenAI 兼容流式客户端
- ReAct 循环
- 文件、Shell、网页、任务清单等内置工具
- 权限门与计划审批接口
- 会话持久化

后续桌面端如果复用该包，也不会反向影响 CLI 的独立性。
