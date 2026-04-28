/** Status de pagamento de um Payable, calculado pelo parser. */
export type PaymentStatus = 'open' | 'partial' | 'paid' | 'overpaid';

/**
 * Conta a pagar individual extraída de um relatório AP.
 * Datas sempre em UTC. `amount` e `amountPaid` sempre não-negativos
 * (sinais virtuais vivem no campo `status`, não em `amount`).
 */
export interface Payable {
  /** Identificador estável dentro do parser (não persistente entre execuções). */
  id: string;
  /** Data de vencimento. Quando VCTO='A VISTA', vira `issuedAt`. */
  dueDate: Date;
  /** Código do fornecedor (CONTA no relatório FKN). */
  vendorCode: number;
  /** Nome do fornecedor (FORNECEDOR), conforme veio no relatório. */
  vendorName: string;
  /** Número/identificador do documento (DOCUM.), preservado raw. */
  docNumber: string;
  /** Filial (FIL). */
  branch: number;
  /** Valor original do título. */
  amount: number;
  /** Valor efetivamente pago. */
  amountPaid: number;
  /** Data de emissão do título (EMIS). */
  issuedAt: Date;
  /** Data de pagamento (PGTO). Null quando ainda em aberto. */
  paidAt: Date | null;
  /** Dias de atraso (ATR), conforme reportado. */
  daysLate: number;
  /** Forma de pagamento (PORTADOR). Ex: BOLETO, PIX, CHEQUE, DEP. C/C, DINHEIRO, CARTEIRA. */
  paymentMethod: string;
  /** Prazo em dias (PRZ). */
  term: number;
  /** Status calculado a partir de amount vs amountPaid. */
  status: PaymentStatus;
}
