import type { ApprovalPolicy, PermissionDecision, PermissionRequest, SandboxMode, ToolDanger, JsonObject } from '../types.js';
import { isToolReadOnly, summarizeToolInput } from '../tools/registry.js';
import { buildPermissionPreview } from './preview.js';

export interface PermissionGateOptions {
  mode: ApprovalPolicy;
  sandboxMode: SandboxMode;
  projectRoot: string;
  requestPermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
}

export class PermissionGate {
  private readonly sessionAllowed = new Map<string, true>();

  constructor(private readonly options: PermissionGateOptions) {}

  async allow(
    toolName: string,
    danger: ToolDanger,
    args: JsonObject,
  ): Promise<{ allowed: boolean; decision?: PermissionDecision }> {
    if (this.options.sandboxMode === 'read' && danger !== 'read' && danger !== 'internal') {
      return { allowed: false, decision: 'deny' };
    }
    if (this.options.mode === 'auto' || isToolReadOnly(toolName)) {
      return { allowed: true, decision: this.options.mode === 'auto' ? 'allow_rule' : undefined };
    }
    const signature = `${toolName}:${summarizeToolInput(toolName, args)}`;
    if (this.sessionAllowed.has(signature)) {
      return { allowed: true, decision: 'allow_session' };
    }
    const request: PermissionRequest = {
      requestId: `perm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      tool: toolName,
      summary: signature,
      args,
      danger,
      preview: await buildPermissionPreview(toolName, args, this.options.projectRoot),
    };
    const decision = await this.options.requestPermission?.(request);
    switch (decision) {
      case 'allow_once':
        return { allowed: true, decision };
      case 'allow_session':
        this.sessionAllowed.set(signature, true);
        return { allowed: true, decision };
      case 'allow_rule':
        this.sessionAllowed.set(signature, true);
        return { allowed: true, decision };
      case 'deny':
      case undefined:
        return { allowed: false, decision: decision || 'deny' };
      default:
        return { allowed: false, decision: 'deny' };
    }
  }

  static isReadOnly(toolName: string): boolean {
    return isToolReadOnly(toolName);
  }
}

export function permissionDescription(danger: ToolDanger): string {
  switch (danger) {
    case 'read':
      return '只读';
    case 'write':
      return '修改文件';
    case 'exec':
      return '执行命令';
    case 'network':
      return '访问网络';
    case 'internal':
      return '内部状态';
    case 'agent':
      return '启动子 Agent';
    default:
      return '危险操作';
  }
}
