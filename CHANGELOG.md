# Auraxis CLI Changelog

## 1.0.0

首个可发布版本。

### 功能

- 交互式 TUI 与非交互 `--run` 执行
- 55 个内置工具，覆盖文件、命令、网络、Git、技能、子 Agent 与验证
- `ask` / `plan` / `auto` 权限策略与交互式审批
- 计划生成、批准与编辑
- 会话创建、恢复、删除与历史渲染
- 本地命令历史持久化
- 编码型 Agent 执行模式
- MCP 服务发现、调用、重载、添加与移除
- 模型、沙箱、思考强度、工具选择、API Base、MaxTokens、主题持久化
- dark / light / neon / mono 四套主题
- DeepSeek 流式输出、思考强度选择、视觉模型工具支持
- API 429/5xx/网络瞬时错误自动重试
- 长会话工具输出裁剪
- Code Mode：worker 线程运行 TypeScript 程序、`tools.*` 工具代理、8 路只读并行、
  写类工具串行、权限审批、120s 超时、Ctrl+C 中止与 50KB 输出裁剪
- 执行视图按工具状态流展示，输出默认折叠并可展开，工具与 Code Mode
  子调用统一图标、状态和耗时动画
- 执行中可继续输入并排队，当前任务完成后按顺序自动执行，`Ctrl+Z` 撤回最后一条
- 鼠标滚轮 / PgUp / PgDn 滚动历史消息；发送任务后输入框立即清空
- 助手回复支持行内 Markdown 加粗与代码、diff 代码块浅底展示
- `/code <file>` 交互命令与 `--code-file` 无头运行入口
- AGENTS.md 分层规则注入（全局 → 项目 .auraxis → 项目根），进入系统提示
- Write/Edit 修改前自动快照，新增 `Undo` 工具可恢复最近一次修改
- `customModels` 自定义模型注册：`--model <id>` 自动切换 apiBase，`/models` 与 `--doctor` 可见
- Hooks 生命周期：全局/项目 hooks 合并，覆盖 session_start、user_prompt_submit、
  pre_tool_use、post_tool_use、stop；pre_tool_use 可阻断、用户输入可拒绝，
  支持 JSON 协议、附加上下文、超时和敏感环境变量剥离；Code Mode 的
  `tools.*` 子调用同样经过 pre/post 门禁
- 回答中的 `diff` 代码块按新增/删除/上下文行着色
- 多模型供应商：deepseek / openai / anthropic / gemini / ollama / custom，
  支持 `--provider`、自定义 provider、输入输出转换和重试
- 上下文管理器：token 估算、工具输出压缩、超预算自动摘要、项目/全局长期记忆
- 沙箱策略：read / workspace-write / full / container，container 默认 Docker
  隔离、网络默认关闭，支持自定义 runner
- HTTP MCP：streamable HTTP、SSE 解析、自定义 headers
- 插件体系：本地/全局插件扫描、plugin.json、skills/hooks/mcp 集成、市场发现
- 跨会话消息、项目产物、并行子 Agent、符号查找、GitHub PR、审计事件日志
- 可选 LSP 定义/引用查询、远程云 Agent 网关委派、上下文预算配置

### 质量

- 三平台 CI：Linux、macOS、Windows
- core 与 CLI 单元测试、headless E2E
- 覆盖率门槛：core statements ≥82%、branches ≥70%、functions ≥80%、lines ≥88%；
  CLI statements ≥95%、branches ≥80%、functions ≥90%、lines ≥95%
- 可发布的 core JS/类型产物与 CLI 独立 bundle

### 修复

- Windows 下 Bash 工具运行带嵌套引号的命令（如 `node -e "console.log(42)"`）会
  静默返回空输出且退出码为 0 → 改为 `shell: true` 由 cmd 直接解析命令行。
- 助手消息的 `tool_calls` 此前以内部格式 {id,name,args} 发出，真实 DeepSeek
  在第二轮会返回空正文 → 序列化为 OpenAI 线路格式
  {id,type:'function',function:{name,arguments}}，并回归验证真实多轮任务。
- 增加统一 schema 校验，配置、Hooks、MCP、会话、插件、模型响应与持久化数据不再依赖
  `as` 强转，非法 JSON 会安全降级或报出可定位错误。
- Code Mode worker 不再继承宿主环境变量，补充代码长度、工具输入大小和资源限制；
  沙箱在只读模式下显式拒绝命令执行，并拦截管道给 shell、eval、关机/格式化等危险命令。
- UI 拆分为 terminal-model / wizard / terminal-controller / app 四层，状态、按键事件
  和渲染视图分离，避免单文件继续膨胀。
