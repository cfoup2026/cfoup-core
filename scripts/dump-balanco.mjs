import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { parseKinlexBalanco } from '../src/parsers/kinlex-balanco.ts';

const path = argv[2];
if (!path) { console.error('Usage: dump-balanco.mjs <path>'); process.exit(1); }
const buf = readFileSync(resolve(path));
const r = await parseKinlexBalanco(buf);

const subs = r.ok.filter(e => e.kind === 'subtotal');
const items = r.ok.filter(e => e.kind === 'line_item');
const headers = r.ok.filter(e => e.kind === 'section_header');
const maxLevel = Math.max(...r.ok.map(e => e.level));

console.log({
  ok: r.ok.length,
  subtotals: subs.length,
  lineItems: items.length,
  sectionHeaders: headers.length,
  errors: r.errors.length,
  warnings: r.warnings.length,
  maxLevel,
});
console.log('\n=== metadata ===');
console.log(r.metadata);
console.log('\n=== root totals (ATIVO/PASSIVO) ===');
for (const e of r.ok.filter(x => x.level === 0)) {
  if (e.kind !== 'section_header') {
    console.log(`  ${e.label.padEnd(10)} ${String(e.amount).padStart(15)} ${e.balanceType}`);
  }
}
