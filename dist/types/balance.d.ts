/**
 * Saldo informativo extraído de um extrato. Não é movimentação:
 * representa um snapshot de saldo num momento, seja saldo de fim de dia
 * (CEF TXT) ou saldo intermediário entre transações (PDF de extrato).
 */
export interface BalanceSnapshot {
    /** Conta a que este saldo pertence. */
    accountId: string;
    /** Data/hora do saldo, sempre em UTC. */
    date: Date;
    /** Valor do saldo. Pode ser negativo (cheque especial). */
    amount: number;
    /** Origem do snapshot. */
    source: BalanceSource;
}
export type BalanceSource = 'bank-statement';
//# sourceMappingURL=balance.d.ts.map