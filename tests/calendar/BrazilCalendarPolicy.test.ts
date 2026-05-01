import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';

const cal = new BrazilCalendarPolicy();
const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

describe('BrazilCalendarPolicy.id', () => {
  it('é "br"', () => {
    expect(cal.id).toBe('br');
  });
});

describe('BrazilCalendarPolicy.isBusinessDay — dias úteis', () => {
  it('aceita 5 dias úteis aleatórios em 2025/2026', () => {
    expect(cal.isBusinessDay(utc(2025, 5, 7))).toBe(true); // qua
    expect(cal.isBusinessDay(utc(2025, 7, 14))).toBe(true); // seg
    expect(cal.isBusinessDay(utc(2026, 3, 19))).toBe(true); // qui
    expect(cal.isBusinessDay(utc(2026, 5, 6))).toBe(true); // qua
    expect(cal.isBusinessDay(utc(2026, 8, 12))).toBe(true); // qua
  });

  it('dia útil colado em feriado (26/12/2026 — sáb não conta; 26 é sáb em 2026)', () => {
    // 25/12/2026 = sex (feriado). 26/12 = sáb. 28/12 = seg (próximo útil real).
    expect(cal.isBusinessDay(utc(2026, 12, 28))).toBe(true);
  });
});

describe('BrazilCalendarPolicy.isBusinessDay — fim de semana', () => {
  it('rejeita sábado e domingo', () => {
    expect(cal.isBusinessDay(utc(2026, 5, 2))).toBe(false); // sábado
    expect(cal.isBusinessDay(utc(2026, 5, 3))).toBe(false); // domingo
    expect(cal.isBusinessDay(utc(2025, 1, 4))).toBe(false); // sábado
    expect(cal.isBusinessDay(utc(2025, 1, 5))).toBe(false); // domingo
  });
});

describe('BrazilCalendarPolicy.isBusinessDay — feriados nacionais 2026', () => {
  it.each([
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
  ] as const)('%s (2026-%i-%i) → não é dia útil', (_label, m, d) => {
    expect(cal.isBusinessDay(utc(2026, m, d))).toBe(false);
  });
});

describe('BrazilCalendarPolicy.nextBusinessDay — sempre avança ao menos 1 dia', () => {
  it('dia útil → próximo dia útil (estritamente após)', () => {
    // Quarta 2026-05-06 → quinta 2026-05-07 (próximo útil).
    expect(cal.nextBusinessDay(utc(2026, 5, 6))).toEqual(utc(2026, 5, 7));
  });

  it('sexta normal → segunda', () => {
    // Sexta 2026-05-08 → segunda 2026-05-11.
    expect(cal.nextBusinessDay(utc(2026, 5, 8))).toEqual(utc(2026, 5, 11));
  });

  it('sábado → segunda', () => {
    // Sábado 2026-05-02 → segunda 2026-05-04.
    expect(cal.nextBusinessDay(utc(2026, 5, 2))).toEqual(utc(2026, 5, 4));
  });

  it('domingo → segunda', () => {
    // Domingo 2026-05-03 → segunda 2026-05-04.
    expect(cal.nextBusinessDay(utc(2026, 5, 3))).toEqual(utc(2026, 5, 4));
  });

  it('quinta véspera de feriado-sexta-santa → próxima segunda', () => {
    // 2026-04-02 quinta. 03 sexta santa. 04 sáb. 05 dom (Páscoa).
    // 06 segunda → próximo útil real.
    expect(cal.nextBusinessDay(utc(2026, 4, 2))).toEqual(utc(2026, 4, 6));
  });

  it('sequência de feriados/ponte natal+ano novo → 1º útil de janeiro', () => {
    // 2026-12-24 quinta. 25 sex (Natal). 26 sáb. 27 dom. 28 seg → próximo útil.
    expect(cal.nextBusinessDay(utc(2026, 12, 24))).toEqual(utc(2026, 12, 28));
    // Mais agressivo: 2026-12-31 quinta (último dia útil do ano? — vamos checar).
    // 2026-12-31 = quinta. 2027-01-01 = sex (Ano Novo). 02 sáb. 03 dom. 04 seg.
    expect(cal.nextBusinessDay(utc(2026, 12, 31))).toEqual(utc(2027, 1, 4));
  });

  it('sábado de Tiradentes (2026-04-25) → segunda 2026-04-27', () => {
    // 2026-04-21 ter (Tiradentes). 25 sáb. 26 dom. 27 seg → próximo útil.
    expect(cal.nextBusinessDay(utc(2026, 4, 25))).toEqual(utc(2026, 4, 27));
  });
});
