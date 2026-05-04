import { describe, expect, it } from 'vitest';
import { agregaPendentesClassificacao } from '../../src/index.js';
import { mkEvento, utc as utcMk } from '../reconciliacao/fixtures/mkEvento.js';
import { mkProjecao, mkUnidade } from './fixtures/index.js';

describe('agregaPendentesClassificacao', () => {
  it('eventos com bucket_id=pendente_classificacao agregam por (LE, semana, direcao)', () => {
    // 3 saídas pendente em W20, 1 entrada pendente em W20, 1 saída em W21.
    const ev = (id: string, valor: number, dir: 'entrada' | 'saida') =>
      mkEvento({
        id,
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: dir,
        valor,
        data_realizada: utcMk(2026, 5, 13),
        data_esperada: utcMk(2026, 5, 13),
      });
    const e1 = ev('e1', 100, 'saida');
    const e2 = ev('e2', 200, 'saida');
    const e3 = ev('e3', 300, 'saida');
    const e4 = ev('e4', 1000, 'entrada');
    const e5 = ev('e5', 50, 'saida');

    const eventos_por_semana = Array.from({ length: 13 }, (_, i) => {
      if (i === 2) return { evento_ids: ['e1', 'e2', 'e3', 'e4'] }; // W20
      if (i === 3) return { evento_ids: ['e5'] }; // W21
      return {};
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });

    const pends = agregaPendentesClassificacao({
      eventos: [e1, e2, e3, e4, e5],
      projecao,
    });
    // 3 buckets: (u1, W20, saida)=3 evts, (u1, W20, entrada)=1, (u1, W21, saida)=1.
    expect(pends).toHaveLength(3);

    const w20Saida = pends.find(
      (p) => p.semana_iso === '2026-W20' && p.direcao === 'saida',
    )!;
    expect(w20Saida.quantidade_eventos).toBe(3);
    expect(w20Saida.valor_total).toBe(600);
    expect(w20Saida.acoes_sugeridas).toEqual(['reclassificar_eventos_pendentes']);

    const w20Entrada = pends.find(
      (p) => p.semana_iso === '2026-W20' && p.direcao === 'entrada',
    )!;
    expect(w20Entrada.quantidade_eventos).toBe(1);
    expect(w20Entrada.valor_total).toBe(1000);

    const w21Saida = pends.find(
      (p) => p.semana_iso === '2026-W21' && p.direcao === 'saida',
    )!;
    expect(w21Saida.quantidade_eventos).toBe(1);
    expect(w21Saida.valor_total).toBe(50);
  });

  it('evento com criticidade=pendente (mesmo se bucket != pendente_classificacao) entra na agregação', () => {
    // Critério: bucket_id pendente OU criticidade pendente.
    const evCritPendente = {
      ...mkEvento({
        id: 'cp',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 500,
        data_vencimento: utcMk(2026, 5, 13),
        data_esperada: utcMk(2026, 5, 13),
      }),
      bucket_id: 'folha', // bucket resolvido
      criticidade: 'pendente' as const, // mas criticidade pendente
    };
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['cp'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = agregaPendentesClassificacao({
      eventos: [evCritPendente],
      projecao,
    });
    expect(pends).toHaveLength(1);
    expect(pends[0]!.quantidade_eventos).toBe(1);
  });

  it('evento já classificado (bucket=folha, criticidade=obrigatoria) NÃO entra', () => {
    const evClassificado = {
      ...mkEvento({
        id: 'ok',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 500,
        data_vencimento: utcMk(2026, 5, 13),
        data_esperada: utcMk(2026, 5, 13),
      }),
      bucket_id: 'folha',
      criticidade: 'obrigatoria' as const,
    };
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['ok'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = agregaPendentesClassificacao({
      eventos: [evClassificado],
      projecao,
    });
    expect(pends).toEqual([]);
  });

  it('agrega também eventos em eventos_pendentes_com_data_ids', () => {
    const evPend = mkEvento({
      id: 'pend',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'pendente',
      origem: 'manual',
      direcao: 'saida',
      valor: 100,
      data_esperada: utcMk(2026, 5, 13),
    });
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { eventos_pendentes_com_data_ids: ['pend'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = agregaPendentesClassificacao({
      eventos: [evPend],
      projecao,
    });
    expect(pends).toHaveLength(1);
    expect(pends[0]!.quantidade_eventos).toBe(1);
  });

  it('IDs determinísticos por (LE, semana, direcao)', () => {
    const ev = mkEvento({
      id: 'e',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 5, 13),
      data_esperada: utcMk(2026, 5, 13),
    });
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['e'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = agregaPendentesClassificacao({
      eventos: [ev],
      projecao,
    });
    expect(pends[0]!.id).toBe(
      'pend_pendentes_classificacao_u1_2026-W20_saida',
    );
  });
});
