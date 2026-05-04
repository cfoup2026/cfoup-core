/**
 * Tipos do Estágio 6 — Motor de Confiança.
 *
 * Implementa §9 do `CFOup_CF13_Spec_v0.md` com ajuste obrigatório §9.3
 * (pendência crítica filtra `direcao=saida` e `is_transferencia=false`;
 * entradas com `criticidade=pendente` excluídas).
 *
 * Stage 6 lê:
 *  - `ProjecaoCliente` (Stage 4) — `unidades[]` + `consolidado` com 13
 *    semanas e `evento_ids` já alocados. **Não recalcula alocação.**
 *  - `CoberturaResult` (Stage 5) — ecoa status para Stage 7 ler num só
 *    lugar. **Não muta.**
 *  - `EventoCaixa[]` — só leitura, indexa por id.
 *
 * Stage 6 produz:
 *  - `ConfiancaResult` — estrutura nova com confiança por semana, por
 *    unidade, do consolidado, e pendências críticas materializadas.
 *
 * Stage 6 **não muta** input. Stage 7 (Veredito) que decide se suprime
 * veredito por cobertura insuficiente.
 *
 * Convenções:
 *  - `Confianca` no repo é `'alta' | 'media' | 'baixa'` apenas (sem
 *    `'pendente'`). A regra "peso_baixa inclui pendente" do spec do
 *    prompt 6 não se aplica.
 *  - `legal_entity_id` do consolidado segue a convenção
 *    `'consolidado:<cliente_id>'` — `ProjecaoConsolidada` no repo só
 *    tem `legal_entity_ids: string[]` (lista das unidades agregadas).
 */
import type { Confianca, Criticidade, Status } from '../types/enums.js';
import type { CoberturaStatus } from '../types/cobertura.js';

/* ─────────── Constantes (exportadas para tests e consumidores) ─────────── */

/** Limite absoluto em BRL para materialidade da pendência crítica
 *  (§9.3). Default v0 = R$ 5.000. */
export const LIMITE_MATERIALIDADE_ABS_BRL = 5000;

/** Threshold de `pct_baixa` para rebaixar a semana (§9.2 regra 3). */
export const THRESHOLD_PCT_BAIXA = 0.25;

/** Threshold mínimo de `pct_alta` para chegar a `media` (§9.2 regra 4).
 *  Abaixo disso, a semana é `baixa` por `pct_alta_baixa`. */
export const THRESHOLD_PCT_ALTA_MIN_MEDIA = 0.5;

/** Threshold de `pct_alta` para a semana ser `alta` (§9.2 regra 5). */
export const THRESHOLD_PCT_ALTA = 0.75;

/** Multiplicador para materialidade relativa (§9.3): valor ≥ 10% das
 *  saídas da semana (no escopo) → material por relativo. */
export const PCT_MATERIALIDADE_SAIDAS_SEMANA = 0.1;

/* ─────────── Enums textuais ─────────── */

/** Motivo pelo qual a semana foi classificada `baixa`. Avaliado em
 *  ordem (primeiro que casa vence) — ver `calcularConfiancaSemana`. */
export type MotivoBaixa =
  | 'peso_total_zero'
  | 'pendencia_critica'
  | 'pct_baixa_alta'
  | 'pct_alta_baixa';

/** Motivo da pendência crítica do evento. */
export type MotivoPendenciaCritica =
  | 'status_pendente'
  | 'criticidade_obrigatoria_critica_op_pendente';

/** Qual condição de materialidade disparou (§9.3). */
export type TriggerMaterialidade =
  | 'pct_10_saidas_semana'
  | 'limite_absoluto';

/* ─────────── Estruturas de saída ─────────── */

/**
 * Confiança da semana N (1..13). `pct_alta`/`pct_baixa` são `null`
 * quando `peso_total === 0` — semana sem qualquer evento alocado.
 *
 * `data_inicio`/`data_fim` são strings ISO copiadas das `Date` da
 * `SemanaProjecao` (`inicio`/`fim`) para serializabilidade.
 */
export interface ConfiancaSemana {
  /** Número da semana (1..13), ordem da janela do Stage 4. */
  semana: number;
  /** Início da semana, ISO 8601 (segunda 00:00 UTC). */
  data_inicio: string;
  /** Fim da semana, ISO 8601 (domingo 23:59:59.999 UTC). */
  data_fim: string;
  /** Soma `|valor|` de todos os eventos alocados (qualquer status,
   *  qualquer direção, qualquer transferência neutralizada já fora
   *  do consolidado pelo Stage 4). */
  peso_total: number;
  /** Soma `|valor|` dos eventos com `confianca='alta'`. */
  peso_alta: number;
  /** Soma `|valor|` dos eventos com `confianca='baixa'`. */
  peso_baixa: number;
  /** `peso_alta / peso_total`; `null` quando `peso_total === 0`. */
  pct_alta: number | null;
  /** `peso_baixa / peso_total`; `null` quando `peso_total === 0`. */
  pct_baixa: number | null;
  /** Faixa final da semana após avaliação em ordem (§9.2). */
  confianca: Confianca;
  /** IDs dos eventos da semana que viraram pendência crítica. Ordenado lex. */
  pendencias_criticas_ids: string[];
  /** Motivo do rebaixamento. Ausente quando `confianca !== 'baixa'`. */
  motivo_baixa?: MotivoBaixa;
}

/**
 * Pendência crítica materializada (§9.3 ajustado). Sempre `direcao='saida'`
 * e `is_transferencia=false`. Recalculada por escopo (unidade ou
 * consolidado) — denominador da materialidade muda.
 */
export interface PendenciaCritica {
  evento_id: string;
  legal_entity_id: string;
  cliente_id: string;
  /** Semana 1..13 onde o evento foi alocado pelo Stage 4. */
  semana: number;
  /** Valor original do evento (`>= 0`, mantido como veio). */
  valor: number;
  /** Sempre `'saida'` — entradas excluídas pelo §9.3 ajustado. */
  direcao: 'saida';
  status: Status;
  criticidade: Criticidade;
  bucket_id: string;
  motivo: MotivoPendenciaCritica;
  trigger_materialidade: TriggerMaterialidade;
}

/**
 * Confiança agregada por unidade (ou consolidado). Lista 13 semanas em
 * ordem 1..13. `confianca_projecao` é a pior das 13 (baixa < media < alta).
 */
export interface ConfiancaUnidade {
  /** Para unidade: `legal_entity_id` real. Para consolidado:
   *  `'consolidado:<cliente_id>'` (convenção — `ProjecaoConsolidada`
   *  no repo não tem `legal_entity_id` único). */
  legal_entity_id: string;
  /** length = 13. Ordem 1..13 corresponde à janela do Stage 4. */
  semanas: ConfiancaSemana[];
  /** Pior das 13 semanas. `baixa < media < alta`. */
  confianca_projecao: Confianca;
  /** Pendências críticas concatenadas das 13 semanas, ordem
   *  `(semana, evento_id)`. */
  pendencias_criticas: PendenciaCritica[];
}

/**
 * Eco do status de cobertura por unidade ativa. Stage 6 NÃO altera
 * `CoberturaResult` — apenas mapeia para um lugar acessível ao Stage 7.
 *
 * **Derivação** (CoberturaResult no repo só tem `status` global):
 *  - `motivosInsuficiencia` para a unidade → `'cobertura_insuficiente'`.
 *  - Senão se `pendencias` para a unidade → `'cobertura_com_confianca_reduzida'`.
 *  - Senão → `'cobertura_completa'`.
 */
export interface CoberturaAplicadaItem {
  legal_entity_id: string;
  status: CoberturaStatus;
}

/** Saída pública do Estágio 6. */
export interface ConfiancaResult {
  /** Uma entrada por `legal_entity_id` ativa do cliente. */
  por_unidade: ConfiancaUnidade[];
  /** Confiança do consolidado — recalculada (denominador diferente das
   *  unidades). `legal_entity_id` na convenção `'consolidado:<cliente_id>'`. */
  consolidado: ConfiancaUnidade;
  /** Eco do status de cobertura por unidade ativa. */
  cobertura_aplicada: CoberturaAplicadaItem[];
}

/**
 * Erro do Estágio 6. Lançado quando evento referenciado por `evento_ids`
 * chega sem `confianca` resolvida. Princípio do nucleus: falhar visível.
 */
export class ConfiancaError extends Error {
  override readonly name = 'ConfiancaError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ConfiancaError.prototype);
  }
}
