import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { parseKinlexDRE } from '../src/parsers/kinlex-dre.ts';

const path = argv[2];
if (!path) { console.error('Usage: dump-dre.mjs <path>'); process.exit(1); }
const buf = readFileSync(resolve(path));
const r = await parseKinlexDRE(buf);

const headers = r.ok.filter(e => e.kind === 'section_header').length;
const items = r.ok.filter(e => e.kind === 'line_item');
const subs = r.ok.filter(e => e.kind === 'subtotal');
const twoVal = items.filter(i => i.kind === 'line_item' && i.value2 !== null).length;

console.log({
  ok: r.ok.length,
  sectionHeaders: headers,
  lineItems: items.length,
  subtotals: subs.length,
  errors: r.errors.length,
  warnings: r.warnings.length,
  lineItemsWithValue2: twoVal,
  lineItemsOneValue: items.length - twoVal,
});
console.log('\n=== metadata ===');
console.log(r.metadata);
console.log('\n=== subtotals ===');
for (const s of subs) {
  if (s.kind === 'subtotal') console.log(`  ${s.label.padEnd(35)} ${String(s.value).padStart(15)}`);
}
console.log('\n=== warnings ===');
for (const w of r.warnings) console.log(`L${w.line}: ${w.message}`);
