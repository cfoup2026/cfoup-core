import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/**
 * 5 títulos de Contas a Receber:
 * 1) Recebido no prazo (paidDate <= dueDate)
 * 2) Atrasado (paidDate > dueDate)
 * 3) Adiantamento (originalCategory='adiantamento')
 * 4) Vencido em aberto (sem paidDate, dueDate < hoje)
 * 5) Parcelado (1 das parcelas, com paymentChannel='boleto')
 */
export const AR_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'ar_001',
    sourceSystem: 'accounts_receivable',
    transactionDate: utcDate(2026, 4, 1),
    dueDate: utcDate(2026, 4, 15),
    paidDate: utcDate(2026, 4, 14),
    direction: 'inflow',
    amount: 4250.0,
    counterpartyName: 'Cliente Alpha LTDA',
    documentNumber: 'NF-12001/01',
  }),
  makeTx({
    id: 'ar_002',
    sourceSystem: 'accounts_receivable',
    transactionDate: utcDate(2026, 3, 25),
    dueDate: utcDate(2026, 4, 5),
    paidDate: utcDate(2026, 4, 22),
    direction: 'inflow',
    amount: 9800.0,
    counterpartyName: 'Cliente Beta SA',
    documentNumber: 'NF-12015/01',
  }),
  makeTx({
    id: 'ar_003',
    sourceSystem: 'accounts_receivable',
    transactionDate: utcDate(2026, 4, 10),
    direction: 'inflow',
    amount: 1500.0,
    counterpartyName: 'Cliente Gamma',
    originalCategory: 'Adiantamento de cliente',
  }),
  makeTx({
    id: 'ar_004',
    sourceSystem: 'accounts_receivable',
    transactionDate: utcDate(2026, 3, 1),
    dueDate: utcDate(2026, 3, 30),
    direction: 'inflow',
    amount: 6700.0,
    counterpartyName: 'Cliente Delta ME',
    documentNumber: 'NF-11998/01',
  }),
  makeTx({
    id: 'ar_005',
    sourceSystem: 'accounts_receivable',
    transactionDate: utcDate(2026, 4, 5),
    dueDate: utcDate(2026, 5, 5),
    direction: 'inflow',
    amount: 2400.0,
    counterpartyName: 'Cliente Eta',
    documentNumber: 'NF-12099/02',
    paymentChannel: 'boleto',
  }),
];
