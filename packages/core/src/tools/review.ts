import fsp from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';
import { bashTool } from './shell.js';
import { asJsonObject, parseJsonObject } from '../validation.js';

export async function reviewArtifactTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  let command = typeof input.command === 'string' && input.command.trim() ? input.command.trim() : '';
  if (!command) {
    try {
      const raw = await fsp.readFile(path.join(ctx.projectRoot, 'package.json'), 'utf8');
      const pkg = parseJsonObject(raw) || {};
      const scripts = asJsonObject(pkg.scripts);
      const preferred = ['check', 'test', 'build'];
      for (const name of preferred) {
        if (typeof scripts[name] === 'string') {
          command = `npm run ${name}`;
          break;
        }
      }
    } catch {
      /* no package.json */
    }
  }
  if (!command) command = 'npm test';
  return bashTool({ command, timeout_ms: typeof input.timeout_ms === 'number' ? input.timeout_ms : 180_000 }, ctx);
}
