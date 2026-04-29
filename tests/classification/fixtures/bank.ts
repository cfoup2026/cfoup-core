import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/**
 * 8 transações bancárias cobrindo recebimento de cliente (TED), depósito
 * agrupado (batch), pagamento Amex sem detalhe, transferência entre
 * contas, tarifa, juros, fornecedor, valor não conciliado.
 */
export const BANK_FIXTURES: readonly SourceTransaction[] = [
  // 1) TED de cliente — alvo de reconciliação 1:1.
  makeTx({
    id: 'bnk_001',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 14),
    direction: 'inflow',
    amount: 4250.0,
    counterpartyName: 'Cliente Alpha LTDA',
    description: 'TED RECEBIDA CLIENTE ALPHA',
    paymentChannel: 'ted',
    documentNumber: 'NF-12001/01',
  }),
  // 2) Depósito agrupado (3 títulos: 30 + 30 + 40 = 100).
  makeTx({
    id: 'bnk_002',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 16),
    direction: 'inflow',
    amount: 100.0,
    counterpartyName: 'Depósito agrupado',
    description: 'Depósito de boletos compensados',
    paymentChannel: 'deposit',
  }),
  // 3) Pagamento American Express — sem detalhe → pendência.
  makeTx({
    id: 'bnk_003',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 20),
    direction: 'outflow',
    amount: 12500.0,
    counterpartyName: 'AMERICAN EXPRESS',
    description: 'PAGAMENTO DE FATURA CARTAO AMEX',
    paymentChannel: 'transfer',
  }),
  // 4) Transferência entre contas próprias.
  makeTx({
    id: 'bnk_004',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 11),
    direction: 'outflow',
    amount: 25000.0,
    counterpartyName: 'CFOup Demo LTDA',
    description: 'Transferência entre contas próprias — Itaú/Bradesco',
    paymentChannel: 'transfer',
  }),
  // 5) Tarifa bancária.
  makeTx({
    id: 'bnk_005',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 1),
    direction: 'outflow',
    amount: 89.9,
    description: 'Tarifa bancária mensal — cesta de serviços',
    paymentChannel: 'transfer',
  }),
  // 6) Juros de empréstimo.
  makeTx({
    id: 'bnk_006',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 25),
    direction: 'outflow',
    amount: 1850.0,
    counterpartyName: 'Banco do Brasil',
    description: 'Juros de empréstimo — capital de giro',
    paymentChannel: 'transfer',
  }),
  // 7) Fornecedor de mercadoria.
  makeTx({
    id: 'bnk_007',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 12),
    direction: 'outflow',
    amount: 18900.0,
    counterpartyName: 'Distribuidora Sigma',
    description: 'Pagamento fornecedor direto — boleto NF 8821',
    paymentChannel: 'boleto',
    documentNumber: 'NF-8821',
  }),
  // 8) Valor não conciliado, descrição fraca.
  makeTx({
    id: 'bnk_008',
    sourceSystem: 'bank',
    transactionDate: utcDate(2026, 4, 17),
    direction: 'outflow',
    amount: 540.0,
    description: 'Pagamento diverso',
    paymentChannel: 'pix',
  }),
];
