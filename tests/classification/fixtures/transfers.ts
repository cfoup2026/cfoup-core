import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/** 2 transferências entre contas próprias (saída e entrada). */
export const TRANSFER_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'trf_001',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 11),
    direction: 'outflow',
    amount: 25000.0,
    counterpartyName: 'CFOup Demo LTDA',
    description: 'Transferência entre contas próprias — Itaú',
    paymentChannel: 'transfer',
  }),
  makeTx({
    id: 'trf_002',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 11),
    direction: 'inflow',
    amount: 25000.0,
    counterpartyName: 'CFOup Demo LTDA',
    description: 'Transferência entre contas próprias — Bradesco',
    paymentChannel: 'transfer',
  }),
];
