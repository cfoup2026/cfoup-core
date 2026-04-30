/* Tipos */
export type {
  AccountCodeHintMap,
  AccountingTranslation,
  Bucket,
  ClassificationMethod,
  ClassificationResult,
  ClassificationRule,
  ClassificationStatus,
  ConfidenceLevel,
  CreatedBy,
  Direction,
  ExceptionReason,
  GroupedException,
  MacroClass,
  PaymentChannel,
  ReconciliationMatch,
  ReconciliationMatchReason,
  ReconciliationMatchType,
  ReconciliationStatus,
  RuleType,
  SourceSystem,
  SourceTransaction,
  StandardCategory,
  StandardCategoryCode,
} from './types.js';

/* Configuração imutável */
export { BUCKETS, BUCKETS_ORDERED } from './buckets.js';
export {
  STANDARD_CATEGORIES,
  getBucketForCategory,
  getCategoryByCode,
} from './categories.js';
export { ACCOUNTING_TRANSLATIONS } from './accounting-translations.js';

/* Motor */
export type { ClassificationOptions } from './classify.js';
export {
  calculateConfidenceLevel,
  classifyTransaction,
  detectCardPaymentWithoutDetail,
  detectGenericCategory,
  detectTransfer,
  normalizeText,
  normalizeTransaction,
  translateAccountingTransaction,
} from './classify.js';

/* Reconciliação */
export type {
  BatchMatchOptions,
  ReconcileOptions,
} from './reconciliation.js';
export {
  findBatchMatch,
  reconcileBankTransaction,
} from './reconciliation.js';

/* Exceções */
export { groupClassificationExceptions } from './exceptions.js';

/* Regras */
export {
  applyClassificationRules,
  createRuleFromOwnerConfirmation,
} from './rules.js';
