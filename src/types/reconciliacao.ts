/**
 * Tipos do Estágio 3.1 — Reconciliação banco ↔ CP/CR.
 *
 * Princípios:
 *  - Imutabilidade: o motor produz NOVOS `EventoCaixa` quando promove
 *    confirmado→realizado; nunca muta o input.
 *  - Auditoria preservada: eventos absorvidos não somem, vão pra
 *    `eventosBancariosAbsorvidos[]`.
 *  - Provenance explícito em cada pendência (`tipo` enumerado, sem string livre).
 *  - Determinístico: mesma entrada + `reconciliadoEm` injetado → mesma saída.
 */
import type { EventoCaixa } from './EventoCaixa.js';

/**
 * Tipos enumerados de pendência de reconciliação. Mantido como
 * union-de-literal para cobertura exaustiva em consumidores.
 *
 * **Passada 1 — `confirmado` ↔ CEF (Estágio 3.1):**
 *  - `'ambiguidade_realizado_para_confirmado'`: 1 CEF com 2+ confirmados
 *    elegíveis. Nenhum match aplicado, eventos preservados.
 *  - `'duplicidade_confirmado'`: 1 confirmado já matched recebeu 2º CEF.
 *    1º match mantido; 2º CEF vira pendência (provável tarifa/IOF/avulso).
 *
 * **Passada 2 — `realizado_titulo` ↔ CEF restante (Estágio 3.1.1):**
 *  - `'ambiguidade_realizado_titulo_para_cef'`: 1 título FKN-realizado
 *    com 2+ CEFs elegíveis. Nenhum match aplicado.
 *  - `'duplicidade_cef_titulo'`: 1 CEF já consumido pela passada 2 e
 *    outro título tenta apontar pra ele. 1º match mantido; 2º título
 *    sem absorção, pendência registra o conflito.
 *
 * **Transferência interna (Estágio 3.2):**
 *  - `'transferencia_ambigua'`: 1 evento candidato a perna A casaria com
 *    2+ pernas B opostas. Política 1:1 estrita: nenhuma marcação aplicada,
 *    pendência registra os IDs. Sem decisão automática.
 */
export type TipoPendenciaReconciliacao =
  | 'ambiguidade_realizado_para_confirmado'
  | 'duplicidade_confirmado'
  | 'ambiguidade_realizado_titulo_para_cef'
  | 'duplicidade_cef_titulo'
  | 'transferencia_ambigua';

/**
 * Pendência detectada durante reconciliação. Carrega referências aos
 * eventos envolvidos para drill-down — nenhum dado é perdido.
 */
export interface PendenciaReconciliacao {
  /** ID determinístico baseado em `(tipo, ids_relacionados_ordenados)`. */
  id: string;
  tipo: TipoPendenciaReconciliacao;
  /** Descrição curta determinística em PT-BR. NÃO é storytelling — é
   *  um rótulo estável que UIs podem usar diretamente. */
  descricao: string;
  /** IDs dos `EventoCaixa` envolvidos, ordenados (determinismo). */
  eventos_relacionados: string[];
  /** Quando a pendência foi detectada. */
  detectado_em: Date;
}

/**
 * Registro de auditoria: 1 realizado bancário (CEF) absorvido em um
 * `confirmado` promovido para `realizado`. O CEF original é descartado
 * de `eventos[]` (evita dupla contagem no caixa) mas permanece referenciado
 * aqui para rastreabilidade.
 */
export interface AbsorcaoBancaria {
  /** ID do EventoCaixa bancário (CEF) que foi absorvido. */
  evento_bancario_id: string;
  /** ID do EventoCaixa promovido (confirmado→realizado) que absorveu. */
  promovido_para_id: string;
  /** Timestamp UTC do match. */
  data_match: Date;
}

/** Estatísticas determinísticas do run de reconciliação. */
export interface ReconciliacaoEstatisticas {
  /** Quantidade de `confirmado` elegíveis na entrada (FKN/manual/erp/etc). */
  confirmadosOriginais: number;
  /** Quantidade de `realizado` com `origem='cef'` na entrada. */
  realizadosBancariosOriginais: number;
  /** Quantidade de `realizado` com origem de título (FKN/manual/erp/etc)
   *  candidatos da passada 2. */
  realizadosTituloOriginais: number;
  /** Matches 1:1 totais aplicados — soma das duas passadas. */
  matchesAplicados: number;
  /** Matches da passada 1 (confirmado ↔ CEF). */
  matchesAplicadosPassada1: number;
  /** Matches da passada 2 (realizado_titulo ↔ CEF restante). */
  matchesAplicadosPassada2: number;
  /** Pendências geradas (`pendencias.length`). */
  pendenciasGeradas: number;
  /** Eventos bancários sem match após as duas passadas (passam pro output
   *  como-estão — tarifa, IOF, transferência avulsa, etc). */
  eventosBancariosNaoAbsorvidos: number;
}

/**
 * Saída de `reconciliaBancoCpCr` (Estágio 3.1). `eventos` carrega o
 * conjunto reconciliado, livre de dupla contagem (banco absorvido é
 * removido). Pendências e absorções ficam em listas separadas para
 * auditoria.
 */
export interface ReconciliacaoResult {
  /** Eventos pós-reconciliação. Confirmados promovidos viram realizados;
   *  bancários absorvidos não estão aqui. */
  eventos: EventoCaixa[];
  /** Conflitos e duplicidades detectados, sem decisão automática. */
  pendencias: PendenciaReconciliacao[];
  /** Eventos CEF descartados em favor de confirmados promovidos (auditoria). */
  eventosBancariosAbsorvidos: AbsorcaoBancaria[];
  /** Quando o run foi executado (injetado em testes). */
  reconciliadoEm: Date;
  estatisticas: ReconciliacaoEstatisticas;
}

/**
 * Erro do estágio de reconciliação. Lançado em input inválido (ex:
 * `realizado` sem `data_realizada`), seguindo princípio do nucleus de
 * falhar visível.
 */
export class ReconciliacaoError extends Error {
  override readonly name = 'ReconciliacaoError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ReconciliacaoError.prototype);
  }
}
