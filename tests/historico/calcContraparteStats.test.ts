import { describe, expect, it } from 'vitest';
import {
  HistoricoError,
  calcContraparteStats,
  type EventoCaixa,
} from '../../src/index.js';
import { makeRealizado, utcDate } from './fixtures/helpers.js';

describe('calcContraparteStats', () => {
  it('6 pares com delta consistente (todos +5 dias) → padrao_estavel=true, mediana=5', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `ev_${i}`,
          valor: 1000,
          direcao: 'saida',
          contraparte_id: 'fornecedor_A',
          data_vencimento: utcDate(2026, 1, 10 + i * 5),
          data_realizada: utcDate(2026, 1, 15 + i * 5), // +5 dias
        }),
      );
    }
    const result = calcContraparteStats(eventos);
    expect(result.size).toBe(1);
    const stats = result.get('fornecedor_A')!;
    expect(stats.n).toBe(6);
    expect(stats.mediana_dias).toBe(5);
    expect(stats.media_dias).toBe(5);
    expect(stats.desvio_dias).toBe(0);
    expect(stats.padrao_estavel).toBe(true);
    expect(stats.confianca_inferencia).toBe('alta');
  });

  it('6 pares com delta disperso → padrao_estavel=false, confianca=media', () => {
    const deltas = [-3, 2, 10, -1, 7, -5];
    const eventos: EventoCaixa[] = deltas.map((d, i) =>
      makeRealizado({
        id: `ev_${i}`,
        valor: 1000,
        direcao: 'saida',
        contraparte_id: 'fornecedor_disperso',
        data_vencimento: utcDate(2026, 1, 10),
        data_realizada: new Date(
          utcDate(2026, 1, 10).getTime() + d * 86_400_000,
        ),
      }),
    );
    const result = calcContraparteStats(eventos);
    const stats = result.get('fornecedor_disperso')!;
    expect(stats.n).toBe(6);
    expect(stats.padrao_estavel).toBe(false);
    expect(stats.desvio_dias).toBeGreaterThan(3);
    expect(stats.confianca_inferencia).toBe('media');
  });

  it('3 pares (n insuficiente) → padrao_estavel=false, confianca=baixa', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'ev_1',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_curto',
        data_vencimento: utcDate(2026, 1, 10),
        data_realizada: utcDate(2026, 1, 15),
      }),
      makeRealizado({
        id: 'ev_2',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_curto',
        data_vencimento: utcDate(2026, 2, 10),
        data_realizada: utcDate(2026, 2, 15),
      }),
      makeRealizado({
        id: 'ev_3',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_curto',
        data_vencimento: utcDate(2026, 3, 10),
        data_realizada: utcDate(2026, 3, 15),
      }),
    ];
    const result = calcContraparteStats(eventos);
    const stats = result.get('fornecedor_curto')!;
    expect(stats.n).toBe(3);
    expect(stats.padrao_estavel).toBe(false);
    expect(stats.confianca_inferencia).toBe('baixa');
  });

  it('mediana=0 (paga sempre no dia) → padrao_estavel=false', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `ev_${i}`,
          valor: 100,
          direcao: 'saida',
          contraparte_id: 'fornecedor_pontual',
          data_vencimento: utcDate(2026, 1, 10 + i * 5),
          data_realizada: utcDate(2026, 1, 10 + i * 5), // delta=0
        }),
      );
    }
    const result = calcContraparteStats(eventos);
    const stats = result.get('fornecedor_pontual')!;
    expect(stats.mediana_dias).toBe(0);
    expect(stats.desvio_dias).toBe(0);
    // |mediana| < 1 → não é padrão (não há shift a aprender).
    expect(stats.padrao_estavel).toBe(false);
  });

  it('eventos sem data_vencimento (CEF puro) são ignorados', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'cef_1',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'banco',
        data_realizada: utcDate(2026, 1, 10),
        // sem data_vencimento
      }),
      makeRealizado({
        id: 'cef_2',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'banco',
        data_realizada: utcDate(2026, 2, 10),
      }),
    ];
    const result = calcContraparteStats(eventos);
    expect(result.size).toBe(0);
  });

  it('eventos sem contraparte_id são ignorados', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'sem_contraparte_1',
        valor: 100,
        direcao: 'saida',
        data_vencimento: utcDate(2026, 1, 10),
        data_realizada: utcDate(2026, 1, 15),
      }),
    ];
    const result = calcContraparteStats(eventos);
    expect(result.size).toBe(0);
  });

  it('provenance presente em toda saída', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `ev_${i}`,
          valor: 100,
          direcao: 'saida',
          contraparte_id: 'fornecedor_X',
          data_vencimento: utcDate(2026, 1, 10 + i * 5),
          data_realizada: utcDate(2026, 1, 13 + i * 5),
        }),
      );
    }
    const stats = calcContraparteStats(eventos).get('fornecedor_X')!;
    expect(stats.inferido_de).toBe('delta_vencimento_realizada');
    expect(stats.n_amostras).toBe(6);
    expect(stats.confianca_inferencia).toBeDefined();
  });

  it('input vazio → Map vazio (sem throw)', () => {
    const result = calcContraparteStats([]);
    expect(result.size).toBe(0);
  });

  it('lança HistoricoError em realizado com data_realizada inválida (NaN)', () => {
    const evRuim = {
      ...makeRealizado({
        id: 'ev_bad',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'X',
        data_vencimento: utcDate(2026, 1, 10),
        data_realizada: utcDate(2026, 1, 15),
      }),
      data_realizada: new Date(Number.NaN),
    };
    expect(() => calcContraparteStats([evRuim])).toThrow(HistoricoError);
  });

  it('determinismo: 2 chamadas → estatísticas idênticas', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `ev_${i}`,
          valor: 100,
          direcao: 'saida',
          contraparte_id: 'fornecedor_det',
          data_vencimento: utcDate(2026, 1, 10 + i * 5),
          data_realizada: utcDate(2026, 1, 15 + i * 5),
        }),
      );
    }
    const a = calcContraparteStats(eventos);
    const b = calcContraparteStats(eventos);
    expect(a.get('fornecedor_det')).toEqual(b.get('fornecedor_det'));
  });
});
