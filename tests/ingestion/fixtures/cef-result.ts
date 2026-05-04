import type {
  BalanceSnapshot,
  Transaction,
} from '../../../src/types/index.js';

const utcDate = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

const ACCOUNT = '0423012920005778782426';

/**
 * Resultado de parser CEF (sintético) com:
 *  - 3 transações (1 entrada via TED, 2 saídas)
 *  - 2 BalanceSnapshots (1 saldo de abertura, 1 saldo de fim de dia)
 *
 * Pequena (sob 50 linhas) e cobre todos os casos do adapter CEF.
 */
export const CEF_TRANSACTIONS_FIXTURE: Transaction[] = [
  {
    id: 'cef-pdf:10',
    accountId: ACCOUNT,
    date: utcDate(2026, 4, 1),
    docNumber: '310325',
    history: 'TED RECEBIDA CLIENTE ALPHA',
    amount: 5964.52,
    direction: 'credit',
  },
  {
    id: 'cef-pdf:11',
    accountId: ACCOUNT,
    date: utcDate(2026, 4, 2),
    docNumber: '310401',
    history: 'PAGAMENTO BOLETO FORNECEDOR BETA',
    amount: 1200,
    direction: 'debit',
  },
  {
    id: 'cef-pdf:12',
    accountId: ACCOUNT,
    date: utcDate(2026, 4, 5),
    docNumber: '',
    history: 'TARIFA BANCARIA MENSAL',
    amount: 89.9,
    direction: 'debit',
  },
];

export const CEF_BALANCES_FIXTURE: BalanceSnapshot[] = [
  // Saldo de abertura (data anterior à 1ª transação).
  {
    accountId: ACCOUNT,
    date: utcDate(2026, 3, 31),
    amount: 12000,
    source: 'bank-statement',
  },
  // Saldo de fim de dia.
  {
    accountId: ACCOUNT,
    date: utcDate(2026, 4, 5),
    amount: 16674.62,
    source: 'bank-statement',
  },
];

export const CEF_RESULT_FIXTURE = {
  ok: CEF_TRANSACTIONS_FIXTURE,
  balances: CEF_BALANCES_FIXTURE,
};
