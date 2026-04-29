import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/**
 * 5 títulos de Contas a Pagar (mínimo do prompt):
 *  - fornecedor direto, folha, aluguel, DAS, despesa diversa.
 *
 * Mais entradas vivem em testes inline (`classify.test.ts`) pra não inflar
 * fixtures que servem como documentação.
 */
export const AP_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'ap_001',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 10),
    dueDate: utcDate(2026, 4, 20),
    direction: 'outflow',
    amount: 18900.0,
    counterpartyName: 'Distribuidora Sigma',
    originalCategory: 'Fornecedor direto de mercadoria',
    originalAccountName: 'Compras de mercadoria',
  }),
  makeTx({
    id: 'ap_002',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 5),
    dueDate: utcDate(2026, 4, 5),
    direction: 'outflow',
    amount: 28500.0,
    counterpartyName: 'Folha CLT',
    originalCategory: 'Folha de pagamento mensal',
    originalAccountName: 'Salário CLT',
  }),
  makeTx({
    id: 'ap_003',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 1),
    dueDate: utcDate(2026, 4, 5),
    direction: 'outflow',
    amount: 8500.0,
    counterpartyName: 'Imobiliária Omega',
    originalCategory: 'Aluguel comercial',
    originalAccountName: 'Aluguel',
  }),
  makeTx({
    id: 'ap_004',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 18),
    dueDate: utcDate(2026, 4, 20),
    direction: 'outflow',
    amount: 4750.0,
    counterpartyName: 'Receita Federal',
    originalCategory: 'DAS Simples Nacional',
    originalAccountName: 'Impostos sobre venda',
  }),
  makeTx({
    id: 'ap_005',
    sourceSystem: 'accounts_payable',
    transactionDate: utcDate(2026, 4, 22),
    direction: 'outflow',
    amount: 320.0,
    counterpartyName: 'Diversos',
    originalCategory: 'Despesas diversas',
    originalAccountName: 'Despesas diversas',
  }),
];
