/**
 * CF13 UI Contract — tipos camelCase de saída.
 *
 * Contrato externo do pipeline CF13 (Stages 1→7) consumido por
 * `cfoup-overview-v3` e demais front-ends. **Não substitui** os tipos
 * snake_case do core (`src/types/projecao.ts`, `cobertura.ts`,
 * `confianca/types.ts`, `veredito/types.ts`) — é um wrapper de
 * apresentação produzido por adapters em `./adapters/*`.
 *
 * Princípios:
 *  - JSON-safe: zero `Date`, `Map`, `Set` ou classe — só `string`/
 *    `number`/`boolean`/`null` e objetos POJO. Datas serializadas como
 *    ISO 8601 (`YYYY-MM-DD` para dia, ISO completo para timestamp).
 *  - camelCase total — convenção do contrato UI.
 *  - Ordenação determinística garantida pelos adapters.
 *
 * Inputs do `runCF13Pipeline` permanecem em snake_case para coincidir
 * com o input nativo do orquestrador interno.
 */

/* ─────────── Constantes do contrato ─────────── */

/** Versão do engine CF13 emitida em `meta.versaoEngine`. */
export const CF13_ENGINE_VERSION = 'cf13.v0';

/* ─────────── Output principal ─────────── */

export interface CF13Output {
  meta: CF13Meta;
  projecao: ProjecaoCliente;
  cobertura: CoberturaResult;
  confianca: ConfiancaResult;
  veredito: VereditoResult;
  pendencias: PendenciaCF13[];
}

export interface CF13Meta {
  clienteId: string;
  /** ISO `YYYY-MM-DD` — data de corte da janela. */
  baseDate: string;
  /** ISO `YYYY-MM-DD` — `consolidado.semanas[0].inicio` (segunda da
   *  semana de baseDate). */
  janelaInicio: string;
  /** ISO `YYYY-MM-DD` — `consolidado.semanas[12].fim` (domingo). */
  janelaFim: string;
  /** ISO 8601 timestamp do momento do cálculo. Não-determinístico em
   *  runtime; injetável para testes via `now` na input. */
  geradoEm: string;
  /** Versão do engine — constante `CF13_ENGINE_VERSION`. */
  versaoEngine: string;
}

/* ─────────── Projeção ─────────── */

export interface ProjecaoCliente {
  clienteId: string;
  baseDate: string;
  janela: { inicio: string; fim: string };
  consolidado: ProjecaoNivel;
  /** Sempre presente; length ≥ 1. */
  unidades: ProjecaoNivel[];
}

export type EscopoNivel =
  | { tipo: 'consolidado'; clienteId: string }
  | {
      tipo: 'unidade';
      legalEntityId: string;
      /** TODO: lookup de nome de unidade não existe no core v0. Sempre
       *  `undefined` até existir fonte confiável (cadastro de unidades). */
      legalEntityNome?: string;
    };

export interface ProjecaoNivel {
  escopo: EscopoNivel;
  /** Caixa de abertura da semana 1. */
  caixaInicial: number;
  /** Sempre 13. Adapter lança erro de invariante se ≠ 13. */
  semanas: SemanaProjecao[];
  /** Mínimo de `caixaFinalSemana` ao longo das 13 semanas. Em empate,
   *  primeira ocorrência (menor índice). */
  menorCaixaProjetado: { semanaInicio: string; valor: number };
  /** Mínimo de `gapMinimoOperacional` (= `caixaFinalSemana -
   *  caixaMinimoOp`). Em empate, primeira ocorrência. */
  menorGapMinimo: { semanaInicio: string; valor: number };
  /** = `semanas[0].caixaMinimoOp`. Sempre definido. */
  minimoOpReferencia: number;
}

export interface SemanaProjecao {
  /** 1..13. */
  indice: number;
  /** ISO `YYYY-MM-DD` — segunda. */
  inicio: string;
  /** ISO `YYYY-MM-DD` — domingo. */
  fim: string;
  /** Ex: `"Sem 1 · 21–27 abr"`. */
  rotulo: string;
  caixaInicialSemana: number;
  /** Total de entradas (realizadas + confirmadas + estimadas). Pendentes
   *  fora dos totais por design do Stage 4. */
  entradas: number;
  /** Total de saídas (idem). */
  saidas: number;
  /** = `entradas - saidas`. */
  saldoSemana: number;
  caixaFinalSemana: number;
  caixaMinimoOp: number;
  /** = `caixaFinalSemana - caixaMinimoOp`. */
  gapMinimoOperacional: number;
  /** = `gapMinimoOperacional < 0`. */
  abaixoDoMinimo: boolean;
  /** = `caixaFinalSemana < 0`. */
  saldoNegativo: boolean;
  /** IDs de eventos com `direcao='entrada'` na semana. Ordem lex. */
  eventosEntradaIds: string[];
  /** IDs de eventos com `direcao='saida'` na semana. Ordem lex. */
  eventosSaidaIds: string[];
}

/* ─────────── Cobertura ─────────── */

export interface CoberturaResult {
  /** Binário: `'insuficiente'` quando há `insuficienciasCriticas`,
   *  senão `'suficiente'`. Pendências de confiança reduzida não
   *  movem este flag. */
  status: 'suficiente' | 'insuficiente';
  insuficienciasCriticas: InsuficienciaCritica[];
  pendenciasConfiancaReduzida: PendenciaConfianca[];
}

/** Tipo do contrato — note `banco_ativo_sem_dado_recente` (palavra
 *  `ativo`); o core emite `banco_sem_dado_recente`. Adapter renomeia. */
export type TipoInsuficiencia =
  | 'saldo_abertura_ausente'
  | 'banco_ativo_sem_dado_recente';

export interface InsuficienciaCritica {
  tipo: TipoInsuficiencia;
  legalEntityId: string;
  /** TODO: sempre `undefined` em v0. */
  legalEntityNome?: string;
  /** TODO: granularidade conta não existe no Stage 5. Sempre `undefined`. */
  accountId?: string;
  /** TODO: idem. */
  accountNome?: string;
  /** Descrição factual vinda do `MotivoInsuficiencia.descricao` interno. */
  mensagem: string;
  acoesSugeridas: AcaoSugerida[];
}

/**
 * Tipo da pendência de confiança reduzida. Em v0 o contrato usa a
 * enum literal do core (`Pendencia.tipo`) — granularidade `folha/imposto`
 * vs `recebível` do Item 1 §3.2 ainda não existe no core. TODO: refinar
 * quando recorrência tiver classificação de bucket.
 */
export type TipoPendenciaConfianca =
  | 'semana_zerada'
  | 'recorrencia_ausente'
  | 'pendentes_classificacao_agregados';

export interface PendenciaConfianca {
  tipo: TipoPendenciaConfianca;
  /** 1..13. Derivado da `semana_iso` interna via mapping para a janela. */
  semanaIndice: number;
  legalEntityId: string;
  mensagem: string;
  contexto?: {
    contraparteGrupoId?: string;
    bucketId?: string;
    valorEsperado?: number;
    /** `'recorrencia_historica'` para `recorrencia_ausente`,
     *  `'ausencia_total'` para `semana_zerada`, `'padrao_contraparte'`
     *  para `pendentes_classificacao_agregados`. */
    fonteDeteccao:
      | 'recorrencia_historica'
      | 'padrao_contraparte'
      | 'ausencia_total';
  };
  acoesSugeridas: AcaoSugerida[];
}

/* ─────────── Confiança ─────────── */

export interface ConfiancaResult {
  consolidado: ConfiancaNivel;
  unidades: Array<ConfiancaNivel & { legalEntityId: string }>;
  pendenciaCriticaPresente: boolean;
}

export interface ConfiancaNivel {
  projecao: 'baixa' | 'media' | 'alta';
  /** Sempre 13. */
  semanas: ConfiancaSemana[];
}

export interface ConfiancaSemana {
  /** 1..13. */
  indice: number;
  nivel: 'baixa' | 'media' | 'alta';
  pesoTotal: number;
  pesoAlta: number;
  pesoBaixa: number;
  /** `null` quando `pesoTotal === 0`. */
  percentAlta: number | null;
  /** `null` quando `pesoTotal === 0`. */
  percentBaixa: number | null;
  /** = `pesoTotal === 0`. */
  semanaZerada: boolean;
  /** = `pendenciasCriticasIds.length > 0`. */
  temPendenciaCritica: boolean;
  pendenciasCriticasIds: string[];
}

/* ─────────── Veredito ─────────── */

export interface VereditoResult {
  consolidado: Veredito;
  unidades: Array<
    Veredito & {
      legalEntityId: string;
      /** TODO: sempre `undefined` em v0. */
      legalEntityNome?: string;
    }
  >;
  bannerUnidadeCritica: BannerUnidadeCritica;
}

export interface BannerUnidadeCritica {
  presente: boolean;
  /** Vazio quando `presente === false`. */
  unidadesEmRisco: Array<{
    legalEntityId: string;
    categoria: VereditoCategoria;
  }>;
  /** Texto curto rendered (ex.: `"1 unidade em risco"`). String vazia
   *  quando `presente === false`. */
  mensagem: string;
}

export type VereditoCategoria =
  | 'dados_insuficientes'
  | 'critico'
  | 'alerta'
  | 'atencao'
  | 'limpo';

export interface Veredito {
  categoria: VereditoCategoria;
  /** Texto determinístico §6.2 (já vem renderizado pelo Stage 7). */
  texto: string;
  detalhe: VereditoDetalhe;
}

export type VereditoDetalhe =
  | { tipo: 'dados_insuficientes' }
  | {
      tipo: 'critico';
      semanaIndice: number;
      /** ISO `YYYY-MM-DD`. */
      semanaData: string;
      faltante: number;
    }
  | {
      tipo: 'alerta';
      semanaIndice: number;
      saldoProjetado: number;
      minimoOperacional: number;
    }
  | { tipo: 'atencao'; pendenciasRelevantes: number }
  | { tipo: 'limpo' };

/* ─────────── Pendência unificada ─────────── */

export type OrigemPendencia = 'cobertura' | 'confianca' | 'veredito' | 'manual';

export type SeveridadePendencia = 'critica' | 'media' | 'baixa';

export interface PendenciaCF13 {
  id: string;
  origem: OrigemPendencia;
  severidade: SeveridadePendencia;
  titulo: string;
  detalhe: string;
  /** ISO `YYYY-MM-DD`. Quando definido, deve existir em
   *  `output.projecao.consolidado.semanas[].inicio`. Ausente em
   *  pendências sem janela (saldo abertura ausente, erros de marcação). */
  semanaId?: string;
  /** = `legal_entity_id` do core. */
  unidadeId?: string;
  valorImpacto?: number;
  /** Singular — primeira ação do array `acoes_sugeridas` interno
   *  (quando existe). */
  acaoSugerida?: AcaoSugerida;
}

export interface AcaoSugerida {
  /** Identificador estável da ação — em v0 é o literal do enum
   *  `AcaoCobertura` do core (`'confirmar_saldo'`, etc.). */
  id: string;
  /** Rótulo PT-BR exibível. Em v0 = `id` (telas downstream traduzem). */
  rotulo: string;
  /** String aberta no v0. Coincide com `id` em ações que vêm de cobertura. */
  tipo: string;
  payload?: Record<string, unknown>;
}
