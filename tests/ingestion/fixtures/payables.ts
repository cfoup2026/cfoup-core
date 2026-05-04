import type { Payable } from '../../../src/types/index.js';

const utcDate = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

/**
 * 4 Payables representativos (fixture pequena, 10–50 linhas):
 *  1) Em aberto, futuro    → confirmado.
 *  2) Liquidado no prazo   → realizado, paidAt === dueDate.
 *  3) Liquidado em atraso  → realizado, paidAt > dueDate.
 *  4) Em aberto, atrasado  → confirmado, dueDate < hoje (status no parser='open').
 */
export const PAYABLES_FIXTURE: Payable[] = [
  {
    id: 'fkn-ap:1',
    dueDate: utcDate(2026, 5, 15),
    vendorCode: 12345,
    vendorName: 'Fornecedor Alpha LTDA',
    docNumber: 'NF 555',
    branch: 1,
    amount: 1500,
    amountPaid: 0,
    issuedAt: utcDate(2026, 4, 15),
    paidAt: null,
    daysLate: 0,
    paymentMethod: 'BOLETO',
    term: 30,
    status: 'open',
  },
  {
    id: 'fkn-ap:2',
    dueDate: utcDate(2026, 4, 30),
    vendorCode: 67890,
    vendorName: 'Fornecedor Beta SA',
    docNumber: 'NF 556',
    branch: 1,
    amount: 800.5,
    amountPaid: 800.5,
    issuedAt: utcDate(2026, 4, 1),
    paidAt: utcDate(2026, 4, 30),
    daysLate: 0,
    paymentMethod: 'PIX',
    term: 29,
    status: 'paid',
  },
  {
    // :3 — paga em SÁBADO (2026-04-18). Prova que `realizado` mantém
    // data_esperada=data_realizada SEM passar por calendário (regra §7.1).
    id: 'fkn-ap:3',
    dueDate: utcDate(2026, 4, 10),
    vendorCode: 11223,
    vendorName: 'Fornecedor Gamma',
    docNumber: 'NF 557',
    branch: 1,
    amount: 2100,
    amountPaid: 2100,
    issuedAt: utcDate(2026, 3, 11),
    paidAt: utcDate(2026, 4, 18),
    daysLate: 8,
    paymentMethod: 'TED',
    term: 30,
    status: 'paid',
  },
  {
    id: 'fkn-ap:4',
    dueDate: utcDate(2026, 4, 5),
    vendorCode: 33445,
    vendorName: 'Fornecedor Delta ME',
    docNumber: '',
    branch: 1,
    amount: 350,
    amountPaid: 0,
    issuedAt: utcDate(2026, 3, 5),
    paidAt: null,
    daysLate: 25,
    paymentMethod: 'BOLETO',
    term: 31,
    status: 'open',
  },
];
