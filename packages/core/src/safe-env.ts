/**
 * Child-process environment sanitization for model-written programs.
 *
 * API keys and credentials must never be inherited by RunCode, Python/shell
 * runners, persistent PTYs, hooks or inline workflows. This module mirrors the
 * desktop Auraxis allowlist: only known runtime variables are kept, and any
 * caller-supplied extra containing a credential-like name is dropped.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'USERDOMAIN',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TMP_DIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'NODE_PATH',
  'PYTHONPATH',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'GOPATH',
  'JAVA_HOME',
  'CARGO_HOME',
  'SSH_AUTH_SOCK',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'GIT_TERMINAL_PROMPT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'NODE_OPTIONS',
  'NODE_ENV',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_SESSION_TYPE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
] as const;

const SENSITIVE_ENV_RE = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE[_-]?KEY)/i;

export function safeProcessEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  if (!out.HOME && out.USERPROFILE) out.HOME = out.USERPROFILE;
  if (!out.SHELL && out.COMSPEC) out.SHELL = out.COMSPEC;
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    if (SENSITIVE_ENV_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Model-written arbitrary code is fail-closed in every runtime environment.
 * It is enabled only when the operator explicitly opts in.
 */
export function unsafeCodeEnabled(): boolean {
  return process.env.AURAXIS_ALLOW_UNSAFE_CODE === '1';
}

export function unsafeCodeDisabledMessage(name: string): string {
  return `${name} 已默认禁用：模型编写的任意代码没有可靠的 OS 沙箱。如需在受信开发环境中使用，请显式设置 AURAXIS_ALLOW_UNSAFE_CODE=1。`;
}
