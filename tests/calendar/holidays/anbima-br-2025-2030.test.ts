import { describe, expect, it } from 'vitest';
import {
  ANBIMA_BR_HOLIDAYS_2025_2030,
  ANBIMA_BR_YEARS_COVERED,
} from '../../../src/calendar/index.js';

/**
 * Tabela de feriados nacionais BR — esperado por ano. Cada entrada é
 * [label, MM, DD]. Usar arrays simples (não Map) pra deixar a tabela
 * legível e lookup direto.
 *
 * Páscoas: 2025=20/04, 2026=05/04, 2027=28/03, 2028=16/04, 2029=01/04, 2030=21/04.
 * Carnaval seg = Páscoa - 48; Carnaval ter = Páscoa - 47;
 * Sexta Santa = Páscoa - 2; Corpus Christi = Páscoa + 60.
 */
type Entry = readonly [label: string, month: number, day: number];

const EXPECTED_BY_YEAR: Record<number, readonly Entry[]> = {
  2025: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 3, 3],
    ['Carnaval (ter)', 3, 4],
    ['Sexta-feira Santa', 4, 18],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 6, 19],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
  2026: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 2, 16],
    ['Carnaval (ter)', 2, 17],
    ['Sexta-feira Santa', 4, 3],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 6, 4],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
  2027: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 2, 8],
    ['Carnaval (ter)', 2, 9],
    ['Sexta-feira Santa', 3, 26],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 5, 27],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
  2028: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 2, 28],
    ['Carnaval (ter)', 2, 29],
    ['Sexta-feira Santa', 4, 14],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 6, 15],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
  2029: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 2, 12],
    ['Carnaval (ter)', 2, 13],
    ['Sexta-feira Santa', 3, 30],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 5, 31],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
  2030: [
    ['Confraternização Universal', 1, 1],
    ['Carnaval (seg)', 3, 4],
    ['Carnaval (ter)', 3, 5],
    ['Sexta-feira Santa', 4, 19],
    ['Tiradentes', 4, 21],
    ['Dia do Trabalho', 5, 1],
    ['Corpus Christi', 6, 20],
    ['Independência', 9, 7],
    ['N. Sra. Aparecida', 10, 12],
    ['Finados', 11, 2],
    ['Proclamação da República', 11, 15],
    ['Consciência Negra', 11, 20],
    ['Natal', 12, 25],
  ],
};

const pad = (n: number): string => String(n).padStart(2, '0');
const isoKey = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

describe('ANBIMA seed 2025–2030 — anos cobertos', () => {
  it('expõe ANBIMA_BR_YEARS_COVERED com 2025..2030', () => {
    expect(ANBIMA_BR_YEARS_COVERED).toEqual([2025, 2026, 2027, 2028, 2029, 2030]);
  });

  it('tabela esperada (test-side) cobre os mesmos anos', () => {
    expect(Object.keys(EXPECTED_BY_YEAR).map(Number).sort()).toEqual([
      ...ANBIMA_BR_YEARS_COVERED,
    ].sort());
  });
});

describe('ANBIMA seed — cada feriado em cada ano está na seed', () => {
  for (const year of ANBIMA_BR_YEARS_COVERED) {
    const entries = EXPECTED_BY_YEAR[year];
    if (entries === undefined) {
      throw new Error(`Tabela esperada faltando ${year}`);
    }
    for (const [label, m, d] of entries) {
      it(`${year} · ${label} (${pad(m)}/${pad(d)}) está na seed`, () => {
        expect(ANBIMA_BR_HOLIDAYS_2025_2030.has(isoKey(year, m, d))).toBe(true);
      });
    }
  }
});

describe('ANBIMA seed — contagem total = 13 entradas × 6 anos = 78', () => {
  it('seed tem exatamente 78 datas', () => {
    expect(ANBIMA_BR_HOLIDAYS_2025_2030.size).toBe(78);
  });

  it('soma de entradas esperadas = 78', () => {
    let total = 0;
    for (const year of ANBIMA_BR_YEARS_COVERED) {
      total += EXPECTED_BY_YEAR[year]?.length ?? 0;
    }
    expect(total).toBe(78);
  });
});

describe('ANBIMA seed — sanity: datas vizinhas NÃO estão na seed', () => {
  it('26/12/2026 (dia após Natal) não é feriado nacional', () => {
    expect(ANBIMA_BR_HOLIDAYS_2025_2030.has('2026-12-26')).toBe(false);
  });

  it('22/04/2026 (dia após Tiradentes) não é feriado nacional', () => {
    expect(ANBIMA_BR_HOLIDAYS_2025_2030.has('2026-04-22')).toBe(false);
  });
});
