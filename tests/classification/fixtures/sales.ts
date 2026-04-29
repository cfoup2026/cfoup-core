import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/** 3 vendas com NF — alimentam classificação como receita. */
export const SALES_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'sal_001',
    sourceSystem: 'sales',
    transactionDate: utcDate(2026, 4, 12),
    direction: 'inflow',
    amount: 4250.0,
    counterpartyName: 'Cliente Alpha LTDA',
    documentNumber: 'NF-12001',
    originalCategory: 'Venda de mercadoria',
  }),
  makeTx({
    id: 'sal_002',
    sourceSystem: 'sales',
    transactionDate: utcDate(2026, 4, 14),
    direction: 'inflow',
    amount: 9800.0,
    counterpartyName: 'Cliente Beta SA',
    documentNumber: 'NF-12015',
    originalCategory: 'Venda de mercadoria',
  }),
  makeTx({
    id: 'sal_003',
    sourceSystem: 'sales',
    transactionDate: utcDate(2026, 4, 18),
    direction: 'inflow',
    amount: 7800.0,
    counterpartyName: 'Cliente Gamma',
    documentNumber: 'NF-12030',
    originalCategory: 'Venda de mercadoria',
    description: 'Liquidação adquirente Stone',
  }),
];
