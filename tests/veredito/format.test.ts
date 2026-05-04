import { describe, expect, it } from 'vitest';
import { formatarBRL, formatarDataDDMM } from '../../src/index.js';

describe('format — formatarBRL', () => {
  it('12345.6 → "12.345,60"', () => {
    expect(formatarBRL(12345.6)).toBe('12.345,60');
  });

  it('0.5 → "0,50"', () => {
    expect(formatarBRL(0.5)).toBe('0,50');
  });

  it('0 → "0,00"', () => {
    expect(formatarBRL(0)).toBe('0,00');
  });

  it('1234567.89 → "1.234.567,89"', () => {
    expect(formatarBRL(1234567.89)).toBe('1.234.567,89');
  });

  it('-1234.5 → "-1.234,50"', () => {
    expect(formatarBRL(-1234.5)).toBe('-1.234,50');
  });

  it('100 → "100,00" (sem milhar)', () => {
    expect(formatarBRL(100)).toBe('100,00');
  });

  it('999 → "999,00" (limite inferior do milhar)', () => {
    expect(formatarBRL(999)).toBe('999,00');
  });

  it('1000 → "1.000,00" (primeiro milhar)', () => {
    expect(formatarBRL(1000)).toBe('1.000,00');
  });

  it('NaN → "0,00" (defesa)', () => {
    expect(formatarBRL(Number.NaN)).toBe('0,00');
  });

  it('Infinity → "0,00" (defesa)', () => {
    expect(formatarBRL(Infinity)).toBe('0,00');
  });
});

describe('format — formatarDataDDMM', () => {
  it('ISO 2026-05-25 → "25/05"', () => {
    expect(formatarDataDDMM('2026-05-25T00:00:00.000Z')).toBe('25/05');
  });

  it('ISO 2026-01-01 → "01/01"', () => {
    expect(formatarDataDDMM('2026-01-01T00:00:00.000Z')).toBe('01/01');
  });

  it('ISO 2026-12-31 → "31/12"', () => {
    expect(formatarDataDDMM('2026-12-31T00:00:00.000Z')).toBe('31/12');
  });

  it('Date → "DD/MM"', () => {
    expect(formatarDataDDMM(new Date(Date.UTC(2026, 4, 25)))).toBe('25/05');
  });

  it('data inválida → "00/00" (defesa)', () => {
    expect(formatarDataDDMM(new Date(Number.NaN))).toBe('00/00');
  });

  it('determinismo: 100 chamadas → mesma saída', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(formatarDataDDMM('2026-05-25T00:00:00.000Z'));
    }
    expect(set.size).toBe(1);
  });
});
