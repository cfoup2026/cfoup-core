export type { Transaction, TransactionDirection } from './transaction.js';
export type { Account, AccountType } from './account.js';
export type { BalanceSnapshot, BalanceSource } from './balance.js';
export type {
  ParseResult,
  ParseError,
  ParseWarning,
} from './parse-result.js';
export type { Payable, PaymentStatus } from './payable.js';
export type { Receivable, DueDateSource } from './receivable.js';
export type { DailyTotal } from './daily-total.js';
export type {
  Sale,
  SaleMovementType,
  SaleMovementTypeSource,
  MarginPercentSource,
} from './sale.js';
export type { SaleAggregate, SaleAggregateScope } from './sale-aggregate.js';
export type {
  DREEntry,
  DREEntryKind,
  DRELineItem,
  DRESectionHeader,
  DRESubtotal,
  DREValueSource,
} from './dre.js';
export type {
  BalanceSheetEntry,
  BalanceSheetEntryKind,
  BalanceSheetLineItem,
  BalanceSheetSectionHeader,
  BalanceSheetSubtotal,
  BalanceSheetValueSource,
  BalanceType,
} from './balance-sheet.js';

/* ─── CF13 — pipeline fluxo de caixa 13 semanas (Estágio 1.1) ─── */
export type {
  Confianca,
  ConfiancaOrigem,
  ContraparteTipo,
  Criticidade,
  Direcao,
  Origem,
  Status,
} from './enums.js';
export type {
  EventoCaixa,
  EventoCaixaBase,
  EventoConfirmado,
  EventoEstimado,
  EventoPendente,
  EventoRealizado,
} from './EventoCaixa.js';
export type { OpeningBalanceSnapshot } from './OpeningBalanceSnapshot.js';

/* ─── CF13 — Estágio 2: Motor de Histórico ─── */
export type {
  BaseDeAmostragem,
  ContraparteStats,
  HistoricoOperacional,
  HistoricoOperacionalParcial,
  Periodo,
  Recorrencia,
  VolatilidadeStats,
} from './historico.js';
export { HistoricoError } from './historico.js';

/* ─── CF13 — Estágio 3.1: Reconciliação banco ↔ CP/CR ─── */
export type {
  AbsorcaoBancaria,
  PendenciaReconciliacao,
  ReconciliacaoEstatisticas,
  ReconciliacaoResult,
  TipoPendenciaReconciliacao,
} from './reconciliacao.js';
export { ReconciliacaoError } from './reconciliacao.js';

/* ─── CF13 — Estágio 3.2: Vendas auxiliares e reconciliação Vendas↔AR ─── */
export type {
  PendenciaComercial,
  PrazoVenda,
  ReconciliacaoComercialEstatisticas,
  ReconciliacaoComercialResult,
  TipoPendenciaComercial,
  VendaComercial,
} from './comercial.js';

/* ─── CF13 — Estágio 4.1: Projeção semanal por unidade ─── */
export type {
  CaixaInicial,
  CaixaMinimoOpProvenance,
  CaixaMinimoOpProvenancePorUnidade,
  MargemOrigem,
  ProjecaoUnidade,
  ProjecaoUnidadeEstatisticas,
  ProjetaUnidadeInput,
  SemanaProjecao,
} from './projecao.js';
export { ProjecaoError } from './projecao.js';

/* ─── CF13 — Estágio 4.2: Consolidado por cliente + transferência ─── */
export type {
  CaixaInicialConsolidado,
  EstatisticasConsolidadas,
  MotivoTransferenciaInvalida,
  ProjecaoCliente,
  ProjecaoConsolidada,
  ProjetaClienteInput,
  TransferenciaNeutralizada,
} from './projecao.js';
