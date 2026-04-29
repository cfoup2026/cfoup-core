import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_TRANSLATIONS,
  translateAccountingTransaction,
} from '../../src/classification/index.js';
import type { Bucket } from '../../src/classification/index.js';
import { makeTx, utcDate } from './fixtures/helpers.js';

/* Casos esperados — espelha a tabela do prompt do motor. */
const EXPECTED: ReadonlyArray<{
  pattern: string;
  bucket: Bucket | null;
  ownerLabel: string;
}> = [
  {
    pattern: 'Disponibilidades',
    bucket: 'caixa',
    ownerLabel: 'Caixa e bancos',
  },
  {
    pattern: 'Caixa e equivalentes',
    bucket: 'caixa',
    ownerLabel: 'Caixa e bancos',
  },
  {
    pattern: 'Clientes',
    bucket: 'contas_receber',
    ownerLabel: 'Valores a receber de clientes',
  },
  {
    pattern: 'Contas a receber',
    bucket: 'contas_receber',
    ownerLabel: 'Valores a receber de clientes',
  },
  { pattern: 'Estoques', bucket: 'estoque', ownerLabel: 'Estoque' },
  {
    pattern: 'Fornecedores',
    bucket: 'contas_pagar',
    ownerLabel: 'Contas a pagar para fornecedores',
  },
  {
    pattern: 'Empréstimos e financiamentos',
    bucket: 'despesas_financeiras',
    ownerLabel: 'Dívidas bancárias',
  },
  {
    pattern: 'Obrigações tributárias',
    bucket: 'contas_pagar',
    ownerLabel: 'Impostos a pagar',
  },
  {
    pattern: 'Obrigações trabalhistas',
    bucket: 'contas_pagar',
    ownerLabel: 'Obrigações com equipe',
  },
  {
    pattern: 'Capital social',
    bucket: 'retiradas_socios',
    ownerLabel: 'Capital dos sócios',
  },
  {
    pattern: 'Receita bruta',
    bucket: 'receita',
    ownerLabel: 'Vendas brutas',
  },
  {
    pattern: 'Deduções da receita',
    bucket: 'deducoes',
    ownerLabel: 'Impostos, devoluções e descontos sobre vendas',
  },
  {
    pattern: 'Custo dos produtos vendidos',
    bucket: 'custos_diretos',
    ownerLabel: 'Custo direto da venda',
  },
  {
    pattern: 'Custo dos serviços prestados',
    bucket: 'custos_diretos',
    ownerLabel: 'Custo direto do serviço',
  },
  {
    pattern: 'Despesas administrativas',
    bucket: 'despesas_operacionais',
    ownerLabel: 'Custos fixos da operação',
  },
  {
    pattern: 'Despesas comerciais',
    bucket: 'despesas_operacionais',
    ownerLabel: 'Gastos para vender',
  },
  {
    pattern: 'Despesas financeiras',
    bucket: 'despesas_financeiras',
    ownerLabel: 'Custo financeiro',
  },
  {
    pattern: 'Receitas financeiras',
    bucket: 'caixa',
    ownerLabel: 'Ganhos financeiros',
  },
  {
    pattern: 'Outras despesas',
    bucket: null,
    ownerLabel: 'Outras despesas — precisa abrir se relevante',
  },
  {
    pattern: 'Despesas diversas',
    bucket: null,
    ownerLabel: 'Despesas diversas — precisa abrir se relevante',
  },
];

describe('AccountingTranslation — cada entrada da tabela tem teste', () => {
  for (const e of EXPECTED) {
    it(`traduz "${e.pattern}" → bucket=${String(e.bucket)}`, () => {
      const tx = makeTx({
        id: `acc_${e.pattern}`,
        sourceSystem: 'accounting',
        transactionDate: utcDate(2026, 3, 31),
        direction: 'neutral',
        amount: 1000,
        originalAccountName: e.pattern,
      });
      const r = translateAccountingTransaction(tx);
      expect(r.status).toBe('translated');
      expect(r.bucket).toBe(e.bucket);
      expect(r.ownerFriendlyLabel).toBe(e.ownerLabel);
      expect(r.originalLabelPreserved).toBe(true);
      expect(r.standardCategoryCode).toBeUndefined();
    });
  }

  it('contagem de traduções na carteira bate com o esperado', () => {
    expect(ACCOUNTING_TRANSLATIONS).toHaveLength(EXPECTED.length);
  });
});

describe('AccountingTranslation — conta genérica relevante exige confirmação', () => {
  it('"Outras despesas" → requiresOwnerConfirmation=true', () => {
    const tx = makeTx({
      id: 'gen_acc_1',
      sourceSystem: 'accounting',
      direction: 'outflow',
      amount: 1000,
      originalAccountName: 'Outras despesas',
    });
    const r = translateAccountingTransaction(tx);
    expect(r.requiresOwnerConfirmation).toBe(true);
    expect(r.exceptionReason).toBe('accounting_generic_account');
    expect(r.bucket).toBeNull();
  });

  it('"Despesas diversas" → requiresOwnerConfirmation=true', () => {
    const tx = makeTx({
      id: 'gen_acc_2',
      sourceSystem: 'accounting',
      direction: 'outflow',
      amount: 800,
      originalAccountName: 'Despesas diversas',
    });
    const r = translateAccountingTransaction(tx);
    expect(r.requiresOwnerConfirmation).toBe(true);
  });

  it('"Disponibilidades" (não-genérica) → requiresOwnerConfirmation=false', () => {
    const tx = makeTx({
      id: 'nogen_acc',
      sourceSystem: 'accounting',
      direction: 'neutral',
      amount: 1000,
      originalAccountName: 'Disponibilidades',
    });
    const r = translateAccountingTransaction(tx);
    expect(r.requiresOwnerConfirmation).toBe(false);
  });
});

describe('AccountingTranslation — sem match cai pra fallback preservando original', () => {
  it('conta sem tradução vira translated com bucket null e baixa confiança', () => {
    const tx = makeTx({
      id: 'unknown_acc',
      sourceSystem: 'accounting',
      direction: 'neutral',
      amount: 100,
      originalAccountName: 'Conta totalmente nova só desse cliente',
    });
    const r = translateAccountingTransaction(tx);
    expect(r.status).toBe('translated');
    expect(r.bucket).toBeNull();
    expect(r.confidenceLevel).toBe('low');
    expect(r.originalLabelPreserved).toBe(true);
  });
});
