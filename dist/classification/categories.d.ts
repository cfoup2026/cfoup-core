import type { Bucket, StandardCategory } from './types.js';
/**
 * As 41 categorias internas do motor (camada interna, não visível ao dono).
 *
 * Os campos `affects*` são lidos pelos motores derivados:
 *  - DRE gerencial: `affectsRevenue`, `affectsGrossMargin`, `affectsEbitda`.
 *  - Fluxo 13 semanas: `affectsCashRunway`. Crítico em estoque — consumo
 *    e write-off não consomem caixa, só a compra (`OUT_INVENTORY_PURCHASE`).
 *  - Análise de dívida: `affectsDebt`.
 *  - Análise de retiradas: `affectsOwnerDistribution`.
 *  - Recorrência: `isRecurringCandidate`.
 *
 * `requiresBreakdown: true` força o dono a abrir a categoria quando relevante
 * (ex: "Outros" > 5% do total).
 */
export declare const STANDARD_CATEGORIES: readonly StandardCategory[];
/**
 * Recupera a categoria por código. Retorna `undefined` quando o código
 * não existe — chamadores devem decidir o fallback (tipicamente OUT_OTHER
 * ou IN_OTHER).
 */
export declare function getCategoryByCode(code: string): StandardCategory | undefined;
/**
 * Retorna o bucket de uma categoria por código. `null` quando a categoria
 * não tem bucket (pendências) ou quando o código é desconhecido.
 */
export declare function getBucketForCategory(code: string): Bucket | null;
//# sourceMappingURL=categories.d.ts.map