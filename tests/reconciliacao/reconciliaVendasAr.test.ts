import { describe, expect, it } from 'vitest';
import { reconciliaVendasAr } from '../../src/index.js';
import type { VendaComercial } from '../../src/types/index.js';
import { mkEvento, utc } from './fixtures/mkEvento.js';

const RECON_EM = new Date('2026-05-30T12:00:00.000Z');

const baseVenda: VendaComercial = {
  id: 'v1',
  cliente_id: 'g',
  legal_entity_id: 'u1',
  origem: 'fkn',
  origem_ref: 'venda-001',
  data_emissao: utc(2026, 5, 1),
  valor: 1000,
  contraparte_tipo: 'cliente',
  prazo: 'a_prazo',
  criado_em: new Date('2026-05-01T00:00:00.000Z'),
  criado_por: 'sistema',
};

function vendaCom(overrides: Partial<VendaComercial> = {}): VendaComercial {
  return { ...baseVenda, ...overrides };
}

describe('reconciliaVendasAr — Via 1 (chave forte por documento_ref)', () => {
  it('venda + AR mesmo documento_ref e janela [emissão, +120d] → match', () => {
    const venda = vendaCom({
      id: 'v1',
      origem_ref: 'NF-555',
      documento_ref: 'NF-555',
      contraparte_id: 'cliente-x',
      data_emissao: utc(2026, 1, 15),
      valor: 1000,
    });
    const ar = mkEvento({
      id: 'ar-1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-555',
      valor: 1000,
      data_vencimento: utc(2026, 4, 30), // 105 dias depois
      data_esperada: utc(2026, 4, 30),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
    expect(r.vendas[0]!.reconciliado_com).toBe('ar-1');
    expect(r.vendas[0]!.reconciliado_em).toEqual(RECON_EM);
  });

  it('AR fora dos 120 dias da emissão → não match (NF reaproveitada)', () => {
    const venda = vendaCom({
      id: 'v2',
      documento_ref: 'NF-556',
      contraparte_id: 'cliente-x',
      data_emissao: utc(2026, 1, 15),
    });
    const ar = mkEvento({
      id: 'ar-2',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-556',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20), // 125 dias depois
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });

  it('AR antes da emissão → não match (NF futura?)', () => {
    const venda = vendaCom({
      id: 'v3',
      documento_ref: 'NF-557',
      data_emissao: utc(2026, 5, 15),
    });
    const ar = mkEvento({
      id: 'ar-3',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-557',
      valor: 1000,
      data_vencimento: utc(2026, 5, 1), // antes da emissão
      data_esperada: utc(2026, 5, 1),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });
});

describe('reconciliaVendasAr — Via 2 (chave fraca, sem documento_ref)', () => {
  it('venda + AR sem documento_ref dentro de ±45 dias → match', () => {
    const venda = vendaCom({
      id: 'v4',
      origem_ref: 'venda-004',
      data_emissao: utc(2026, 5, 1),
      contraparte_id: 'cliente-x',
    });
    const ar = mkEvento({
      id: 'ar-4',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20), // 19 dias depois
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });

  it('AR sem documento_ref a 50 dias → não match', () => {
    const venda = vendaCom({
      id: 'v5',
      data_emissao: utc(2026, 5, 1),
    });
    const ar = mkEvento({
      id: 'ar-5',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 6, 20), // 50 dias depois
      data_esperada: utc(2026, 6, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });

  it('venda e AR com documento_ref de domínios diferentes (NOTA vs DUPLIC) → cai em Via 2', () => {
    // Cenário FKN real: vendas guardam invoiceNumber em documento_ref;
    // AR guarda duplicata. Ambos populados, mas semanticamente distintos.
    const venda = vendaCom({
      id: 'v-fkn',
      documento_ref: '115683', // NOTA
      data_emissao: utc(2026, 5, 1),
      contraparte_id: 'cli-fkn',
    });
    const ar = mkEvento({
      id: 'ar-fkn',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cli-fkn',
      contraparte_tipo: 'cliente',
      documento_ref: '018794/1', // DUPLICATA
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    // Via 1 falha (doc_refs diferem); Via 2 dentro de ±45 dias → match.
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });

  it('venda com documento_ref + AR sem documento_ref → cai em Via 2', () => {
    const venda = vendaCom({
      id: 'v6',
      documento_ref: 'NF-560',
      data_emissao: utc(2026, 5, 1),
    });
    const ar = mkEvento({
      id: 'ar-6',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      // sem documento_ref!
      valor: 1000,
      data_vencimento: utc(2026, 5, 20), // dentro de ±45
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });
});

describe('reconciliaVendasAr — pendências', () => {
  it('1 venda sem AR equivalente → pendência venda_sem_ar', () => {
    const venda = vendaCom({ id: 'v7', valor: 999 });
    const r = reconciliaVendasAr([venda], [], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.vendasSemAr).toBe(1);
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('venda_sem_ar');
    expect(r.pendencias[0]!.vendas_relacionadas).toEqual(['v7']);
    expect(r.pendencias[0]!.ar_relacionados).toEqual([]);
  });

  it('1 AR sem venda equivalente → pendência ar_sem_venda', () => {
    const ar = mkEvento({
      id: 'ar-orfao',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.arSemVenda).toBe(1);
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('ar_sem_venda');
    expect(r.pendencias[0]!.ar_relacionados).toEqual(['ar-orfao']);
  });

  it('1 venda + 2 ARs candidatos → pendência venda_ambigua', () => {
    const venda = vendaCom({
      id: 'va',
      data_emissao: utc(2026, 5, 1),
      contraparte_id: 'cliente-x',
    });
    const ar1 = mkEvento({
      id: 'ar-x1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const ar2 = mkEvento({
      id: 'ar-x2',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'cliente-x',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar1, ar2], {
      reconciliadoEm: RECON_EM,
    });
    expect(r.estatisticas.ambiguidades).toBe(1);
    expect(r.estatisticas.matchesAplicados).toBe(0);
    expect(r.pendencias[0]!.tipo).toBe('venda_ambigua');
    expect(r.pendencias[0]!.ar_relacionados.sort()).toEqual([
      'ar-x1',
      'ar-x2',
    ]);
  });
});

describe('reconciliaVendasAr — tolerância e filtros', () => {
  it('tolerância R$ 5 absoluto vence em valores baixos', () => {
    const venda = vendaCom({ id: 'vt', valor: 100, contraparte_id: 'x' });
    const ar = mkEvento({
      id: 'art',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'x',
      contraparte_tipo: 'cliente',
      valor: 105, // R$ 5 absoluto exato
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });

  it('tolerância 1% vence em valores altos', () => {
    const venda = vendaCom({ id: 'vth', valor: 10000, contraparte_id: 'x' });
    const ar = mkEvento({
      id: 'arh',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'x',
      contraparte_tipo: 'cliente',
      valor: 9900, // 1% exato
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });

  it('AR de saída (AP) é ignorado pelo filtro', () => {
    const venda = vendaCom({ id: 'vap' });
    const ap = mkEvento({
      id: 'ap',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      contraparte_tipo: 'fornecedor',
      valor: 1000,
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ap], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.arFiltrados).toBe(0);
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });

  it('AR realizado (já recebido) também é candidato — confirmado e realizado', () => {
    const venda = vendaCom({
      id: 'vr',
      data_emissao: utc(2026, 5, 1),
      contraparte_id: 'x',
    });
    const ar = mkEvento({
      id: 'ar-pago',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_id: 'x',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_realizada: utc(2026, 5, 18),
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 18),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.arFiltrados).toBe(1);
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });
});

describe('reconciliaVendasAr — auditoria, determinismo e invariantes', () => {
  it('AR não muda — só venda ganha reconciliado_com', () => {
    const venda = vendaCom({
      id: 'v',
      documento_ref: 'NF-100',
      data_emissao: utc(2026, 5, 1),
    });
    const ar = mkEvento({
      id: 'ar',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-100',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    // AR original sem reconciliado_com (ele não é mutado nem clonado).
    expect(ar.reconciliado_com).toBeUndefined();
  });

  it('determinismo: 2 chamadas → deepEqual', () => {
    const venda = vendaCom({
      id: 'vd',
      documento_ref: 'NF-D',
      data_emissao: utc(2026, 5, 1),
    });
    const ar = mkEvento({
      id: 'ard',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      documento_ref: 'NF-D',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const a = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    const b = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    expect(b).toEqual(a);
  });

  it('invariante "nunca somar Vendas + CR no caixa": Σvendas + Σar não é o caixa', () => {
    // Smoke: a função NÃO retorna eventos de caixa novos. Apenas vendas
    // (com `reconciliado_com` opcional) e pendências. Garante separação.
    const venda = vendaCom({
      id: 'vinv',
      valor: 1000,
      data_emissao: utc(2026, 5, 1),
    });
    const ar = mkEvento({
      id: 'arinv',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      valor: 1000,
      data_vencimento: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'g',
      legal_entity_id: 'u1',
    });
    const r = reconciliaVendasAr([venda], [ar], { reconciliadoEm: RECON_EM });
    // Resultado tem `vendas` e `pendencias`, NÃO tem `eventos`.
    const asUnknown = r as unknown as Record<string, unknown>;
    expect(asUnknown['eventos']).toBeUndefined();
    // Vendas continuam tendo origem='fkn' e contraparte_tipo='cliente' —
    // tipo VendaComercial, não EventoCaixa.
    for (const v of r.vendas) {
      const vU = v as unknown as Record<string, unknown>;
      expect(vU['status']).toBeUndefined();
      expect(vU['direcao']).toBeUndefined();
    }
  });
});
