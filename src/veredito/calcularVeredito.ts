/**
 * Estágio 7 — Motor de Veredito (orquestrador).
 *
 * Lê `ProjecaoCliente` (Stage 4) + `CoberturaResult` (Stage 5) +
 * `ConfiancaResult` (Stage 6), produz `VereditoResult`.
 *
 * Fluxo (§6.1, §6.2, §6.3, §8.1):
 *  1. Para cada unidade ativa: deriva status de cobertura → se
 *     insuficiente, `DADOS_INSUFICIENTES`; senão aplica gatilhos.
 *     Renderiza texto.
 *  2. Para o consolidado: status derivado via `deriveCoberturaConsolidada`
 *     → idem.
 *  3. Calcula banner a partir dos vereditos.
 *  4. Detecta erros de marcação.
 *
 * **Não muta inputs.** Determinismo absoluto: mesmo input → mesmo
 * output byte a byte.
 */
import type {
  CoberturaResult,
  ProjecaoCliente,
  ProjecaoConsolidada,
  ProjecaoUnidade,
} from '../types/index.js';
import type { ConfiancaResult, ConfiancaUnidade } from '../confianca/index.js';
import { calcularBanner } from './banner.js';
import {
  deriveCoberturaConsolidada,
  deriveStatusUnidade,
} from './cobertura-consolidada.js';
import { detectarErrosMarcacao } from './erros-marcacao.js';
import { aplicarGatilhos } from './gatilhos.js';
import { renderTexto } from './templates.js';
import type {
  Veredito,
  VereditoDetalhes,
  VereditoResult,
  VereditoUnidade,
} from './types.js';

export interface CalcularVereditoInput {
  projecao: ProjecaoCliente;
  cobertura: CoberturaResult;
  confianca: ConfiancaResult;
}

export function calcularVeredito(
  input: CalcularVereditoInput,
): VereditoResult {
  const { projecao, cobertura, confianca } = input;
  const cliente_id = projecao.cliente_id;

  /* Index de confiança por legal_entity_id para lookup O(1). */
  const confianciaPorLE = new Map<string, ConfiancaUnidade>();
  for (const u of confianca.por_unidade) {
    confianciaPorLE.set(u.legal_entity_id, u);
  }

  /* (1) Vereditos por unidade. */
  const unidades: VereditoUnidade[] = projecao.unidades.map((u) => {
    const statusCobertura = deriveStatusUnidade(cobertura, u.legal_entity_id);
    const confiancaUnidade = confianciaPorLE.get(u.legal_entity_id);
    return resolverVereditoUnidade({
      legal_entity_id: u.legal_entity_id,
      projecao: u,
      confianca: confiancaUnidade,
      coberturaInsuficiente: statusCobertura === 'cobertura_insuficiente',
    });
  });

  /* (2) Veredito do consolidado. */
  const idsAtivas = projecao.unidades.map((u) => u.legal_entity_id);
  const statusConsol = deriveCoberturaConsolidada(cobertura, idsAtivas);
  const consolidadoLE = `consolidado:${cliente_id}`;
  const consolidado: VereditoUnidade = resolverVereditoUnidade({
    legal_entity_id: consolidadoLE,
    projecao: projecao.consolidado,
    confianca: confianca.consolidado,
    coberturaInsuficiente: statusConsol === 'cobertura_insuficiente',
  });

  /* (3) Banner. */
  const banner_unidade_critica = calcularBanner(unidades, consolidado);

  /* (4) Erros de marcação. */
  const erros_de_marcacao = detectarErrosMarcacao({
    unidades,
    consolidado,
    cliente_id,
  });

  return { unidades, consolidado, banner_unidade_critica, erros_de_marcacao };
}

/* ─────────── Helper de resolução por unidade ─────────── */

interface ResolverArgs {
  legal_entity_id: string;
  projecao: ProjecaoUnidade | ProjecaoConsolidada;
  confianca: ConfiancaUnidade | undefined;
  coberturaInsuficiente: boolean;
}

function resolverVereditoUnidade(args: ResolverArgs): VereditoUnidade {
  /* §8.1: cobertura insuficiente vence tudo. */
  if (args.coberturaInsuficiente) {
    return montarVereditoUnidade(
      args.legal_entity_id,
      'DADOS_INSUFICIENTES',
      {},
    );
  }

  /* Sem confiança correspondente, nada a calcular — falha defensiva
   *  (não deveria ocorrer no fluxo normal: Stage 6 sempre produz uma
   *  entrada por unidade ativa + consolidado). */
  if (args.confianca === undefined) {
    return montarVereditoUnidade(
      args.legal_entity_id,
      'DADOS_INSUFICIENTES',
      {},
    );
  }

  /* §6.1: aplicar gatilhos em ordem. */
  const { veredito, detalhes } = aplicarGatilhos({
    projecao: args.projecao,
    confianca: args.confianca,
  });
  return montarVereditoUnidade(args.legal_entity_id, veredito, detalhes);
}

function montarVereditoUnidade(
  legal_entity_id: string,
  veredito: Veredito,
  detalhes: VereditoDetalhes,
): VereditoUnidade {
  return {
    legal_entity_id,
    veredito,
    texto: renderTexto(veredito, detalhes),
    detalhes,
  };
}
