#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fsp from 'node:fs/promises';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const single = path.join(dist, 'single.js');
const entry = await fsp.access(single).then(() => single).catch(() => path.join(dist, 'main.js'));
await import(pathToFileURL(entry).href);
