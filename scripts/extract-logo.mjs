import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = 'C:/Users/After/Desktop/projects/Auraxis/public/apple-touch-icon.png';
const outputPng = path.join(root, 'packages', 'cli', 'assets', 'auraxis-logo.png');
const outputPixels = path.join(root, 'packages', 'cli', 'src', 'ui', 'logo-pixels.ts');

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

// ── ANSI truecolor half-block logo ────────────────────────────────
const artWidth = 34;
const artHeight = 14;
const dark = [13, 17, 23];

function sample(startX, endX, startY, endY) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha > 20) {
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
        a += alpha;
        count += 1;
      }
    }
  }
  if (count === 0) return { r: dark[0], g: dark[1], b: dark[2] };
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

const rows = [];
for (let line = 0; line < artHeight; line += 1) {
  const row = [];
  for (let col = 0; col < artWidth; col += 1) {
    const x0 = Math.floor((width * col) / artWidth);
    const x1 = Math.max(x0 + 1, Math.floor((width * (col + 1)) / artWidth));
    const y0 = Math.floor((height * line * 2) / (artHeight * 2));
    const y1 = Math.max(y0 + 1, Math.floor((height * (line * 2 + 1)) / (artHeight * 2)));
    const y2 = Math.floor((height * (line * 2 + 1)) / (artHeight * 2));
    const y3 = Math.max(y2 + 1, Math.floor((height * (line * 2 + 2)) / (artHeight * 2)));
    const top = sample(x0, x1, y0, y1);
    const bottom = sample(x0, x1, y2, y3);
    row.push({
      top: `#${top.r.toString(16).padStart(2, '0')}${top.g.toString(16).padStart(2, '0')}${top.b.toString(16).padStart(2, '0')}`,
      bottom: `#${bottom.r.toString(16).padStart(2, '0')}${bottom.g.toString(16).padStart(2, '0')}${bottom.b.toString(16).padStart(2, '0')}`,
    });
  }
  rows.push(row);
}

await fs.writeFile(
  outputPixels,
  `export const LOGO_PIXELS = ${JSON.stringify(rows)};\n`,
  'utf8',
);

console.log(`logo png: ${outputPng}`);
console.log(`logo pixels: ${outputPixels}`);
