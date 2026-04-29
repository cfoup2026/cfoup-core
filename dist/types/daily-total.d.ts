/**
 * Linha de totalização diária presente em relatórios FKN
 * (TOTAL DO DIA.....:). A `date` é inferida pelo parser a partir
 * da data dos Payables que precedem a linha de total no relatório.
 */
export interface DailyTotal {
    /** Data de referência (inferida da última data vista). */
    date: Date;
    /** Total devido no dia. */
    totalDue: number;
    /** Total efetivamente pago no dia. */
    totalPaid: number;
    /** Tipo de relatório que originou esse total. */
    accountType: 'AP' | 'AR';
}
//# sourceMappingURL=daily-total.d.ts.map