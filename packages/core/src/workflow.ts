import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppPaths } from './config.js';

export interface WorkflowStep {
  id: string;
  name: string;
  agentType?: 'Explore' | 'Plan' | 'general-purpose';
  prompt: string;
  dependsOn?: string[];
}

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  source?: 'json' | 'markdown';
}

export interface WorkflowRunner {
  runSubAgent: (prompt: string, description?: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface WorkflowRunResult {
  ok: boolean;
  results: Record<string, string>;
  errors: Record<string, string>;
  output: string;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'step'
  );
}

export function parseMarkdownWorkflow(content: string, fallbackName: string): WorkflowDef | null {
  let body = content;
  let name = fallbackName;
  let description: string | undefined;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const match = /^(name|description):\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      if (match[1] === 'name' && match[2].trim()) name = match[2].trim();
      if (match[1] === 'description' && match[2].trim()) description = match[2].trim();
    }
  }
  const rawSections = body.split(/^##\s+(.+)$/m).map((item) => item.trim());
  const steps: WorkflowStep[] = [];
  for (let index = 1; index + 1 < rawSections.length; index += 2) {
    const heading = rawSections[index];
    const prompt = rawSections[index + 1];
    if (!heading || !prompt) continue;
    steps.push({
      id: `md-${slugify(name)}-${steps.length + 1}`,
      name: heading,
      agentType: 'general-purpose',
      prompt,
    });
  }
  return steps.length
    ? { id: `md-${slugify(name)}`, name, description, steps, source: 'markdown' }
    : null;
}

async function readWorkflowFile(file: string): Promise<WorkflowDef | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    if (file.toLowerCase().endsWith('.md')) return parseMarkdownWorkflow(raw, path.basename(file, path.extname(file)));
    const parsed = JSON.parse(raw) as WorkflowDef;
    if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.steps) || !parsed.steps.length) return null;
    return { ...parsed, source: 'json' };
  } catch {
    return null;
  }
}

export async function listWorkflows(projectRoot?: string): Promise<WorkflowDef[]> {
  const dirs = [
    path.join(getAppPaths().configDir, 'workflows'),
    ...(projectRoot ? [path.join(projectRoot, '.auraxis', 'workflows')] : []),
  ];
  const defs: WorkflowDef[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.md')) continue;
      const def = await readWorkflowFile(path.join(dir, file));
      if (def) defs.push(def);
    }
  }
  return defs;
}

export function renderTemplate(template: string, results: Record<string, string>): string {
  return template.replace(
    /\{\{\s*([A-Za-z0-9_-]+)\.result\s*\}\}/g,
    (_match, id: string) => results[id] ?? `（${id} 无结果）`,
  );
}

export function topoOrder(def: WorkflowDef): string[] {
  const ids = new Set(def.steps.map((step) => step.id));
  if (ids.size !== def.steps.length) throw new Error('步骤 id 重复');
  const byId = new Map(def.steps.map((step) => [step.id, step]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const visit = (id: string) => {
    const mark = state.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') throw new Error(`工作流存在循环依赖: ${id}`);
    state.set(id, 'visiting');
    for (const dep of byId.get(id)?.dependsOn || []) {
      if (!byId.has(dep)) throw new Error(`未知依赖: ${dep}`);
      visit(dep);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of ids) visit(id);
  return order;
}

export async function runWorkflow(
  def: WorkflowDef,
  runner: WorkflowRunner,
): Promise<WorkflowRunResult> {
  topoOrder(def);
  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const done = new Set<string>();
  const states = new Map<string, 'pending' | 'running' | 'completed' | 'error'>(
    def.steps.map((step) => [step.id, 'pending']),
  );
  const output: string[] = [];
  while (done.size < def.steps.length) {
    const ready = def.steps.filter(
      (step) =>
        states.get(step.id) === 'pending' &&
        (step.dependsOn || []).every((dep) => states.get(dep) === 'completed'),
    );
    if (!ready.length) {
      for (const step of def.steps.filter((item) => states.get(item.id) === 'pending')) {
        states.set(step.id, 'error');
        errors[step.id] = '前置步骤失败，已跳过';
        done.add(step.id);
      }
      break;
    }
    await Promise.all(
      ready.map(async (step) => {
        states.set(step.id, 'running');
        runner.log?.(`[工作流] ${step.name}`);
        try {
          const prompt = renderTemplate(step.prompt, results);
          const text = await runner.runSubAgent(prompt, `工作流：${step.name}`);
          results[step.id] = text;
          states.set(step.id, 'completed');
          output.push(`[${step.id}] ${step.name}\n${text}`);
        } catch (error) {
          states.set(step.id, 'error');
          errors[step.id] = error instanceof Error ? error.message : String(error);
          output.push(`[${step.id}] ${step.name}\n错误: ${errors[step.id]}`);
        } finally {
          done.add(step.id);
        }
      }),
    );
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, results, errors, output: output.join('\n\n') };
}

export async function findWorkflow(projectRoot: string, idOrName: string): Promise<WorkflowDef | null> {
  const workflows = await listWorkflows(projectRoot);
  return workflows.find((item) => item.id === idOrName || item.name === idOrName) || null;
}
