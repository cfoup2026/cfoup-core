import { describe, expect, it } from 'vitest';
import {
  ProjecaoError,
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanaIsoOf,
  semanasJanela,
} from '../../src/index.js';

const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

describe('semanaIsoOf — regra ISO 8601', () => {
  it('2026-05-01 (sexta) → 2026-W18', () => {
    expect(semanaIsoOf(utc(2026, 5, 1))).toBe('2026-W18');
  });

  it('2026-04-27 (segunda, primeiro dia de W18) → 2026-W18', () => {
    expect(semanaIsoOf(utc(2026, 4, 27))).toBe('2026-W18');
  });

  it('2026-05-03 (domingo, último dia de W18) → 2026-W18', () => {
    expect(semanaIsoOf(utc(2026, 5, 3))).toBe('2026-W18');
  });

  it('2026-12-28 (segunda) → 2026-W53 (ano longo)', () => {
    expect(semanaIsoOf(utc(2026, 12, 28))).toBe('2026-W53');
  });

  it('2027-01-01 (sexta) → 2026-W53 (Thursday-pertence-ao-ano-anterior)', () => {
    expect(semanaIsoOf(utc(2027, 1, 1))).toBe('2026-W53');
  });

  it('2025-12-29 (segunda) → 2026-W01 (Thursday-pertence-ao-ano-seguinte)', () => {
    expect(semanaIsoOf(utc(2025, 12, 29))).toBe('2026-W01');
  });

  it('lança em data inválida', () => {
    expect(() => semanaIsoOf(new Date(Number.NaN))).toThrow(ProjecaoError);
  });
});

describe('inicioDaSemanaIso — segunda 00:00:00.000 UTC', () => {
  it('2026-W18 → 2026-04-27 00:00 UTC', () => {
    const inicio = inicioDaSemanaIso('2026-W18');
    expect(inicio.toISOString()).toBe('2026-04-27T00:00:00.000Z');
  });

  it('2026-W01 → 2025-12-29 (cruza ano)', () => {
    const inicio = inicioDaSemanaIso('2026-W01');
    expect(inicio.toISOString()).toBe('2025-12-29T00:00:00.000Z');
  });

  it('2026-W53 → 2026-12-28', () => {
    const inicio = inicioDaSemanaIso('2026-W53');
    expect(inicio.toISOString()).toBe('2026-12-28T00:00:00.000Z');
  });

  it('formato inválido → ProjecaoError', () => {
    expect(() => inicioDaSemanaIso('2026-18')).toThrow(ProjecaoError);
    expect(() => inicioDaSemanaIso('2026W18')).toThrow(ProjecaoError);
    expect(() => inicioDaSemanaIso('xx-Wzz')).toThrow(ProjecaoError);
  });

  it('número de semana fora de [1,53] → ProjecaoError', () => {
    expect(() => inicioDaSemanaIso('2026-W00')).toThrow(ProjecaoError);
    expect(() => inicioDaSemanaIso('2026-W54')).toThrow(ProjecaoError);
  });
});

describe('fimDaSemanaIso — domingo 23:59:59.999 UTC', () => {
  it('2026-W18 → 2026-05-03 23:59:59.999 UTC', () => {
    const fim = fimDaSemanaIso('2026-W18');
    expect(fim.toISOString()).toBe('2026-05-03T23:59:59.999Z');
  });

  it('inicio + 7d - 1ms === fim', () => {
    const inicio = inicioDaSemanaIso('2026-W18');
    const fim = fimDaSemanaIso('2026-W18');
    const diff = fim.getTime() - inicio.getTime();
    expect(diff).toBe(7 * 86_400_000 - 1);
  });
});

describe('semanasJanela — N semanas a partir de geradoEm', () => {
  it('geradoEm 2026-05-01, n=13 → 13 entradas começando em 2026-W18', () => {
    const j = semanasJanela(utc(2026, 5, 1), 13);
    expect(j).toHaveLength(13);
    expect(j[0]).toBe('2026-W18');
    expect(j[12]).toBe('2026-W30');
  });

  it('geradoEm na segunda da semana → mesma semana é a primeira', () => {
    const j = semanasJanela(utc(2026, 4, 27), 13);
    expect(j[0]).toBe('2026-W18');
  });

  it('geradoEm no domingo da semana → mesma semana é a primeira', () => {
    const j = semanasJanela(utc(2026, 5, 3), 13);
    expect(j[0]).toBe('2026-W18');
  });

  it('janela cruza ano: geradoEm 2025-12-29 → começa 2026-W01', () => {
    const j = semanasJanela(utc(2025, 12, 29), 4);
    expect(j).toEqual(['2026-W01', '2026-W02', '2026-W03', '2026-W04']);
  });

  it('janela curta: n=1 retorna só a semana de geradoEm', () => {
    expect(semanasJanela(utc(2026, 5, 1), 1)).toEqual(['2026-W18']);
  });

  it('n inválido → ProjecaoError', () => {
    expect(() => semanasJanela(utc(2026, 5, 1), 0)).toThrow(ProjecaoError);
    expect(() => semanasJanela(utc(2026, 5, 1), -1)).toThrow(ProjecaoError);
    expect(() => semanasJanela(utc(2026, 5, 1), 1.5)).toThrow(ProjecaoError);
  });
});
