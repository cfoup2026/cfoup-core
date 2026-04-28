import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { extractCSV } from '../src/csv/extractor.ts';
import { parseFKNAp } from '../src/parsers/fkn-ap.ts';

const path = argv[2];
if (!path) { console.error('Usage: dump-fkn-ap.mjs <path>'); process.exit(1); }
const buf = readFileSync(resolve(path));
const decoder = new TextDecoder('windows-1252');
const content = decoder.decode(buf);
const rows = extractCSV(content, ';');
const r = parseFKNAp(rows);

console.log('=== summary ===');
console.log({
  ok: r.ok.length,
  dailyTotals: r.dailyTotals.length,
  errors: r.errors.length,
  warnings: r.warnings.length,
});

console.log('\n=== EMIS errors ===');
for (const e of r.errors.filter(e => e.reason.includes('EMIS'))) {
  console.log(`L${e.line}: ${e.reason}`);
  console.log(`     raw: ${e.raw.slice(0, 200)}`);
}

console.log('\n=== unique non-00/00/0000 PGTO error values ===');
const weirdPgto = new Set();
for (const e of r.errors.filter(e => e.reason.includes('PGTO'))) {
  const m = e.reason.match(/"([^"]*)"/);
  if (m && m[1] !== '00/00/0000') weirdPgto.add(`L${e.line}: ${m[1]}`);
}
for (const v of weirdPgto) console.log(v);

console.log('\n=== error reason histogram ===');
const histo = new Map();
for (const e of r.errors) {
  const key = e.reason.split(':')[0];
  histo.set(key, (histo.get(key) ?? 0) + 1);
}
for (const [k, v] of histo) console.log(`${v}x  ${k}`);
