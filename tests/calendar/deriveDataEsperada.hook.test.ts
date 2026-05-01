import { describe, expect, it } from 'vitest';
import {
  BrazilCalendarPolicy,
  deriveDataEsperada,
  type ContraparteHistory,
} from '../../src/calendar/index.js';

const cal = new BrazilCalendarPolicy();
const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

describe('deriveDataEsperada — hook contraparteHistory ATIVO (Estágio 2.2)', () => {
  it('compat: chamada sem hook é idêntica ao Stage 1.3', () => {
    // 2026-04-21 = Tiradentes (terça). Sem hook → próximo útil 2026-04-22.
    expect(deriveDataEsperada(utc(2026, 4, 21), cal)).toEqual(utc(2026, 4, 22));
    // Dia útil → identidade.
    expect(deriveDataEsperada(utc(2026, 5, 6), cal)).toEqual(utc(2026, 5, 6));
  });

  it('contraparte estável com mediana +5 desloca antes do calendário', () => {
    // 2026-05-04 (segunda) + 5 = 2026-05-09 (sábado) → próximo útil seg 11.
    const history: ContraparteHistory = new Map([
      ['fornecedor_atrasado', { padrao_estavel: true, mediana_dias: 5 }],
    ]);
    expect(
      deriveDataEsperada(utc(2026, 5, 4), cal, history, 'fornecedor_atrasado'),
    ).toEqual(utc(2026, 5, 11));
  });

  it('contraparte estável com mediana -3 desloca para trás', () => {
    // 2026-05-08 (sexta) - 3 = 2026-05-05 (terça útil) → identidade.
    const history: ContraparteHistory = new Map([
      ['cliente_antecipa', { padrao_estavel: true, mediana_dias: -3 }],
    ]);
    expect(
      deriveDataEsperada(utc(2026, 5, 8), cal, history, 'cliente_antecipa'),
    ).toEqual(utc(2026, 5, 5));
  });

  it('contraparte estável + mediana ±X que cai em fim de semana → calendário move', () => {
    // 2026-05-04 (seg) + 5 = 2026-05-09 (sábado) → segunda 2026-05-11.
    const history: ContraparteHistory = new Map([
      ['fornecedor_X', { padrao_estavel: true, mediana_dias: 5 }],
    ]);
    expect(
      deriveDataEsperada(utc(2026, 5, 4), cal, history, 'fornecedor_X'),
    ).toEqual(utc(2026, 5, 11));
  });

  it('contraparte INSTÁVEL (padrao_estavel=false) NÃO ajusta', () => {
    const history: ContraparteHistory = new Map([
      ['fornecedor_inst', { padrao_estavel: false, mediana_dias: 5 }],
    ]);
    // Sem ajuste, comportamento idêntico ao calendário puro.
    expect(
      deriveDataEsperada(utc(2026, 5, 6), cal, history, 'fornecedor_inst'),
    ).toEqual(utc(2026, 5, 6));
  });

  it('contraparte estável com mediana ZERO NÃO ajusta', () => {
    // padrão estável de "paga sempre no dia" — não há shift a aplicar.
    const history: ContraparteHistory = new Map([
      ['fornecedor_pontual', { padrao_estavel: true, mediana_dias: 0 }],
    ]);
    expect(
      deriveDataEsperada(utc(2026, 5, 6), cal, history, 'fornecedor_pontual'),
    ).toEqual(utc(2026, 5, 6));
  });

  it('contraparte ausente do mapa NÃO ajusta', () => {
    const history: ContraparteHistory = new Map([
      ['outro_fornecedor', { padrao_estavel: true, mediana_dias: 10 }],
    ]);
    // Pergunta por contraparte que não está no map → fallback calendário puro.
    expect(
      deriveDataEsperada(utc(2026, 5, 6), cal, history, 'fornecedor_x'),
    ).toEqual(utc(2026, 5, 6));
  });

  it('contraparteId ausente (somente history) NÃO ajusta', () => {
    const history: ContraparteHistory = new Map([
      ['x', { padrao_estavel: true, mediana_dias: 10 }],
    ]);
    // Sem contraparteId, mesmo com history não há a quem aplicar.
    expect(deriveDataEsperada(utc(2026, 5, 6), cal, history)).toEqual(
      utc(2026, 5, 6),
    );
  });
});
