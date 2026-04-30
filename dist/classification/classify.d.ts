import { getBucketForCategory } from './categories.js';
import type { AccountCodeHintMap, ClassificationResult, ClassificationRule, ConfidenceLevel, SourceTransaction } from './types.js';
/** Opções de execução do motor. */
export interface ClassificationOptions {
    /** Regras da empresa, aplicadas com prioridade máxima. */
    rules?: readonly ClassificationRule[];
    /** Quando o banco já casou em reconciliação, herda a categoria do CR/CP
     *  associado — evita classificar duas vezes a mesma realidade econômica. */
    reconciliationCategoryCode?: string;
    /** Mapa externo de hints por `originalAccountCode`. Sinal de
     *  classificação adicional, opcional. Sem este campo o motor mantém
     *  o comportamento de fallback inalterado. */
    accountCodeHints?: AccountCodeHintMap;
}
/** Lowercase + remoção de acentos. Para comparações case-insensitive. */
export declare function normalizeText(s: string): string;
/**
 * Versão normalizada de uma `SourceTransaction`. Não altera o original
 * — devolve uma cópia com os campos textuais relevantes em forma comparável.
 *
 * Útil para inspeção/teste; o motor usa `normalizeText()` internamente
 * conforme precisa, sem persistir a versão normalizada.
 */
export declare function normalizeTransaction(transaction: SourceTransaction): {
    description: string | null;
    counterpartyName: string | null;
    originalAccountName: string | null;
    originalCategory: string | null;
    originalGroupName: string | null;
    originalSubgroupName: string | null;
};
/** Faixa qualitativa derivada do `confidenceScore`. */
export declare function calculateConfidenceLevel(score: number): ConfidenceLevel;
/**
 * Verdadeiro quando a classificação original é genérica (não acionável).
 * Comparação case-insensitive e sem acentos.
 */
export declare function detectGenericCategory(transaction: SourceTransaction): boolean;
/** Verdadeiro quando a transação é movimentação entre contas próprias. */
export declare function detectTransfer(transaction: SourceTransaction): boolean;
/**
 * Verdadeiro para saídas de cartão sem detalhe — counterparty é
 * emissor/processadora ou descrição é "pagamento de fatura" sem categoria.
 */
export declare function detectCardPaymentWithoutDetail(transaction: SourceTransaction): boolean;
/**
 * Traduz uma transação contábil para linguagem de dono.
 *
 * NUNCA atribui `standardCategoryCode` — dado contábil não vira categoria
 * standard. Sempre `status: 'translated'`, `originalLabelPreserved: true`,
 * `classificationMethod: 'accounting_translation'`.
 *
 * Conta genérica e relevante (`requiresBreakdown`) marca
 * `requiresOwnerConfirmation: true` e `exceptionReason: 'accounting_generic_account'`.
 */
export declare function translateAccountingTransaction(transaction: SourceTransaction): ClassificationResult;
/**
 * Classifica uma transação. Pura, síncrona, nunca lança.
 *
 * Ordem de prioridade:
 *  1. Regras explícitas da empresa (sempre ganham).
 *  2. `accounting` → tradução, nunca categoria standard.
 *  3. Transferência entre contas próprias (cross-cutting).
 *  4. Reconciliação prévia (banco) — herda categoria.
 *  5. Cartão sem detalhe → pendência `card_payment_without_detail`.
 *  6. AR → IN_CUSTOMER_RECEIPT/ADVANCE.
 *  7. Sales → IN_INVOICED_REVENUE (inflow) ou OUT_REFUND_CUSTOMER (return).
 *  8. Account code hints (`accountCodeHints`) sobre `originalAccountCode`.
 *  9. Heurísticas por keyword (AP/ERP/manual/bank).
 * 10. Genérico relevante → pendência (com ou sem categoria sugerida).
 * 11. Banco sem match → pendência `unmatched_bank_transaction`.
 * 12. Fallback final → IN_OTHER/OUT_OTHER.
 *
 * Sempre retorna `bucket` derivado do código quando há código atribuído,
 * `null` em pendências sem categoria.
 */
export declare function classifyTransaction(transaction: SourceTransaction, options?: ClassificationOptions): ClassificationResult;
export { getBucketForCategory };
//# sourceMappingURL=classify.d.ts.map