import { describe, expect, it } from 'vitest';
import { detectarErrosMarcacao, type VereditoUnidade } from '../../src/index.js';

function v(legal_entity_id: string, veredito: VereditoUnidade['veredito']): VereditoUnidade {
  return { legal_entity_id, veredito, texto: 'x', detalhes: {} };
}

describe('erros-marcacao — caso inverso (consolidado pior que unidades)', () => {
  it('consolidado CRITICO + todas unidades LIMPAS → emite erro', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'LIMPO'), v('u2', 'LIMPO')],
      consolidado: v('consolidado:c1', 'CRITICO'),
      cliente_id: 'c1',
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.tipo).toBe('consolidado_pior_que_unidades');
    expect(r[0]!.cliente_id).toBe('c1');
    expect(r[0]!.legal_entity_ids).toEqual(['u1', 'u2']);
  });

  it('consolidado ALERTA + todas LIMPAS → emite erro', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u_z', 'LIMPO'), v('u_a', 'LIMPO')],
      consolidado: v('consolidado:c1', 'ALERTA'),
      cliente_id: 'c1',
    });
    expect(r).toHaveLength(1);
    /* Ordem lex. */
    expect(r[0]!.legal_entity_ids).toEqual(['u_a', 'u_z']);
  });

  it('consolidado CRITICO + unidades em ATENCAO contam como OK → emite erro', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'ATENCAO'), v('u2', 'LIMPO')],
      consolidado: v('consolidado:c1', 'CRITICO'),
      cliente_id: 'c1',
    });
    expect(r).toHaveLength(1);
  });
});

describe('erros-marcacao — casos sem erro', () => {
  it('consolidado LIMPO → nada', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'LIMPO')],
      consolidado: v('consolidado:c1', 'LIMPO'),
      cliente_id: 'c1',
    });
    expect(r).toEqual([]);
  });

  it('consolidado CRITICO + 1 unidade CRITICO → não é "consolidado pior", nada', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'CRITICO'), v('u2', 'LIMPO')],
      consolidado: v('consolidado:c1', 'CRITICO'),
      cliente_id: 'c1',
    });
    expect(r).toEqual([]);
  });

  it('consolidado CRITICO + 1 unidade DADOS_INSUFICIENTES → não emite (insuficiente quebra a comparação)', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'LIMPO'), v('u2', 'DADOS_INSUFICIENTES')],
      consolidado: v('consolidado:c1', 'CRITICO'),
      cliente_id: 'c1',
    });
    expect(r).toEqual([]);
  });

  it('consolidado DADOS_INSUFICIENTES → nada', () => {
    const r = detectarErrosMarcacao({
      unidades: [v('u1', 'LIMPO')],
      consolidado: v('consolidado:c1', 'DADOS_INSUFICIENTES'),
      cliente_id: 'c1',
    });
    expect(r).toEqual([]);
  });

  it('lista de unidades vazia → nada', () => {
    const r = detectarErrosMarcacao({
      unidades: [],
      consolidado: v('consolidado:c1', 'CRITICO'),
      cliente_id: 'c1',
    });
    expect(r).toEqual([]);
  });
});
