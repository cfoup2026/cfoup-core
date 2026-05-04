import { describe, expect, it } from 'vitest';
import { detectaSaldoAbertura } from '../../src/index.js';
import { mkProjecao, mkUnidade } from './fixtures/index.js';

describe('detectaSaldoAbertura', () => {
  it('unidade ativa com snapshot disponível → não dispara', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { valor: 5000, ausente: false, stale: false },
        }),
      ],
    });
    expect(detectaSaldoAbertura(projecao)).toEqual([]);
  });

  it('unidade ativa SEM snapshot (ausente=true) → motivo saldo_abertura_ausente', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { valor: 0, ausente: true, stale: false },
        }),
      ],
    });
    const motivos = detectaSaldoAbertura(projecao);
    expect(motivos).toHaveLength(1);
    expect(motivos[0]!.tipo).toBe('saldo_abertura_ausente');
    expect(motivos[0]!.legal_entity_id).toBe('u1');
    expect(motivos[0]!.acoes_sugeridas).toEqual([
      'confirmar_saldo',
      'revisar_conexao',
    ]);
  });

  it('múltiplas unidades sem snapshot → ordem lex por legal_entity_id', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({ legal_entity_id: 'u3', caixaInicial: { ausente: true, valor: 0, stale: false } }),
        mkUnidade({ legal_entity_id: 'u1', caixaInicial: { ausente: true, valor: 0, stale: false } }),
        mkUnidade({ legal_entity_id: 'u2', caixaInicial: { ausente: false, valor: 100, stale: false } }),
      ],
    });
    const motivos = detectaSaldoAbertura(projecao);
    expect(motivos.map((m) => m.legal_entity_id)).toEqual(['u1', 'u3']);
  });

  it('snapshot stale (data > 7d) NÃO dispara saldo_abertura_ausente (stale ≠ ausente)', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { valor: 1000, ausente: false, stale: true },
        }),
      ],
    });
    expect(detectaSaldoAbertura(projecao)).toEqual([]);
  });
});
