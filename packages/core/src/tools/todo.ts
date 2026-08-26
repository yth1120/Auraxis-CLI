import type { JsonObject } from '../types.js';
import type { PlanTask } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

export async function todoWriteTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  if (!Array.isArray(input.todos)) throw new Error('todos 必须是数组');
  const todos: PlanTask[] = input.todos
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : String(index + 1),
      description: typeof item.description === 'string' ? item.description : String(item.description || ''),
      status: (item.status === 'running' || item.status === 'completed' || item.status === 'blocked'
        ? item.status
        : 'pending') as PlanTask['status'],
      dependencies: Array.isArray(item.dependencies)
        ? item.dependencies.filter((dependency): dependency is string => typeof dependency === 'string')
        : [],
    }));
  ctx.setTodos(todos);
  const done = todos.filter((todo) => todo.status === 'completed').length;
  return { content: `OK 当前任务 ${done}/${todos.length} 完成`, artifact: todos };
}
