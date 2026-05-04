import { describe, expect, it } from 'vitest';
import {
  BrazilCalendarPolicy,
  deriveDataEsperada,
  type ContraparteHistory,
} from '../../src/calendar/index.js';

const cal = new BrazilCalendarPolicy();
const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

describe('deriveDataEsperada — passthrough em dia útil', () => {
  it('quarta → mesma data (não move)', () => {
    const d = utc(2026, 5, 6);
    expect(deriveDataEsperada(d, cal)).toEqual(d);
  });

  it('segunda → mesma data', () => {
    const d = utc(2026, 5, 4);
    expect(deriveDataEsperada(d, cal)).toEqual(d);
  });

  it('sexta normal → mesma data', () => {
    const d = utc(2026, 5, 8);
    expect(deriveDataEsperada(d, cal)).toEqual(d);
  });
});

describe('deriveDataEsperada — fim de semana move para segunda', () => {
  it('sábado 2026-05-02 → segunda 2026-05-04', () => {
    expect(deriveDataEsperada(utc(2026, 5, 2), cal)).toEqual(utc(2026, 5, 4));
  });

  it('domingo 2026-05-03 → segunda 2026-05-04', () => {
    expect(deriveDataEsperada(utc(2026, 5, 3), cal)).toEqual(utc(2026, 5, 4));
  });
});

describe('deriveDataEsperada — feriado move para próximo dia útil', () => {
  it('25/12/2026 (sexta — Natal) → segunda 28/12/2026', () => {
    expect(deriveDataEsperada(utc(2026, 12, 25), cal)).toEqual(
      utc(2026, 12, 28),
    );
  });

  it('21/04/2026 (terça — Tiradentes) → quarta 22/04/2026', () => {
    expect(deriveDataEsperada(utc(2026, 4, 21), cal)).toEqual(utc(2026, 4, 22));
  });

  it('01/05/2026 (sexta — Trabalho) → segunda 04/05/2026', () => {
    expect(deriveDataEsperada(utc(2026, 5, 1), cal)).toEqual(utc(2026, 5, 4));
  });
});

describe('deriveDataEsperada — sequência de feriados/ponte', () => {
  it('Natal seguido de fim de semana → 1º útil em janeiro', () => {
    // 2026-12-25 sex (Natal) → próximo útil 2026-12-28 seg.
    expect(deriveDataEsperada(utc(2026, 12, 25), cal)).toEqual(
      utc(2026, 12, 28),
    );
  });

  it('Tiradentes 2030 (domingo) → segunda 2030-04-22', () => {
    // 2030-04-21 = Tiradentes que cai no domingo. 22 segunda.
    expect(deriveDataEsperada(utc(2030, 4, 21), cal)).toEqual(utc(2030, 4, 22));
  });
});

describe('deriveDataEsperada — hook contraparteHistory (compat de assinatura)', () => {
  it('aceita ContraparteHistory vazio sem quebrar comportamento', () => {
    const empty: ContraparteHistory = new Map();
    const d = utc(2026, 5, 6); // útil
    expect(deriveDataEsperada(d, cal, empty)).toEqual(d);
  });

  it('com history vazio também passa direto em fim de semana → seg', () => {
    const empty: ContraparteHistory = new Map();
    expect(deriveDataEsperada(utc(2026, 5, 2), cal, empty)).toEqual(
      utc(2026, 5, 4),
    );
  });
});
