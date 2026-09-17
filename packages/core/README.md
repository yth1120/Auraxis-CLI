# @auraxis/core

纯 Node.js 的 Auraxis Agent 核心。

核心不依赖 Electron、桌面 UI 或 IPC，只依赖 Node 22+、`fast-glob`、`zod`
和用于 Code Mode 编译的 TypeScript 5 兼容模块。

提供：

- DeepSeek OpenAI 兼容流式客户端
- DeepSeek Responses API 客户端（支持多轮工具调用、Thinking、图片与 Files API）
- DeepSeek Files API 客户端（上传、列举、查询、删除）
- Anthropic / Gemini / OpenAI / Ollama / custom provider 适配
- DeepSeek Anthropic 兼容端点预设与 strict Function Calling
- ReAct 循环
- Code Mode：TypeScript 工人线程工具编排、JS / Python / Shell 隔离运行
- RunWorkflow 多 Agent 编排、Task/Job 后台任务、PTY/Terminal 持久终端
- NotebookEdit、Delete、Replan 与子进程环境白名单脱敏
- 文件、Shell、网页、任务清单等内置工具
- 权限门与计划审批接口
- 会话持久化
- 上下文摘要、长期记忆、沙箱策略、插件、HTTP MCP、跨会话消息与审计
- 标准 LSP 客户端（UTF-8 `Content-Length` 帧协议、`AURAXIS_LSP_ARGS` 与
  `AURAXIS_LSP_INIT_OPTIONS`，可用 `AURAXIS_LSP_DEBUG=1` 排查启动问题）
- Agent 执行保护：`maxSteps` 工具轮次预算、重复无进展检测，以及触发限制后的
  无工具收尾总结

后续桌面端如果复用该包，也不会反向影响 CLI 的独立性。
