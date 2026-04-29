import type { ClassificationResult, ClassificationRule, GroupedException, SourceTransaction } from './types.js';
/**
 * Aplica regras de uma empresa em ordem; retorna a primeira que casa.
 * Regras inativas são ignoradas. `confidenceBoost` soma ao score base
 * (cap em 1.0).
 *
 * O score base aqui é 0.85 — regra explícita tem confiança alta por
 * default. O `confidenceBoost` permite refinar (ex: regra criada após
 * confirmação do dono recebe boost = 0.10 → score 0.95).
 */
export declare function applyClassificationRules(transaction: SourceTransaction, rules: readonly ClassificationRule[]): ClassificationResult | null;
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
export declare function createRuleFromOwnerConfirmation(groupedException: GroupedException, selectedCategoryCode: string, options?: {
    now?: Date;
}): ClassificationRule | null;
//# sourceMappingURL=rules.d.ts.map