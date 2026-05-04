/**
 * Tipos do Estágio 4.1 — Projeção semanal por unidade.
 *
 * Princípios:
 *  - Imutabilidade: `EventoCaixa` jamais é mutado. `allocationDate`
 *    (resultado do hook + calendário) vive no mapa
 *    `allocationDatesByEventoId` da projeção, não no evento.
 *  - Determinístico: mesma entrada + `geradoEm` injetado → mesma saída.
 *  - Provenance: `caixaInicial.origem_snapshot_id` aponta para o
 *    `OpeningBalanceSnapshot` consumido; `evento_ids` por semana
 *    permite drill-down completo.
 *  - Pendentes ficam fora dos totais: `status='pendente'` indica dado
 *    incompleto (§3.1 do spec); somar no caixa seria mentir confiança.
 *    Ficam listados em `eventos_pendentes_com_data_ids` para Stage 5/6.
 */
import type { EventoCaixa } from './EventoCaixa.js';

/**
 * Caixa de abertura da semana 1, derivado do `OpeningBalanceSnapshot`
 * mais recente disponível. Flags são informativas — Stage 5 (Cobertura)
 * decide o que fazer com `stale`/`ausente`.
 */
export interface CaixaInicial {
  /** Saldo a usar como `caixa_inicial` da semana 1. 0 quando ausente. */
  valor: number;
  /** Data de referência do snapshot consumido. Ausente quando `ausente=true`. */
  data_referencia?: Date;
  /** ID do snapshot consumido (drill-down). Ausente quando `ausente=true`. */
  origem_snapshot_id?: string;
  /** True quando `(geradoEm − data_referencia) > 7 dias`. Stage 5 trata. */
  stale: boolean;
  /** True quando nenhum snapshot elegível disponível. `valor=0`. Stage 5 trata. */
  ausente: boolean;
}

/**
 * Origem da margem de segurança aplicada ao caixa mínimo operacional.
 *
 *  - `'volatilidade_alta'`: usou `min(VolatilidadeStats.cv, 0.25)` da
 *    unidade (qualidade alta, n_periodos ≥ 12).
 *  - `'fallback_10pct'`: usou 10% — qualidade insuficiente ou ausente.
 *  - `'agregado_por_unidade'`: somente no consolidado — não há margem
 *    única (cada unidade tem a sua); ver `por_unidade` para drill-down.
 */
export type MargemOrigem =
  | 'volatilidade_alta'
  | 'fallback_10pct'
  | 'agregado_por_unidade';

/**
 * Provenance do `caixa_minimo_op` de uma `SemanaProjecao`. Forma única
 * para unidade e consolidado: a unidade preenche `margem_origem` com
 * `'volatilidade_alta'` ou `'fallback_10pct'`; o consolidado usa
 * `'agregado_por_unidade'` e popula `por_unidade` com o detalhe por LE.
 *
 * Modelo unificado (vs duas interfaces) para que `SemanaProjecao` continue
 * sendo um único tipo aceito tanto por `ProjecaoUnidade.semanas` quanto
 * por `ProjecaoConsolidada.semanas` — consumidores não precisam discriminar.
 */
export interface CaixaMinimoOpProvenance {
  /** Para unidade: margem real (CV ou fallback). Para consolidado:
   *  margem efetiva agregada (`(minimo - base) / base`); `0` quando
   *  `base_pre_margem === 0`. */
  margem_aplicada: number;
  margem_origem: MargemOrigem;
  /** CV usado quando `margem_origem === 'volatilidade_alta'`. Ausente em
   *  fallback ou agregado. */
  volatilidade_cv?: number;
  /** Soma dos eventos elegíveis sem margem (unidade ou total no consolidado). */
  base_pre_margem: number;
  /** IDs dos eventos elegíveis. Unidade: lista própria. Consolidado:
   *  união ordenada lex. */
  eventos_considerados_ids: string[];
  /** Apenas no consolidado: detalhamento por unidade da semana. */
  por_unidade?: Map<string, CaixaMinimoOpProvenancePorUnidade>;
}

/** Detalhamento por unidade dentro do `por_unidade` do consolidado. */
export interface CaixaMinimoOpProvenancePorUnidade {
  margem_aplicada: number;
  margem_origem: 'volatilidade_alta' | 'fallback_10pct';
  volatilidade_cv?: number;
  base_pre_margem: number;
}

/**
 * Uma semana da grade de 13. Bucketização por `status × direcao`.
 *
 * **Pendentes excluídos dos totais.** `entradas_*`/`saidas_*`/`total_*`/
 * `variacao_liquida`/`caixa_final` somam apenas `realizado` + `confirmado`
 * + `estimado`. Pendentes com `data_esperada` aparecem em
 * `eventos_pendentes_com_data_ids` para drill-down.
 */
export interface SemanaProjecao {
  /** Identificador ISO da semana, formato `YYYY-Www`. */
  semana_iso: string;
  /** Segunda 00:00:00.000 UTC. */
  inicio: Date;
  /** Domingo 23:59:59.999 UTC. */
  fim: Date;
  /** Semana 1: `CaixaInicial.valor`. Semanas seguintes: `caixa_final[n-1]`. */
  caixa_inicial: number;
  entradas_realizadas: number;
  entradas_confirmadas: number;
  entradas_estimadas: number;
  saidas_realizadas: number;
  saidas_confirmadas: number;
  saidas_estimadas: number;
  /** Soma de `entradas_*`. Pendentes NÃO entram. */
  total_entradas: number;
  /** Soma de `saidas_*`. Pendentes NÃO entram. */
  total_saidas: number;
  /** `total_entradas − total_saidas`. */
  variacao_liquida: number;
  /** `caixa_inicial + variacao_liquida`. */
  caixa_final: number;
  /** IDs dos eventos contabilizados nos totais (drill-down). Ordenados (det). */
  evento_ids: string[];
  /** IDs de `pendente` com `data_esperada` alocados na semana, FORA dos totais. */
  eventos_pendentes_com_data_ids: string[];
  /**
   * Caixa mínimo operacional desta semana (Estágio 4.3 §5 do spec).
   * Calculado como `base_pre_margem × (1 + margem_aplicada)`, onde a base
   * soma eventos `confirmado/estimado` × `saida` × `criticidade IN
   * (obrigatoria, critica_op)` × `is_transferencia=false`, alocados nas
   * semanas `n+1` e `n+2`. Margem com teto 25% e fallback 10%.
   *
   * **Default `0`** quando produzido por `projetaUnidade` direto (sem
   * passar por `calculaCaixaMinimoOp`). O orquestrador `projetaCliente`
   * sempre calcula e popula. Stage 4 não compara com `caixa_final` —
   * leitura/veredito é Stage 5/7.
   */
  caixa_minimo_op: number;
  /** Provenance do cálculo. Default conservador (`fallback_10pct`,
   *  `base_pre_margem=0`) quando ainda não calculado. */
  caixa_minimo_op_provenance: CaixaMinimoOpProvenance;
}

/** Estatísticas da projeção. Devem fechar: `naGrade + atrasados + foraDaJanela + naoAlocados = total`. */
export interface ProjecaoUnidadeEstatisticas {
  /** Eventos da unidade (input após filtragem por cliente_id+legal_entity_id). */
  eventosTotal: number;
  /** Eventos somados nos buckets das 13 semanas (pendentes com data inclusos). */
  eventosNaGrade: number;
  /** Eventos com `allocationDate` < início da semana 1. */
  eventosAtrasadosCount: number;
  /** Eventos com `allocationDate` > fim da semana 13. */
  eventosForaDaJanelaCount: number;
  /** Eventos sem data alguma para alocação (sem `data_vencimento` E sem `data_esperada`). */
  eventosNaoAlocadosCount: number;
  /** Confirmados onde a contraparte tinha hook ativo (padrão estável + mediana ≠ 0). */
  confirmadosComHookAplicado: number;
}

/**
 * Saída de `projetaUnidade`. Visão por unidade isolada — sem
 * consolidação (4.2) e sem caixa mínimo (4.3). Transferências internas
 * aparecem normalmente: §11.4 do spec exige que a visão por unidade
 * veja transferência; só consolidado neutraliza.
 */
export interface ProjecaoUnidade {
  cliente_id: string;
  legal_entity_id: string;
  geradoEm: Date;
  /** 13 strings `YYYY-Www`, da semana de `geradoEm` em diante. */
  janela: string[];
  caixaInicial: CaixaInicial;
  /** length = `janela.length` (= 13). Ordem corresponde à janela. */
  semanas: SemanaProjecao[];
  /**
   * Mapa `eventoId → allocationDate`. Cobre 100% dos eventos com data
   * calculável (na grade + atrasados + fora da janela). Drill-down
   * completo: dado um id, sabemos exatamente onde ele caiu (ou caiu
   * fora da janela). Apenas `eventosNaoAlocados` ficam ausentes do mapa.
   */
  allocationDatesByEventoId: Map<string, Date>;
  /** IDs de eventos com `allocationDate` < início da semana 1. */
  eventosAtrasados: string[];
  /** IDs de eventos com `allocationDate` > fim da semana 13. */
  eventosForaDaJanela: string[];
  /** IDs de eventos sem data calculável. Cobertura (Stage 5) trata. */
  eventosNaoAlocados: string[];
  estatisticas: ProjecaoUnidadeEstatisticas;
}

/**
 * Input de `projetaUnidade`. `eventos` é tipicamente o output do
 * `MotorReconciliacao.run()` (Stage 3), mas a função não conhece esse
 * detalhe — aceita qualquer `EventoCaixa[]`.
 */
export interface ProjetaUnidadeInput {
  eventos: readonly EventoCaixa[];
  saldos: readonly import('./OpeningBalanceSnapshot.js').OpeningBalanceSnapshot[];
  cliente_id: string;
  legal_entity_id: string;
  geradoEm: Date;
  calendar: import('../calendar/CalendarPolicy.js').CalendarPolicy;
  /** Map opcional de Stage 2.1. Quando presente, hook desloca
   *  confirmados de contraparte estável por `mediana_dias`. */
  contraparteHistory?: ReadonlyMap<
    string,
    import('./historico.js').ContraparteStats
  >;
}

/**
 * Erro do estágio de projeção. Lançado em input inválido (realizado
 * sem `data_realizada`, `geradoEm` ausente, `calendar` ausente, semana
 * ISO mal-formada). Princípio do nucleus: falhar visivelmente.
 */
export class ProjecaoError extends Error {
  override readonly name = 'ProjecaoError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ProjecaoError.prototype);
  }
}

/* ───────────────────────────────────────────────────────────────────
 * Estágio 4.2 — Consolidado por cliente + transferência interna.
 * ─────────────────────────────────────────────────────────────────── */

/**
 * Caixa inicial agregado pelo cliente. Soma vetorial das `CaixaInicial`
 * das `legal_entity_ids_ativas`, com flags propagadas em "OR" — qualquer
 * unidade stale/ausente põe a flag no consolidado. Cobertura (Stage 5)
 * decide o impacto.
 */
export interface CaixaInicialConsolidado {
  /** Soma das `CaixaInicial.valor` de todas as unidades ativas. 0 quando
   *  todas ausentes. Unidades ausentes contribuem com 0 (não NaN). */
  valor: number;
  /** Map `legal_entity_id → CaixaInicial` da respectiva unidade.
   *  Drill-down completo para auditar de onde veio cada parcela. */
  por_unidade: Map<string, CaixaInicial>;
  /** OR das `stale` — true se qualquer unidade tem snapshot >7d. */
  alguma_stale: boolean;
  /** OR das `ausente` — true se qualquer unidade ativa não tem snapshot. */
  alguma_ausente: boolean;
}

/**
 * Motivo pelo qual um par marcado `is_transferencia=true` não foi
 * neutralizado no consolidado. Lista exaustiva.
 */
export type MotivoTransferenciaInvalida =
  | 'par_inexistente'
  | 'mesma_unidade'
  | 'cliente_diferente'
  | 'nao_reciproco'
  | 'mesma_direcao'
  | 'fora_janela';

/**
 * Registro de auditoria por par de transferência avaliado. Cada par
 * (recíproco ou órfão) gera UM registro. Lista ordenada por
 * `evento_a_id` para determinismo.
 */
export interface TransferenciaNeutralizada {
  /** ID do "lado A" (em geral a saída; quando há ambiguidade, o de
   *  menor `id` lex). */
  evento_a_id: string;
  /** ID do "lado B" apontado por `transferencia_par_id` de A. String
   *  vazia quando A é órfão (`transferencia_par_id` ausente). */
  evento_b_id: string;
  /** Par recíproco válido + dentro da janela + intra-cliente +
   *  inter-unidade + direções opostas → true; subtração foi aplicada. */
  valido: boolean;
  /** Motivo da invalidez. Ausente quando `valido=true`. */
  motivo_invalidez?: MotivoTransferenciaInvalida;
  /** Semana de allocationDate de A (na unidade de A). Ausente se A está
   *  fora da janela ou se par inválido por par_inexistente. */
  semana_a?: string;
  /** Semana de allocationDate de B. Ausente em casos análogos. */
  semana_b?: string;
  /** Valor do lado A em R$. Registrado em todos os casos onde A existe
   *  no input. Em valid pair, B.valor difere de A.valor por no máximo
   *  R$ 0.02 (tolerância da §3.A do 3.2). */
  valor: number;
}

/** Estatísticas da consolidação. Identidade obrigatória:
 *  `transferenciasNeutralizadasValidas + transferenciasNeutralizadasInvalidas
 *   === transferenciasParesAvaliados`. */
export interface EstatisticasConsolidadas {
  /** `legal_entity_ids_ativas.length`. */
  unidadesAtivas: number;
  /** Soma de `eventosTotal` das unidades. Antes da neutralização. */
  eventosTotalConsolidado: number;
  /** Eventos com `is_transferencia=true` no input filtrado por cliente.
   *  Cada evento conta 1 (par marca 2; órfão marca 1). Independente
   *  de validação. */
  transferenciasMarcadasEventos: number;
  /** Pares únicos avaliados. Recíproco conta 1; órfão conta 1. */
  transferenciasParesAvaliados: number;
  /** Pares com par recíproco + intra-cliente + inter-unidade + direções
   *  opostas + ambos dentro da janela → subtração aplicada. */
  transferenciasNeutralizadasValidas: number;
  /** Pares avaliados que NÃO foram neutralizados. Soma com `Validas`
   *  fecha em `transferenciasParesAvaliados`. */
  transferenciasNeutralizadasInvalidas: number;
}

/**
 * Projeção consolidada — soma das unidades ativas com transferências
 * internas neutralizadas. Mesmo formato de `ProjecaoUnidade.semanas`
 * para que consumidores reutilizem renderizadores.
 *
 * **Ordem de construção** (§3.D do spec):
 *  1. Soma bruta de buckets por semana.
 *  2. Neutralização de pares válidos (subtração).
 *  3. Recalcular totais (`total_entradas`, `total_saidas`, `variacao_liquida`).
 *  4. Roll-forward (`caixa_inicial[k+1] = caixa_final[k]`).
 *
 * Pular ou inverter passos quebra o invariante `caixa_final =
 * caixa_inicial + variacao_liquida`.
 */
export interface ProjecaoConsolidada {
  cliente_id: string;
  /** Unidades agregadas (= `legal_entity_ids_ativas`, ordenadas lex). */
  legal_entity_ids: string[];
  geradoEm: Date;
  /** Mesmo da janela das unidades (todas usam o mesmo `geradoEm`). */
  janela: string[];
  caixaInicial: CaixaInicialConsolidado;
  /** length = 13. `evento_ids` = união menos neutralizados.
   *  `eventos_pendentes_com_data_ids` = união sem subtração. */
  semanas: SemanaProjecao[];
  /** Auditoria: 1 entrada por par avaliado, ordem lex por `evento_a_id`. */
  transferenciasNeutralizadas: TransferenciaNeutralizada[];
  estatisticas: EstatisticasConsolidadas;
}

/**
 * Saída de `projetaCliente`. `unidades` é byte-for-byte idêntico ao
 * output de `projetaUnidade` para cada `legal_entity_id` ativa
 * (transferência aparece normalmente; consolidado é quem neutraliza).
 */
export interface ProjecaoCliente {
  cliente_id: string;
  geradoEm: Date;
  /** Unidades ordenadas por `legal_entity_id` lex. */
  unidades: ProjecaoUnidade[];
  consolidado: ProjecaoConsolidada;
}

/**
 * Input de `projetaCliente`. `eventos` e `saldos` cobrem TODAS as
 * unidades do cliente; o orquestrador filtra internamente. Eventos de
 * unidades fora de `legal_entity_ids_ativas` são ignorados silenciosamente.
 */
export interface ProjetaClienteInput {
  eventos: readonly EventoCaixa[];
  saldos: readonly import('./OpeningBalanceSnapshot.js').OpeningBalanceSnapshot[];
  cliente_id: string;
  /** Universo das unidades a projetar. Ordem irrelevante (orquestrador
   *  ordena lex internamente). Vazio → `unidades=[]` e consolidado zerado. */
  legal_entity_ids_ativas: readonly string[];
  geradoEm: Date;
  calendar: import('../calendar/CalendarPolicy.js').CalendarPolicy;
  contraparteHistory?: ReadonlyMap<
    string,
    import('./historico.js').ContraparteStats
  >;
  /**
   * Map `legal_entity_id → VolatilidadeStats` (Stage 2.1). Quando
   * presente, cada unidade usa seu CV (com teto 25%) na margem do
   * caixa mínimo operacional. Ausente ou unidade sem entrada → fallback
   * 10%. Estágio 4.3.
   */
  volatilidades?: ReadonlyMap<
    string,
    import('./historico.js').VolatilidadeStats
  >;
}
