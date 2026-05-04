import { describe, expect, it } from 'vitest';
import { calcularBanner, type VereditoUnidade } from '../../src/index.js';

function v(legal_entity_id: string, veredito: VereditoUnidade['veredito']): VereditoUnidade {
  return { legal_entity_id, veredito, texto: 'x', detalhes: {} };
}

describe('banner — consolidado LIMPO/ATENCAO + unidades em risco', () => {
  it('consolidado LIMPO + 1 unidade ALERTA → banner ativo, "1 unidade em risco"', () => {
    const b = calcularBanner(
      [v('u1', 'ALERTA'), v('u2', 'LIMPO')],
      v('consolidado:c1', 'LIMPO'),
    );
    expect(b).not.toBeNull();
    expect(b!.ativo).toBe(true);
    expect(b!.unidades_em_risco).toEqual(['u1']);
    expect(b!.texto).toBe('1 unidade em risco');
  });

  it('consolidado ATENCAO + 2 unidades CRITICO → "2 unidades em risco"', () => {
    const b = calcularBanner(
      [v('u_b', 'CRITICO'), v('u_a', 'CRITICO'), v('u_c', 'LIMPO')],
      v('consolidado:c1', 'ATENCAO'),
    );
    expect(b).not.toBeNull();
    expect(b!.ativo).toBe(true);
    /* Ordem lex. */
    expect(b!.unidades_em_risco).toEqual(['u_a', 'u_b']);
    expect(b!.texto).toBe('2 unidades em risco');
  });

  it('consolidado LIMPO + nenhuma unidade em risco → null', () => {
    const b = calcularBanner(
      [v('u1', 'LIMPO'), v('u2', 'ATENCAO')],
      v('consolidado:c1', 'LIMPO'),
    );
    expect(b).toBeNull();
  });
});

describe('banner — consolidado em risco', () => {
  it('consolidado CRITICO + qualquer unidade → null (banner não aplica)', () => {
    const b = calcularBanner(
      [v('u1', 'ALERTA'), v('u2', 'LIMPO')],
      v('consolidado:c1', 'CRITICO'),
    );
    expect(b).toBeNull();
  });

  it('consolidado ALERTA + 1 unidade CRITICO → null', () => {
    const b = calcularBanner(
      [v('u1', 'CRITICO')],
      v('consolidado:c1', 'ALERTA'),
    );
    expect(b).toBeNull();
  });
});

describe('banner — DADOS_INSUFICIENTES', () => {
  it('consolidado DADOS_INSUFICIENTES → banner null', () => {
    const b = calcularBanner(
      [v('u1', 'ALERTA')],
      v('consolidado:c1', 'DADOS_INSUFICIENTES'),
    );
    expect(b).toBeNull();
  });

  it('unidade DADOS_INSUFICIENTES NÃO conta como em risco', () => {
    const b = calcularBanner(
      [
        v('u1', 'ALERTA'),
        v('u2', 'DADOS_INSUFICIENTES'),
      ],
      v('consolidado:c1', 'LIMPO'),
    );
    expect(b).not.toBeNull();
    expect(b!.unidades_em_risco).toEqual(['u1']);
    expect(b!.texto).toBe('1 unidade em risco');
  });
});

describe('banner — degenerados', () => {
  it('lista de unidades vazia → null', () => {
    const b = calcularBanner([], v('consolidado:c1', 'LIMPO'));
    expect(b).toBeNull();
  });
});
