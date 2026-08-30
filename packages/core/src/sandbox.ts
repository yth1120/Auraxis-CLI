import path from 'node:path';
import type { SandboxMode } from './types.js';

const DENY_COMMAND_RE =
  /\b(?:sudo\b|rm\s+-rf\s+(?:\/|~)(?=\s|$)|git\s+push\s+--force\b|git\s+reset\s+--hard\b)/i;

const DENY_COMMAND_PATTERNS: RegExp[] = [
  DENY_COMMAND_RE,
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  /\b(?:mkfs|fdisk|parted|dd\s+if=\/dev\/)\b/i,
  /\b(?:Remove-Item|del|rmdir)\s+(?:-Recurse|-Force|-rf|-r|-f)\b/i,
  /(?:curl|wget)\s+[^\n|]*\|\s*(?:sh|bash|zsh)\b/i,
  /\beval\b/i,
  /^\s*:\(\)\s*\{/,
];

export interface SandboxPolicyOptions {
  mode: SandboxMode;
  projectRoot: string;
  allowNetwork?: boolean;
}

/**
 * 策略层沙箱：read-only 禁止写入/执行/网络，workspace-write 限制工作区，
 * container 模式通过外部 runner（Docker/Podman/CI wrapper）真正隔离执行环境。
 */
export class SandboxPolicy {
  constructor(private readonly options: SandboxPolicyOptions) {}

  get mode(): SandboxMode {
    return this.options.mode;
  }

  assertPath(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('路径不能为空');
    const root = path.resolve(this.options.projectRoot);
    const resolved = path.resolve(root, raw);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`路径超出项目根目录: ${resolved}`);
    }
    if (this.options.mode === 'read') {
      throw new Error(`当前为只读沙箱，不能写入 ${resolved}`);
    }
    return resolved;
  }

  assertCommand(command: string): void {
    if (!command || !command.trim()) throw new Error('command 不能为空');
    if (this.options.mode === 'read') {
      throw new Error('只读沙箱禁止执行命令');
    }
    if (DENY_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      throw new Error('沙箱策略拒绝执行高危险命令，请拆分请求或修改命令');
    }
  }

  wrapCommand(command: string): string {
    if (this.options.mode !== 'container') return command;
    const image = process.env.AURAXIS_CONTAINER_IMAGE || 'node:24-alpine';
    const workdir = process.env.AURAXIS_CONTAINER_WORKDIR || '/workspace';
    const network = process.env.AURAXIS_CONTAINER_NETWORK === 'host' ? '--network host' : '--network none';
    const projectMount = shellQuote(this.options.projectRoot);
    const runner =
      process.env.AURAXIS_CONTAINER_RUNNER ||
      `docker run --rm -v ${projectMount}:/workspace -w ${shellQuote(workdir)} ${network} ${shellQuote(image)} sh -lc`;
    return `${runner} ${shellQuote(command)}`;
  }

  assertNetwork(url: URL | string): void {
    if (this.options.mode === 'read') throw new Error('只读沙箱禁止网络访问');
    if (this.options.mode === 'container' && this.options.allowNetwork !== true) {
      throw new Error('容器沙箱默认禁止网络访问，请显式配置 allowNetwork');
    }
    const raw = typeof url === 'string' ? url : url.toString();
    if (!/^https?:\/\//i.test(raw)) throw new Error('沙箱仅允许 http/https 网络访问');
  }
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
