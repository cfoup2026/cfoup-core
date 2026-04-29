import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/** 3 lançamentos com classificação genérica — viram pendência. */
export const GENERIC_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'gen_001',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 22),
    direction: 'outflow',
    amount: 320.0,
    originalCategory: 'Despesas diversas',
    originalAccountName: 'Despesas diversas',
  }),
  makeTx({
    id: 'gen_002',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 23),
    direction: 'outflow',
    amount: 950.0,
    originalCategory: 'Outros',
    originalAccountName: 'Outras despesas',
  }),
  makeTx({
    id: 'gen_003',
    sourceSystem: 'erp',
    transactionDate: utcDate(2026, 4, 25),
    direction: 'outflow',
    amount: 1340.0,
    originalCategory: 'Lançamentos gerais',
    originalAccountName: 'Outras despesas',
  }),
];
