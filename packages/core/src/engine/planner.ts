import type { LlmClient, Plan } from '../types.js';
import { asJsonObject, parseJson } from '../validation.js';

export function buildPlannerPrompt(prompt: string, projectRoot: string): string {
  return [
    '你是 Auraxis 软件架构师。你只负责阅读和分析项目，不执行任何修改。',
    `项目根目录: ${projectRoot}`,
    '',
    '用户请求:',
    prompt,
    '',
    '请输出一个可执行的 JSON 计划，格式必须是：',
    '{"summary":"简短摘要","tasks":[{"id":"1","description":"任务描述","dependencies":[]}]}',
    '',
    '任务必须具体、可验证，不要写“继续分析”这种空任务。',
  ].join('\n');
}

function parsePlan(text: string): Plan | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced ? fenced[1] : text;
  try {
    const value = asJsonObject(parseJson(raw));
    const tasks = Array.isArray(value.tasks)
      ? value.tasks
          .map((item, index) => {
            const task = asJsonObject(item);
            return {
            id: typeof task.id === 'string' && task.id ? task.id : String(index + 1),
            description: typeof task.description === 'string' ? task.description : String(task.description || ''),
            status: 'pending' as const,
            dependencies: Array.isArray(task.dependencies)
              ? task.dependencies.filter((dep): dep is string => typeof dep === 'string')
              : [],
            };
          })
      : [];
    if (tasks.length === 0) return null;
    return {
      summary: typeof value.summary === 'string' ? value.summary : undefined,
      tasks,
      approvedSteps: tasks.map((task) => task.id),
    };
  } catch {
    return null;
  }
}

export async function generatePlan(
  llm: LlmClient,
  prompt: string,
  projectRoot: string,
  signal?: AbortSignal,
): Promise<Plan> {
  const result = await llm.chat({
    messages: [
      { role: 'system', content: buildPlannerPrompt(prompt, projectRoot) },
      { role: 'user', content: prompt },
    ],
    tools: [],
    stream: false,
    responseFormat: 'json_object',
    signal,
  });
  const parsed = parsePlan(result.content);
  if (parsed) return parsed;
  // Fallback keeps interactive plan mode useful even when JSON parsing fails.
  return {
    summary: '模型未能生成结构化计划，已提供最简回退计划',
    tasks: [{ id: '1', description: prompt, status: 'pending', dependencies: [] }],
    approvedSteps: ['1'],
  };
}
