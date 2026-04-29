import { getCategoryByCode } from './categories.js';
import type {
  ClassificationResult,
  ExceptionReason,
  GroupedException,
  SourceTransaction,
} from './types.js';

function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Pega as 3 primeiras palavras significativas da descrição. */
function descriptionPrefix(tx: SourceTransaction): string {
  const raw = tx.description ?? tx.originalCategory ?? tx.counterpartyName;
  if (raw === undefined) return '(sem descrição)';
  const words = raw
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 3);
  return words.length > 0 ? words.join(' ') : raw;
}

/**
 * Extrai a chave de agrupamento por motivo. Mantém a regra estável e
 * legível: cada motivo agrupa pelo campo mais informativo.
 */
function extractKey(reason: ExceptionReason, tx: SourceTransaction): string {
  switch (reason) {
    case 'card_payment_without_detail':
      return tx.counterpartyName ?? tx.description ?? '(sem contraparte)';
    case 'accounting_generic_account':
      return (
        tx.originalAccountName ??
        tx.originalGroupName ??
        tx.originalSubgroupName ??
        '(conta sem nome)'
      );
    case 'generic_original_category':
      return (
        tx.originalCategory ??
        tx.originalAccountName ??
        tx.originalGroupName ??
        '(categoria sem nome)'
      );
    case 'unknown_counterparty':
      return tx.counterpartyName ?? '(sem contraparte)';
    case 'unmatched_bank_transaction':
    case 'bank_only_weak_description':
      return descriptionPrefix(tx);
    case 'low_confidence':
      return tx.counterpartyName ?? descriptionPrefix(tx);
    case 'possible_transfer':
      return tx.counterpartyName ?? descriptionPrefix(tx);
    case 'possible_duplicate':
      return (
        tx.documentNumber ?? tx.counterpartyName ?? descriptionPrefix(tx)
      );
    case 'large_other_category':
      return tx.originalCategory ?? tx.originalAccountName ?? 'Outros';
    case 'receivables_advance':
      return tx.counterpartyName ?? '(adiantamento)';
    case 'loan_needs_breakdown':
      return tx.counterpartyName ?? '(empréstimo)';
    case 'refund_or_chargeback':
      return tx.counterpartyName ?? '(reembolso/chargeback)';
    case 'none':
      return '';
  }
}

/** Templates de label legível em PT-BR por motivo. */
const LABEL_TEMPLATES: Record<ExceptionReason, (k: string) => string> = {
  card_payment_without_detail: (k) =>
    `Pagamentos de cartão sem detalhe — "${k}"`,
  accounting_generic_account: (k) => `Conta contábil genérica — "${k}"`,
  generic_original_category: (k) => `Categoria genérica — "${k}"`,
  unknown_counterparty: (k) => `Contraparte desconhecida — "${k}"`,
  unmatched_bank_transaction: (k) => `Banco sem match — "${k}"`,
  bank_only_weak_description: (k) => `Descrição bancária fraca — "${k}"`,
  low_confidence: (k) => `Classificação com baixa confiança — "${k}"`,
  possible_transfer: (k) => `Possível transferência — "${k}"`,
  possible_duplicate: (k) => `Possível duplicata — "${k}"`,
  large_other_category: (k) => `Categoria "Outros" relevante — "${k}"`,
  receivables_advance: (k) => `Adiantamento de cliente — "${k}"`,
  loan_needs_breakdown: (k) => `Empréstimo a abrir — "${k}"`,
  refund_or_chargeback: (k) => `Reembolso/chargeback — "${k}"`,
  none: (k) => k,
};

interface GroupAccumulator {
  reason: ExceptionReason;
  /** Chave já normalizada (lowercase, sem acentos) — usada no map. */
  normalizedKey: string;
  /** Primeira ocorrência crua, pra mostrar com a capitalização original. */
  rawKey: string;
  txs: SourceTransaction[];
  results: ClassificationResult[];
}

let exceptionCounter = 0;
function nextExceptionId(companyId: string): string {
  exceptionCounter += 1;
  return `exc_${companyId}_${exceptionCounter}`;
}

/**
 * Agrupa pendências por (motivo, chave). A chave é escolhida por motivo
 * (ver `extractKey`).
 *
 * Resultados com `status === 'classified'` ou `exceptionReason === 'none'`
 * são ignorados — só pendências entram. Resultados sem transação
 * correspondente em `transactions` também são ignorados.
 *
 * Sugestão (`suggestedCategoryCode`/`suggestedBucket`/`suggestedOwnerLabel`)
 * é derivada da categoria mais comum entre os resultados do grupo, quando
 * existe alguma. Pendências completamente sem categoria não recebem sugestão.
 */
export function groupClassificationExceptions(
  results: readonly ClassificationResult[],
  transactions: readonly SourceTransaction[],
): GroupedException[] {
  const txById = new Map<string, SourceTransaction>();
  for (const tx of transactions) txById.set(tx.id, tx);

  const groups = new Map<string, GroupAccumulator>();

  for (const r of results) {
    if (r.status === 'classified') continue;
    if (r.exceptionReason === 'none') continue;

    const tx = txById.get(r.sourceTransactionId);
    if (tx === undefined) continue;

    const rawKey = extractKey(r.exceptionReason, tx);
    const normalizedKey = normalizeText(rawKey);
    const mapKey = `${r.exceptionReason}::${normalizedKey}`;

    let group = groups.get(mapKey);
    if (group === undefined) {
      group = {
        reason: r.exceptionReason,
        normalizedKey,
        rawKey,
        txs: [],
        results: [],
      };
      groups.set(mapKey, group);
    }
    group.txs.push(tx);
    group.results.push(r);
  }

  return Array.from(groups.values()).map((g) => buildException(g));
}

function buildException(g: GroupAccumulator): GroupedException {
  const companyId = g.txs[0]?.companyId ?? '';
  const totalAmount = g.txs.reduce((sum, t) => sum + t.amount, 0);
  const labelFn = LABEL_TEMPLATES[g.reason];
  const groupLabel = labelFn(g.rawKey);

  const codeCounts = new Map<string, number>();
  for (const r of g.results) {
    if (r.standardCategoryCode === undefined) continue;
    codeCounts.set(
      r.standardCategoryCode,
      (codeCounts.get(r.standardCategoryCode) ?? 0) + 1,
    );
  }
  const suggestedCode = pickMostCommon(codeCounts);
  const suggestedCat =
    suggestedCode !== undefined ? getCategoryByCode(suggestedCode) : undefined;

  const avgConfidence =
    g.results.reduce((sum, r) => sum + r.confidenceScore, 0) /
    Math.max(g.results.length, 1);

  const result: GroupedException = {
    id: nextExceptionId(companyId),
    companyId,
    exceptionReason: g.reason,
    groupLabel,
    transactionIds: g.txs.map((t) => t.id),
    totalAmount,
    count: g.txs.length,
    confidenceScore: avgConfidence,
    requiresOwnerAction: true,
  };
  if (suggestedCode !== undefined)
    result.suggestedCategoryCode = suggestedCode;
  if (suggestedCat?.bucket !== undefined && suggestedCat.bucket !== null)
    result.suggestedBucket = suggestedCat.bucket;
  if (suggestedCat?.ownerFriendlyLabel !== undefined)
    result.suggestedOwnerLabel = suggestedCat.ownerFriendlyLabel;
  return result;
}

function pickMostCommon(counts: Map<string, number>): string | undefined {
  let best: { code: string; count: number } | undefined;
  for (const [code, count] of counts) {
    if (best === undefined || count > best.count) best = { code, count };
  }
  return best?.code;
}
