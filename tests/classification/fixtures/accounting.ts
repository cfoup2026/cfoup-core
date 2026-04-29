import type { SourceTransaction } from '../../../src/classification/index.js';
import { COMPANY_ID, makeTx, utcDate } from './helpers.js';

/**
 * 5 lançamentos contábeis cobrindo as principais traduções:
 * Disponibilidades, Fornecedores, Receita bruta, Despesas administrativas,
 * Despesas diversas (genérica que pede confirmação).
 */
export const ACCOUNTING_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'acc_001',
    companyId: COMPANY_ID,
    sourceSystem: 'accounting',
    transactionDate: utcDate(2026, 3, 31),
    direction: 'neutral',
    amount: 152340.55,
    originalAccountName: 'Disponibilidades',
    originalGroupName: 'Ativo Circulante',
  }),
  makeTx({
    id: 'acc_002',
    companyId: COMPANY_ID,
    sourceSystem: 'accounting',
    transactionDate: utcDate(2026, 3, 31),
    direction: 'neutral',
    amount: 87420.0,
    originalAccountName: 'Fornecedores',
    originalGroupName: 'Passivo Circulante',
  }),
  makeTx({
    id: 'acc_003',
    companyId: COMPANY_ID,
    sourceSystem: 'accounting',
    transactionDate: utcDate(2026, 3, 31),
    direction: 'inflow',
    amount: 412000.0,
    originalAccountName: 'Receita Bruta',
    originalGroupName: 'Receitas',
  }),
  makeTx({
    id: 'acc_004',
    companyId: COMPANY_ID,
    sourceSystem: 'accounting',
    transactionDate: utcDate(2026, 3, 31),
    direction: 'outflow',
    amount: 38500.0,
    originalAccountName: 'Despesas Administrativas',
    originalGroupName: 'Despesas',
  }),
  makeTx({
    id: 'acc_005',
    companyId: COMPANY_ID,
    sourceSystem: 'accounting',
    transactionDate: utcDate(2026, 3, 31),
    direction: 'outflow',
    amount: 12500.0,
    originalAccountName: 'Despesas Diversas',
    originalGroupName: 'Despesas',
  }),
];
