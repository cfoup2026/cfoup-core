import { describe, expect, it } from 'vitest';
import type {
  ClassificationRule,
  GroupedException,
} from '../../src/classification/index.js';
import {
  applyClassificationRules,
  classifyTransaction,
  createRuleFromOwnerConfirmation,
} from '../../src/classification/index.js';
import { makeTx, utcDate } from './fixtures/helpers.js';

const NOW = utcDate(2026, 4, 29);

describe('applyClassificationRules', () => {
  it('regra por contraparte aplica e atinge confidence high', () => {
    const tx = makeTx({
      id: 'cr_1',
      direction: 'outflow',
      amount: 1500,
      counterpartyName: 'Posto Shell BR',
      description: 'pagamento aleatório',
    });
    const rule: ClassificationRule = {
      id: 'r_1',
      companyId: 'co_test_001',
      ruleType: 'counterparty',
      pattern: 'Posto Shell',
      standardCategoryCode: 'OUT_REPAIR_MAINTENANCE',
      appliesToFutureTransactions: true,
      createdBy: 'owner',
      confidenceBoost: 0.1,
      active: true,
      createdAt: NOW,
    };
    const r = applyClassificationRules(tx, [rule]);
    expect(r).not.toBeNull();
    expect(r!.standardCategoryCode).toBe('OUT_REPAIR_MAINTENANCE');
    expect(r!.bucket).toBe('despesas_operacionais');
    expect(r!.classificationMethod).toBe('owner_confirmed');
    expect(r!.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('regra por keyword bate contra description', () => {
    const tx = makeTx({
      id: 'cr_2',
      direction: 'outflow',
      amount: 1000,
      description: 'Mensalidade do clube empresarial XYZ',
    });
    const rule: ClassificationRule = {
      id: 'r_2',
      companyId: 'co_test_001',
      ruleType: 'keyword',
      pattern: 'mensalidade do clube',
      standardCategoryCode: 'OUT_BENEFITS',
      appliesToFutureTransactions: true,
      createdBy: 'admin',
      confidenceBoost: 0,
      active: true,
    };
    const r = applyClassificationRules(tx, [rule]);
    expect(r!.standardCategoryCode).toBe('OUT_BENEFITS');
  });

  it('regra inativa não é aplicada', () => {
    const tx = makeTx({
      id: 'cr_3',
      direction: 'outflow',
      counterpartyName: 'Posto Shell',
    });
    const rule: ClassificationRule = {
      id: 'r_3',
      companyId: 'co_test_001',
      ruleType: 'counterparty',
      pattern: 'Posto Shell',
      standardCategoryCode: 'OUT_REPAIR_MAINTENANCE',
      appliesToFutureTransactions: true,
      createdBy: 'owner',
      confidenceBoost: 0.1,
      active: false,
    };
    expect(applyClassificationRules(tx, [rule])).toBeNull();
  });

  it('regra por amount_pattern bate exato', () => {
    const tx = makeTx({
      id: 'cr_4',
      direction: 'outflow',
      amount: 1234.56,
    });
    const rule: ClassificationRule = {
      id: 'r_4',
      companyId: 'co_test_001',
      ruleType: 'amount_pattern',
      pattern: '1234,56',
      standardCategoryCode: 'OUT_RENT',
      appliesToFutureTransactions: true,
      createdBy: 'system',
      confidenceBoost: 0,
      active: true,
    };
    const r = applyClassificationRules(tx, [rule]);
    expect(r!.standardCategoryCode).toBe('OUT_RENT');
  });

  it('regra é prioritária sobre heurística — classifyTransaction respeita', () => {
    const tx = makeTx({
      id: 'cr_5',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 500,
      description: 'Aluguel comercial mensal', // bateria em OUT_RENT pela heurística
    });
    const rule: ClassificationRule = {
      id: 'r_5',
      companyId: 'co_test_001',
      ruleType: 'keyword',
      pattern: 'aluguel comercial',
      standardCategoryCode: 'OUT_PROFESSIONAL_FEES', // categoria errada de propósito
      appliesToFutureTransactions: true,
      createdBy: 'owner',
      confidenceBoost: 0,
      active: true,
    };
    const r = classifyTransaction(tx, { rules: [rule] });
    expect(r.standardCategoryCode).toBe('OUT_PROFESSIONAL_FEES');
  });
});

describe('createRuleFromOwnerConfirmation', () => {
  it('cria regra a partir de pendência confirmada pelo dono', () => {
    const exc: GroupedException = {
      id: 'exc_1',
      companyId: 'co_test_001',
      exceptionReason: 'card_payment_without_detail',
      groupLabel: 'AMERICAN EXPRESS',
      transactionIds: ['t1', 't2'],
      totalAmount: 12500,
      count: 2,
      confidenceScore: 0.55,
      requiresOwnerAction: true,
    };
    const rule = createRuleFromOwnerConfirmation(exc, 'OUT_CARD_PAYMENT', {
      now: NOW,
    });
    expect(rule).not.toBeNull();
    expect(rule!.ruleType).toBe('counterparty');
    expect(rule!.standardCategoryCode).toBe('OUT_CARD_PAYMENT');
    expect(rule!.appliesToFutureTransactions).toBe(true);
    expect(rule!.createdBy).toBe('owner');
    expect(rule!.active).toBe(true);
    expect(rule!.confidenceBoost).toBeGreaterThan(0);
  });

  it('rejeita categoria inexistente', () => {
    const exc: GroupedException = {
      id: 'exc_2',
      companyId: 'co_test_001',
      exceptionReason: 'unknown_counterparty',
      groupLabel: 'Fornecedor Novo',
      transactionIds: ['t1'],
      totalAmount: 100,
      count: 1,
      confidenceScore: 0.4,
      requiresOwnerAction: true,
    };
    expect(
      createRuleFromOwnerConfirmation(exc, 'CODIGO_INEXISTENTE'),
    ).toBeNull();
  });

  it('rejeita groupLabel vazio', () => {
    const exc: GroupedException = {
      id: 'exc_3',
      companyId: 'co_test_001',
      exceptionReason: 'low_confidence',
      groupLabel: '   ',
      transactionIds: ['t1'],
      totalAmount: 100,
      count: 1,
      confidenceScore: 0.4,
      requiresOwnerAction: true,
    };
    expect(createRuleFromOwnerConfirmation(exc, 'OUT_OTHER')).toBeNull();
  });

  it('regra criada aplica a transação futura igual à do grupo', () => {
    const exc: GroupedException = {
      id: 'exc_4',
      companyId: 'co_test_001',
      exceptionReason: 'card_payment_without_detail',
      groupLabel: 'AMERICAN EXPRESS',
      transactionIds: ['t1'],
      totalAmount: 5000,
      count: 1,
      confidenceScore: 0.55,
      requiresOwnerAction: true,
    };
    const rule = createRuleFromOwnerConfirmation(exc, 'OUT_CARD_PAYMENT')!;
    const futureTx = makeTx({
      id: 'future_1',
      direction: 'outflow',
      amount: 7500,
      counterpartyName: 'AMERICAN EXPRESS',
    });
    const r = applyClassificationRules(futureTx, [rule]);
    expect(r).not.toBeNull();
    expect(r!.standardCategoryCode).toBe('OUT_CARD_PAYMENT');
  });
});
