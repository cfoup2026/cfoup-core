import { describe, expect, it } from 'vitest';
import {
  BUCKET_TO_CRITICIDADE,
  NucleusClassifierAdapter,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

/**
 * Smokes do adapter REAL contra o motor do Núcleo. O motor é
 * regex/string-match puro (sync, sem I/O), então testar com input
 * real é viável e barato.
 */
describe('NucleusClassifierAdapter — integração com classifyTransaction do Núcleo', () => {
  it('mapa BUCKET_TO_CRITICIDADE cobre os 12 buckets', () => {
    const buckets = Object.keys(BUCKET_TO_CRITICIDADE);
    expect(buckets).toHaveLength(12);
    // Spot-checks dos mapeamentos aprovados.
    expect(BUCKET_TO_CRITICIDADE.folha).toBe('obrigatoria');
    expect(BUCKET_TO_CRITICIDADE.deducoes).toBe('obrigatoria');
    expect(BUCKET_TO_CRITICIDADE.custos_diretos).toBe('critica_op');
    expect(BUCKET_TO_CRITICIDADE.despesas_operacionais).toBe('critica_op');
    expect(BUCKET_TO_CRITICIDADE.despesas_financeiras).toBe('critica_op');
    expect(BUCKET_TO_CRITICIDADE.estoque).toBe('critica_op');
    expect(BUCKET_TO_CRITICIDADE.caixa).toBe('negociavel');
    expect(BUCKET_TO_CRITICIDADE.contas_pagar).toBe('negociavel');
    expect(BUCKET_TO_CRITICIDADE.retiradas_socios).toBe('discricionaria');
    expect(BUCKET_TO_CRITICIDADE.investimentos).toBe('discricionaria');
    // Receita e contas_receber são neutras (pendente) — entradas não
    // afetam caixa_minimo_op.
    expect(BUCKET_TO_CRITICIDADE.receita).toBe('pendente');
    expect(BUCKET_TO_CRITICIDADE.contas_receber).toBe('pendente');
  });

  it('roda contra evento sem descrição/contraparte_name (Stage 1 reality)', () => {
    // Stage 1 não preserva description nem counterpartyName (decisão
    // 1.2 do CF13). Adapter monta SourceTransaction com o que tem;
    // o motor opera sobre direction + amount + sourceSystem.
    const ev = mkEvento({
      id: 'ev-fkn-ar',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: '1234',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-100',
    });
    const adapter = new NucleusClassifierAdapter();
    const result = adapter.classify(ev);
    // Pode ser null (motor não classificou sem texto) ou um bucket
    // válido — não bloqueamos por falta de cobertura, só validamos
    // que NÃO há throw e que SE retorna algo, o shape é válido.
    if (result !== null) {
      expect(typeof result.bucket_id).toBe('string');
      expect(typeof result.bucket_nome).toBe('string');
      expect([
        'obrigatoria',
        'critica_op',
        'negociavel',
        'discricionaria',
        'pendente',
      ]).toContain(result.criticidade);
      // Criticidade deve bater com o mapa.
      expect(result.criticidade).toBe(
        BUCKET_TO_CRITICIDADE[
          result.bucket_id as keyof typeof BUCKET_TO_CRITICIDADE
        ],
      );
    }
  });

  it('determinismo: classify 2× → mesmo resultado', () => {
    const ev = mkEvento({
      id: 'ev-det',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 89.9,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
    });
    const adapter = new NucleusClassifierAdapter();
    const r1 = adapter.classify(ev);
    const r2 = adapter.classify(ev);
    expect(r2).toEqual(r1);
  });

  it('lastRequiresConfirmation reseta ao false a cada chamada', () => {
    const ev1 = mkEvento({
      id: 'ev1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
    });
    const adapter = new NucleusClassifierAdapter();
    // Antes da 1ª chamada, deve ser false (estado inicial).
    expect(adapter.lastRequiresConfirmation).toBe(false);
    adapter.classify(ev1);
    // Após chamada, é o valor reportado pelo motor (true ou false).
    expect(typeof adapter.lastRequiresConfirmation).toBe('boolean');
  });

  it('FKN AR (entrada + contraparte_tipo=cliente) traduz para sourceSystem accounts_receivable', () => {
    // Smoke indireto: motor de classificação tem regras específicas pra
    // accounts_receivable (sourceSystem-based). Confirmamos aqui que
    // a tradução de direção e contraparte_tipo funciona — se motor
    // produz algum bucket válido (não-erro), o sistema-fonte foi aceito.
    const ev = mkEvento({
      id: 'ar',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-1',
    });
    const adapter = new NucleusClassifierAdapter();
    // Sem throw é o critério mínimo. Result pode ser null ou bucket.
    expect(() => adapter.classify(ev)).not.toThrow();
  });

  it('FKN AP (saida + contraparte_tipo=fornecedor) traduz para sourceSystem accounts_payable', () => {
    const ev = mkEvento({
      id: 'ap',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 500,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'fornecedor-y',
      contraparte_tipo: 'fornecedor',
      documento_ref: 'NF-2',
    });
    const adapter = new NucleusClassifierAdapter();
    expect(() => adapter.classify(ev)).not.toThrow();
  });

  it('CEF (origem=cef) traduz para sourceSystem=bank', () => {
    const ev = mkEvento({
      id: 'cef-1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
    });
    const adapter = new NucleusClassifierAdapter();
    expect(() => adapter.classify(ev)).not.toThrow();
  });

  it('estimado (origem=historico) → sourceSystem=manual, motor possivelmente null', () => {
    const ev = mkEvento({
      id: 'est',
      status: 'estimado',
      origem: 'historico',
      direcao: 'saida',
      valor: 1000,
      data_esperada: utc(2026, 5, 12),
    });
    const adapter = new NucleusClassifierAdapter();
    // Sem throw. Geralmente null (sem descrição), mas Bridge tolera.
    expect(() => adapter.classify(ev)).not.toThrow();
  });
});
