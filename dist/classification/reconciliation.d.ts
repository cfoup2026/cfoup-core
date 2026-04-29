import type { ReconciliationMatch, SourceTransaction } from './types.js';
export interface ReconcileOptions {
    /** Tolerância em fração (0..1) pra match exato. Default 0.01 (1%). */
    exactTolerance?: number;
    /** Tolerância em fração pra match parcial. Default 0.05 (5%). */
    partialTolerance?: number;
}
/**
 * Tenta casar uma transação bancária contra candidatos (CR/CP).
 *
 * Ordem de prioridade (a primeira que casa ganha):
 *  1. Mesmo `documentNumber`.
 *  2. Mesmo valor + mesma data.
 *  3. Mesmo valor + data próxima (±3 dias).
 *  4. Soma de múltiplos candidatos = valor (batch).
 *  5. Contraparte parecida + valor próximo (parcial).
 *
 * Diferença ≤ `exactTolerance` (default 1%) → match exato.
 * Diferença > `exactTolerance` mas ≤ `partialTolerance` (default 5%) →
 * match parcial (matchType='partial').
 * Diferença > `partialTolerance` → sem match (`null`).
 */
export declare function reconcileBankTransaction(bankTransaction: SourceTransaction, candidates: readonly SourceTransaction[], options?: ReconcileOptions): ReconciliationMatch | null;
export interface BatchMatchOptions {
    /** Tolerância em fração (0..1). Default 0.01. */
    tolerance?: number;
    /**
     * Limite de candidatos a considerar na busca subset-sum (greedy).
     * Default 12 — combinatorial protection. Aumente para casos pesados.
     */
    maxCandidates?: number;
    /**
     * Em V1 a função produz `one_to_many` por padrão (1 banco = N candidatos).
     * Inverter pra `many_to_one` é uma escolha de quem chama, dependendo do
     * sentido em que está reconciliando. Default 'one_to_many'.
     */
    matchType?: 'one_to_many' | 'many_to_one';
}
/**
 * Encontra subset de candidatos cuja soma bate com `primary.amount`.
 *
 * Implementação V1 greedy/recursive (DFS com poda) limitada a
 * `maxCandidates` itens. Aceita pequena diferença parametrizável.
 *
 * **Limitação V1 (declarada no prompt):** split heterogêneo
 * (1 transação bancária = múltiplas naturezas distintas) é tratado como
 * `one_to_many` simples — natureza do match não é decomposta.
 *
 * Retorna `null` quando nenhum subset bate dentro da tolerância.
 */
export declare function findBatchMatch(primary: SourceTransaction, candidates: readonly SourceTransaction[], options?: BatchMatchOptions): ReconciliationMatch | null;
//# sourceMappingURL=reconciliation.d.ts.map