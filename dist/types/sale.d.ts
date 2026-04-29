/** Tipo de movimento de uma linha do relatório de vendas. */
export type SaleMovementType = 'sale' | 'return' | 'cancellation';
/**
 * Origem do `movementType`. Mesmo princípio do `dueDateSource` em
 * Receivable: dado inferido nunca pode ser indistinguível de dado original.
 *
 * - 'explicit': o relatório trouxe coluna ou marca explícita.
 * - 'inferred_from_negative_amount': o parser inferiu 'return' porque
 *   VALOR NOTA veio negativo, sem coluna explícita de tipo.
 */
export type SaleMovementTypeSource = 'explicit' | 'inferred_from_negative_amount';
/**
 * Origem da `marginPercent`. Mesmo princípio: distinguir valor calculado
 * pelo sistema-fonte (FKN) de valor recomputado por nós ou indisponível.
 *
 * - 'from_csv': veio direto do CSV. NUNCA sobrescrever, mesmo que
 *   `amount`/`cost` permitiriam recalcular — preserva o arredondamento
 *   do FKN, que é o que aparece em relatórios oficiais.
 * - 'computed': o relatório não trouxe; calculamos via
 *   `(amount - cost) / amount * 100`.
 * - 'unavailable': o relatório não trouxe e dados (cost zero/ausente,
 *   amount zero) não permitem recalcular. `marginPercent` fica null.
 *   Sem chute, sem zero falso.
 */
export type MarginPercentSource = 'from_csv' | 'computed' | 'unavailable';
/**
 * Linha de venda individual de um relatório FKN de Vendas (uma nota fiscal).
 * Datas em UTC. `amount` e `cost` sempre não-negativos — sinal de devolução
 * vive em `movementType`.
 */
export interface Sale {
    /** Identificador estável dentro do parser. */
    id: string;
    /** Data de emissão da nota (DATA), UTC. */
    issuedAt: Date;
    /** Código do cliente, herdado do header `CLIENTE:` que precede a venda. */
    customerCode: number;
    /** Nome do cliente, herdado do header `CLIENTE:` (raw, com espaços/parênteses). */
    customerName: string;
    /** Número da nota (NOTA), preservado raw — preserva leading zeros. */
    invoiceNumber: string;
    /** Vendedor (VENDEDOR), preservado raw. Ex: 'DIRETA', 'SITE'. */
    salesperson: string;
    /** Prazo de pagamento (PRAZO), texto livre, preservado raw. */
    paymentTerm: string;
    /** Valor da nota (VALOR NOTA), sempre não-negativo. */
    amount: number;
    /** Custo da nota (VALOR CUSTO), sempre não-negativo. */
    cost: number;
    /** Margem percentual (%LUC). Pode ser negativo (vendeu abaixo do custo). */
    marginPercent: number | null;
    /** Origem de `marginPercent`. */
    marginPercentSource: MarginPercentSource;
    /** Tipo de movimento. 'cancellation' reservado pra formatos futuros. */
    movementType: SaleMovementType;
    /** Origem de `movementType`. */
    movementTypeSource: SaleMovementTypeSource;
    /** Colunas originais tokenizadas, preservadas pra debug e auditoria. */
    rawColumns: string[];
}
//# sourceMappingURL=sale.d.ts.map