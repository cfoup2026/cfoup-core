// Usage: pnpm exec tsx scripts/inspect-pdf.mjs <path-to-pdf> [--positions]
// Dumps text from a PDF using pdfjs-dist. With --positions, also dumps x,y,width per item.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const args = argv.slice(2);
const pdfPath = args[0];
const showPositions = args.includes('--positions');
if (!pdfPath) {
  console.error('Usage: inspect-pdf.mjs <path> [--positions]');
  process.exit(1);
}

const data = new Uint8Array(readFileSync(resolve(pdfPath)));
const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false });
const pdf = await loadingTask.promise;
console.log(`pages: ${pdf.numPages}`);

for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log(`\n===== page ${p} (size ${viewport.width.toFixed(0)}x${viewport.height.toFixed(0)}) =====`);
  if (showPositions) {
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const [a, b, c, d, e, f] = it.transform;
      console.log(`x=${e.toFixed(1).padStart(6)} y=${f.toFixed(1).padStart(6)} w=${it.width.toFixed(1).padStart(6)} ${JSON.stringify(it.str)}`);
    }
  } else {
    // Group items by row using y coordinate (rounded)
    const rows = new Map();
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], str: it.str });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const row = rows.get(y).sort((a, b) => a.x - b.x).map(c => c.str).join(' ');
      console.log(`y=${y}\t${row}`);
    }
  }
}
