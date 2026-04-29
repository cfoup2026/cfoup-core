import type { ClassificationResult, GroupedException, SourceTransaction } from './types.js';
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
export declare function groupClassificationExceptions(results: readonly ClassificationResult[], transactions: readonly SourceTransaction[]): GroupedException[];
//# sourceMappingURL=exceptions.d.ts.map