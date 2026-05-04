/**
 * Tipos do Estágio 5.1 — Detecção de cobertura.
 *
 * Stage 5 detecta dois tipos de problema sobre a projeção (4.1+4.2+4.3):
 *
 *  1. **Cobertura insuficiente** (§8.1 do spec): casos que substituem
 *     o veredito por "dados insuficientes" no Stage 7. Ex: saldo de
 *     abertura ausente, banco sem dado recente.
 *
 *  2. **Cobertura com confiança reduzida** (§8.2): pendências que
 *     informam o dono mas NÃO bloqueiam veredito. Ex: semana zerada,
 *     recorrência ausente, eventos pendente de classificação agregados.
 *
 * Stage 5 só **detecta e lista** — não rebaixa confiança (Stage 6) nem
 * emite veredito (Stage 7). Saída é `Pendencia[]` + `MotivoInsuficiencia[]`
 * prontos para consumo nos próximos estágios.
 *
 * Linguagem de produto (§8.3): `descricao` em pendências/motivos é
 * factual, sem storytelling. `acoes_sugeridas` são enums, não strings
 * livres — telas downstream traduzem para PT-BR.
 */
import type { Direcao } from './enums.js';

/**
 * Tipo de pendência detectada. Lista exaustiva.
 *
 *  - `'semana_zerada'`: semana (≠ a primeira) sem nenhum evento alocado.
 *  - `'recorrencia_ausente'`: recorrência elegível esperada na semana
 *    sem evento `(contraparte_id, bucket_id)` correspondente. Trava
 *    anti-duplicação aplicada — só dispara quando NEM confirmado, NEM
 *    realizado, NEM estimado existe.
 *  - `'pendentes_classificacao_agregados'`: agregação de eventos com
 *    `bucket_id='pendente_classificacao'` OU `criticidade='pendente'`,
 *    granularidade `(legal_entity_id, semana_iso, direcao)`.
 */
export type TipoPendencia =
  | 'semana_zerada'
  | 'recorrencia_ausente'
  | 'pendentes_classificacao_agregados';

/**
 * Tipo de motivo de cobertura insuficiente. Aciona substituição do
 * veredito por "dados insuficientes" no Stage 7.
 *
 *  - `'saldo_abertura_ausente'`: alguma `legal_entity_id` ativa sem
 *    `OpeningBalanceSnapshot` em `data_referencia <= geradoEm`.
 *  - `'banco_sem_dado_recente'`: unidade ativa com banco conhecido
 *    cujo último evento `realizado` (CEF ou manual) é > 7 dias antes
 *    de `geradoEm`.
 */
export type TipoMotivoInsuficiencia =
  | 'saldo_abertura_ausente'
  | 'banco_sem_dado_recente';

/**
 * Ações sugeridas, enumeradas. Telas/relatórios traduzem cada enum
 * para PT-BR. Stage 5 só emite o enum — sem strings livres.
 *
 *  - `'confirmar_saldo'`: dono informa o saldo de abertura faltante.
 *  - `'revisar_conexao'`: revisa integração bancária / re-importa CSV.
 *  - `'declarar_conta_inativa'`: marca a unidade/conta como inativa
 *    para excluir do universo CF13.
 *  - `'adicionar_evento_manual'`: lança evento manual cobrindo o gap.
 *  - `'confirmar_que_era_esperado'`: dono confirma que ausência é normal.
 *  - `'reclassificar_eventos_pendentes'`: dono confirma bucket dos
 *    pendentes para precisão do caixa mínimo.
 *  - `'verificar_recorrencia'`: dono revê a recorrência (encerrada?
 *    contraparte mudou?).
 */
export type AcaoCobertura =
  | 'confirmar_saldo'
  | 'revisar_conexao'
  | 'declarar_conta_inativa'
  | 'adicionar_evento_manual'
  | 'confirmar_que_era_esperado'
  | 'reclassificar_eventos_pendentes'
  | 'verificar_recorrencia';

/**
 * Pendência detectada. ID determinístico baseado em
 * `(tipo, legal_entity_id, semana_iso, qualificador)`.
 *
 * Campos opcionais por tipo:
 *  - `recorrencia_id`, `bucket_id`, `contraparte_id`, `valor_esperado`:
 *    `'recorrencia_ausente'`.
 *  - `direcao`, `quantidade_eventos`, `valor_total`:
 *    `'pendentes_classificacao_agregados'`.
 */
export interface Pendencia {
  /** ID determinístico para deduplicação e drill-down. */
  id: string;
  tipo: TipoPendencia;
  legal_entity_id: string;
  /** Semana ISO `YYYY-Www` onde a pendência foi detectada. */
  semana_iso: string;
  /** Descrição curta factual (sem storytelling). Telas traduzem se
   *  precisar variar tom. */
  descricao: string;
  /** Lista de ações enumeradas. Nunca vazia, nunca strings livres. */
  acoes_sugeridas: AcaoCobertura[];
  /* ───── Opcionais por tipo ───── */
  /** `'recorrencia_ausente'` apenas. */
  recorrencia_id?: string;
  /** `'recorrencia_ausente'` apenas. */
  bucket_id?: string;
  /** `'recorrencia_ausente'` apenas (quando a recorrência tem contraparte). */
  contraparte_id?: string;
  /** `'recorrencia_ausente'` apenas. Valor mediano da recorrência —
   *  NÃO é estimativa nova; é repetição do histórico já calculado. */
  valor_esperado?: number;
  /** `'pendentes_classificacao_agregados'` apenas. */
  direcao?: Direcao;
  /** `'pendentes_classificacao_agregados'` apenas. */
  quantidade_eventos?: number;
  /** `'pendentes_classificacao_agregados'` apenas. */
  valor_total?: number;
}

/**
 * Motivo de cobertura insuficiente. Reportado em separado das
 * pendências; aciona "dados insuficientes" no Stage 7. Pendências
 * continuam sendo detectadas mesmo quando há motivos.
 */
export interface MotivoInsuficiencia {
  tipo: TipoMotivoInsuficiencia;
  legal_entity_id: string;
  /** Descrição curta factual. */
  descricao: string;
  /** Última `data_realizada` observada (apenas em `banco_sem_dado_recente`). */
  ultima_data_observada?: Date;
  acoes_sugeridas: AcaoCobertura[];
}

/** Estatísticas determinísticas. Identidades obrigatórias:
 *  - `Σ pendenciasPorTipo.values() === pendencias.length`.
 *  - `Σ pendenciasPorUnidade.values() === pendencias.length`.
 *  - `motivosInsuficienciaCount === motivosInsuficiencia.length`. */
export interface CoberturaEstatisticas {
  /** Distribuição por tipo. */
  pendenciasPorTipo: Map<TipoPendencia, number>;
  /** Distribuição por `legal_entity_id`. */
  pendenciasPorUnidade: Map<string, number>;
  /** Quantidade de `(legal_entity_id, semana_iso)` distintos com
   *  pelo menos uma pendência. */
  semanasComPendencia: number;
  /** Soma de `quantidade_eventos` em pendências do tipo
   *  `'pendentes_classificacao_agregados'`. */
  totalEventosPendentesClassificacao: number;
  /** Soma de `valor_total` idem. */
  valorTotalPendentesClassificacao: number;
  /** Quando `status='cobertura_insuficiente'`, conta quantos motivos. */
  motivosInsuficienciaCount: number;
}

/**
 * Status da cobertura. Hierarquia:
 *
 *  - `'cobertura_insuficiente'`: `motivosInsuficiencia.length > 0`.
 *    Stage 7 substitui veredito por "dados insuficientes".
 *  - `'cobertura_com_confianca_reduzida'`: sem motivos, mas
 *    `pendencias.length > 0`. Stage 7 emite veredito + lista pendências.
 *  - `'cobertura_completa'`: tudo zero. Stage 7 emite veredito limpo.
 */
export type CoberturaStatus =
  | 'cobertura_insuficiente'
  | 'cobertura_com_confianca_reduzida'
  | 'cobertura_completa';

/**
 * Saída de `detectaCobertura`. Determinístico — mesmo input + `geradoEm`
 * → mesmo output (`deepEqual`).
 */
export interface CoberturaResult {
  status: CoberturaStatus;
  /** Lista ordenada por `(legal_entity_id, semana_iso, tipo, id)`. */
  pendencias: Pendencia[];
  /** Lista ordenada por `(tipo, legal_entity_id)`. Vazia quando
   *  `status !== 'cobertura_insuficiente'`. */
  motivosInsuficiencia: MotivoInsuficiencia[];
  estatisticas: CoberturaEstatisticas;
  detectadoEm: Date;
}

/**
 * Erro do estágio de cobertura. Lançado em input inválido (ex:
 * `projecao.cliente_id` divergente do `cliente_id` do parâmetro).
 * Princípio do nucleus: falhar visivelmente.
 */
export class CoberturaError extends Error {
  override readonly name = 'CoberturaError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CoberturaError.prototype);
  }
}
