import type { Receivable } from '../../../src/types/index.js';

const utcDate = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

/**
 * 4 Receivables representativos:
 *  1) Em aberto futuro        → confirmado.
 *  2) Recebido no prazo       → realizado, paidAt === dueDate.
 *  3) Recebido em atraso      → realizado, paidAt > dueDate.
 *  4) Em aberto, vencido      → confirmado, dueDate < hoje.
 */
export const RECEIVABLES_FIXTURE: Receivable[] = [
  {
    id: 'fkn-ar:1',
    dueDate: utcDate(2026, 5, 20),
    dueDateSource: 'explicit',
    customerCode: 1001,
    customerName: 'Cliente Alpha LTDA',
    docNumber: 'NF-12001/01',
    installmentId: '1',
    branch: 1,
    amount: 4250,
    amountPaid: 0,
    issuedAt: utcDate(2026, 4, 20),
    paidAt: null,
    daysLate: 0,
    paymentMethod: 'BOLETO',
    documentType: 'DM',
    bankRef: '',
    status: 'open',
  },
  {
    id: 'fkn-ar:2',
    dueDate: utcDate(2026, 4, 28),
    dueDateSource: 'explicit',
    customerCode: 1002,
    customerName: 'Cliente Beta SA',
    docNumber: 'NF-12015/01',
    installmentId: '1',
    branch: 1,
    amount: 9800,
    amountPaid: 9800,
    issuedAt: utcDate(2026, 3, 29),
    paidAt: utcDate(2026, 4, 28),
    daysLate: 0,
    paymentMethod: 'PIX',
    documentType: 'DM',
    bankRef: '',
    status: 'paid',
  },
  {
    // :3 — recebido em SÁBADO (2026-04-25). Prova que `realizado` mantém
    // data_esperada=data_realizada SEM passar por calendário (§7.1).
    id: 'fkn-ar:3',
    dueDate: utcDate(2026, 4, 15),
    dueDateSource: 'explicit',
    customerCode: 1003,
    customerName: 'Cliente Gamma',
    docNumber: 'NF-12030/01',
    installmentId: '1',
    branch: 1,
    amount: 1500,
    amountPaid: 1500,
    issuedAt: utcDate(2026, 3, 16),
    paidAt: utcDate(2026, 4, 25),
    daysLate: 10,
    paymentMethod: 'TED',
    documentType: 'DM',
    bankRef: '',
    status: 'paid',
  },
  {
    id: 'fkn-ar:4',
    dueDate: utcDate(2026, 4, 1),
    dueDateSource: 'inferred_from_issue_date',
    customerCode: 1004,
    customerName: 'Cliente Delta ME',
    docNumber: '',
    installmentId: '1',
    branch: 1,
    amount: 670,
    amountPaid: 0,
    issuedAt: utcDate(2026, 4, 1),
    paidAt: null,
    daysLate: 29,
    paymentMethod: 'CARTEIRA',
    documentType: 'DM',
    bankRef: '',
    status: 'open',
  },
];
