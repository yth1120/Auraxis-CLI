export interface HomeCommand {
  icon: string;
  command: string;
  description: string;
}

const BLOCK_GLYPHS: Record<string, readonly string[]> = {
  A: ['███  ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  X: ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  S: [' ███ ', '█    ', ' ███ ', '    █', ' ███ '],
  G: ['████ ', '█   █', '█   █', '█  █ ', ' ███ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  ' ': [' ', ' ', ' ', ' ', ' '],
};

export function buildBlockTitle(text: string): string[] {
  const letters = text
    .toUpperCase()
    .split('')
    .filter((letter) => BLOCK_GLYPHS[letter]);
  if (letters.length === 0) return [];
  return Array.from({ length: 5 }, (_, row) => letters.map((letter) => BLOCK_GLYPHS[letter][row]).join(' '));
}

export const HOME_COMMANDS: readonly HomeCommand[] = [
  { icon: '◇', command: '/model', description: '模型设置' },
  { icon: '✦', command: '/permission', description: '权限模式' },
  { icon: '≋', command: '/reasoning', description: '思考强度' },
  { icon: '⌁', command: '/mcp', description: '扩展集成' },
  { icon: 'ℹ', command: '/help', description: '命令帮助' },
];

export function formatSessionTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((safeSeconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (safeSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

export function shortenProjectPath(project: string, home: string, maxLength: number): string {
  const safeMax = Math.max(1, Math.floor(maxLength));
  const display = project.startsWith(home) ? `~${project.slice(home.length)}` : project;
  const normalized = display.replace(/\\/g, '/');
  if (normalized.length <= safeMax) return normalized;

  const segments = normalized.split('/').filter(Boolean);
  const prefix = normalized.startsWith('~/') ? '~/…/' : '…/';
  for (const count of [3, 2, 1]) {
    const compact = `${prefix}${segments.slice(-count).join('/')}`;
    if (compact.length <= safeMax) return compact;
  }
  return normalized.slice(-safeMax);
}
