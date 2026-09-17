/**
 * 首次发布引导（本地执行，仅需一次）。
 *
 * npm 的 Trusted Publisher 只能配置在「已存在」的包上，而 @auraxis/core 与
 * @auraxis/cli 还没发布过，所以第一次必须先手动发一次。这个脚本让整件事留在
 * 你自己机器上完成：凭据不经过 CI，2FA 验证码由你本人输入。
 *
 * 用法：
 *   node scripts/bootstrap-publish.mjs            # 查看当前状态
 *   node scripts/bootstrap-publish.mjs --publish  # 直接发布（需先 npm login）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shouldPublish = process.argv.includes('--publish');

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

function runQuiet(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  return { code: result.status, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
}

const cliPackage = JSON.parse(fs.readFileSync(path.join(root, 'packages/cli/package.json'), 'utf8'));
const corePackage = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/package.json'), 'utf8'));
const version = corePackage.version;

console.log(`准备发布 @auraxis/core@${version} 与 @auraxis/cli@${version}（公开包，MIT）。\n`);

const whoami = runQuiet('npm', ['whoami']);
if (whoami.code !== 0) {
  console.log('当前机器还没有登录 npm。请先执行：');
  console.log('  npm login --auth-type=web\n');
  console.log('浏览器里完成授权后重新运行本脚本。');
  if (!shouldPublish) process.exit(0);
  process.exit(1);
}
console.log(`npm 登录身份：${whoami.out}\n`);

if (!shouldPublish) {
  console.log('状态检查完成。确认无误后运行：');
  console.log('  node scripts/bootstrap-publish.mjs --publish\n');
  process.exit(0);
}

console.log('1/3 构建 @auraxis/core …');
if (run('npm', ['run', 'build', '-w', '@auraxis/core']).status !== 0) process.exit(1);

console.log('\n2/3 发布 @auraxis/core（如提示 OTP，请输入验证器里的 6 位码）…');
if (run('npm', ['publish', '-w', '@auraxis/core', '--access', 'public']).status !== 0) {
  console.error('\n@auraxis/core 发布失败，请查看上方 npm 报错。');
  process.exit(1);
}

console.log('\n3/3 发布 @auraxis/cli …');
if (run('npm', ['publish', '-w', '@auraxis/cli', '--access', 'public']).status !== 0) {
  console.error('\n@auraxis/cli 发布失败，请查看上方 npm 报错。');
  process.exit(1);
}

console.log('\n完成。接下来请配置 Trusted Publishing（之后不再需要任何 token）：');
console.log('  https://www.npmjs.com/package/@auraxis/core/access');
console.log('  https://www.npmjs.com/package/@auraxis/cli/access');
console.log('  选择 GitHub Actions，填 yth1120 / Auraxis-CLI / release.yml，并勾选允许 npm publish。');
console.log('\n然后运行以下命令核对：');
console.log(`  npm view @auraxis/core@${version} version`);
console.log(`  npm view @auraxis/cli@${version} version`);
