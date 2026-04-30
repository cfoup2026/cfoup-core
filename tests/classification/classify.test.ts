import { describe, expect, it } from 'vitest';
import type { Sale } from '../../src/types/index.js';
import type {
  AccountCodeHintMap,
  ClassificationResult,
  ClassificationStatus,
  SourceTransaction,
} from '../../src/classification/index.js';
import {
  STANDARD_CATEGORIES,
  calculateConfidenceLevel,
  classifyTransaction,
  detectCardPaymentWithoutDetail,
  detectGenericCategory,
  detectTransfer,
  getBucketForCategory,
  getCategoryByCode,
  normalizeText,
  normalizeTransaction,
  translateAccountingTransaction,
} from '../../src/classification/index.js';
import { ACCOUNTING_FIXTURES } from './fixtures/accounting.js';
import { AR_FIXTURES } from './fixtures/ar.js';
import { CARD_FIXTURES } from './fixtures/card.js';
import { GENERIC_FIXTURES } from './fixtures/generic.js';
import { TRANSFER_FIXTURES } from './fixtures/transfers.js';
import { makeTx, utcDate } from './fixtures/helpers.js';

/* ─────────── Casos de despacho por categoria ─────────── */

const CATEGORY_DISPATCH_CASES: ReadonlyArray<{
  code: string;
  build: () => SourceTransaction;
}> = [
  /* Inflows */
  {
    code: 'IN_CUSTOMER_RECEIPT',
    build: () =>
      makeTx({
        id: 'tc_in_recv',
        sourceSystem: 'accounts_receivable',
        direction: 'inflow',
        amount: 1000,
        paidDate: utcDate(2026, 4, 10),
        dueDate: utcDate(2026, 4, 15),
        counterpartyName: 'Cliente XYZ',
      }),
  },
  {
    code: 'IN_CUSTOMER_ADVANCE',
    build: () =>
      makeTx({
        id: 'tc_in_adv',
        sourceSystem: 'accounts_receivable',
        direction: 'inflow',
        amount: 1000,
        counterpartyName: 'Cliente Gamma',
        originalCategory: 'Adiantamento de cliente',
      }),
  },
  {
    code: 'IN_INVOICED_REVENUE',
    build: () =>
      makeTx({
        id: 'tc_in_invoiced',
        sourceSystem: 'sales',
        direction: 'inflow',
        amount: 4250,
        counterpartyName: 'Cliente Alpha LTDA',
        documentNumber: 'NF-12001',
      }),
  },
  {
    code: 'IN_CARD_SETTLEMENT',
    build: () =>
      makeTx({
        id: 'tc_in_card',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 7800,
        counterpartyName: 'Cielo',
        description: 'Cielo repasse — liquidação adquirente',
      }),
  },
  {
    code: 'IN_MARKETPLACE',
    build: () =>
      makeTx({
        id: 'tc_in_mkt',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 12000,
        counterpartyName: 'Mercado Livre',
        description: 'Mercado Livre repasse mensal',
      }),
  },
  {
    code: 'IN_LOAN',
    build: () =>
      makeTx({
        id: 'tc_in_loan',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 50000,
        counterpartyName: 'Banco do Brasil',
        description: 'Liberação empréstimo — capital de giro recebido',
      }),
  },
  {
    code: 'IN_OWNER_CAPITAL',
    build: () =>
      makeTx({
        id: 'tc_in_capital',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 100000,
        description: 'Aporte de capital sócio fundador',
      }),
  },
  {
    code: 'IN_REFUND',
    build: () =>
      makeTx({
        id: 'tc_in_refund',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 250,
        description: 'Reembolso recebido — devolução de fornecedor',
      }),
  },
  {
    code: 'IN_INVESTMENT_INCOME',
    build: () =>
      makeTx({
        id: 'tc_in_inv',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 480,
        description: 'Rendimento aplicação — CDB liquidez diária',
      }),
  },
  {
    code: 'IN_ASSET_SALE',
    build: () =>
      makeTx({
        id: 'tc_in_asset',
        sourceSystem: 'manual',
        direction: 'inflow',
        amount: 8500,
        description: 'Venda de imobilizado — empilhadeira usada',
      }),
  },
  {
    code: 'IN_TRANSFER',
    build: () =>
      makeTx({
        id: 'tc_in_transfer',
        sourceSystem: 'bank',
        direction: 'inflow',
        amount: 25000,
        description: 'Transferência entre contas próprias',
      }),
  },
  {
    code: 'IN_OTHER',
    build: () =>
      makeTx({
        id: 'tc_in_other',
        sourceSystem: 'manual',
        direction: 'inflow',
        amount: 100,
        description: 'Entrada aleatória sem padrão zzz',
      }),
  },

  /* Outflows */
  {
    code: 'OUT_SUPPLIER_DIRECT',
    build: () =>
      makeTx({
        id: 'tc_out_sup',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 5000,
        description: 'Compra direta fornecedor de mercadoria',
      }),
  },
  {
    code: 'OUT_SERVICE_DIRECT',
    build: () =>
      makeTx({
        id: 'tc_out_srv',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 4200,
        description: 'Subcontratação serviço — mão de obra terceirizada',
      }),
  },
  {
    code: 'OUT_PAYROLL',
    build: () =>
      makeTx({
        id: 'tc_out_pay',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 28500,
        description: 'Folha de pagamento mensal CLT',
      }),
  },
  {
    code: 'OUT_CONTRACTORS',
    build: () =>
      makeTx({
        id: 'tc_out_ct',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 6000,
        description: 'Pagamento autônomo — RPA autônomo',
      }),
  },
  {
    code: 'OUT_BENEFITS',
    build: () =>
      makeTx({
        id: 'tc_out_ben',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 4800,
        description: 'Vale refeição da equipe',
      }),
  },
  {
    code: 'OUT_COMMISSION',
    build: () =>
      makeTx({
        id: 'tc_out_com',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 3200,
        description: 'Comissão de venda — fechamento março',
      }),
  },
  {
    code: 'OUT_TAXES_SALES',
    build: () =>
      makeTx({
        id: 'tc_out_tax_s',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 4750,
        description: 'DAS Simples Nacional referente a fevereiro',
      }),
  },
  {
    code: 'OUT_TAXES_OTHER',
    build: () =>
      makeTx({
        id: 'tc_out_tax_o',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 1850,
        description: 'IPTU comercial 2026',
      }),
  },
  {
    code: 'OUT_REFUND_CUSTOMER',
    build: () =>
      makeTx({
        id: 'tc_out_ref',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 500,
        description: 'Devolução para cliente — chargeback Visa',
      }),
  },
  {
    code: 'OUT_RENT',
    build: () =>
      makeTx({
        id: 'tc_out_rent',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 8500,
        description: 'Aluguel comercial mensal',
      }),
  },
  {
    code: 'OUT_UTILITIES',
    build: () =>
      makeTx({
        id: 'tc_out_util',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 480,
        description: 'Energia elétrica conta março',
      }),
  },
  {
    code: 'OUT_SOFTWARE',
    build: () =>
      makeTx({
        id: 'tc_out_sw',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 380,
        description: 'Licença de software — assinatura mensal software',
      }),
  },
  {
    code: 'OUT_MARKETING',
    build: () =>
      makeTx({
        id: 'tc_out_mkt',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 2500,
        description: 'Google Ads — campanha de busca',
      }),
  },
  {
    code: 'OUT_LOGISTICS',
    build: () =>
      makeTx({
        id: 'tc_out_log',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 1200,
        description: 'Transportadora last mile — entrega de pedido',
      }),
  },
  {
    code: 'OUT_TRAVEL',
    build: () =>
      makeTx({
        id: 'tc_out_trv',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 1800,
        description: 'Passagem aérea visita cliente',
      }),
  },
  {
    code: 'OUT_OFFICE',
    build: () =>
      makeTx({
        id: 'tc_out_off',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 220,
        description: 'Material de escritório — papelaria escritorio',
      }),
  },
  {
    code: 'OUT_PROFESSIONAL_FEES',
    build: () =>
      makeTx({
        id: 'tc_out_prof',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 1900,
        description: 'Honorários contábeis mensais — contabilidade mensal',
      }),
  },
  {
    code: 'OUT_INSURANCE',
    build: () =>
      makeTx({
        id: 'tc_out_ins',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 850,
        description: 'Apólice de seguro frota',
      }),
  },
  {
    code: 'OUT_REPAIR_MAINTENANCE',
    build: () =>
      makeTx({
        id: 'tc_out_rep',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 600,
        description: 'Manutenção preventiva equipamentos',
      }),
  },
  {
    code: 'OUT_BANK_FEES',
    build: () =>
      makeTx({
        id: 'tc_out_bnk',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 89.9,
        description: 'Tarifa bancária mensal — manutenção conta',
      }),
  },
  {
    code: 'OUT_INTEREST',
    build: () =>
      makeTx({
        id: 'tc_out_int',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 1850,
        description: 'Juros de empréstimo — capital de giro',
      }),
  },
  {
    code: 'OUT_DEBT_PRINCIPAL',
    build: () =>
      makeTx({
        id: 'tc_out_principal',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 5000,
        description: 'Amortização principal — financiamento veicular',
      }),
  },
  {
    code: 'OUT_CARD_PAYMENT',
    build: () =>
      makeTx({
        id: 'tc_out_cardpay',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 5000,
        counterpartyName: 'AMERICAN EXPRESS',
        description: 'Pagamento de fatura cartão',
      }),
  },
  {
    code: 'OUT_CAPEX',
    build: () =>
      makeTx({
        id: 'tc_out_capex',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 22000,
        description: 'Compra equipamento — máquina industrial',
      }),
  },
  {
    code: 'OUT_OWNER_DRAW',
    build: () =>
      makeTx({
        id: 'tc_out_draw',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 12000,
        description: 'Pró-labore mensal sócio',
      }),
  },
  {
    code: 'OUT_INVENTORY_PURCHASE',
    build: () =>
      makeTx({
        id: 'tc_out_inv_p',
        sourceSystem: 'accounts_payable',
        direction: 'outflow',
        amount: 18000,
        description: 'Compra mercadoria para revenda',
      }),
  },
  {
    code: 'OUT_INVENTORY_CONSUMED',
    build: () =>
      makeTx({
        id: 'tc_out_inv_c',
        sourceSystem: 'manual',
        direction: 'outflow',
        amount: 12000,
        description: 'Baixa estoque consumido em venda — CMV mensal',
      }),
  },
  {
    code: 'OUT_INVENTORY_WRITEOFF',
    build: () =>
      makeTx({
        id: 'tc_out_inv_w',
        sourceSystem: 'manual',
        direction: 'outflow',
        amount: 1500,
        description: 'Perda estoque — baixa por avaria de mercadoria',
      }),
  },
  {
    code: 'OUT_TRANSFER',
    build: () =>
      makeTx({
        id: 'tc_out_transfer',
        sourceSystem: 'bank',
        direction: 'outflow',
        amount: 25000,
        description: 'Transferência entre contas próprias — Itaú/Bradesco',
      }),
  },
  {
    code: 'OUT_OTHER',
    build: () =>
      makeTx({
        id: 'tc_out_other',
        sourceSystem: 'manual',
        direction: 'outflow',
        amount: 100,
        description: 'Saída aleatória sem padrão zzz',
      }),
  },
];

/* ─────────── Testes ─────────── */

describe('classifyTransaction — despacho de cada uma das 42 categorias', () => {
  it('lista cobre exatamente as 42 categorias', () => {
    const codes = new Set(CATEGORY_DISPATCH_CASES.map((c) => c.code));
    expect(codes.size).toBe(42);
    for (const cat of STANDARD_CATEGORIES) {
      expect(codes.has(cat.code)).toBe(true);
    }
  });

  for (const { code, build } of CATEGORY_DISPATCH_CASES) {
    it(`atribui ${code}`, () => {
      const tx = build();
      const result = classifyTransaction(tx);
      expect(result.standardCategoryCode).toBe(code);
      expect(result.companyId).toBe(tx.companyId);
      expect(result.sourceTransactionId).toBe(tx.id);
    });
  }
});

describe('classifyTransaction — bucket sempre derivado do código (status=classified)', () => {
  for (const { code, build } of CATEGORY_DISPATCH_CASES) {
    it(`bucket de ${code} bate com getBucketForCategory()`, () => {
      const result = classifyTransaction(build());
      if (result.status !== 'classified') return;
      expect(result.standardCategoryCode).toBe(code);
      expect(result.bucket).toBe(getBucketForCategory(code));
    });
  }
});

describe('classifyTransaction — cobre cada ClassificationStatus', () => {
  it('classified — categoria com confiança alta', () => {
    const tx = makeTx({
      id: 'st_classified',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 8500,
      description: 'Aluguel comercial mensal',
    });
    expect(classifyTransaction(tx).status).toBe('classified');
  });

  it('translated — lançamento contábil', () => {
    const tx = ACCOUNTING_FIXTURES[0]!;
    expect(classifyTransaction(tx).status).toBe('translated');
  });

  it('needs_confirmation — cartão sem detalhe', () => {
    const tx = CARD_FIXTURES[1]!;
    expect(classifyTransaction(tx).status).toBe('needs_confirmation');
  });

  it('pending — fallback genérico de banco', () => {
    const tx = makeTx({
      id: 'st_pending',
      sourceSystem: 'bank',
      direction: 'outflow',
      amount: 200,
      description: 'Pagamento aleatório xyz',
    });
    expect(classifyTransaction(tx).status).toBe('pending');
  });

  it('ignored — status válido no domínio (construção manual)', () => {
    const ignored: ClassificationResult = {
      sourceTransactionId: 'x',
      companyId: 'co',
      bucket: null,
      confidenceScore: 1,
      confidenceLevel: 'high',
      classificationMethod: 'manual',
      originalLabelPreserved: true,
      requiresOwnerConfirmation: false,
      exceptionReason: 'none',
      status: 'ignored',
    };
    const status: ClassificationStatus = ignored.status;
    expect(status).toBe('ignored');
  });
});

describe('translateAccountingTransaction', () => {
  it('preserva original e retorna translated', () => {
    const tx = ACCOUNTING_FIXTURES[0]!;
    const r = translateAccountingTransaction(tx);
    expect(r.status).toBe('translated');
    expect(r.classificationMethod).toBe('accounting_translation');
    expect(r.originalLabelPreserved).toBe(true);
    expect(r.standardCategoryCode).toBeUndefined();
  });

  it('marca conta genérica relevante como pendência', () => {
    const tx = ACCOUNTING_FIXTURES[4]!; // Despesas Diversas
    const r = translateAccountingTransaction(tx);
    expect(r.exceptionReason).toBe('accounting_generic_account');
    expect(r.requiresOwnerConfirmation).toBe(true);
  });

  it('jamais atribui standardCategoryCode', () => {
    for (const tx of ACCOUNTING_FIXTURES) {
      const r = translateAccountingTransaction(tx);
      expect(r.standardCategoryCode).toBeUndefined();
    }
  });
});

describe('detectGenericCategory', () => {
  const cases: ReadonlyArray<{ term: string; field: string }> = [
    { term: 'outros', field: 'Outros' },
    { term: 'diversas', field: 'Despesas Diversas' },
    { term: 'diversos', field: 'Diversos' },
    { term: 'varias contas', field: 'Várias contas' },
    { term: 'despesas diversas', field: 'Despesas diversas' },
    { term: 'lancamentos gerais', field: 'Lançamentos gerais' },
    { term: 'ajustes', field: 'Ajustes contábeis' },
    { term: 'outras despesas', field: 'Outras despesas' },
    { term: 'outras receitas', field: 'Outras receitas' },
  ];
  for (const c of cases) {
    it(`detecta "${c.term}" em campo "${c.field}"`, () => {
      const tx = makeTx({
        id: `gen_${c.term}`,
        direction: 'outflow',
        originalCategory: c.field,
      });
      expect(detectGenericCategory(tx)).toBe(true);
    });
  }
  it('não dispara em texto comum', () => {
    expect(
      detectGenericCategory(
        makeTx({
          id: 'g_neg',
          direction: 'outflow',
          originalCategory: 'Aluguel comercial',
        }),
      ),
    ).toBe(false);
  });
});

describe('detectTransfer', () => {
  it('detecta "transferência entre contas próprias"', () => {
    const tx = TRANSFER_FIXTURES[0]!;
    expect(detectTransfer(tx)).toBe(true);
  });
  it('não dispara em pagamento comum', () => {
    const tx = makeTx({
      id: 'tr_neg',
      sourceSystem: 'bank',
      description: 'Pagamento boleto fornecedor',
    });
    expect(detectTransfer(tx)).toBe(false);
  });
});

describe('detectCardPaymentWithoutDetail', () => {
  it('dispara em counterparty AMERICAN EXPRESS', () => {
    const tx = CARD_FIXTURES[1]!;
    expect(detectCardPaymentWithoutDetail(tx)).toBe(true);
  });
  it('não dispara em compra com detalhe', () => {
    const tx = CARD_FIXTURES[0]!;
    expect(detectCardPaymentWithoutDetail(tx)).toBe(false);
  });
  it('não dispara em entrada (apenas saída)', () => {
    const tx = CARD_FIXTURES[2]!;
    expect(detectCardPaymentWithoutDetail(tx)).toBe(false);
  });
});

describe('calculateConfidenceLevel', () => {
  it('high quando >= 0.85', () => {
    expect(calculateConfidenceLevel(0.85)).toBe('high');
    expect(calculateConfidenceLevel(0.92)).toBe('high');
    expect(calculateConfidenceLevel(1)).toBe('high');
  });
  it('medium quando >= 0.60 e < 0.85', () => {
    expect(calculateConfidenceLevel(0.6)).toBe('medium');
    expect(calculateConfidenceLevel(0.7)).toBe('medium');
    expect(calculateConfidenceLevel(0.8499)).toBe('medium');
  });
  it('low quando < 0.60', () => {
    expect(calculateConfidenceLevel(0)).toBe('low');
    expect(calculateConfidenceLevel(0.3)).toBe('low');
    expect(calculateConfidenceLevel(0.5999)).toBe('low');
  });
});

describe('Sales — dispatch dedicado e affectors do IN_INVOICED_REVENUE', () => {
  it('sourceSystem=sales + inflow → IN_INVOICED_REVENUE classified', () => {
    const tx = makeTx({
      id: 'sl_in_1',
      sourceSystem: 'sales',
      direction: 'inflow',
      amount: 4250,
      counterpartyName: 'Cliente Alpha LTDA',
      documentNumber: 'NF-12001',
    });
    const r = classifyTransaction(tx);
    expect(r.standardCategoryCode).toBe('IN_INVOICED_REVENUE');
    expect(r.bucket).toBe('receita');
    expect(r.status).toBe('classified');
    expect(r.classificationMethod).toBe('source_mapping');
  });

  it('sourceSystem=sales + outflow (devolução) → OUT_REFUND_CUSTOMER', () => {
    const tx = makeTx({
      id: 'sl_out_1',
      sourceSystem: 'sales',
      direction: 'outflow',
      amount: 320,
      counterpartyName: 'Cliente Beta SA',
      documentNumber: 'NF-12015',
    });
    const r = classifyTransaction(tx);
    expect(r.standardCategoryCode).toBe('OUT_REFUND_CUSTOMER');
    expect(r.bucket).toBe('deducoes');
    expect(r.status).toBe('classified');
  });

  it('IN_INVOICED_REVENUE — affectsRevenue=true, affectsGrossMargin=false, affectsCashRunway=false', () => {
    const cat = getCategoryByCode('IN_INVOICED_REVENUE')!;
    expect(cat.affectsRevenue).toBe(true);
    expect(cat.affectsGrossMargin).toBe(false);
    expect(cat.affectsCashRunway).toBe(false);
    expect(cat.bucket).toBe('receita');
    expect(cat.macroClass).toBe('revenue');
  });

  it('IN_INVOICED_REVENUE não consome caixa — distinto de IN_CUSTOMER_RECEIPT', () => {
    const invoiced = getCategoryByCode('IN_INVOICED_REVENUE')!;
    const receipt = getCategoryByCode('IN_CUSTOMER_RECEIPT')!;
    expect(invoiced.affectsCashRunway).toBe(false);
    expect(receipt.affectsCashRunway).toBe(true);
  });
});

describe('Sales — Sale.movementType="return" cai em OUT_REFUND_CUSTOMER, não em IN_INVOICED_REVENUE', () => {
  // Cadeia completa Sale (parser FKN Vendas) → SourceTransaction → ClassificationResult.
  // O mapeamento `movementType==='return' → direction='outflow'` espelha
  // adaptSaleToSourceTransaction em scripts/classify-gregorutt.ts; replicado
  // aqui inline (sem importar do scripts/) pra manter o teste autocontido
  // dentro do escopo do core de classificação.

  function makeSale(overrides: Partial<Sale>): Sale {
    return {
      id: 'sale_default',
      issuedAt: utcDate(2026, 4, 10),
      customerCode: 12345,
      customerName: 'Cliente Beta SA',
      invoiceNumber: 'NF-12015',
      salesperson: 'DIRETA',
      paymentTerm: '30 DDL',
      amount: 320,
      cost: 200,
      marginPercent: 37.5,
      marginPercentSource: 'computed',
      movementType: 'sale',
      movementTypeSource: 'explicit',
      rawColumns: [],
      ...overrides,
    };
  }

  function adaptSaleForTest(s: Sale): SourceTransaction {
    return {
      id: `sale_${s.id}`,
      companyId: 'co_test',
      sourceSystem: 'sales',
      transactionDate: s.issuedAt,
      direction: s.movementType === 'return' ? 'outflow' : 'inflow',
      amount: s.amount,
      currency: 'BRL',
      counterpartyName: s.customerName,
      documentNumber: s.invoiceNumber,
    };
  }

  it('Sale.movementType="return" → OUT_REFUND_CUSTOMER (não IN_INVOICED_REVENUE)', () => {
    const sale = makeSale({ id: 's_return_1', movementType: 'return' });
    const tx = adaptSaleForTest(sale);
    const r = classifyTransaction(tx);
    expect(r.standardCategoryCode).toBe('OUT_REFUND_CUSTOMER');
    expect(r.standardCategoryCode).not.toBe('IN_INVOICED_REVENUE');
    expect(r.bucket).toBe('deducoes');
    expect(r.status).toBe('classified');
  });

  it('Sale.movementType="sale" → IN_INVOICED_REVENUE (companion positivo)', () => {
    const sale = makeSale({ id: 's_sale_1', movementType: 'sale' });
    const tx = adaptSaleForTest(sale);
    const r = classifyTransaction(tx);
    expect(r.standardCategoryCode).toBe('IN_INVOICED_REVENUE');
    expect(r.bucket).toBe('receita');
    expect(r.status).toBe('classified');
  });
});

describe('Estoque — affectsCashRunway false em consumed e writeoff', () => {
  it('OUT_INVENTORY_CONSUMED', () => {
    const cat = getCategoryByCode('OUT_INVENTORY_CONSUMED')!;
    expect(cat.affectsCashRunway).toBe(false);
    expect(cat.affectsGrossMargin).toBe(true);
    expect(cat.affectsEbitda).toBe(true);
  });
  it('OUT_INVENTORY_WRITEOFF', () => {
    const cat = getCategoryByCode('OUT_INVENTORY_WRITEOFF')!;
    expect(cat.affectsCashRunway).toBe(false);
    expect(cat.affectsEbitda).toBe(true);
  });
  it('OUT_INVENTORY_PURCHASE consome caixa', () => {
    const cat = getCategoryByCode('OUT_INVENTORY_PURCHASE')!;
    expect(cat.affectsCashRunway).toBe(true);
  });
});

describe('normalizeText', () => {
  it('remove acentos e baixa caixa', () => {
    expect(normalizeText('Transferência Entre Contas Próprias')).toBe(
      'transferencia entre contas proprias',
    );
  });
});

describe('normalizeTransaction', () => {
  it('devolve campos normalizados sem mutar original', () => {
    const tx = makeTx({
      id: 'norm_1',
      direction: 'outflow',
      description: 'PAGAMENTO Fornecedor ALPHA',
      counterpartyName: 'Fornecedor ALPHA',
    });
    const n = normalizeTransaction(tx);
    expect(n.description).toBe('pagamento fornecedor alpha');
    expect(n.counterpartyName).toBe('fornecedor alpha');
    expect(tx.description).toBe('PAGAMENTO Fornecedor ALPHA');
  });
});

describe('Genéricas + heurística — pendência mesmo com sugestão', () => {
  it('aluguel + originalCategory genérico → pendência com OUT_RENT sugerido', () => {
    const tx = makeTx({
      id: 'gen_h',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 500,
      description: 'Aluguel + outros',
      originalCategory: 'Despesas diversas',
    });
    const r = classifyTransaction(tx);
    expect(r.status).toBe('pending');
    expect(r.standardCategoryCode).toBe('OUT_RENT');
    expect(r.exceptionReason).toBe('generic_original_category');
    expect(r.confidenceScore).toBeLessThanOrEqual(0.55);
  });
});

describe('AR — IN_CUSTOMER_RECEIPT vs IN_CUSTOMER_ADVANCE', () => {
  it('CR pago vira IN_CUSTOMER_RECEIPT', () => {
    const r = classifyTransaction(AR_FIXTURES[0]!);
    expect(r.standardCategoryCode).toBe('IN_CUSTOMER_RECEIPT');
  });
  it('CR com originalCategory adiantamento vira IN_CUSTOMER_ADVANCE', () => {
    const r = classifyTransaction(AR_FIXTURES[2]!);
    expect(r.standardCategoryCode).toBe('IN_CUSTOMER_ADVANCE');
  });
});

describe('Genérico isolado — fallback para IN_OTHER/OUT_OTHER', () => {
  it('saída genérica sem heurística', () => {
    const r = classifyTransaction(GENERIC_FIXTURES[1]!);
    expect(r.standardCategoryCode).toBe('OUT_OTHER');
    expect(r.status).toBe('pending');
    expect(r.exceptionReason).toBe('generic_original_category');
  });
});

describe('Banco sem match — pending unmatched_bank_transaction', () => {
  it('descrição fraca não bate em nenhuma heurística', () => {
    const tx = makeTx({
      id: 'bnk_unmatched',
      sourceSystem: 'bank',
      direction: 'outflow',
      amount: 540,
      description: 'Pagamento diverso xyz',
    });
    const r = classifyTransaction(tx);
    expect(r.status).toBe('pending');
    expect(r.exceptionReason).toBe('unmatched_bank_transaction');
  });
});

describe('Reconciliação prévia — herda categoria do CR/CP', () => {
  it('reconciliationCategoryCode injetado vira a categoria final', () => {
    const tx = makeTx({
      id: 'recon_inject',
      sourceSystem: 'bank',
      direction: 'inflow',
      amount: 4250,
      description: 'TED recebida',
    });
    const r = classifyTransaction(tx, {
      reconciliationCategoryCode: 'IN_CUSTOMER_RECEIPT',
    });
    expect(r.standardCategoryCode).toBe('IN_CUSTOMER_RECEIPT');
    expect(r.classificationMethod).toBe('reconciliation_match');
  });
});

describe('accountCodeHints — sinal externo via originalAccountCode', () => {
  // Hint de cliente: código '6.1.001' = aluguel; prefixo '6.2.' = software.
  // Códigos fictícios escolhidos pra não colidir com nenhuma heurística por
  // keyword (heurísticas leem texto, não código).
  const exactHints: AccountCodeHintMap = {
    exact: {
      '6.1.001': 'OUT_RENT',
    },
  };
  const prefixHints: AccountCodeHintMap = {
    prefix: [{ pattern: '6.2.', category: 'OUT_SOFTWARE', confidence: 'medium' }],
  };
  const mixedHints: AccountCodeHintMap = {
    exact: { '6.1.001': 'OUT_RENT' },
    prefix: [{ pattern: '6.2.', category: 'OUT_SOFTWARE', confidence: 'medium' }],
  };

  it('exact hint sem contradição → classified, account_code_hint, high', () => {
    const tx = makeTx({
      id: 'hint_e1',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 5000,
      originalAccountCode: '6.1.001',
      // Descrição neutra, sem keyword que dispare heurística.
      description: 'Pagamento mensal',
    });
    const r = classifyTransaction(tx, { accountCodeHints: exactHints });
    expect(r.standardCategoryCode).toBe('OUT_RENT');
    expect(r.bucket).toBe('despesas_operacionais');
    expect(r.classificationMethod).toBe('account_code_hint');
    expect(r.status).toBe('classified');
    expect(r.confidenceLevel).toBe('high');
    expect(r.confidenceScore).toBeGreaterThanOrEqual(0.85);
  });

  it('exact hint + descrição contradiz fortemente → needs_confirmation, medium', () => {
    const tx = makeTx({
      id: 'hint_e2',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 480,
      originalAccountCode: '6.1.001', // hint diz OUT_RENT
      description: 'energia eletrica conta março', // heurística diz OUT_UTILITIES
    });
    const r = classifyTransaction(tx, { accountCodeHints: exactHints });
    expect(r.standardCategoryCode).toBe('OUT_RENT'); // hint vence em categoria
    expect(r.classificationMethod).toBe('account_code_hint');
    expect(r.status).toBe('needs_confirmation');
    expect(r.confidenceLevel).toBe('medium');
    expect(r.requiresOwnerConfirmation).toBe(true);
  });

  it('prefix hint sozinho (sem suporte da descrição) → needs_confirmation', () => {
    const tx = makeTx({
      id: 'hint_p1',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 420,
      originalAccountCode: '6.2.999',
      description: 'Pagamento diverso',
    });
    const r = classifyTransaction(tx, { accountCodeHints: prefixHints });
    expect(r.standardCategoryCode).toBe('OUT_SOFTWARE');
    expect(r.classificationMethod).toBe('account_code_hint');
    expect(r.status).toBe('needs_confirmation');
    expect(r.confidenceLevel).toBe('medium');
  });

  it('prefix hint com descrição apoiando a mesma categoria → classified', () => {
    const tx = makeTx({
      id: 'hint_p2',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 320,
      originalAccountCode: '6.2.555',
      // Descrição contém keyword que a heurística mapeia em OUT_SOFTWARE.
      description: 'Licença de software anual',
    });
    const r = classifyTransaction(tx, { accountCodeHints: prefixHints });
    expect(r.standardCategoryCode).toBe('OUT_SOFTWARE');
    expect(r.classificationMethod).toBe('account_code_hint');
    expect(r.status).toBe('classified');
    expect(r.confidenceLevel).toBe('high');
  });

  it('exact tem prioridade sobre prefix quando ambos casariam', () => {
    // Código '6.1.001' bate em exact AND poderia bater num prefix '6.1.' se
    // existisse. Aqui mostramos que exact ganha — score 0.92, não 0.86.
    const hints: AccountCodeHintMap = {
      exact: { '6.1.001': 'OUT_RENT' },
      prefix: [{ pattern: '6.1.', category: 'OUT_OFFICE', confidence: 'medium' }],
    };
    const tx = makeTx({
      id: 'hint_pri',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 5000,
      originalAccountCode: '6.1.001',
      description: 'Pagamento neutro',
    });
    const r = classifyTransaction(tx, { accountCodeHints: hints });
    expect(r.standardCategoryCode).toBe('OUT_RENT'); // do exact, não OUT_OFFICE
    expect(r.confidenceScore).toBeCloseTo(0.92, 2);
  });

  it('código não bate em nenhum hint → fallback existente, sem account_code_hint', () => {
    const tx = makeTx({
      id: 'hint_miss',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 8500,
      originalAccountCode: '9.9.999', // não bate em exact nem prefix
      description: 'Aluguel comercial mensal', // heurística pega OUT_RENT
    });
    const r = classifyTransaction(tx, { accountCodeHints: mixedHints });
    expect(r.standardCategoryCode).toBe('OUT_RENT');
    expect(r.classificationMethod).toBe('keyword_rule');
  });

  it('sem options → comportamento idêntico ao motor sem hint', () => {
    const tx = makeTx({
      id: 'hint_none',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 8500,
      originalAccountCode: '6.1.001', // tem código mas options não vem
      description: 'Aluguel comercial mensal',
    });
    const noOpts = classifyTransaction(tx);
    const emptyOpts = classifyTransaction(tx, {});
    // Heurística pega OUT_RENT pelo texto. Mesma resposta nos dois casos.
    expect(noOpts.standardCategoryCode).toBe('OUT_RENT');
    expect(noOpts.classificationMethod).toBe('keyword_rule');
    expect(emptyOpts.standardCategoryCode).toBe(noOpts.standardCategoryCode);
    expect(emptyOpts.classificationMethod).toBe(noOpts.classificationMethod);
  });

  it('originalAccountCode ausente → hint não dispara mesmo com map fornecido', () => {
    const tx = makeTx({
      id: 'hint_noc',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 1000,
      // sem originalAccountCode
      description: 'Pagamento aleatório xyz',
    });
    const r = classifyTransaction(tx, { accountCodeHints: exactHints });
    expect(r.classificationMethod).not.toBe('account_code_hint');
  });

  it('rule explícita ainda vence sobre account_code_hint (regra > hint)', () => {
    const tx = makeTx({
      id: 'hint_vs_rule',
      sourceSystem: 'accounts_payable',
      direction: 'outflow',
      amount: 5000,
      originalAccountCode: '6.1.001', // hint diria OUT_RENT
      counterpartyName: 'Posto Shell BR',
    });
    const r = classifyTransaction(tx, {
      accountCodeHints: exactHints,
      rules: [
        {
          id: 'r_x',
          companyId: 'co_test_001',
          ruleType: 'counterparty',
          pattern: 'Posto Shell',
          standardCategoryCode: 'OUT_REPAIR_MAINTENANCE',
          appliesToFutureTransactions: true,
          createdBy: 'owner',
          confidenceBoost: 0.1,
          active: true,
        },
      ],
    });
    expect(r.standardCategoryCode).toBe('OUT_REPAIR_MAINTENANCE');
    expect(r.classificationMethod).toBe('owner_confirmed');
  });
});
