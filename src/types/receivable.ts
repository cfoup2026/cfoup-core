import type { PaymentStatus } from './payable.js';

/**
 * Origem do `dueDate` de um Receivable. Crucial pra consumidores
 * downstream (relatórios de vencidos, fluxo 13s, alertas) decidirem
 * se devem tratar a data como vencimento real ou aproximação.
 *
 * Princípio: dado inferido nunca pode ser indistinguível de dado original.
 *
 * - 'explicit': VCTO veio do extrato como data válida.
 * - 'inferred_from_issue_date': VCTO='A VISTA' (ou outro marcador
 *   equivalente); o parser usou `issuedAt` como fallback.
 */
export type DueDateSource = 'explicit' | 'inferred_from_issue_date';

/**
 * Conta a receber individual extraída de um relatório AR.
 * Datas sempre em UTC. `amount` e `amountPaid` sempre não-negativos
 * (sinais virtuais vivem no campo `status`, não em `amount`).
 */
export interface Receivable {
  /** Identificador estável dentro do parser (não persistente entre execuções). */
  id: string;
  /** Data de vencimento. Quando VCTO='A VISTA', vira `issuedAt`. */
  dueDate: Date;
  /** Origem do `dueDate`: explícito do extrato ou inferido. */
  dueDateSource: DueDateSource;
  /** Código do cliente (COD. no relatório FKN). */
  customerCode: number;
  /** Nome do cliente (CLIENTE), conforme veio no relatório. */
  customerName: string;
  /** Número/identificador da duplicata (DUPLIC.), preservado raw. */
  docNumber: string;
  /** Identificador interno da parcela (ID), preservado raw. */
  installmentId: string;
  /** Filial (FIL). */
  branch: number;
  /** Valor original da duplicata. */
  amount: number;
  /** Valor efetivamente recebido. */
  amountPaid: number;
  /** Data de emissão da duplicata (EMIS). */
  issuedAt: Date;
  /** Data de pagamento (PGTO). Null quando ainda em aberto. */
  paidAt: Date | null;
  /** Dias de atraso (ATR), conforme reportado. */
  daysLate: number;
  /** Forma de pagamento (PORTADOR). */
  paymentMethod: string;
  /** Tipo do título (TIP), preservado raw (ex: códigos do banco). */
  documentType: string;
  /** Identificação bancária do título (NOSSO NRO / BCO), preservada raw. */
  bankRef: string;
  /** Status calculado a partir de amount vs amountPaid. */
  status: PaymentStatus;
}
