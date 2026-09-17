# Auraxis CLI Changelog

## 1.1.0

DeepSeek 官方接口同步 + Agent 执行视图重做。老配置无需修改即可升级：历史模型名
仍然可用，思考模式默认值与官方一致，未引入破坏性变更。

对齐 DeepSeek 官网 2026-09 的接口文档。

### 变更

- 默认模型切换为 `deepseek-flash`（DeepSeek-V4.1-Flash，原生多模态），
  内置模型表更新为 `deepseek-flash` + `deepseek-v4-pro`，两者同为 1M 上下文、
  384K 最大输出
- 历史模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 归一化到
  `deepseek-flash`，旧配置无需修改即可继续运行
- 默认 Base URL 回归标准 OpenAI 兼容端点
  `https://api.deepseek.com/chat/completions`，不再使用 `/beta` 前缀；
  Responses 为 `https://api.deepseek.com/responses`，
  Anthropic 为 `https://api.deepseek.com/anthropic`
- 新增思考模式开关 `--thinking <on|off>` / `--no-thinking` / `AURAXIS_THINKING`
  与 `/config` 的「思考模式」项；官方语义为 Chat/Anthropic 发
  `thinking.type`、Responses 发 `reasoning.effort = none`，默认开启、默认 high
- effort 取值对齐官方 `low` / `high` / `max`（官方 minimal/medium/xhigh/ultra
  的映射由服务端完成）
- 思考模式下不再下发 `temperature`（官方说明该参数在思考模式无效果）
- Responses 请求固定 `store: false`，与官方无状态接口一致
- Anthropic 兼容端点补齐 `output_config.effort` 与 thinking 开关，并记录官方
  模型映射规则（`claude-opus* → deepseek-v4-pro`，`claude-haiku*`/`claude-sonnet*`
  → `deepseek-flash`）
- 视觉能力跟随模型：`deepseek-flash` 支持 base64 data URL、外链 URL 与
  Files API `file_id` 三种图片输入
- Agent 执行流程视图重做：时间轴引导线（`╭ ├ ╰`）串联每个工具步骤，
  运行中步骤用 80ms 转圈动画并在状态栏显示实时耗时，步骤行右对齐显示耗时，
  表头汇总「进行中 / 已完成 / 执行失败 · N 步 · N 失败 · 总耗时」，
  输出预览统一 `⎿` 缩进并与时间轴对齐，默认只保留最近 6 步、满屏时提示折叠条数
- 对话区的工具卡片与执行视图统一风格：连续的工具调用自动连成 `╭ ├ ╰` 时间轴，
  输出沿用 `⎿` 缩进并与引导线对齐，单条工具保持原来的紧凑单行
- 新增 `npm run ui:snapshot`，把执行视图（含对话区工具卡片）在运行中 / 完成 /
  展开三种状态直接渲染到终端，用于排版回归检查

### 修复

- `models.ts` 内置模型回退清单不再映射不存在的 `experimental` 字段

### 说明

- 版本号首次统一：根包、`@auraxis/core`、`@auraxis/cli` 与源码内版本常量同为
  `1.1.0`，`npm run version:check` 会校验三者一致

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
- `--set-api-key` 现在按当前 provider 保存到对应的 `*_API_KEY`，修复此前
  Anthropic / OpenAI / Gemini / Ollama 密钥被误存为 DeepSeek 的问题。
- 排队任务统一经过执行生命周期清理；即使缺少 API Key、配置文件损坏或 Code Mode
  文件读取失败，也不会卡在“运行中”状态，队列会继续执行下一条。
- CI 和 Release 增加 practical matrix、App Server、SDK 与 npm 打包检查。
- 修复 LSP 客户端按字符串长度解析 UTF-8 帧的问题；包含中文/非 ASCII 路径的
  项目现在可以正常使用定义与引用查询，且显式 `AURAXIS_LSP_ARGS` 不再经过 shell。
- Agent 达到最大工具轮次时不再返回空文本：会强制发起一次禁用工具的收尾总结，
  输出完成情况、验证结果与未完成事项。
- CLI 本地入口会比较 `main.js` 与 `single.js` 的构建时间，避免运行到过期 bundle。
- 将 `--max-iterations` 统一为面向用户的 `--max-steps`，交互模式默认 500 步，
  无头模式默认 200 步，`0/-1` 表示不设上限；旧参数继续作为弃用别名工作。
- Agent 增加重复工具调用与相同结果检测：连续 3 轮没有进展时停止执行并生成收尾总结。
