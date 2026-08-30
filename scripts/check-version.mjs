import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');

const cliPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'packages/cli/package.json'), 'utf8'));
const corePackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'packages/core/package.json'), 'utf8'));
const cliSource = await fs.readFile(path.join(projectRoot, 'packages/cli/src/version.ts'), 'utf8');
const coreSource = await fs.readFile(path.join(projectRoot, 'packages/core/src/version.ts'), 'utf8');

const failures = [];
if (!cliSource.includes(`'${cliPackage.version}'`)) failures.push(`CLI source version does not match ${cliPackage.version}`);
if (!coreSource.includes(`'${corePackage.version}'`)) failures.push(`Core source version does not match ${corePackage.version}`);
if (cliPackage.devDependencies?.['@auraxis/core'] !== corePackage.version) {
  failures.push(`CLI core dependency ${cliPackage.devDependencies?.['@auraxis/core']} does not match ${corePackage.version}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`version ok: @auraxis/core@${corePackage.version} @auraxis/cli@${cliPackage.version}`);
