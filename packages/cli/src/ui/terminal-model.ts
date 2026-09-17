import {
  chatMessageText,
  type ApiFamily,
  type ImageDetail,
  type ModelProvider,
  type ModelChoice,
  type PermissionRequest,
  type Plan,
  type ReasoningEffort,
  type SessionRecord,
  type SkillRecord,
  type ToolChoice,
} from '@auraxis/core';
import type { ThemeName } from './blocks.js';
import type { CommandHint } from './commands.js';

export interface UiItem {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'error' | 'system' | 'plan' | 'code' | 'code_tool';
  text: string;
  toolName?: string;
  ok?: boolean;
  status?: 'running' | 'done' | 'error' | 'aborted';
  duration?: number;
  error?: string;
  output?: string;
  plan?: Plan;
  lines?: string[];
  codeRunning?: boolean;
  subCallId?: number;
}

export interface ActivityItem {
  id?: string;
  kind: 'tool' | 'code';
  name: string;
  status: 'running' | 'done' | 'error' | 'aborted';
  summary?: string;
  error?: string;
  duration?: number;
  output?: string;
}

export type ActiveCommandKey =
  | 'agents'
  | 'code'
  | 'run'
  | 'plugin-install'
  | 'memory-remember'
  | 'max-tokens'
  | 'context-budget'
  | 'api-base'
  | 'api-key'
  | 'symbol'
  | 'worktree'
  | 'checkpoint'
  | 'files'
  | 'complete'
  | 'fim';

export interface ActiveCommand {
  key: ActiveCommandKey;
  label: string;
  placeholder: string;
}

export type PromptState =
  | { kind: 'permission'; request: PermissionRequest; resolve: (value: 'allow_once' | 'allow_session' | 'allow_rule' | 'deny') => void }
  | { kind: 'plan'; plan: Plan; resolve: (value: 'approve' | 'reject' | 'edit') => void }
  | { kind: 'ask'; question: string; resolve: (value: string) => void }
  | null;

export interface ModelPickerState {
  models: ModelChoice[];
  source: 'live' | 'builtin';
  selected: number;
}

export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  data?: unknown;
}

export type ChoicePickerKind =
  | 'permission'
  | 'reasoning'
  | 'sandbox'
  | 'provider'
  | 'api-family'
  | 'vision-detail'
  | 'strict-tools'
  | 'tool-choice'
  | 'theme'
  | 'config'
  | 'session-resume'
  | 'session-delete';

export interface ChoicePickerState {
  kind: ChoicePickerKind;
  title: string;
  options: ChoiceOption[];
  selected: number;
}

export interface Stats {
  iterations: number;
  toolCalls: number;
  tokens: string;
}

export interface TerminalController {
  entries: UiItem[];
  activity: ActivityItem[];
  pendingPrompts: string[];
  activeCommand: ActiveCommand | null;
  skillsPanel: SkillRecord[] | null;
  modelPicker: ModelPickerState | null;
  choicePicker: ChoicePickerState | null;
  selectedSkill: number;
  skillsDetail: SkillRecord | null;
  skillsDetailContent: string;
  input: string;
  running: boolean;
  exitArmed: boolean;
  prompt: PromptState;
  model: string;
  provider: ModelProvider;
  apiFamily: ApiFamily;
  visionDetail: ImageDetail;
  strictTools: boolean;
  mode: string;
  sandbox: string;
  reasoningEffort: ReasoningEffort;
  toolChoice: ToolChoice;
  apiBase: string;
  maxTokens?: number;
  theme: ThemeName;
  onboarding: boolean | null;
  showHome: boolean;
  branch: string;
  homeFocus: 'input' | 'commands';
  selectedCommand: number;
  commandSuggestions: CommandHint[];
  suggestionIndex: number;
  showHelp: boolean;
  expandedThinking: boolean;
  expandedActivity: boolean;
  stats: Stats;
  elapsed: number;
  sessionSeconds: number;
  scrollOffset: number;
  projectLabel: string;
  projectFull: string;
  saveOnboardingApiKey: (apiKey: string) => Promise<void>;
  completeOnboarding: (selectedModel: string, selectedEffort: ReasoningEffort) => Promise<void>;
}

export function formatPlan(plan: Plan): string {
  return plan.tasks.map((task) => `  ${task.id}. ${task.description} [${task.status}]`).join('\n');
}

export function mouseScrollDelta(chunk: string): number {
  let delta = 0;
  const matches = chunk.matchAll(/\x1b\[<?(64|65);\d+;\d+[Mm]/g);
  for (const match of matches) {
    if (match[1] === '64') delta += 3;
    if (match[1] === '65') delta -= 3;
  }
  return delta;
}

export function appendPendingPrompt(queue: readonly string[], text: string): string[] {
  return [...queue, text];
}

export function takeNextPendingPrompt(queue: readonly string[]): { next?: string; rest: string[] } {
  const [next, ...rest] = queue;
  return next === undefined ? { rest: [...queue] } : { next, rest };
}

export function withdrawPendingPrompt(queue: readonly string[]): { withdrawn?: string; rest: string[] } {
  const rest = [...queue];
  const withdrawn = rest.pop();
  return withdrawn === undefined ? { rest } : { withdrawn, rest };
}

export function sessionToUiItems(session: SessionRecord): UiItem[] {
  const items: UiItem[] = [];
  for (const message of session.messages) {
    if (message.role === 'user') {
      const text = chatMessageText(message.content);
      if (text) items.push({ kind: 'user', text });
    } else if (message.role === 'assistant') {
      const text = chatMessageText(message.content);
      if (message.reasoning_content) items.push({ kind: 'thinking', text: message.reasoning_content });
      if (text) items.push({ kind: 'assistant', text });
    } else if (message.role === 'tool') {
      items.push({
        kind: 'tool',
        toolName: message.name || 'Tool',
        text: message.name || 'Tool',
        status: 'done',
        ok: true,
        output: chatMessageText(message.content).slice(0, 1200),
      });
    }
  }
  return items;
}
