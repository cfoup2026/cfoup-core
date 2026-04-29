import { getCategoryByCode } from './categories.js';
import type {
  ClassificationResult,
  ClassificationRule,
  GroupedException,
  RuleType,
  SourceTransaction,
} from './types.js';

/** Lowercase + remoção de acentos, igual ao normalizeText do classify.ts.
 *  Duplicado aqui pra evitar import circular com classify.ts. */
function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/* ─────────── Avaliação de uma regra ─────────── */

interface RuleMatcher {
  /** Verdadeiro quando a regra casa contra a transação. */
  matches(rule: ClassificationRule, transaction: SourceTransaction): boolean;
}

/** Verifica substring case-insensitive em um campo. */
function substringMatch(field: string | undefined, pattern: string): boolean {
  if (field === undefined) return false;
  return normalizeText(field).includes(normalizeText(pattern));
}

const MATCHERS: Record<RuleType, RuleMatcher> = {
  counterparty: {
    matches: (r, t) => substringMatch(t.counterpartyName, r.pattern),
  },
  keyword: {
    matches: (r, t) =>
      substringMatch(t.description, r.pattern) ||
      substringMatch(t.originalCategory, r.pattern) ||
      substringMatch(t.originalClassificationRaw, r.pattern),
  },
  original_account: {
    matches: (r, t) =>
      substringMatch(t.originalAccountName, r.pattern) ||
      substringMatch(t.originalAccountCode, r.pattern),
  },
  cost_center: {
    matches: (r, t) => substringMatch(t.originalCostCenter, r.pattern),
  },
  payment_channel: {
    matches: (r, t) =>
      t.paymentChannel !== undefined &&
      normalizeText(t.paymentChannel) === normalizeText(r.pattern),
  },
  amount_pattern: {
    matches: (r, t) => {
      // Pattern como número exato: '1234.56' ou '1234,56'.
      const normalized = r.pattern.replace(',', '.').trim();
      const target = Number(normalized);
      if (!Number.isFinite(target)) return false;
      return Math.abs(t.amount - target) < 0.005;
    },
  },
  accounting_account: {
    matches: (r, t) =>
      substringMatch(t.originalAccountName, r.pattern) ||
      substringMatch(t.originalGroupName, r.pattern) ||
      substringMatch(t.originalSubgroupName, r.pattern),
  },
};

/**
 * Aplica regras de uma empresa em ordem; retorna a primeira que casa.
 * Regras inativas são ignoradas. `confidenceBoost` soma ao score base
 * (cap em 1.0).
 *
 * O score base aqui é 0.85 — regra explícita tem confiança alta por
 * default. O `confidenceBoost` permite refinar (ex: regra criada após
 * confirmação do dono recebe boost = 0.10 → score 0.95).
 */
export function applyClassificationRules(
  transaction: SourceTransaction,
  rules: readonly ClassificationRule[],
): ClassificationResult | null {
  const BASE_SCORE = 0.85;

  for (const rule of rules) {
    if (!rule.active) continue;
    const matcher = MATCHERS[rule.ruleType];
    if (!matcher.matches(rule, transaction)) continue;

    const score = Math.min(1, BASE_SCORE + rule.confidenceBoost);
    const cat = getCategoryByCode(rule.standardCategoryCode);
    const result: ClassificationResult = {
      sourceTransactionId: transaction.id,
      companyId: transaction.companyId,
      standardCategoryCode: rule.standardCategoryCode,
      bucket: cat?.bucket ?? null,
      confidenceScore: score,
      confidenceLevel: score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : 'low',
      classificationMethod:
        rule.createdBy === 'owner' ? 'owner_confirmed' : ruleMethod(rule.ruleType),
      originalLabelPreserved: true,
      requiresOwnerConfirmation: false,
      exceptionReason: 'none',
      status: 'classified',
    };
    if (cat?.ownerFriendlyLabel !== undefined)
      result.ownerFriendlyLabel = cat.ownerFriendlyLabel;
    return result;
  }

  return null;
}

/** Mapeia tipo de regra → `classificationMethod` quando criador não é o dono. */
function ruleMethod(
  ruleType: RuleType,
):
  | 'counterparty_rule'
  | 'keyword_rule'
  | 'original_account_rule'
  | 'cost_center_rule' {
  switch (ruleType) {
    case 'counterparty':
      return 'counterparty_rule';
    case 'original_account':
    case 'accounting_account':
      return 'original_account_rule';
    case 'cost_center':
      return 'cost_center_rule';
    case 'keyword':
    case 'payment_channel':
    case 'amount_pattern':
      return 'keyword_rule';
  }
}

/* ─────────── Criação de regra a partir de confirmação ─────────── */

let ruleCounter = 0;
/** Gera um id estável dentro do processo. Sufixo monotônico previne colisão
 *  em geração em lote. */
function nextRuleId(companyId: string): string {
  ruleCounter += 1;
  return `rule_${companyId}_${ruleCounter}`;
}

/**
 * Constrói uma `ClassificationRule` a partir de uma pendência confirmada
 * pelo dono. O tipo da regra é inferido do `exceptionReason` e dos sinais
 * agregados no grupo.
 *
 * `appliesToFutureTransactions` é sempre `true` nesta versão — confirmação
 * do dono é compromisso de regra futura. Se ele quiser limitar ao histórico,
 * pode editar a regra depois.
 *
 * Retorna `null` quando o grupo não tem informação suficiente para
 * derivar uma regra válida (ex: groupLabel vazio).
 */
export function createRuleFromOwnerConfirmation(
  groupedException: GroupedException,
  selectedCategoryCode: string,
  options: { now?: Date } = {},
): ClassificationRule | null {
  const ruleType = inferRuleType(groupedException);
  const pattern = groupedException.groupLabel.trim();
  if (pattern === '') return null;
  if (getCategoryByCode(selectedCategoryCode) === undefined) return null;

  const now = options.now ?? new Date();
  return {
    id: nextRuleId(groupedException.companyId),
    companyId: groupedException.companyId,
    ruleType,
    pattern,
    standardCategoryCode: selectedCategoryCode,
    appliesToFutureTransactions: true,
    createdBy: 'owner',
    confidenceBoost: 0.1,
    active: true,
    createdAt: now,
  };
}

/** Mapeia `exceptionReason` em um `RuleType` razoável. */
function inferRuleType(g: GroupedException): RuleType {
  switch (g.exceptionReason) {
    case 'unknown_counterparty':
    case 'card_payment_without_detail':
      return 'counterparty';
    case 'accounting_generic_account':
    case 'generic_original_category':
      return 'original_account';
    case 'bank_only_weak_description':
    case 'unmatched_bank_transaction':
    case 'low_confidence':
      return 'keyword';
    case 'possible_transfer':
    case 'possible_duplicate':
    case 'large_other_category':
    case 'receivables_advance':
    case 'loan_needs_breakdown':
    case 'refund_or_chargeback':
    case 'none':
      return 'keyword';
  }
}
