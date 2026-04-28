import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractCSV } from '../../src/csv/extractor.js';
import { parseFKNVendas } from '../../src/parsers/fkn-vendas.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_VENDAS = resolve(fixturesDir, 'gregorutt_vendas_2023_ate_20abr2026.csv');

const HEADER_PREAMBLE: string[][] = [
  ['GREGORUTT IND. E COM. LTDA', 'PAG.: 1 de 191', ''],
  ['', 'DATA: 20/04/2026', ''],
  ['SISTEMA DE GESTÃO EMPRESARIAL', '16:30', ''],
  ['VENDAS POR CLIENTE POR NOTA', 'FKN(031)-00', ''],
  ['DATA', 'NOTA', 'VENDEDOR', 'PRAZO', 'VALOR NOTA', 'VALOR CUSTO', '%LUC', ''],
];

const RULER: string[] = ['---------------------------------------------'];

function customerHeader(code: string, name: string): string[] {
  return [`CLIENTE: ${code} ${name}       `, ''];
}

function sale(
  data: string,
  nota: string,
  vendedor: string,
  prazo: string,
  valor: string,
  custo: string,
  luc: string,
): string[] {
  return [data, nota, vendedor, prazo, valor, custo, luc, ''];
}

function totalNotas(
  count: string,
  totalAmount: string,
  totalCost: string,
  luc: string,
): string[] {
  return ['', '', 'TOTAL - NOTAS:', count, totalAmount, totalCost, luc, ''];
}

function totalGeral(
  count: string,
  totalAmount: string,
  totalCost: string,
  luc: string,
): string[] {
  return ['', '', 'TOTAL GERAL:', count, totalAmount, totalCost, luc, ''];
}

describe('parseFKNVendas — happy path com fixture sintética', () => {
  const rows = [
    ...HEADER_PREAMBLE,
    [''],
    RULER,
    customerHeader('000001', 'GREGORUTT INDUSTRIA E COMERCIO LTDA'),
    sale('03/03/2023', '   115683', 'DIRETA', 'A VISTA', '16,90', '9,38', '80,1'),
    sale('22/03/2023', '   115817', 'DIRETA', 'A VISTA', '1.773,73', '800,81', '121,4'),
    totalNotas('2', '1.790,63', '810,19', '120,9'),
    RULER,
    customerHeader('000023', 'ANIL COM PROD LIMPEZA LTDA ME'),
    sale('11/04/2025', '   022390', 'DIRETA', 'A VISTA', '212,60', '87,22', '143,7'),
    sale('11/04/2025', '   022391', 'DIRETA', 'A VISTA', '-212,60', '-87,22', '143,7'),
    totalNotas('2', '0,00', '0,00', '0,0'),
    RULER,
    customerHeader('000050', 'CLIENTE SEM LUC'),
    sale('15/05/2024', '   100200', 'SITE', '30 DDL', '500,00', '300,00', ''),
    totalNotas('1', '500,00', '300,00', ''),
    RULER,
    customerHeader('000099', 'CLIENTE COST ZERO'),
    sale('01/06/2024', '   100201', 'SITE', '30 DDL', '100,00', '0,00', ''),
    totalNotas('1', '100,00', '0,00', ''),
    RULER,
    totalGeral('6', '2.390,63', '1.110,19', '115,3'),
  ];

  const r = parseFKNVendas(rows);

  it('reconhece 6 Sales (2 + 2 + 1 + 1)', () => {
    expect(r.ok).toHaveLength(6);
  });

  it('herda customerCode e customerName do header CLIENTE precedente', () => {
    expect(r.ok[0]?.customerCode).toBe(1);
    expect(r.ok[0]?.customerName).toBe('GREGORUTT INDUSTRIA E COMERCIO LTDA');
    expect(r.ok[2]?.customerCode).toBe(23);
    expect(r.ok[2]?.customerName).toBe('ANIL COM PROD LIMPEZA LTDA ME');
  });

  it('VALOR negativo: movementType=return + source=inferred + warning + amount positivo', () => {
    const ret = r.ok[3];
    expect(ret?.movementType).toBe('return');
    expect(ret?.movementTypeSource).toBe('inferred_from_negative_amount');
    expect(ret?.amount).toBe(212.6);
    expect(ret?.cost).toBe(87.22);
    const w = r.warnings.find((w) =>
      w.message.includes('movementType inferido como return'),
    );
    expect(w).toBeDefined();
  });

  it('VALOR positivo: movementType=sale + source=explicit', () => {
    expect(r.ok[0]?.movementType).toBe('sale');
    expect(r.ok[0]?.movementTypeSource).toBe('explicit');
  });

  it('marginPercent from_csv quando CSV traz valor (não recalcula)', () => {
    const s = r.ok[0];
    expect(s?.marginPercent).toBe(80.1);
    expect(s?.marginPercentSource).toBe('from_csv');
  });

  it('marginPercent computed quando CSV vazio mas amount+cost ok', () => {
    const s = r.ok[4];
    expect(s?.marginPercentSource).toBe('computed');
    expect(s?.marginPercent).toBeCloseTo(40, 5);
  });

  it('marginPercent unavailable quando CSV vazio e cost zero', () => {
    const s = r.ok[5];
    expect(s?.marginPercent).toBeNull();
    expect(s?.marginPercentSource).toBe('unavailable');
  });

  it('rawColumns preserva tokenização original', () => {
    expect(r.ok[0]?.rawColumns).toEqual([
      '03/03/2023',
      '   115683',
      'DIRETA',
      'A VISTA',
      '16,90',
      '9,38',
      '80,1',
    ]);
  });

  it('produz 4 SaleAggregate scope=customer + 1 scope=global', () => {
    const customerAggs = r.aggregates.filter((a) => a.scope === 'customer');
    const globalAggs = r.aggregates.filter((a) => a.scope === 'global');
    expect(customerAggs).toHaveLength(4);
    expect(globalAggs).toHaveLength(1);
  });

  it('SaleAggregate global tem customerCode/Name null', () => {
    const g = r.aggregates.find((a) => a.scope === 'global');
    expect(g?.customerCode).toBeNull();
    expect(g?.customerName).toBeNull();
    expect(g?.invoiceCount).toBe(6);
    expect(g?.totalAmount).toBe(2390.63);
  });

  it('SaleAggregate customer mantém customerCode/Name', () => {
    const c = r.aggregates.find((a) => a.scope === 'customer');
    expect(c?.customerCode).toBe(1);
    expect(c?.customerName).toBe('GREGORUTT INDUSTRIA E COMERCIO LTDA');
  });

  it('rulers ignorados silenciosamente', () => {
    expect(r.errors).toHaveLength(0);
  });

  it('balances vazio (Vendas não usa)', () => {
    expect(r.balances).toHaveLength(0);
  });
});

describe('parseFKNVendas — robustez', () => {
  it('venda sem header CLIENTE precedente: ParseError', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      sale('03/03/2023', '1', 'DIRETA', 'A VISTA', '10,00', '5,00', '100,0'),
    ];
    const r = parseFKNVendas(rows);
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0]?.reason).toContain('sem header CLIENTE');
  });

  it('TOTAL - NOTAS sem CLIENTE precedente: ParseError', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      totalNotas('1', '10,00', '5,00', '100,0'),
    ];
    const r = parseFKNVendas(rows);
    expect(r.errors.some((e) => e.reason.includes('TOTAL - NOTAS sem'))).toBe(true);
  });

  it('VALOR não-numérico: erro pontual, parser segue', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      customerHeader('1', 'X'),
      sale('03/03/2023', '1', 'DIRETA', 'A VISTA', 'abc,XX', '5,00', '100,0'),
      sale('04/03/2023', '2', 'DIRETA', 'A VISTA', '20,00', '10,00', '100,0'),
    ];
    const r = parseFKNVendas(rows);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('VALOR NOTA');
  });

  it('cabeçalho ausente: ParseError global', () => {
    const r = parseFKNVendas([['linha qualquer'], ['outra']]);
    expect(r.ok).toHaveLength(0);
    expect(r.errors.some((e) => e.reason.includes('cabeçalho'))).toBe(true);
  });

  it('linha não reconhecida: ParseError pontual com motivo claro', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      customerHeader('1', 'X'),
      ['ALGO ESTRANHO QUE NÃO É VENDA NEM TOTAL'],
      sale('04/03/2023', '2', 'DIRETA', 'A VISTA', '20,00', '10,00', '100,0'),
    ];
    const r = parseFKNVendas(rows);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('linha não reconhecida');
  });
});

describe('parseFKNVendas — fixture real (gregorutt_vendas_2023_ate_20abr2026.csv)', () => {
  const exists = existsSync(REAL_VENDAS);

  it.skipIf(!exists)('parseia o CSV real sem erros', () => {
    const buf = readFileSync(REAL_VENDAS);
    const decoder = new TextDecoder('windows-1252');
    const content = decoder.decode(buf);
    const rows = extractCSV(content, ';');
    const r = parseFKNVendas(rows);

    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(9000);

    const customerAggs = r.aggregates.filter((a) => a.scope === 'customer');
    const globalAggs = r.aggregates.filter((a) => a.scope === 'global');
    expect(customerAggs.length).toBeGreaterThan(600);
    expect(globalAggs).toHaveLength(1);

    const global = globalAggs[0];
    expect(global?.invoiceCount).toBe(9903);
    expect(global?.totalAmount).toBe(10980335.87);

    const returns = r.ok.filter((s) => s.movementType === 'return');
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const ret of returns) {
      expect(ret.movementTypeSource).toBe('inferred_from_negative_amount');
      expect(ret.amount).toBeGreaterThan(0);
    }

    const fromCsv = r.ok.filter((s) => s.marginPercentSource === 'from_csv');
    expect(fromCsv.length).toBeGreaterThan(0);
  });
});
