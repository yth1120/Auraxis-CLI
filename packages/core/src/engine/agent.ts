import fsp from 'node:fs/promises';
import path from 'node:path';
import { DeepSeekClient } from '../llm.js';
import { makeRequestId, truncateText, type AgentEvent } from '../events.js';
import { getTool, getTools, TOOL_DEFINITIONS, summarizeToolInput, type ToolContext } from '../tools/registry.js';
import { PermissionGate } from './permissions.js';
import { generatePlan } from './planner.js';
import type { ChatMessage, ChatContentPart, Plan, PlanDecision, RunOptions, RunResult, ToolDefinition } from '../types.js';
import { modelSupportsImages } from '../types.js';

async function readInstructionFile(root: string, names: string[]): Promise<string> {
  for (const name of names) {
    try {
      const file = path.join(root, name);
      const content = await fsp.readFile(file, 'utf8');
      return content.trim();
    } catch {
      /* continue */
    }
  }
  return '';
}

export function buildSystemPrompt(projectRoot: string, tools: ToolDefinition[]): string {
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
  ].join('\n');
}

function ensureSystemMessage(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
  if (messages.length > 0 && messages[0].role === 'system') return messages;
  return [{ role: 'system', content: systemPrompt }, ...messages];
}

function cleanFinal(text: string): string {
  return text.replace(/<FINAL_ANSWER>/gi, '').replace(/<\/FINAL_ANSWER>/gi, '').trim();
}

function usageEvent(usage: { inputTokens: number; outputTokens: number; cacheHitTokens?: number; cacheMissTokens?: number; reasoningTokens?: number }): AgentEvent {
  return { type: 'usage', ...usage };
}

function buildToolSpecs(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const emit = options.onEvent || (() => {});
  const llm = options.llm || new DeepSeekClient(options.apiKey, options.apiBase, options.model, 32768);
  const permissionGate = new PermissionGate({
    mode: options.mode,
    sandboxMode: options.sandboxMode,
    requestPermission: options.requestPermission,
  });
  const systemPrompt = buildSystemPrompt(options.projectRoot, options.tools);
  let messages = ensureSystemMessage([...(options.resumeMessages || [])], systemPrompt);
  if (messages.length === 0 || messages.at(-1)?.role !== 'user') {
    messages.push({ role: 'user', content: options.prompt });
  }

  let activePlan: Plan | null = null;
  let text = '';
  let toolCallCount = 0;
  let aborted = false;
  const todos: Plan['tasks'] = [];

  const context: ToolContext = {
    projectRoot: options.projectRoot,
    emit,
    askUser: options.askUser,
    todos,
    setTodos: (next) => {
      todos.splice(0, todos.length, ...next);
    },
    signal: options.signal,
  };

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
        emit({ type: 'system_message', level: 'warning', content: '编辑计划将在后续版本开放，当前按原计划执行' });
      }
      emit({ type: 'plan_updated', plan: { ...plan, approvedSteps: plan.tasks.map((task) => task.id) } });
    } catch (error) {
      emit({ type: 'error', error: error instanceof Error ? error.message : String(error) });
      return { text: '', messages, iterations: 0, toolCallCount: 0, plan: null, aborted: false };
    }
  }

  const maxIterations = options.maxIterations ?? 200;
  let completedIterations = 0;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }
    emit({ type: 'iteration_start', iteration });
    completedIterations = iteration;
    const result = await llm.chat({
      messages,
      tools: buildToolSpecs(),
      toolChoice: options.toolChoice,
      stream: true,
      isDeepThink: options.deepThink,
      reasoningEffort: options.reasoningEffort,
      maxTokens: 32768,
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

    for (const call of result.toolCalls) {
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }
      toolCallCount += 1;
      const tool = getTool(call.name);
      emit({ type: 'tool_start', toolName: call.name, input: call.args });
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
        emit({ type: 'tool_end', toolName: call.name, durationMs: Date.now() - started, ok: true });
        const payload = JSON.stringify({ ok: true, output: output.content.slice(0, 200_000), artifact: output.artifact ?? null });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: payload });
        const artifact = output.artifact as Record<string, unknown> | undefined;
        if (
          call.name === 'ReadImage' &&
          artifact &&
          typeof artifact.dataUrl === 'string' &&
          modelSupportsImages(options.model)
        ) {
          const userParts: ChatContentPart[] = [
            { type: 'text', text: typeof artifact.prompt === 'string' ? artifact.prompt : '请分析这张图片。' },
            { type: 'image_url', image_url: { url: artifact.dataUrl } },
          ];
          messages.push({ role: 'user', content: userParts });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'tool_error', toolName: call.name, error: message });
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ ok: false, error: message }) });
      }
    }
    emit({ type: 'iteration_end', iteration });
  }

  return {
    text,
    messages,
    iterations: completedIterations,
    toolCallCount,
    plan: activePlan,
    aborted,
  };
}
