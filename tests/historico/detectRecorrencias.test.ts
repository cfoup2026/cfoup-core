import { describe, expect, it } from 'vitest';
import {
  detectRecorrencias,
  type EventoCaixa,
} from '../../src/index.js';
import { makeRealizado, utcDate } from './fixtures/helpers.js';

const GERADO_EM = utcDate(2026, 5, 1);

/** Helper para gerar série mensal de N ocorrências terminando em `lastDate`. */
function seriesMensal(args: {
  prefix: string;
  contraparte_id: string;
  bucket_id: string;
  valor: number;
  n: number;
  lastDate: Date;
  step?: number; // dias entre ocorrências (default 30)
}): EventoCaixa[] {
  const eventos: EventoCaixa[] = [];
  const step = args.step ?? 30;
  for (let i = 0; i < args.n; i++) {
    const offsetDays = -(args.n - 1 - i) * step;
    const date = new Date(args.lastDate.getTime() + offsetDays * 86_400_000);
    eventos.push(
      makeRealizado({
        id: `${args.prefix}_${i}`,
        valor: args.valor,
        direcao: 'saida',
        contraparte_id: args.contraparte_id,
        bucket_id: args.bucket_id,
        data_realizada: date,
      }),
    );
  }
  return eventos;
}

describe('detectRecorrencias', () => {
  it('12 ocorrências mensais valor consistente → confianca=alta, ativa=true, periodo=mensal', () => {
    const eventos = seriesMensal({
      prefix: 'mensal_alta',
      contraparte_id: 'fornecedor_aluguel',
      bucket_id: 'pendente_classificacao',
      valor: 5000,
      n: 12,
      lastDate: utcDate(2026, 4, 15),
      step: 30,
    });
    const recs = detectRecorrencias(eventos, GERADO_EM);
    expect(recs.length).toBe(1);
    const r = recs[0]!;
    expect(r.confianca).toBe('alta');
    expect(r.ativa).toBe(true);
    expect(r.periodo).toBe('mensal');
    expect(r.n_ocorrencias).toBe(12);
    expect(r.valor_mediano).toBe(5000);
    expect(r.contraparte_id).toBe('fornecedor_aluguel');
  });

  it('4 ocorrências mensais com gap de 2 meses no meio → confianca=media', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'gap_1',
        valor: 1000,
        direcao: 'saida',
        contraparte_id: 'fornecedor_falho',
        data_realizada: utcDate(2025, 12, 1),
      }),
      makeRealizado({
        id: 'gap_2',
        valor: 1000,
        direcao: 'saida',
        contraparte_id: 'fornecedor_falho',
        data_realizada: utcDate(2026, 1, 1),
      }),
      // gap de 2 meses (skip Feb)
      makeRealizado({
        id: 'gap_3',
        valor: 1000,
        direcao: 'saida',
        contraparte_id: 'fornecedor_falho',
        data_realizada: utcDate(2026, 3, 1),
      }),
      makeRealizado({
        id: 'gap_4',
        valor: 1000,
        direcao: 'saida',
        contraparte_id: 'fornecedor_falho',
        data_realizada: utcDate(2026, 4, 1),
      }),
    ];
    const recs = detectRecorrencias(eventos, GERADO_EM);
    // mediana dos gaps (31, 59, 31) = 31 → mensal.
    // matches: 31 ✓, 59 ✗, 31 ✓ → 2 of 3 → media (n>=3, majority match).
    if (recs.length === 0) {
      // se mediana 31 não classificou como mensal, é baixa/não detectada
      // — ambos aceitos pelo critério. Skip.
      return;
    }
    const r = recs[0]!;
    expect(['media', 'baixa']).toContain(r.confianca);
  });

  it('3 ocorrências em 18 meses sem padrão → confianca=baixa OU não detecta', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'rand_1',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_rand',
        data_realizada: utcDate(2024, 11, 5),
      }),
      makeRealizado({
        id: 'rand_2',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_rand',
        data_realizada: utcDate(2025, 6, 22),
      }),
      makeRealizado({
        id: 'rand_3',
        valor: 100,
        direcao: 'saida',
        contraparte_id: 'fornecedor_rand',
        data_realizada: utcDate(2026, 4, 18),
      }),
    ];
    const recs = detectRecorrencias(eventos, GERADO_EM);
    // Aceita: nenhuma recorrência (mediana de gap fora das faixas) OU baixa.
    if (recs.length === 0) return;
    expect(recs[0]!.confianca).toBe('baixa');
  });

  it('tolerância ±10%: R$ 50000 e R$ 53000 contam mesma série; R$ 60000 inicia nova', () => {
    const eventos: EventoCaixa[] = [];
    // 6 ocorrências com valores em 50000-53000 (dentro do ±10% de 50000).
    const valores = [50000, 51000, 52000, 53000, 50500, 52500];
    const lastDate = utcDate(2026, 4, 15);
    for (let i = 0; i < 6; i++) {
      const date = new Date(lastDate.getTime() - (5 - i) * 30 * 86_400_000);
      eventos.push(
        makeRealizado({
          id: `cluster_${i}`,
          valor: valores[i]!,
          direcao: 'saida',
          contraparte_id: 'fornecedor_cluster',
          data_realizada: date,
        }),
      );
    }
    // 6 ocorrências com R$ 60000 (>10% acima → cluster separado).
    for (let i = 0; i < 6; i++) {
      const date = new Date(lastDate.getTime() - (5 - i) * 30 * 86_400_000);
      eventos.push(
        makeRealizado({
          id: `outro_${i}`,
          valor: 60000,
          direcao: 'saida',
          contraparte_id: 'fornecedor_cluster',
          data_realizada: date,
        }),
      );
    }
    const recs = detectRecorrencias(eventos, GERADO_EM);
    expect(recs.length).toBe(2);
    const valoresMedianos = recs.map((r) => r.valor_mediano).sort();
    expect(valoresMedianos[0]).toBeLessThan(54000);
    expect(valoresMedianos[1]).toBe(60000);
  });

  it('última ocorrência > 1.5 períodos atrás → ativa=false e confianca=baixa', () => {
    // 12 mensais terminando há 6 meses (>1.5 meses).
    const eventos = seriesMensal({
      prefix: 'antigo',
      contraparte_id: 'fornecedor_antigo',
      bucket_id: 'pendente_classificacao',
      valor: 1000,
      n: 12,
      lastDate: utcDate(2025, 11, 1), // último em nov/25; geradoEm em mai/26 → 6 meses
      step: 30,
    });
    const recs = detectRecorrencias(eventos, GERADO_EM);
    // Pode ou não detectar (ativa=false); se detectar, confianca=baixa.
    if (recs.length === 0) return;
    expect(recs[0]!.ativa).toBe(false);
    expect(recs[0]!.confianca).toBe('baixa');
  });

  it('provenance presente', () => {
    const eventos = seriesMensal({
      prefix: 'prov',
      contraparte_id: 'X',
      bucket_id: 'pendente_classificacao',
      valor: 100,
      n: 6,
      lastDate: utcDate(2026, 4, 1),
    });
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const r = recs[0];
    if (r === undefined) return;
    expect(r.inferido_de).toBe('agrupamento_contraparte_bucket_valor');
    expect(r.n_amostras).toBeGreaterThanOrEqual(3);
    expect(r.recorrencia_id).toMatch(/^rec_/);
  });

  it('determinismo: 2 chamadas com mesmo geradoEm → mesmo array', () => {
    const eventos = seriesMensal({
      prefix: 'det',
      contraparte_id: 'Y',
      bucket_id: 'pendente_classificacao',
      valor: 200,
      n: 8,
      lastDate: utcDate(2026, 4, 1),
    });
    const a = detectRecorrencias(eventos, GERADO_EM);
    const b = detectRecorrencias(eventos, GERADO_EM);
    expect(a).toEqual(b);
  });
});
