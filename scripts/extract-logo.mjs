import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = 'C:/Users/After/Desktop/projects/Auraxis/public/apple-touch-icon.png';
const outputPng = path.join(root, 'packages', 'cli', 'assets', 'auraxis-logo.png');

const input = PNG.sync.read(await fs.readFile(source));
const { width, height, data } = input;
const transparent = new PNG({ width, height });

let minX = width;
let minY = height;
let maxX = 0;
let maxY = 0;

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const whiteness = Math.min(r, g, b);
    const alpha = whiteness > 248 ? 0 : 255;
    transparent.data[index] = r;
    transparent.data[index + 1] = g;
    transparent.data[index + 2] = b;
    transparent.data[index + 3] = alpha;
    if (alpha > 0) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

await fs.mkdir(path.dirname(outputPng), { recursive: true });
await fs.writeFile(outputPng, PNG.sync.write(transparent));

console.log(`logo png: ${outputPng}`);
