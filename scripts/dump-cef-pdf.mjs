// Usage: pnpm exec tsx scripts/dump-cef-pdf.mjs <path-to-pdf>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { parseCEFPdf } from '../src/parsers/cef-pdf.ts';

const pdfPath = argv[2];
if (!pdfPath) {
  console.error('Usage: dump-cef-pdf.mjs <path>');
  process.exit(1);
}
const buf = readFileSync(resolve(pdfPath));
const r = await parseCEFPdf(buf);
const credits = r.ok.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
const debits = r.ok.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0);
const dates = new Set(r.ok.map(t => t.date.toISOString().slice(0, 10)));
console.log({
  ok: r.ok.length,
  balances: r.balances.length,
  errors: r.errors.length,
  warnings: r.warnings.length,
  credits: Number(credits.toFixed(2)),
  debits: Number(debits.toFixed(2)),
  net: Number((credits - debits).toFixed(2)),
  uniqueDates: dates.size,
  firstDate: [...dates].sort()[0],
  lastDate: [...dates].sort().at(-1),
  errorSample: r.errors.slice(0, 3),
});
