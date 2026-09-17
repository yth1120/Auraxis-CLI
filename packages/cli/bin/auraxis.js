#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fsp from 'node:fs/promises';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const single = path.join(dist, 'single.js');
const main = path.join(dist, 'main.js');
const mtime = async (file) => fsp.stat(file).then((stat) => stat.mtimeMs).catch(() => 0);
const [singleMtime, mainMtime] = await Promise.all([mtime(single), mtime(main)]);
const entry = singleMtime >= mainMtime && singleMtime > 0 ? single : main;
await import(pathToFileURL(entry).href);
