import type { AgentEvent } from './events.js';

export type ApprovalPolicy = 'ask' | 'plan' | 'auto';
export type SandboxMode = 'read' | 'workspace-write' | 'full';
export type ReasoningEffort = 'low' | 'high' | 'max';
export type ToolChoice = 'auto' | 'none' | 'required' | string;

export type JsonObject = Record<string, unknown>;

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export interface TextContentPart {
  type: 'text';
  text: string;
}

export type ChatContentPart = TextContentPart | ImageContentPart;

export interface LlmToolCall {
  id: string;
  name: string;
  args: JsonObject;
}

export interface ChatMessage {
  role: LlmRole;
  content?: string | ChatContentPart[];
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export function chatMessageText(content?: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function modelSupportsImages(model: string): boolean {
  return /(vl|vision|omni|multimodal)/i.test(model);
}

export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: JsonObject;
}

export interface LlmRequest {
  messages: ChatMessage[];
  tools?: LlmToolSpec[];
  toolChoice?: ToolChoice;
  stream?: boolean;
  isDeepThink?: boolean;
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json_object' | 'text';
  signal?: AbortSignal;
  onTextChunk?: (text: string) => void;
  onThinkingChunk?: (text: string, isNewBlock?: boolean) => void;
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

export interface LlmResult {
  content: string;
  reasoning: string;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
  finishReason?: string;
}

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResult>;
}

export type ToolDanger = 'read' | 'write' | 'exec' | 'network' | 'internal' | 'mcp' | 'agent';

export interface ToolDefinition {
  name: string;
  description: string;
  danger: ToolDanger;
  parameters: JsonObject;
  required?: string[];
  mcpServer?: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHost {
  getToolDefinitions(): ToolDefinition[];
  hasTool(name: string): boolean;
  getDefinition(name: string): ToolDefinition | undefined;
  call(serverName: string, toolName: string, args: JsonObject): Promise<string>;
  close(): Promise<void>;
}

export interface PermissionRequest {
  requestId: string;
  tool: string;
  summary: string;
  args: JsonObject;
  danger: ToolDanger;
  preview?: string;
}

export type PermissionDecision = 'allow_once' | 'allow_session' | 'allow_rule' | 'deny';

export interface PlanTask {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'blocked';
  dependencies?: string[];
}

export interface Plan {
  tasks: PlanTask[];
  summary?: string;
  approvedSteps?: string[];
}

export type PlanDecision = 'approve' | 'reject' | 'edit';

export interface RunOptions {
  prompt: string;
  projectRoot: string;
  model: string;
  apiKey: string;
  apiBase: string;
  mode: ApprovalPolicy;
  sandboxMode: SandboxMode;
  maxIterations?: number;
  deepThink?: boolean;
  reasoningEffort?: ReasoningEffort;
  toolChoice?: ToolChoice;
  tools: ToolDefinition[];
  mcp?: McpHost;
  subAgentDepth?: number;
  llm?: LlmClient;
  sessionId: string;
  resumeMessages?: ChatMessage[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  requestPermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
  onPlanApproval?: (plan: Plan) => Promise<PlanDecision>;
  askUser?: (question: string) => Promise<string>;
}

export interface RunResult {
  text: string;
  messages: ChatMessage[];
  iterations: number;
  toolCallCount: number;
  plan?: Plan | null;
  aborted: boolean;
}

export interface SessionRecord {
  id: string;
  projectRoot: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  summary?: string;
}
