import type { Bucket } from './types.js';
/**
 * Definição imutável dos 12 buckets visíveis ao dono.
 *
 *  - `label`: texto que aparece em telas e relatórios.
 *  - `order`: ordem natural pra renderização (1..12).
 *  - `isPosition: true` significa que o bucket representa saldo de títulos
 *    em aberto (não transações classificadas). Buckets com `isPosition: true`
 *    NÃO recebem categorias da `categories.ts` — são alimentados pelos
 *    relatórios de aging (CR/CP) diretamente.
 *
 * Mantenha esta tabela alinhada com a tabela do prompt do motor.
 * Qualquer mudança aqui é mudança de UI pública.
 */
export declare const BUCKETS: Record<Bucket, {
    label: string;
    order: number;
    isPosition: boolean;
}>;
/** Lista de buckets na ordem de renderização. */
export declare const BUCKETS_ORDERED: readonly Bucket[];
//# sourceMappingURL=buckets.d.ts.map