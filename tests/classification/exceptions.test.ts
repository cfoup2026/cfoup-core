import { describe, expect, it } from 'vitest';
import type {
  ClassificationResult,
  ExceptionReason,
  SourceTransaction,
} from '../../src/classification/index.js';
import { groupClassificationExceptions } from '../../src/classification/index.js';
import { makeTx, utcDate } from './fixtures/helpers.js';

/** Constrói um resultado pendente sintético com um motivo específico. */
function pendingResult(
  tx: SourceTransaction,
  reason: ExceptionReason,
  options: { code?: string } = {},
): ClassificationResult {
  const r: ClassificationResult = {
    sourceTransactionId: tx.id,
    companyId: tx.companyId,
    bucket: null,
    confidenceScore: 0.4,
    confidenceLevel: 'low',
    classificationMethod: 'fallback',
    originalLabelPreserved: true,
    requiresOwnerConfirmation: true,
    exceptionReason: reason,
    status: 'pending',
  };
  if (options.code !== undefined) r.standardCategoryCode = options.code;
  return r;
}

/* ─────────── Cada ExceptionReason (exceto 'none') agrupa ─────────── */

const REASON_CASES: ReadonlyArray<{
  reason: ExceptionReason;
  build: (i: number) => SourceTransaction;
}> = [
  {
    reason: 'generic_original_category',
    build: (i) =>
      makeTx({
        id: `gen_${i}`,
        direction: 'outflow',
        originalCategory: 'Despesas diversas',
      }),
  },
  {
    reason: 'unknown_counterparty',
    build: (i) =>
      makeTx({
        id: `unk_${i}`,
        direction: 'outflow',
        counterpartyName: 'Beneficiário Desconhecido',
      }),
  },
  {
    reason: 'bank_only_weak_description',
    build: (i) =>
      makeTx({
        id: `wk_${i}`,
        direction: 'outflow',
        sourceSystem: 'bank',
        description: 'pagamento diversos xyz',
      }),
  },
  {
    reason: 'possible_transfer',
    build: (i) =>
      makeTx({
        id: `pt_${i}`,
        direction: 'outflow',
        sourceSystem: 'bank',
        counterpartyName: 'CFOup Demo LTDA',
      }),
  },
  {
    reason: 'card_payment_without_detail',
    build: (i) =>
      makeTx({
        id: `cp_${i}`,
        direction: 'outflow',
        counterpartyName: 'AMERICAN EXPRESS',
      }),
  },
  {
    reason: 'possible_duplicate',
    build: (i) =>
      makeTx({
        id: `pd_${i}`,
        direction: 'outflow',
        documentNumber: 'DOC-9999',
      }),
  },
  {
    reason: 'unmatched_bank_transaction',
    build: (i) =>
      makeTx({
        id: `um_${i}`,
        direction: 'outflow',
        sourceSystem: 'bank',
        description: 'pagamento aleatório xyz',
      }),
  },
  {
    reason: 'large_other_category',
    build: (i) =>
      makeTx({
        id: `lo_${i}`,
        direction: 'outflow',
        originalCategory: 'Outros',
      }),
  },
  {
    reason: 'low_confidence',
    build: (i) =>
      makeTx({
        id: `lc_${i}`,
        direction: 'outflow',
        counterpartyName: 'Fornecedor Genérico',
      }),
  },
  {
    reason: 'accounting_generic_account',
    build: (i) =>
      makeTx({
        id: `ag_${i}`,
        direction: 'neutral',
        sourceSystem: 'accounting',
        originalAccountName: 'Despesas Diversas',
      }),
  },
  {
    reason: 'receivables_advance',
    build: (i) =>
      makeTx({
        id: `ra_${i}`,
        direction: 'inflow',
        sourceSystem: 'accounts_receivable',
        counterpartyName: 'Cliente Adiantado',
      }),
  },
  {
    reason: 'loan_needs_breakdown',
    build: (i) =>
      makeTx({
        id: `lb_${i}`,
        direction: 'inflow',
        sourceSystem: 'bank',
        counterpartyName: 'Banco do Brasil',
      }),
  },
  {
    reason: 'refund_or_chargeback',
    build: (i) =>
      makeTx({
        id: `rc_${i}`,
        direction: 'outflow',
        counterpartyName: 'Cliente Reclamação',
      }),
  },
];

describe('groupClassificationExceptions — cada ExceptionReason agrupa', () => {
  for (const { reason, build } of REASON_CASES) {
    it(`agrupa pendências de ${reason}`, () => {
      const tx = build(1);
      const result = pendingResult(tx, reason);
      const groups = groupClassificationExceptions([result], [tx]);
      expect(groups).toHaveLength(1);
      const g = groups[0]!;
      expect(g.exceptionReason).toBe(reason);
      expect(g.transactionIds).toEqual([tx.id]);
      expect(g.count).toBe(1);
      expect(g.requiresOwnerAction).toBe(true);
    });
  }
});

describe('groupClassificationExceptions — agregação', () => {
  it('mesma contraparte agrupa em um único grupo', () => {
    const txs = [1, 2, 3].map((i) =>
      makeTx({
        id: `cp_amex_${i}`,
        direction: 'outflow',
        counterpartyName: 'AMERICAN EXPRESS',
        amount: 100 * i,
      }),
    );
    const results = txs.map((t) =>
      pendingResult(t, 'card_payment_without_detail', { code: 'OUT_CARD_PAYMENT' }),
    );
    const groups = groupClassificationExceptions(results, txs);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.count).toBe(3);
    expect(g.totalAmount).toBe(600);
    expect(g.suggestedCategoryCode).toBe('OUT_CARD_PAYMENT');
  });

  it('descrição parecida agrupa quando o motivo é unmatched_bank_transaction', () => {
    const txs = [1, 2].map((i) =>
      makeTx({
        id: `wk_${i}`,
        direction: 'outflow',
        sourceSystem: 'bank',
        description: 'Pagamento diverso xyz',
        amount: 50 * i,
      }),
    );
    const results = txs.map((t) =>
      pendingResult(t, 'unmatched_bank_transaction'),
    );
    const groups = groupClassificationExceptions(results, txs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(2);
  });

  it('contrapartes diferentes geram grupos diferentes', () => {
    const tx1 = makeTx({
      id: 'cpa',
      direction: 'outflow',
      counterpartyName: 'AMERICAN EXPRESS',
    });
    const tx2 = makeTx({
      id: 'cpb',
      direction: 'outflow',
      counterpartyName: 'Bradesco Cartões',
    });
    const groups = groupClassificationExceptions(
      [
        pendingResult(tx1, 'card_payment_without_detail'),
        pendingResult(tx2, 'card_payment_without_detail'),
      ],
      [tx1, tx2],
    );
    expect(groups).toHaveLength(2);
  });

  it('classificados (status=classified) e exceptionReason=none são ignorados', () => {
    const tx = makeTx({ id: 'ok', direction: 'outflow' });
    const ok: ClassificationResult = {
      sourceTransactionId: tx.id,
      companyId: tx.companyId,
      standardCategoryCode: 'OUT_RENT',
      bucket: 'despesas_operacionais',
      confidenceScore: 0.92,
      confidenceLevel: 'high',
      classificationMethod: 'keyword_rule',
      originalLabelPreserved: true,
      requiresOwnerConfirmation: false,
      exceptionReason: 'none',
      status: 'classified',
    };
    expect(groupClassificationExceptions([ok], [tx])).toHaveLength(0);
  });

  it('sugestão é a categoria mais comum entre os resultados do grupo', () => {
    const tx1 = makeTx({
      id: 'sg1',
      direction: 'outflow',
      counterpartyName: 'Fornecedor Único',
    });
    const tx2 = makeTx({
      id: 'sg2',
      direction: 'outflow',
      counterpartyName: 'Fornecedor Único',
    });
    const tx3 = makeTx({
      id: 'sg3',
      direction: 'outflow',
      counterpartyName: 'Fornecedor Único',
    });
    const results = [
      pendingResult(tx1, 'low_confidence', { code: 'OUT_SUPPLIER_DIRECT' }),
      pendingResult(tx2, 'low_confidence', { code: 'OUT_SUPPLIER_DIRECT' }),
      pendingResult(tx3, 'low_confidence', { code: 'OUT_RENT' }),
    ];
    const groups = groupClassificationExceptions(results, [tx1, tx2, tx3]);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.suggestedCategoryCode).toBe('OUT_SUPPLIER_DIRECT');
    expect(g.suggestedBucket).toBe('custos_diretos');
  });
});
