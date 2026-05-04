/**
 * Tipos do Motor de Histórico Operacional CF13 (Estágio 2.1).
 *
 * Estágio 2.1 produz APENAS estatística sobre o passado — não gera
 * `EventoCaixa` estimado, não toca `deriveDataEsperada`. Estágio 2.2
 * vai consumir essas estruturas para projetar futuros e ativar o hook
 * `contraparteHistory` no calendário.
 *
 * Princípios:
 *  - Provenance explícito em cada saída (`inferido_de`, `n_amostras`,
 *    `confianca_inferencia` quando aplicável).
 *  - Fail visibly: input inválido → `HistoricoError`.
 *  - Determinístico: mesma entrada → mesma saída (`geradoEm` injetado).
 *  - Conservador: estruturas com cobertura insuficiente são retornadas
 *    com flag, nunca inventadas.
 */

/**
 * Estatística de antecipação/atraso por contraparte.
 *
 * Calculada apenas sobre eventos `realizado` que tenham
 * `data_vencimento` E `data_realizada` ambas preenchidas. Eventos sem
 * vencimento (ex: extrato CEF puro) ou sem `contraparte_id` são ignorados.
 *
 * `delta_dias = data_realizada - data_vencimento` (positivo = atraso,
 * negativo = antecipação).
 */
export interface ContraparteStats {
  /** Identificador da contraparte (mesmo `contraparte_id` do `EventoCaixa`). */
  contraparte_id: string;
  /** Quantidade de pares (vencimento, realizada) válidos da contraparte. */
  n: number;
  /** Mediana de `delta_dias` (mais robusta que média a outliers). */
  mediana_dias: number;
  /** Média aritmética de `delta_dias`. */
  media_dias: number;
  /** Desvio-padrão populacional de `delta_dias`. */
  desvio_dias: number;
  /** Menor `delta_dias` da amostra. */
  min_dias: number;
  /** Maior `delta_dias` da amostra. */
  max_dias: number;
  /**
   * `true` somente quando há padrão estável o suficiente para o
   * Estágio 2.2 ajustar `data_esperada` futura:
   *  - `n >= 6` (cobertura mínima)
   *  - `desvio_dias <= 3` (consistência)
   *  - `|mediana_dias| >= 1` (deslocamento identificável; mediana=0
   *    significa "paga sempre no dia" — sem padrão a aprender).
   */
  padrao_estavel: boolean;
  inferido_de: 'delta_vencimento_realizada';
  n_amostras: number;
  confianca_inferencia: 'alta' | 'media' | 'baixa';
}

/** Períodos suportados por `Recorrencia`. */
export type Periodo =
  | 'semanal'
  | 'quinzenal'
  | 'mensal'
  | 'bimestral'
  | 'trimestral';

/**
 * Série recorrente detectada no histórico. Identificada por
 * `(contraparte_id, bucket_id, valor_classe)` onde `valor_classe` é o
 * cluster do valor com tolerância ±10% sobre a mediana da série.
 *
 * Estágio 2.2 (`generateEstimados`) usa séries com
 * `confianca IN ('alta', 'media')` E `ativa=true` para projetar
 * `EventoCaixa` estimados nas próximas N semanas. Os campos
 * `direcao`, `cliente_id`, `legal_entity_id`, etc são **herdados** dos
 * eventos do cluster — todos os eventos de uma série compartilham esses
 * valores por construção (cluster pelo mesmo `contraparte_id` + bucket).
 */
export interface Recorrencia {
  /** ID determinístico da série, derivado de chave + primeiro evento. */
  recorrencia_id: string;
  contraparte_id: string;
  bucket_id: string;
  /** Valor mediano dos eventos da série (representante do cluster). */
  valor_mediano: number;
  /** Menor valor observado na série (limite inferior do cluster ±10%). */
  valor_classe_min: number;
  /** Maior valor observado na série. */
  valor_classe_max: number;
  /** Período provável detectado. */
  periodo: Periodo;
  /** Quantidade de ocorrências na série. */
  n_ocorrencias: number;
  /** `data_realizada` da primeira ocorrência da série. */
  primeira_data: Date;
  /** `data_realizada` da última ocorrência da série. */
  ultima_data: Date;
  /** `true` quando a última ocorrência foi há menos de 1.5 períodos. */
  ativa: boolean;
  /** Qualidade da inferência (cobre n + consistência de gaps + atividade). */
  confianca: 'alta' | 'media' | 'baixa';
  inferido_de: 'agrupamento_contraparte_bucket_valor';
  n_amostras: number;

  /* ─── Campos herdados do cluster (homogêneos por construção) ─── */

  /** Direção financeira herdada dos eventos do cluster. */
  direcao: import('./enums.js').Direcao;
  /** Tenant herdado. */
  cliente_id: string;
  /** Legal entity herdada. */
  legal_entity_id: string;
  /** Bucket name herdado (legível ao dono). */
  bucket_nome: string;
  /** Criticidade herdada (em V0 será 'pendente' quando bucket técnico). */
  criticidade: import('./enums.js').Criticidade;
  /** Tipo da contraparte quando conhecido nos eventos do cluster. */
  contraparte_tipo?: import('./enums.js').ContraparteTipo;
  /** Source company code herdado quando todos os eventos têm o mesmo. */
  source_company_code?: string;
}

/**
 * Estatística de volatilidade de saídas por `legal_entity_id` —
 * coeficiente de variação das saídas obrigatórias/críticas dos últimos
 * 12 meses. Estágio 4 (Projeção) aplica teto 25% e fallback 10% em
 * cima do `cv` bruto produzido aqui.
 *
 * Base temporal: `competencia` quando todos os eventos do legal_entity
 * têm `competencia` preenchida; senão fallback `semana_iso`.
 */
export interface VolatilidadeStats {
  legal_entity_id: string;
  /** Quantidade de períodos (meses-competência ou semanas-ISO) com dados. */
  n_periodos: number;
  /** Média de saídas relevantes por período (R$). */
  media: number;
  /** Desvio-padrão populacional dos totais por período. */
  desvio: number;
  /** Coeficiente de variação = `desvio / media`. 0 quando `media` é 0. */
  cv: number;
  /** `'alta'` quando `n_periodos >= 12`; `'insuficiente'` caso contrário. */
  qualidade: 'alta' | 'insuficiente';
  /** Base de agrupamento temporal usada. */
  base_temporal: 'competencia' | 'semana_iso';
  inferido_de: 'saidas_obrigatorias_critica_op_12m';
  n_amostras: number;
  confianca_inferencia: 'alta' | 'baixa';
}

/** Resumo da janela amostral usada pelo motor. */
export interface BaseDeAmostragem {
  /** `data_realizada` do primeiro evento `realizado` considerado. */
  primeiroEvento: Date;
  /** `data_realizada` do último evento `realizado` considerado. */
  ultimoEvento: Date;
  /** Total de eventos `realizado` na entrada do motor. */
  totalRealizados: number;
}

/**
 * Saída do `MotorHistorico` no Estágio 2.1 (parcial — sem
 * `eventosEstimados`, que nasce em 2.2).
 */
export interface HistoricoOperacionalParcial {
  /** Padrão de antecipação/atraso por contraparte. */
  contraparteHistory: Map<string, ContraparteStats>;
  /** Séries recorrentes detectadas no histórico. */
  recorrencias: Recorrencia[];
  /** Volatilidade de saídas por `legal_entity_id`. */
  volatilidades: Map<string, VolatilidadeStats>;
  /** Quando o histórico foi calculado (injetado em testes). */
  geradoEm: Date;
  /** Resumo da janela amostral. */
  baseDe: BaseDeAmostragem;
}

/**
 * Saída completa do `MotorHistorico` (Estágio 2.2). Estende o parcial
 * com `eventosEstimados` — `EventoCaixa[]` projetados pelas próximas
 * N semanas (default 13) a partir das recorrências fortes.
 */
export interface HistoricoOperacional extends HistoricoOperacionalParcial {
  /**
   * Eventos `estimado` com `origem='historico'` cobrindo a janela de
   * projeção. Trava anti-duplicação aplicada contra
   * `confirmado`/`realizado` dentro de ±5 dias por `(contraparte_id,
   * bucket_id, valor_classe)`.
   */
  eventosEstimados: import('./EventoCaixa.js').EventoCaixa[];
}

/**
 * Erro do motor de histórico. Princípio do nucleus: input quebrado
 * (ex: `realizado` sem `data_realizada`) lança visivelmente, não
 * silencia. Stage 1 já valida isso, mas a verificação aqui é uma rede
 * de segurança contra eventos construídos manualmente que pulem o adapter.
 */
export class HistoricoError extends Error {
  override readonly name = 'HistoricoError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, HistoricoError.prototype);
  }
}
