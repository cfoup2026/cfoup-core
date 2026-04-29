/** Movimentação financeira individual extraída de um extrato. */
export interface Transaction {
    /** Identificador estável dentro do parser (não persistente entre execuções). */
    id: string;
    /** Conta a que esta movimentação pertence. */
    accountId: string;
    /** Data do lançamento, sempre em UTC (00:00 do dia local do extrato). */
    date: Date;
    /** Número do documento conforme aparece no extrato. */
    docNumber: string;
    /** Histórico/descrição da movimentação. */
    history: string;
    /** Valor sempre positivo. O sinal vive em `direction`. */
    amount: number;
    /** Crédito (entrada) ou débito (saída). */
    direction: TransactionDirection;
    /** Saldo após esta movimentação, quando o extrato fornecer. */
    balance?: number;
}
export type TransactionDirection = 'credit' | 'debit';
//# sourceMappingURL=transaction.d.ts.map