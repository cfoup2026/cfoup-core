import { describe, expect, it } from 'vitest';
import { detectaSemanaZerada } from '../../src/index.js';
import { mkProjecao, mkUnidade } from './fixtures/index.js';

describe('detectaSemanaZerada', () => {
  it('semana 1 (idx 0) zerada → NÃO dispara (período curto antes do início)', () => {
    // Setup: idx 0 vazia; idx 1..12 com 1 evento → só idx 0 zerada → 0 pendências.
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 0 ? {} : { evento_ids: [`e-${i}`] },
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    expect(detectaSemanaZerada(projecao)).toEqual([]);
  });

  it('semana ≠ 1 zerada → dispara pendência por (legal_entity_id, semana_iso)', () => {
    // mkUnidade já cria 13 semanas vazias por default. semana 1 (idx 0)
    // não dispara; idx 1..12 disparam.
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const pends = detectaSemanaZerada(projecao);
    expect(pends).toHaveLength(12); // semanas 2..13 zeradas
    for (const p of pends) {
      expect(p.tipo).toBe('semana_zerada');
      expect(p.legal_entity_id).toBe('u1');
      expect(p.acoes_sugeridas).toEqual([
        'confirmar_que_era_esperado',
        'adicionar_evento_manual',
      ]);
    }
    // Primeira pendência é W19 (idx 1), última é W30 (idx 12).
    expect(pends[0]!.semana_iso).toBe('2026-W19');
    expect(pends[pends.length - 1]!.semana_iso).toBe('2026-W30');
  });

  it('semana com ao menos 1 evento_id → não dispara', () => {
    // Idx 5 com evento_id; idx 0 (sempre skip); demais zeradas.
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 5 ? { evento_ids: ['e1'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = detectaSemanaZerada(projecao);
    // 11 semanas zeradas (idx 1..12 menos 5).
    expect(pends).toHaveLength(11);
    expect(pends.find((p) => p.semana_iso === '2026-W23')).toBeUndefined();
  });

  it('semana com pendentes_com_data conta como não-zerada', () => {
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 3 ? { eventos_pendentes_com_data_ids: ['p1'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const pends = detectaSemanaZerada(projecao);
    expect(pends.find((p) => p.semana_iso === '2026-W21')).toBeUndefined();
  });

  it('IDs determinísticos: mesmo (legal_entity_id, semana_iso) → mesmo id', () => {
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const pends = detectaSemanaZerada(projecao);
    const id = pends[0]!.id;
    expect(id).toBe('pend_semana_zerada_u1_2026-W19');
  });
});
