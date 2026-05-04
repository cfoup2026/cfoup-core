/**
 * Fixtures helper para testes do Estágio 7 — Motor de Veredito.
 *
 * Reutiliza `mkProjecaoConf`/`mkUnidadeConf` do Stage 6 (em
 * `tests/confianca/fixtures.ts`) para construir a projeção, e adiciona
 * helpers para sobrescrever `caixa_final`/`caixa_minimo_op` por semana
 * — campos que o Stage 7 lê para aplicar gatilhos.
 */
import type {
  CoberturaResult,
  ConfiancaResult,
  ConfiancaSemana,
  ConfiancaUnidade,
  PendenciaCritica,
  ProjecaoCliente,
  ProjecaoConsolidada,
  ProjecaoUnidade,
  SemanaProjecao,
} from '../../src/index.js';
import {
  mkProjecaoConf,
  mkUnidadeConf,
  mkCobertura,
  GERADO_EM,
} from '../confianca/fixtures.js';

export { GERADO_EM, mkCobertura };

/** Sobrescreve `caixa_final` e/ou `caixa_minimo_op` em semanas
 *  específicas de uma `ProjecaoUnidade`. Imutável — retorna nova. */
export function comSaldosNaSemana(
  unidade: ProjecaoUnidade | ProjecaoConsolidada,
  overrides: ReadonlyMap<
    number,
    { caixa_final?: number; caixa_minimo_op?: number }
  >,
): ProjecaoUnidade | ProjecaoConsolidada {
  const semanas = unidade.semanas.map((sem, idx) => {
    const ov = overrides.get(idx);
    if (ov === undefined) return sem;
    const nova: SemanaProjecao = {
      ...sem,
      caixa_final: ov.caixa_final ?? sem.caixa_final,
      caixa_minimo_op: ov.caixa_minimo_op ?? sem.caixa_minimo_op,
    };
    return nova;
  });
  return { ...unidade, semanas } as ProjecaoUnidade | ProjecaoConsolidada;
}

/** Variante que aceita `ProjecaoUnidade` strictamente (preserva tipo). */
export function unidadeComSaldos(
  unidade: ProjecaoUnidade,
  overrides: ReadonlyMap<
    number,
    { caixa_final?: number; caixa_minimo_op?: number }
  >,
): ProjecaoUnidade {
  return comSaldosNaSemana(unidade, overrides) as ProjecaoUnidade;
}

/** Constrói `ConfiancaUnidade` minimalista para testes do Stage 7 —
 *  só os campos que `aplicarGatilhos` e o resto do orquestrador
 *  consomem. */
export interface MkConfiancaUnidadeArgs {
  legal_entity_id: string;
  confianca_projecao: ConfiancaUnidade['confianca_projecao'];
  pendencias_criticas?: readonly PendenciaCritica[];
}

export function mkConfiancaUnidade(
  args: MkConfiancaUnidadeArgs,
): ConfiancaUnidade {
  // 13 semanas placeholder com valores neutros — aplicarGatilhos NÃO
  // usa `confianca.semanas`, só `confianca_projecao` e `pendencias_criticas`.
  const semanas: ConfiancaSemana[] = Array.from({ length: 13 }, (_, idx) => ({
    semana: idx + 1,
    data_inicio: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    data_fim: new Date(Date.UTC(2026, 0, 7)).toISOString(),
    peso_total: 0,
    peso_alta: 0,
    peso_baixa: 0,
    pct_alta: null,
    pct_baixa: null,
    confianca: args.confianca_projecao,
    pendencias_criticas_ids: [],
  }));

  return {
    legal_entity_id: args.legal_entity_id,
    semanas,
    confianca_projecao: args.confianca_projecao,
    pendencias_criticas: [...(args.pendencias_criticas ?? [])],
  };
}

export interface MkConfiancaResultArgs {
  por_unidade: readonly ConfiancaUnidade[];
  consolidado: ConfiancaUnidade;
}

export function mkConfianca(args: MkConfiancaResultArgs): ConfiancaResult {
  return {
    por_unidade: [...args.por_unidade],
    consolidado: args.consolidado,
    cobertura_aplicada: args.por_unidade.map((u) => ({
      legal_entity_id: u.legal_entity_id,
      status: 'cobertura_completa' as const,
    })),
  };
}

export { mkProjecaoConf, mkUnidadeConf };
export type { ProjecaoCliente, ConfiancaResult, CoberturaResult };
