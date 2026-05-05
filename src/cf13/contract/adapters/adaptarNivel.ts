/**
 * Adapter: `ProjecaoUnidade` ou `ProjecaoConsolidada` (interno) →
 * `ProjecaoNivel` do contrato.
 *
 * Invariante: `semanas.length === 13`. Lança erro se diferente — Stage 4
 * sempre produz 13 semanas, então isso só dispara em uso indevido.
 *
 * Determinismo:
 *  - `menorCaixaProjetado` / `menorGapMinimo`: em empate, **primeira
 *    ocorrência** (menor índice) — leitura previsível.
 *  - `minimoOpReferencia` = `semanas[0].caixaMinimoOp` — Item 1 §3.2.
 */
import type {
  ProjecaoConsolidada,
  ProjecaoUnidade,
} from '../../../types/projecao.js';
import type { EventoCaixa } from '../../../types/EventoCaixa.js';
import { adaptarSemana } from './adaptarSemana.js';
import type { EscopoNivel, ProjecaoNivel, SemanaProjecao } from '../types.js';

const SEMANAS_ESPERADAS = 13;

export interface AdaptarNivelArgs {
  /** Unidade ou consolidado — adapter não distingue além do escopo. */
  fonte: ProjecaoUnidade | ProjecaoConsolidada;
  /** Escopo a estampar no nível adaptado. */
  escopo: EscopoNivel;
  eventoIndex: ReadonlyMap<string, EventoCaixa>;
}

export function adaptarNivel(args: AdaptarNivelArgs): ProjecaoNivel {
  const { fonte, escopo, eventoIndex } = args;

  if (fonte.semanas.length !== SEMANAS_ESPERADAS) {
    throw new Error(
      `adaptarNivel: invariante violada — esperado ${SEMANAS_ESPERADAS} semanas, recebido ${fonte.semanas.length}`,
    );
  }

  const semanas: SemanaProjecao[] = fonte.semanas.map((s, idx) =>
    adaptarSemana({ semana: s, indice: idx + 1, eventoIndex }),
  );

  /* Mínimos — primeira ocorrência (índice menor) em empate. */
  const menorCaixa = encontrarMin(
    semanas,
    (s) => s.caixaFinalSemana,
  );
  const menorGap = encontrarMin(
    semanas,
    (s) => s.gapMinimoOperacional,
  );

  return {
    escopo,
    /* `caixaInicial` do nível = `caixaInicialSemana` da semana 1.
     *  No core, `ProjecaoUnidade.caixaInicial.valor` e
     *  `ProjecaoConsolidada.caixaInicial.valor` carregam o mesmo número,
     *  mas com flags adicionais (stale/ausente). Aqui o contrato pede
     *  só o valor — `semanas[0].caixaInicialSemana` já equivale. */
    caixaInicial: semanas[0]!.caixaInicialSemana,
    semanas,
    menorCaixaProjetado: {
      semanaInicio: menorCaixa.semana.inicio,
      valor: menorCaixa.valor,
    },
    menorGapMinimo: {
      semanaInicio: menorGap.semana.inicio,
      valor: menorGap.valor,
    },
    minimoOpReferencia: semanas[0]!.caixaMinimoOp,
  };
}

/* ─────────── Helpers internos ─────────── */

interface MinResult {
  semana: SemanaProjecao;
  valor: number;
}

function encontrarMin(
  semanas: readonly SemanaProjecao[],
  pick: (s: SemanaProjecao) => number,
): MinResult {
  let melhor: SemanaProjecao = semanas[0]!;
  let valorMelhor = pick(melhor);
  for (let i = 1; i < semanas.length; i++) {
    const s = semanas[i]!;
    const v = pick(s);
    if (v < valorMelhor) {
      melhor = s;
      valorMelhor = v;
    }
  }
  return { semana: melhor, valor: valorMelhor };
}
