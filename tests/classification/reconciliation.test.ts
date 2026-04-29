import { describe, expect, it } from 'vitest';
import type {
  ReconciliationMatch,
  ReconciliationMatchType,
} from '../../src/classification/index.js';
import {
  findBatchMatch,
  reconcileBankTransaction,
} from '../../src/classification/index.js';
import { makeTx, utcDate } from './fixtures/helpers.js';

/* ─────────── matchType ─────────── */

describe('ReconciliationMatchType — cada tipo cobre ≥ 1 teste', () => {
  it('one_to_one — mesmo valor + mesma data', () => {
    const bank = makeTx({
      id: 'b1',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 1000,
    });
    const candidate = makeTx({
      id: 'c1',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 1000,
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m).not.toBeNull();
    expect(m!.matchType).toBe<ReconciliationMatchType>('one_to_one');
  });

  it('one_to_many — soma de candidatos bate com bancário', () => {
    const bank = makeTx({
      id: 'b2',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 16),
      direction: 'inflow',
      amount: 100,
    });
    const candidates = [
      makeTx({
        id: 'c2a',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 16),
        direction: 'inflow',
        amount: 30,
      }),
      makeTx({
        id: 'c2b',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 16),
        direction: 'inflow',
        amount: 30,
      }),
      makeTx({
        id: 'c2c',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 16),
        direction: 'inflow',
        amount: 40,
      }),
    ];
    const m = reconcileBankTransaction(bank, candidates);
    expect(m).not.toBeNull();
    expect(m!.matchType).toBe<ReconciliationMatchType>('one_to_many');
    expect(m!.matchedTransactionIds).toHaveLength(3);
  });

  it('many_to_one — múltiplos bancários para um candidato (via findBatchMatch reverso)', () => {
    const candidate = makeTx({
      id: 'cm',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 16),
      direction: 'inflow',
      amount: 100,
    });
    const banks = [
      makeTx({
        id: 'bm1',
        sourceSystem: 'bank',
        transactionDate: utcDate(2026, 4, 16),
        direction: 'inflow',
        amount: 60,
      }),
      makeTx({
        id: 'bm2',
        sourceSystem: 'bank',
        transactionDate: utcDate(2026, 4, 16),
        direction: 'inflow',
        amount: 40,
      }),
    ];
    const m = findBatchMatch(candidate, banks, { matchType: 'many_to_one' });
    expect(m).not.toBeNull();
    expect(m!.matchType).toBe<ReconciliationMatchType>('many_to_one');
  });

  it('many_to_many — válido no domínio (construção manual)', () => {
    // V1 do motor não emite many_to_many automaticamente — split heterogêneo
    // é V2. Aqui só validamos que o tipo é aceito e construível.
    const m: ReconciliationMatch = {
      id: 'm_n2n',
      companyId: 'co',
      bankTransactionId: 'b_multi',
      matchedTransactionIds: ['c1', 'c2'],
      matchType: 'many_to_many',
      amountMatched: 200,
      amountDifference: 0,
      confidenceScore: 0.6,
      matchReason: 'manual_owner_match',
      status: 'needs_confirmation',
    };
    expect(m.matchType).toBe<ReconciliationMatchType>('many_to_many');
  });

  it('partial — counterparty bate, valor próximo mas não exato (>1% e ≤5%)', () => {
    const bank = makeTx({
      id: 'b_partial',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 1),
      direction: 'outflow',
      amount: 1000,
      counterpartyName: 'Distribuidora Sigma',
    });
    const candidate = makeTx({
      id: 'c_partial',
      sourceSystem: 'accounts_payable',
      transactionDate: utcDate(2026, 4, 30),
      direction: 'outflow',
      amount: 970, // 3% de diferença → partial
      counterpartyName: 'Distribuidora Sigma',
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m).not.toBeNull();
    expect(m!.matchType).toBe<ReconciliationMatchType>('partial');
    expect(m!.matchReason).toBe('counterparty_similarity');
  });
});

/* ─────────── matchReason ─────────── */

describe('ReconciliationMatchReason — cada motivo cobre ≥ 1 teste', () => {
  it('same_amount_same_date', () => {
    const bank = makeTx({
      id: 'r1b',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 4250,
    });
    const candidate = makeTx({
      id: 'r1c',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 4250,
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m!.matchReason).toBe('same_amount_same_date');
  });

  it('same_amount_near_date — ±3 dias', () => {
    const bank = makeTx({
      id: 'r2b',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 4250,
    });
    const candidate = makeTx({
      id: 'r2c',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 13),
      direction: 'inflow',
      amount: 4250,
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m!.matchReason).toBe('same_amount_near_date');
  });

  it('document_number_match — mesmo documentNumber + valor exato', () => {
    const bank = makeTx({
      id: 'r3b',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 5, 1),
      direction: 'inflow',
      amount: 4250,
      documentNumber: 'NF-12001/01',
    });
    const candidate = makeTx({
      id: 'r3c',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 4250,
      documentNumber: 'NF-12001/01',
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m!.matchReason).toBe('document_number_match');
  });

  it('counterparty_similarity — substring no nome, valor próximo', () => {
    const bank = makeTx({
      id: 'r4b',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 1),
      direction: 'outflow',
      amount: 1000,
      counterpartyName: 'Distribuidora Sigma',
    });
    const candidate = makeTx({
      id: 'r4c',
      sourceSystem: 'accounts_payable',
      transactionDate: utcDate(2026, 4, 30),
      direction: 'outflow',
      amount: 970,
      counterpartyName: 'Distribuidora Sigma',
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m!.matchReason).toBe('counterparty_similarity');
  });

  it('batch_total_match', () => {
    const bank = makeTx({
      id: 'r5b',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 16),
      direction: 'inflow',
      amount: 100,
    });
    const candidates = [
      makeTx({
        id: 'r5a',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 14),
        direction: 'inflow',
        amount: 30,
      }),
      makeTx({
        id: 'r5b2',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 14),
        direction: 'inflow',
        amount: 30,
      }),
      makeTx({
        id: 'r5c',
        sourceSystem: 'accounts_receivable',
        transactionDate: utcDate(2026, 4, 14),
        direction: 'inflow',
        amount: 40,
      }),
    ];
    const m = reconcileBankTransaction(bank, candidates);
    expect(m!.matchReason).toBe('batch_total_match');
  });

  it('manual_owner_match — válido no domínio (construção manual)', () => {
    const m: ReconciliationMatch = {
      id: 'mom',
      companyId: 'co',
      bankTransactionId: 'b',
      matchedTransactionIds: ['c'],
      matchType: 'one_to_one',
      amountMatched: 100,
      amountDifference: 0,
      confidenceScore: 1,
      matchReason: 'manual_owner_match',
      status: 'matched',
    };
    expect(m.matchReason).toBe('manual_owner_match');
  });
});

/* ─────────── Tolerância de 1% ─────────── */

describe('Tolerância de match', () => {
  it('diferença ≤ 1% é aceita como exato (one_to_one)', () => {
    const bank = makeTx({
      id: 'tol_1',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 1000,
    });
    const candidate = makeTx({
      id: 'tol_1c',
      sourceSystem: 'accounts_receivable',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'inflow',
      amount: 999, // 0,1% diferença
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m).not.toBeNull();
    expect(m!.matchType).toBe('one_to_one');
  });

  it('diferença > 5% (acima do partial) → null', () => {
    const bank = makeTx({
      id: 'tol_2',
      sourceSystem: 'bank',
      transactionDate: utcDate(2026, 4, 15),
      direction: 'outflow',
      amount: 1000,
      counterpartyName: 'Fornecedor Único',
    });
    const candidate = makeTx({
      id: 'tol_2c',
      sourceSystem: 'accounts_payable',
      transactionDate: utcDate(2026, 4, 1),
      direction: 'outflow',
      amount: 800, // 20% diferença
      counterpartyName: 'Fornecedor Único',
    });
    const m = reconcileBankTransaction(bank, [candidate]);
    expect(m).toBeNull();
  });

  it('lista vazia retorna null', () => {
    const bank = makeTx({
      id: 'empty',
      sourceSystem: 'bank',
      direction: 'inflow',
      amount: 100,
    });
    expect(reconcileBankTransaction(bank, [])).toBeNull();
  });
});

/* ─────────── findBatchMatch ─────────── */

describe('findBatchMatch — subset sum', () => {
  it('encontra subset exato', () => {
    const primary = makeTx({
      id: 'fb_p',
      sourceSystem: 'bank',
      direction: 'inflow',
      amount: 250,
    });
    const candidates = [
      makeTx({ id: 'fb_a', direction: 'inflow', amount: 100 }),
      makeTx({ id: 'fb_b', direction: 'inflow', amount: 150 }),
      makeTx({ id: 'fb_c', direction: 'inflow', amount: 75 }),
    ];
    const m = findBatchMatch(primary, candidates);
    expect(m).not.toBeNull();
    const ids = new Set(m!.matchedTransactionIds);
    expect(ids.has('fb_a')).toBe(true);
    expect(ids.has('fb_b')).toBe(true);
  });

  it('retorna null quando nenhum subset bate dentro da tolerância', () => {
    const primary = makeTx({
      id: 'fb_p2',
      sourceSystem: 'bank',
      direction: 'inflow',
      amount: 1000,
    });
    const candidates = [
      makeTx({ id: 'fb_x', direction: 'inflow', amount: 50 }),
      makeTx({ id: 'fb_y', direction: 'inflow', amount: 70 }),
    ];
    const m = findBatchMatch(primary, candidates);
    expect(m).toBeNull();
  });
});
