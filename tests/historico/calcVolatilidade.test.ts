import { describe, expect, it } from 'vitest';
import {
  calcVolatilidade,
  type EventoCaixa,
} from '../../src/index.js';
import { makeRealizado, utcDate } from './fixtures/helpers.js';

const GERADO_EM = utcDate(2026, 5, 1);

describe('calcVolatilidade', () => {
  it('12 períodos com saídas (média 100k, desvio 10k) → cv≈0.1, qualidade=alta', () => {
    // 12 meses, valores: 90, 110, 90, 110, 90, 110, 90, 110, 90, 110, 90, 110 (média 100, desvio 10).
    const valoresK = [90, 110, 90, 110, 90, 110, 90, 110, 90, 110, 90, 110];
    const eventos: EventoCaixa[] = valoresK.map((vK, i) =>
      makeRealizado({
        id: `vol_${i}`,
        valor: vK * 1000,
        direcao: 'saida',
        criticidade: 'obrigatoria',
        data_realizada: utcDate(2025, 5 + i > 12 ? (5 + i) - 12 : 5 + i, 15),
        // ↑ esquema simples, mas os meses podem cair fora do intervalo válido.
      }),
    );
    // Reescrevendo dates simples: 12 meses consecutivos terminando em abril/26.
    const eventosFix: EventoCaixa[] = [];
    for (let i = 0; i < 12; i++) {
      // i=0 → mai/25, i=1 → jun/25, ..., i=11 → abr/26.
      const baseMonth = 5 + i;
      const year = 2025 + Math.floor((baseMonth - 1) / 12);
      const month = ((baseMonth - 1) % 12) + 1;
      eventosFix.push(
        makeRealizado({
          id: `vol_${i}`,
          valor: valoresK[i]! * 1000,
          direcao: 'saida',
          criticidade: 'obrigatoria',
          competencia: `${year}-${String(month).padStart(2, '0')}`,
          data_realizada: utcDate(year, month, 15),
        }),
      );
    }
    void eventos;

    const result = calcVolatilidade(eventosFix, { geradoEm: GERADO_EM });
    const stats = result.get('le_test')!;
    expect(stats.n_periodos).toBe(12);
    expect(stats.media).toBe(100_000);
    expect(stats.desvio).toBe(10_000);
    expect(stats.cv).toBeCloseTo(0.1, 5);
    expect(stats.qualidade).toBe('alta');
    expect(stats.confianca_inferencia).toBe('alta');
    expect(stats.base_temporal).toBe('competencia');
  });

  it('6 períodos → qualidade=insuficiente, confianca=baixa', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      const baseMonth = 11 + i;
      const year = 2025 + Math.floor((baseMonth - 1) / 12);
      const month = ((baseMonth - 1) % 12) + 1;
      eventos.push(
        makeRealizado({
          id: `vol_${i}`,
          valor: 100_000,
          direcao: 'saida',
          criticidade: 'obrigatoria',
          competencia: `${year}-${String(month).padStart(2, '0')}`,
          data_realizada: utcDate(year, month, 15),
        }),
      );
    }
    const stats = calcVolatilidade(eventos, { geradoEm: GERADO_EM }).get(
      'le_test',
    )!;
    expect(stats.n_periodos).toBe(6);
    expect(stats.qualidade).toBe('insuficiente');
    expect(stats.confianca_inferencia).toBe('baixa');
  });

  it('sem competencia em algum evento → fallback semana_iso', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 12; i++) {
      const baseMonth = 5 + i;
      const year = 2025 + Math.floor((baseMonth - 1) / 12);
      const month = ((baseMonth - 1) % 12) + 1;
      eventos.push(
        makeRealizado({
          id: `noc_${i}`,
          valor: 50_000,
          direcao: 'saida',
          criticidade: 'critica_op',
          // sem competencia
          data_realizada: utcDate(year, month, 15),
        }),
      );
    }
    const stats = calcVolatilidade(eventos, { geradoEm: GERADO_EM }).get(
      'le_test',
    )!;
    expect(stats.base_temporal).toBe('semana_iso');
  });

  it('filtra fora da janela 365d', () => {
    const eventos: EventoCaixa[] = [
      // dentro da janela
      makeRealizado({
        id: 'in_1',
        valor: 100_000,
        direcao: 'saida',
        criticidade: 'obrigatoria',
        competencia: '2026-01',
        data_realizada: utcDate(2026, 1, 15),
      }),
      // fora da janela (>365 dias antes de geradoEm 2026-05-01)
      makeRealizado({
        id: 'out_1',
        valor: 999_999,
        direcao: 'saida',
        criticidade: 'obrigatoria',
        competencia: '2024-01',
        data_realizada: utcDate(2024, 1, 15),
      }),
    ];
    const stats = calcVolatilidade(eventos, { geradoEm: GERADO_EM }).get(
      'le_test',
    )!;
    expect(stats.n_periodos).toBe(1);
    expect(stats.media).toBe(100_000);
  });

  it('filtra fora da criticidade default (apenas obrigatoria/critica_op)', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'pend_1',
        valor: 100_000,
        direcao: 'saida',
        criticidade: 'pendente', // fora do default
        competencia: '2026-01',
        data_realizada: utcDate(2026, 1, 15),
      }),
      makeRealizado({
        id: 'obrig_1',
        valor: 50_000,
        direcao: 'saida',
        criticidade: 'obrigatoria',
        competencia: '2026-01',
        data_realizada: utcDate(2026, 1, 15),
      }),
    ];
    const stats = calcVolatilidade(eventos, { geradoEm: GERADO_EM }).get(
      'le_test',
    )!;
    expect(stats.n_periodos).toBe(1);
    expect(stats.media).toBe(50_000);
  });

  it('override criticidades inclui pendente (caminho V0)', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 12; i++) {
      const baseMonth = 5 + i;
      const year = 2025 + Math.floor((baseMonth - 1) / 12);
      const month = ((baseMonth - 1) % 12) + 1;
      eventos.push(
        makeRealizado({
          id: `pend_${i}`,
          valor: 1000,
          direcao: 'saida',
          criticidade: 'pendente',
          competencia: `${year}-${String(month).padStart(2, '0')}`,
          data_realizada: utcDate(year, month, 15),
        }),
      );
    }
    const stats = calcVolatilidade(eventos, {
      geradoEm: GERADO_EM,
      criticidades: ['obrigatoria', 'critica_op', 'pendente'],
    }).get('le_test')!;
    expect(stats.n_periodos).toBe(12);
    expect(stats.qualidade).toBe('alta');
  });

  it('input vazio → Map vazio (sem throw)', () => {
    const result = calcVolatilidade([], { geradoEm: GERADO_EM });
    expect(result.size).toBe(0);
  });

  it('provenance presente em toda saída', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'p_1',
        valor: 1000,
        direcao: 'saida',
        criticidade: 'obrigatoria',
        competencia: '2026-04',
        data_realizada: utcDate(2026, 4, 15),
      }),
    ];
    const stats = calcVolatilidade(eventos, { geradoEm: GERADO_EM }).get(
      'le_test',
    )!;
    expect(stats.inferido_de).toBe('saidas_obrigatorias_critica_op_12m');
    expect(stats.n_amostras).toBe(1);
    expect(stats.confianca_inferencia).toBeDefined();
  });
});
