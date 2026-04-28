import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseCEFPdf } from '../../src/parsers/cef-pdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_APR26 = resolve(fixturesDir, 'cef_apr26_com_saldo.pdf');

describe('parseCEFPdf — fixture real (cef_apr26_com_saldo.pdf)', () => {
  const exists = existsSync(REAL_APR26);

  it.skipIf(!exists)('parseia o PDF real sem erros', async () => {
    const buf = readFileSync(REAL_APR26);
    const r = await parseCEFPdf(buf);

    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(100);
    expect(r.balances.length).toBeGreaterThan(r.ok.length);

    const first = r.ok[0];
    expect(first?.date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(first?.direction).toBe('credit');
    expect(first?.amount).toBe(3046.64);
    expect(first?.history).toBe('COB COMPE');
    expect(first?.docNumber).toBe('310326');

    for (const tx of r.ok) {
      expect(tx.amount).toBeGreaterThan(0);
      expect(tx.balance).toBeUndefined();
      expect(tx.history.toUpperCase()).not.toContain('SALDO DIA');
    }

    const hasOpening = r.balances.some((b) => b.amount === 34494.27);
    expect(hasOpening).toBe(true);

    const hasSaldoAnterior = r.balances.some((b) => b.amount === 0);
    expect(hasSaldoAnterior).toBe(true);

    const hasSaldoDia = r.balances.some((b) => b.amount === 39271.62);
    expect(hasSaldoDia).toBe(true);
  });
});

describe('parseCEFPdf — input inválido', () => {
  it('retorna ParseError estruturado pra bytes que não são PDF', async () => {
    const r = await parseCEFPdf(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.ok).toHaveLength(0);
  });
});
