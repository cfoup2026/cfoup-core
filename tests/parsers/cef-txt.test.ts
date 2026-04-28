import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseCEFTxt } from '../../src/parsers/cef-txt.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const SYNTHETIC = resolve(fixturesDir, 'cef_synthetic.txt');
const REAL_APR25 = resolve(fixturesDir, 'cef_apr25.txt');

describe('parseCEFTxt — fixture sintética', () => {
  const content = readFileSync(SYNTHETIC, 'utf8');
  const result = parseCEFTxt(content);

  it('reconhece transações válidas (4 esperadas)', () => {
    expect(result.ok).toHaveLength(4);
  });

  it('primeira transação: 2025-04-01 / credit / 5964.52 / COB COMPE', () => {
    const first = result.ok[0];
    expect(first).toBeDefined();
    expect(first?.date.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(first?.direction).toBe('credit');
    expect(first?.amount).toBe(5964.52);
    expect(first?.history).toBe('COB COMPE');
    expect(first?.docNumber).toBe('310325');
    expect(first?.accountId).toBe('0423012920005778782426');
  });

  it('campo balance fica undefined (CEF TXT não traz saldo intercalado)', () => {
    for (const tx of result.ok) {
      expect(tx.balance).toBeUndefined();
    }
  });

  it('SALDO DIA vira BalanceSnapshot, não Transaction', () => {
    expect(result.balances).toHaveLength(1);
    const bal = result.balances[0];
    expect(bal?.accountId).toBe('0423012920005778782426');
    expect(bal?.amount).toBe(4764.52);
    expect(bal?.source).toBe('bank-statement');
    expect(bal?.date.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    for (const tx of result.ok) {
      expect(tx.history.toUpperCase()).not.toContain('SALDO DIA');
    }
  });

  it('emite warning informativo pra cada SALDO DIA', () => {
    const saldoWarnings = result.warnings.filter((w) =>
      w.message.includes('saldo informativo'),
    );
    expect(saldoWarnings).toHaveLength(1);
  });

  it('reporta erros pras 3 linhas inválidas e segue', () => {
    expect(result.errors).toHaveLength(3);
    const reasons = result.errors.map((e) => e.reason);
    expect(reasons.some((r) => r.includes('valor não-numérico'))).toBe(true);
    expect(reasons.some((r) => r.includes('data inválida'))).toBe(true);
    expect(reasons.some((r) => r.includes('Deb_Cred inválido'))).toBe(true);
  });

  it('linhas em branco são ignoradas silenciosamente', () => {
    const blankErrors = result.errors.filter((e) => e.raw.trim() === '');
    expect(blankErrors).toHaveLength(0);
  });

  it('soma créditos e débitos válidos no mês de abril/2025', () => {
    const totals = result.ok.reduce(
      (acc, tx) => {
        if (tx.direction === 'credit') acc.credits += tx.amount;
        else acc.debits += tx.amount;
        return acc;
      },
      { credits: 0, debits: 0 },
    );
    expect(totals.credits).toBeCloseTo(5964.52 + 800.5 + 2500.75, 2);
    expect(totals.debits).toBeCloseTo(1200.0, 2);
  });

  it('valor sempre positivo em todas as transações', () => {
    for (const tx of result.ok) {
      expect(tx.amount).toBeGreaterThan(0);
    }
  });
});

describe('parseCEFTxt — robustez', () => {
  it('arquivo vazio: retorna estrutura vazia com erro de cabeçalho', () => {
    const r = parseCEFTxt('');
    expect(r.ok).toHaveLength(0);
    expect(r.balances).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('cabeçalho inválido: retorna sem processar linhas', () => {
    const r = parseCEFTxt('foo;bar;baz\n"x";"y";"z"');
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0]?.reason).toContain('cabeçalho inválido');
  });

  it('quantidade de colunas errada: erro pontual, parser segue', () => {
    const csv = [
      '"Conta";"Data_Mov";"Nr_Doc";"Historico";"Valor";"Deb_Cred"',
      '"acc";"20250401";"001";"OK";"100.00";"C"',
      '"acc";"20250401";"002";"FALTA COLUNA";"100.00"',
      '"acc";"20250402";"003";"OK2";"200.00";"D"',
    ].join('\n');
    const r = parseCEFTxt(csv);
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('colunas');
  });

  it('lida com CRLF (terminadores Windows)', () => {
    const csv =
      '"Conta";"Data_Mov";"Nr_Doc";"Historico";"Valor";"Deb_Cred"\r\n' +
      '"acc";"20250401";"001";"OK";"100.00";"C"\r\n';
    const r = parseCEFTxt(csv);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });
});

describe('parseCEFTxt — fixture real (cef_apr25.txt)', () => {
  const exists = existsSync(REAL_APR25);
  it.skipIf(!exists)('parseia o arquivo real sem erros', () => {
    const content = readFileSync(REAL_APR25, 'utf8');
    const r = parseCEFTxt(content);
    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(400);
    const first = r.ok[0];
    expect(first?.date.toISOString().startsWith('2025-04-01')).toBe(true);
    expect(first?.direction).toBe('credit');
    expect(first?.amount).toBe(5964.52);
    for (const tx of r.ok) {
      expect(tx.balance).toBeUndefined();
    }
  });
});
