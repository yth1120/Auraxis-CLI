import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLlmClient } from '../providers.js';
import { createDeepSeekFilesClient } from '../files.js';
import { truncateText, type AgentEvent } from '../events.js';
import { getTool, type ToolContext } from '../tools/registry.js';
import { PermissionGate } from './permissions.js';
import { generatePlan } from './planner.js';
import { scanSkills, readSkillContent, type SkillRecord } from '../skills.js';
import { chatMessageText, type ChatMessage, type ChatContentPart, type Plan, type PlanDecision, type RunOptions, type RunResult, type ToolDefinition } from '../types.js';
import { modelSupportsImages, type JsonObject } from '../types.js';
import { getAppPaths } from '../config.js';
import { UndoStore } from '../undo.js';
import { compactMessages, estimateChatTokens, summarizeMessages } from '../context.js';
import { MemoryStore, loadMemoryContext } from '../memory.js';
import { SandboxPolicy } from '../sandbox.js';
import { AuditStore } from '../audit.js';
import { SessionMailbox } from '../mailbox.js';
import { LspManager } from '../lsp.js';
import {
  loadHooks,
  runHooksFor,
  type HookConfig,
  type HookEvent,
  type HooksDispatch,
} from '../hooks.js';
import { asJsonObject } from '../validation.js';

/** 分层规则注入：全局 config/AGENTS.md → 项目 .auraxis/AGENTS.md → 项目 AGENTS.md。 */
async function loadLayeredInstructions(root: string): Promise<string> {
  const paths = getAppPaths();
  const candidates: Array<{ file: string; label: string }> = [
    { file: path.join(paths.configDir, 'AGENTS.md'), label: '全局规则' },
    { file: path.join(root, '.auraxis', 'AGENTS.md'), label: '项目规则' },
    { file: path.join(root, 'AGENTS.md'), label: '项目规则' },
  ];
  const parts: string[] = [];
  for (const { file, label } of candidates) {
    try {
      const content = (await fsp.readFile(file, 'utf8')).trim();
      if (content) parts.push(`### ${label}\n${content.slice(0, 12_000)}`);
    } catch {
      /* 文件不存在时跳过 */
    }
  }
  return parts.join('\n\n');
}

export function buildSystemPrompt(
  projectRoot: string,
  tools: ToolDefinition[],
  instructions = '',
): string {
  const rules = instructions.trim()
    ? ['', '## 项目规则', instructions.trim()]
    : [];
  return [
    '你是 Auraxis Agent，一个运行在用户终端中的编码智能体。',
    `项目根目录: ${path.resolve(projectRoot)}`,
    `平台: ${process.platform} / Node ${process.version}`,
    '',
    '工作方式:',
    '- 先阅读相关文件并确认事实，不要凭猜测回答。',
    '- 优先使用工具而不是假装看过代码。',
    '- 修改文件前先读取当前内容，避免覆盖用户未提交的改动。',
    '- 每个工具调用只做一件事，参数必须完整。',
    '- 工具失败后根据错误继续，不要重复完全相同的失败调用。',
    '- 任务完成时输出 <FINAL_ANSWER>。',
    '',
    `可用工具: ${tools.map((tool) => tool.name).join(', ')}`,
    ...rules,
  ].join('\n');
}

function ensureSystemMessage(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
  const rest = messages.length > 0 && messages[0].role === 'system' ? messages.slice(1) : messages;
  return [{ role: 'system', content: systemPrompt }, ...rest];
}

function cleanFinal(text: string): string {
  return text.replace(/<FINAL_ANSWER>/gi, '').replace(/<\/FINAL_ANSWER>/gi, '').trim();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function usageEvent(usage: { inputTokens: number; outputTokens: number; cacheHitTokens?: number; cacheMissTokens?: number; reasoningTokens?: number }): AgentEvent {
  return { type: 'usage', ...usage };
}

function buildToolSpecs(tools: ToolDefinition[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function appendHookContext(messages: ChatMessage[], context?: string): void {
  const trimmed = context?.trim();
  if (!trimmed) return;
  messages.push({ role: 'user', content: `[Hook 上下文]\n${trimmed}` });
}

function hookBlockedMessage(event: HookEvent, dispatch: HooksDispatch): string {
  const detail = dispatch.outputs.filter(Boolean).join('\n').trim();
  return detail
    ? `Hook ${event} 阻止了本次执行：${truncateText(detail, 240)}`
    : `Hook ${event} 阻止了本次执行`;
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const audit = AuditStore.session(options.projectRoot, options.sessionId);
  const emit = (event: AgentEvent) => {
    options.onEvent?.(event);
    void audit.append({ type: event.type, data: event, sessionId: options.sessionId }).catch(() => {});
  };
  const lsp = await LspManager.fromEnv(options.projectRoot);
  const runOptions: RunOptions = { ...options, onEvent: emit, lsp: lsp || undefined };
  const hooks = await loadHooks(options.projectRoot);
  const sessionDispatch = await runHooksFor(
    'session_start',
    { projectRoot: options.projectRoot, model: options.model, sessionId: options.sessionId },
    options.projectRoot,
    hooks,
  );

  let result: RunResult | undefined;
  try {
    result = await runAgentCore(runOptions, hooks, sessionDispatch);
  } finally {
    const stopDispatch = await runHooksFor(
      'stop',
      { iterations: result?.iterations ?? 0, toolCallCount: result?.toolCallCount ?? 0 },
      options.projectRoot,
      hooks,
    );
    if (stopDispatch.stopReason) {
      emit({ type: 'system_message', level: 'warning', content: `Hook 停止原因：${stopDispatch.stopReason}` });
    }
    if (result && stopDispatch.additionalContext) {
      appendHookContext(result.messages, stopDispatch.additionalContext);
    }
    await audit
      .append({ type: 'stop', data: { iterations: result?.iterations ?? 0, toolCallCount: result?.toolCallCount ?? 0 }, sessionId: options.sessionId })
      .catch(() => {});
    await runHooksFor(
      'session_end',
      { projectRoot: options.projectRoot, sessionId: options.sessionId, iterations: result?.iterations ?? 0 },
      options.projectRoot,
      hooks,
    );
    await lsp?.close().catch(() => {});
  }
  return result!;
}

async function runAgentCore(
  options: RunOptions,
  hooks: Partial<Record<HookEvent, HookConfig[]>>,
  sessionDispatch: HooksDispatch,
): Promise<RunResult> {
  const emit = options.onEvent || (() => {});
const llm = options.llm || createLlmClient({
    provider: options.provider || 'deepseek',
    apiFamily: options.apiFamily,
    apiKey: options.apiKey,
    apiBase: options.apiBase,
    headers: options.headers,
    model: options.model,
    maxTokens: options.maxTokens || 32768,
    maxRetries: 3,
    strictTools: options.strictTools,
  });
  const permissionGate = new PermissionGate({
    mode: options.mode,
    sandboxMode: options.sandboxMode,
    projectRoot: options.projectRoot,
    requestPermission: options.requestPermission,
  });
  const instructions = await loadLayeredInstructions(options.projectRoot);
  const memories = await loadMemoryContext(options.projectRoot);
  const systemPrompt = buildSystemPrompt(
    options.projectRoot,
    options.tools,
    [instructions, memories ? `## 项目记忆\n${memories}` : ''].filter(Boolean).join('\n\n'),
  );
  let messages = ensureSystemMessage([...(options.resumeMessages || [])], systemPrompt);
  appendHookContext(messages, sessionDispatch.additionalContext);
  messages = compactMessages(messages);
  if (messages.length === 0 || messages.at(-1)?.role !== 'user') {
    messages.push({ role: 'user', content: options.prompt });
  }
  const promptDispatch = await runHooksFor(
    'user_prompt_submit',
    { projectRoot: options.projectRoot, prompt: options.prompt, sessionId: options.sessionId },
    options.projectRoot,
    hooks,
  );
  if (promptDispatch.blocked) {
    emit({ type: 'system_message', level: 'warning', content: hookBlockedMessage('user_prompt_submit', promptDispatch) });
    return { text: '', messages, iterations: 0, toolCallCount: 0, plan: null, aborted: false };
  }
  appendHookContext(messages, promptDispatch.additionalContext);

  let activePlan: Plan | null = null;
  let text = '';
  let toolCallCount = 0;
  let aborted = false;
  let contextSummarized = false;
  const todos: Plan['tasks'] = [];

  const context: ToolContext = {
    projectRoot: options.projectRoot,
    sessionId: options.sessionId,
    undo: new UndoStore(path.join(getAppPaths().home, 'undo')),
    memory: MemoryStore.project(options.projectRoot),
    mailbox: SessionMailbox.global(),
    lsp: options.lsp || undefined,
    sandbox: new SandboxPolicy({
      mode: options.sandboxMode,
      projectRoot: options.projectRoot,
      allowNetwork: options.sandboxMode !== 'container',
    }),
    emit,
    askUser: options.askUser,
    tools: options.tools,
    todos,
    setTodos: (next) => {
      todos.splice(0, todos.length, ...next);
    },
    signal: options.signal,
    mcp: options.mcp,
    files: options.files || createDeepSeekFilesClient({
      provider: options.provider || 'deepseek',
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      headers: options.headers,
    }),
    supportsImages: options.supportsImages,
    visionDetail: options.visionDetail,
  };
  context.executeTool = async (name: string, input: JsonObject) => {
    const staticTool = getTool(name);
    const mcpDefinition = options.mcp?.getDefinition(name);
    const definition = staticTool?.definition || mcpDefinition;
    if (!staticTool && !mcpDefinition) return { output: null, error: `未知工具: ${name}` };
    const permission = await permissionGate.allow(
      name,
      definition?.danger || 'mcp',
      input,
    );
    if (!permission.allowed) return { output: null, error: 'Code Mode 子调用被拒绝' };
    try {
      if (staticTool) {
        const output = await staticTool.runner(input, context);
        return { output: output.content };
      }
      if (mcpDefinition?.mcpServer && options.mcp) {
        return { output: await options.mcp.call(mcpDefinition.mcpServer, name, input) };
      }
      return { output: null, error: 'Code Mode 子调用不可用' };
    } catch (error) {
      return { output: null, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const skills = await scanSkills(options.projectRoot).catch(() => []);
  const skillMap = new Map<string, SkillRecord>(skills.map((skill) => [skill.id, skill]));
  context.listSkills = async () => skills;
  context.readSkill = async (id) => {
    const skill = skillMap.get(id);
    return skill ? readSkillContent(skill) : '';
  };

  const runSubAgent = async (prompt: string, description?: string): Promise<string> => {
    const depth = options.subAgentDepth ?? 0;
    if (depth >= 2) throw new Error('子 Agent 嵌套深度超过上限');
    emit({ type: 'system_message', level: 'info', content: `正在启动子 Agent: ${description || '未命名任务'}` });
    const subResult = await runAgent({
      ...options,
      prompt,
      sessionId: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      resumeMessages: [],
      subAgentDepth: depth + 1,
      onEvent: (event) => {
        if (event.type === 'error') emit({ type: 'system_message', level: 'warning', content: `[子 Agent] ${event.error}` });
      },
    });
    emit({ type: 'system_message', level: 'info', content: `子 Agent 完成: ${description || '未命名任务'}` });
    return subResult.text;
  };
  context.runSubAgent = runSubAgent;
  const runSubAgents = async (tasks: Array<{ prompt: string; description?: string }>): Promise<string[]> => {
    const depth = options.subAgentDepth ?? 0;
    if (depth >= 2) throw new Error('子 Agent 嵌套深度超过上限');
    if (!tasks.length || tasks.length > 8) throw new Error('并行子 Agent 数量必须在 1 到 8 之间');
    emit({ type: 'system_message', level: 'info', content: `正在启动 ${tasks.length} 个并行子 Agent` });
    return Promise.all(
      tasks.map(async (task, index) => {
        const description = task.description || `并行任务 ${index + 1}`;
        const subResult = await runAgent({
          ...options,
          prompt: task.prompt,
          sessionId: `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          resumeMessages: [],
          subAgentDepth: depth + 1,
          onEvent: (event) => {
            if (event.type === 'error') emit({ type: 'system_message', level: 'warning', content: `[${description}] ${event.error}` });
          },
        });
        emit({ type: 'system_message', level: 'info', content: `并行子 Agent 完成: ${description}` });
        return subResult.text;
      }),
    );
  };
  context.runSubAgents = runSubAgents;

  if (options.mode === 'plan') {
    try {
      const plan = await generatePlan(llm, options.prompt, options.projectRoot, options.signal);
      activePlan = plan;
      emit({ type: 'plan_created', plan });
      const decision: PlanDecision = options.onPlanApproval ? await options.onPlanApproval(plan) : 'reject';
      if (decision === 'reject') {
        emit({ type: 'system_message', level: 'warning', content: '计划未批准，未执行任何工具' });
        return { text: '', messages, iterations: 0, toolCallCount: 0, plan: activePlan, aborted: false };
      }
      if (decision === 'edit') {
        const edited = options.onPlanEdit ? await options.onPlanEdit(activePlan) : null;
        if (edited && edited.tasks.length > 0) activePlan = edited;
        emit({ type: 'system_message', level: 'info', content: '计划已更新' });
      }
      emit({ type: 'plan_updated', plan: { ...activePlan, approvedSteps: activePlan.tasks.map((task) => task.id) } });
    } catch (error) {
      emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      return { text: '', messages, iterations: 0, toolCallCount: 0, plan: null, aborted: false };
    }
  }

  const maxSteps = options.maxSteps ?? options.maxIterations ?? 500;
  const unlimitedSteps = maxSteps <= 0;
  let completedSteps = 0;
  let loopDetected = false;
  let repeatedBatchCount = 0;
  let previousBatchFingerprint = '';
  let previousBatchResultSignature = '';
  for (let step = 1; unlimitedSteps || step <= maxSteps; step += 1) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    emit({ type: 'iteration_start', iteration: step });
    completedSteps = step;
    messages = compactMessages(messages);
    if (!contextSummarized && estimateChatTokens(messages) > (options.contextBudget || 220_000)) {
      const summarized = await summarizeMessages(llm, messages, options.projectRoot, options.signal);
      messages = summarized.messages;
      contextSummarized = true;
      emit({ type: 'system_message', level: 'info', content: `上下文超过预算，已自动压缩并保留摘要（${summarized.summary.slice(0, 120)}…）` });
    }
    const result = await llm.chat({
      messages,
      tools: buildToolSpecs(options.tools),
      toolChoice: options.toolChoice,
      stream: true,
      reasoningEffort: options.reasoningEffort || 'high',
      maxTokens: options.maxTokens ?? 32768,
      signal: options.signal,
      onTextChunk: (chunk) => emit({ type: 'text_chunk', text: chunk }),
      onThinkingChunk: (chunk, isNewBlock) => emit({ type: 'thinking_chunk', chunk, isNewBlock }),
      onUsage: (usage) => emit(usageEvent({ ...usage })),
    });

    const assistant: ChatMessage = {
      role: 'assistant',
      content: result.content || undefined,
      reasoning_content: result.reasoning || undefined,
      tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
    };
    messages.push(assistant);

    if (result.toolCalls.length === 0) {
      text = cleanFinal(result.content);
      emit({ type: 'done', result: text });
      break;
    }

    const pendingHookContexts: string[] = [];
    const toolMessageStart = messages.length;
    const batchFingerprint = result.toolCalls
      .map((call) => `${call.name}:${stableStringify(call.args)}`)
      .join('|');
    for (const call of result.toolCalls) {
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }
      toolCallCount += 1;
      emit({ type: 'tool_start', toolName: call.name, input: call.args });
      if (call.name === 'Replan') {
        try {
          const reason =
            (typeof call.args.reason === 'string' ? call.args.reason : '') ||
            (typeof call.args.context === 'string' ? call.args.context : '任务需要重新规划');
          const replanned = await generatePlan(
            llm,
            `${options.prompt}\n\n重新规划原因：${reason}`,
            options.projectRoot,
            options.signal,
          );
          activePlan = replanned;
          emit({ type: 'plan_updated', plan: { ...replanned, approvedSteps: replanned.tasks.map((task) => task.id) } });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ ok: true, tasks: replanned.tasks.map((task) => task.id) }),
          });
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          });
        }
        continue;
      }
      const preDispatch = await runHooksFor(
        'pre_tool_use',
        { projectRoot: options.projectRoot, sessionId: options.sessionId, toolName: call.name, input: call.args },
        options.projectRoot,
        hooks,
      );
      if (preDispatch.additionalContext) pendingHookContexts.push(preDispatch.additionalContext);
      if (preDispatch.blocked) {
        const detail = preDispatch.outputs.filter(Boolean).join('\n').trim();
        const error = `Hook 阻止执行 ${call.name}${detail ? `：${truncateText(detail, 200)}` : ''}`;
        emit({ type: 'tool_error', toolName: call.name, error });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ ok: false, error }) });
        continue;
      }
      const staticTool = getTool(call.name);
      const mcpDefinition = options.mcp?.getDefinition(call.name);
      const tool = staticTool || (mcpDefinition ? { definition: mcpDefinition, runner: async (input: JsonObject, _toolContext: ToolContext) => {
        if (!mcpDefinition.mcpServer || !options.mcp) throw new Error('MCP runner unavailable');
        return { content: await options.mcp.call(mcpDefinition.mcpServer, call.name, input), artifact: null };
      } } : undefined);
      if (!tool) {
        const error = `未知工具: ${call.name}`;
        emit({ type: 'tool_error', toolName: call.name, error });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: `{"ok":false,"error":${JSON.stringify(error)}}` });
        continue;
      }
      const permission = await permissionGate.allow(call.name, tool.definition.danger, call.args);
      if (!permission.allowed) {
        const error = `用户拒绝执行 ${call.name}`;
        emit({ type: 'tool_error', toolName: call.name, error });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: `{"ok":false,"error":${JSON.stringify(error)}}` });
        continue;
      }
      const started = Date.now();
      try {
        const output = await tool.runner(call.args, context);
        emit({
          type: 'tool_end',
          toolName: call.name,
          durationMs: Date.now() - started,
          ok: true,
          outputPreview: output.content.slice(0, 1200),
        });
        const payload = JSON.stringify({ ok: true, output: output.content.slice(0, 200_000), artifact: output.artifact ?? null });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: payload });
        const artifact =
          output.artifact && typeof output.artifact === 'object' && !Array.isArray(output.artifact)
            ? asJsonObject(output.artifact)
            : undefined;
        if (
          call.name === 'ReadImage' &&
          artifact &&
          (typeof artifact.dataUrl === 'string' || typeof artifact.fileId === 'string') &&
          modelSupportsImages(options.model)
        ) {
          const userParts: ChatContentPart[] = [
            { type: 'text', text: typeof artifact.prompt === 'string' ? artifact.prompt : '请分析这张图片。' },
            typeof artifact.fileId === 'string'
              ? { type: 'file', file_id: artifact.fileId }
              : {
                  type: 'image_url',
                  image_url: {
                    url: typeof artifact.dataUrl === 'string' ? artifact.dataUrl : '',
                    ...(options.visionDetail ? { detail: options.visionDetail } : {}),
                  },
                },
          ];
          messages.push({ role: 'user', content: userParts });
        }
        const postDispatch = await runHooksFor(
          'post_tool_use',
          { projectRoot: options.projectRoot, sessionId: options.sessionId, toolName: call.name, input: call.args, ok: true },
          options.projectRoot,
          hooks,
        );
        if (postDispatch.additionalContext) pendingHookContexts.push(postDispatch.additionalContext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'tool_error', toolName: call.name, error: message });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ ok: false, error: message }) });
        const postDispatch = await runHooksFor(
          'post_tool_use',
          { projectRoot: options.projectRoot, sessionId: options.sessionId, toolName: call.name, input: call.args, ok: false, error: message },
          options.projectRoot,
          hooks,
        );
        if (postDispatch.additionalContext) pendingHookContexts.push(postDispatch.additionalContext);
      }
    }
    if (pendingHookContexts.length > 0) {
      messages.push({ role: 'user', content: `[Hook 上下文]\n${pendingHookContexts.join('\n\n')}` });
    }
    if (!aborted) {
      const batchResultSignature = messages
        .slice(toolMessageStart)
        .map((message) => `${message.name || ''}:${chatMessageText(message.content)}`)
        .join('|')
        .slice(0, 4000);
      repeatedBatchCount =
        batchFingerprint === previousBatchFingerprint && batchResultSignature === previousBatchResultSignature
          ? repeatedBatchCount + 1
          : 1;
      previousBatchFingerprint = batchFingerprint;
      previousBatchResultSignature = batchResultSignature;
      if (repeatedBatchCount >= 3) {
        loopDetected = true;
        emit({
          type: 'system_message',
          level: 'warning',
          content: '检测到重复工具调用且结果没有变化，已停止继续执行并准备收尾总结。',
        });
      }
    }
    emit({ type: 'iteration_end', iteration: step });
    if (loopDetected) break;
  }

  const stepLimitReached = !unlimitedSteps && completedSteps >= maxSteps;
  if (!text && !aborted && (stepLimitReached || loopDetected)) {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    const fallbackText = cleanFinal(chatMessageText(lastAssistant?.content));
    const stopNotice = loopDetected
      ? '检测到重复工具调用且结果没有变化，已停止继续执行。'
      : `已达到工具轮次上限（${maxSteps}），已停止继续执行。`;
    emit({
      type: 'system_message',
      level: 'info',
      content: loopDetected
        ? '检测到重复执行，正在生成收尾总结。'
        : '已达到最大工具轮次，正在生成收尾总结。',
    });
    try {
      const finalResponse = await llm.chat({
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              loopDetected
                ? '检测到重复的无效执行。不要再调用任何工具。请根据当前上下文给出最终答复：说明已经完成的内容、验证过什么、为什么停止继续执行，以及还有什么未完成。'
                : '已达到最大工具调用轮次。不要再调用任何工具。请根据当前上下文给出最终答复：说明已经完成的内容、验证过什么、还有什么未完成或需要注意。',
          },
        ],
        tools: [],
        toolChoice: 'none',
        stream: true,
        reasoningEffort: options.reasoningEffort || 'high',
        maxTokens: Math.min(options.maxTokens ?? 32768, 4096),
        signal: options.signal,
        onTextChunk: (chunk) => emit({ type: 'text_chunk', text: chunk }),
        onThinkingChunk: (chunk, isNewBlock) => emit({ type: 'thinking_chunk', chunk, isNewBlock }),
        onUsage: (usage) => emit(usageEvent({ ...usage })),
      });
      text = cleanFinal(finalResponse.content) || fallbackText || stopNotice;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: 'system_message', level: 'warning', content: `收尾总结失败：${message}` });
      text = fallbackText || stopNotice;
    }
    if (text) {
      messages.push({ role: 'assistant', content: text });
      emit({ type: 'done', result: text });
    }
  }

  return {
    text,
    messages,
    iterations: completedSteps,
    steps: completedSteps,
    toolCallCount,
    plan: activePlan,
    aborted,
    stopReason: aborted ? 'aborted' : loopDetected ? 'loop_detected' : stepLimitReached ? 'max_steps' : 'completed',
  };
}
