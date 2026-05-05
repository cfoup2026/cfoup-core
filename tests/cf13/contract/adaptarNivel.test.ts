import { describe, expect, it } from 'vitest';
import { adaptarNivel } from '../../../src/cf13/contract/index.js';
import type {
  EventoCaixa,
  ProjecaoUnidade,
  SemanaProjecao as SemanaProjecaoInterna,
} from '../../../src/index.js';
import { mkUnidadeConf, mkSemana } from '../../confianca/fixtures.js';

/* Helper: substitui caixa_final/caixa_minimo_op em semanas escolhidas. */
function comSaldos(
  unidade: ProjecaoUnidade,
  overrides: ReadonlyMap<
    number,
    { caixa_final?: number; caixa_minimo_op?: number }
  >,
): ProjecaoUnidade {
  const semanas = unidade.semanas.map((s, idx): SemanaProjecaoInterna => {
    const ov = overrides.get(idx);
    if (ov === undefined) return s;
    return {
      ...s,
      caixa_final: ov.caixa_final ?? s.caixa_final,
      caixa_minimo_op: ov.caixa_minimo_op ?? s.caixa_minimo_op,
    };
  });
  return { ...unidade, semanas };
}

const EMPTY_INDEX = new Map<string, EventoCaixa>();

describe('adaptarNivel — invariante 13 semanas', () => {
  it('semanas.length < 13 → throws', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    /* Reduzir para 12 semanas. */
    const truncado: ProjecaoUnidade = { ...u, semanas: u.semanas.slice(0, 12) };
    expect(() =>
      adaptarNivel({
        fonte: truncado,
        escopo: { tipo: 'unidade', legalEntityId: 'u1' },
        eventoIndex: EMPTY_INDEX,
      }),
    ).toThrow(/13 semanas/);
  });

  it('semanas.length > 13 → throws', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const sobra = mkSemana({ semana_iso: '2026-W31' });
    const aumentado: ProjecaoUnidade = {
      ...u,
      semanas: [...u.semanas, sobra],
    };
    expect(() =>
      adaptarNivel({
        fonte: aumentado,
        escopo: { tipo: 'unidade', legalEntityId: 'u1' },
        eventoIndex: EMPTY_INDEX,
      }),
    ).toThrow(/13 semanas/);
  });
});

describe('adaptarNivel — minimoOpReferencia', () => {
  it('= semanas[0].caixaMinimoOp', () => {
    const u = comSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([
        [0, { caixa_minimo_op: 1234 }],
        [5, { caixa_minimo_op: 9999 }], // não influencia
      ]),
    );
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.minimoOpReferencia).toBe(1234);
    expect(r.semanas[0]!.caixaMinimoOp).toBe(1234);
  });
});

describe('adaptarNivel — menorCaixaProjetado', () => {
  it('encontra menor caixa_final', () => {
    const u = comSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([
        [3, { caixa_final: 500 }],
        [5, { caixa_final: -2000 }],
        [10, { caixa_final: 800 }],
      ]),
    );
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.menorCaixaProjetado.valor).toBe(-2000);
    /* W23 = índice 5 (W18 + 5). */
    expect(r.menorCaixaProjetado.semanaInicio).toBe(r.semanas[5]!.inicio);
  });

  it('empate → primeira ocorrência (menor índice)', () => {
    /* Caixa = 0 em três semanas (mesmo valor). Empate. Espera-se a
     *  primeira (idx 0). */
    const u = comSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      /* Semanas mkUnidadeConf default já têm caixa_final=0 em todas;
       *  empate é o caso default. */
      new Map(),
    );
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.menorCaixaProjetado.valor).toBe(0);
    expect(r.menorCaixaProjetado.semanaInicio).toBe(r.semanas[0]!.inicio);
  });
});

describe('adaptarNivel — menorGapMinimo', () => {
  it('encontra menor gap (caixa_final - caixa_minimo_op)', () => {
    const u = comSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([
        [2, { caixa_final: 1000, caixa_minimo_op: 200 }], // gap +800
        [4, { caixa_final: 100, caixa_minimo_op: 5000 }], // gap -4900 ←
        [9, { caixa_final: 5000, caixa_minimo_op: 1000 }], // gap +4000
      ]),
    );
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.menorGapMinimo.valor).toBe(-4900);
    expect(r.menorGapMinimo.semanaInicio).toBe(r.semanas[4]!.inicio);
  });

  it('empate → primeira ocorrência', () => {
    /* Em mkUnidadeConf default todas semanas têm caixa_final=0,
     *  caixa_minimo_op=0 → gap=0 em todas. Empate; espera-se idx 0. */
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.menorGapMinimo.valor).toBe(0);
    expect(r.menorGapMinimo.semanaInicio).toBe(r.semanas[0]!.inicio);
  });
});

describe('adaptarNivel — escopo', () => {
  it('estampa escopo recebido sem mudar', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u_alpha' });
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u_alpha' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.escopo).toEqual({ tipo: 'unidade', legalEntityId: 'u_alpha' });
  });

  it('escopo consolidado também aceito', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const r = adaptarNivel({
      fonte: u,
      escopo: { tipo: 'consolidado', clienteId: 'c1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(r.escopo).toEqual({ tipo: 'consolidado', clienteId: 'c1' });
  });
});

describe('adaptarNivel — não muta input', () => {
  it('input snapshot preservado byte a byte', () => {
    const u = comSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([[2, { caixa_final: 1234 }]]),
    );
    /* JSON snapshot — Date e Map são serializados conforme. */
    const replacer = (_k: string, v: unknown): unknown => {
      if (v instanceof Map) return [...v.entries()];
      return v;
    };
    const snap = JSON.stringify(u, replacer);
    adaptarNivel({
      fonte: u,
      escopo: { tipo: 'unidade', legalEntityId: 'u1' },
      eventoIndex: EMPTY_INDEX,
    });
    expect(JSON.stringify(u, replacer)).toBe(snap);
  });
});
