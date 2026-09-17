/**
 * 校验 package-lock.json 是否完整，避免「本地 npm 11 装得上、CI 的 npm 10 报
 * Missing ... from lock file」这类锁文件漂移。
 *
 * npm 10 的 `npm ci` 会逐个检查可选依赖是否在 lock 里有可解析的条目（嵌套条目
 * 或提升到根的条目），npm 11 对此更宽松。开发机通常跑 npm 11，所以 CI 上的问题
 * 只能在提交前用本脚本提前暴露。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const packages = lock.packages || {};

/** 解析 node_modules 前缀，用于推导嵌套条目的候选路径。 */
function candidatePaths(fromKey, depName) {
  const segments = fromKey.split('/').filter(Boolean);
  const candidates = [];
  // 从最深一层开始，逐级向上查找嵌套命名空间与提升到根的条目。
  for (let index = segments.length; index >= 0; index -= 1) {
    const prefix = segments.slice(0, index).join('/');
    candidates.push(prefix ? `${prefix}/node_modules/${depName}` : `node_modules/${depName}`);
  }
  return candidates;
}

const missing = [];
let checkedOptional = 0;
for (const [key, entry] of Object.entries(packages)) {
  if (!entry || typeof entry !== 'object') continue;
  for (const [depName, spec] of Object.entries(entry.optionalDependencies || {})) {
    checkedOptional += 1;
    const wanted = String(spec).replace(/^[\^~]/, '');
    const resolved = candidatePaths(key, depName).some((candidate) => {
      const found = packages[candidate];
      return Boolean(found) && String(found.version || '').replace(/^[\^~]/, '') === wanted;
    });
    if (!resolved) missing.push(`${key || '<root>'} → ${depName}@${spec}`);
  }
}

if (missing.length > 0) {
  console.error(`package-lock.json 缺少 ${missing.length} 个可选依赖条目（npm ci 会在 CI 上失败）：`);
  for (const line of missing.slice(0, 40)) console.error(`  - ${line}`);
  console.error('请在提交前运行：npm install --package-lock-only');
  process.exit(1);
}

console.log(`lockfile ok: 校验 ${checkedOptional} 个可选依赖，均有可解析条目`);
