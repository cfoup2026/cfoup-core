import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractCSV } from '../../src/csv/extractor.js';
import { parseFKNAp } from '../../src/parsers/fkn-ap.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_CP = resolve(fixturesDir, 'gregorutt_cp_2023_ate_20abr2026.csv');

const HEADER_PREAMBLE: string[][] = [
  ['GREGORUTT IND. E COM. LTDA', 'PAG.: 1 de 85', ''],
  ['', 'DATA: 20/04/2026', ''],
  ['SISTEMA DE GESTÃO EMPRESARIAL', '15:59', ''],
  ['CONTAS A PAGAR POR DATA: GERAL', 'FKN(086)-00', ''],
  [
    'EMIS',
    'CONTA',
    'FORNECEDOR',
    'DOCUM.',
    'FIL',
    'VALOR',
    'VALOR PAGO',
    'VCTO',
    'PGTO',
    'ATR',
    'PORTADOR',
    'PRZ',
    '',
  ],
];

function payable(
  emis: string,
  conta: string,
  fornecedor: string,
  docum: string,
  fil: string,
  valor: string,
  valorPago: string,
  vcto: string,
  pgto: string,
  atr: string,
  portador: string,
  prz: string,
): string[] {
  return [emis, conta, fornecedor, docum, fil, valor, valorPago, vcto, pgto, atr, portador, prz, ''];
}

function totalDoDia(due: string, paid: string): string[] {
  return ['', 'TOTAL DO DIA.....:', due, paid, 'J/D:', '0,00', 'EM ABERTO:', '0,00', ''];
}

describe('parseFKNAp — happy path com fixture sintética', () => {
  const rows = [
    ...HEADER_PREAMBLE,
    payable(
      '01/01/2023',
      '14003',
      'CONSELHO REGIONAL DE QU',
      '130208-1',
      '1',
      '285,13',
      '285,13',
      '30/03/2023',
      '30/03/2023',
      '0',
      'BOLETO',
      '88',
    ),
    payable(
      '01/01/2023',
      '01167',
      'CHEMIX PROD QUIMICOS',
      '$4821/1',
      '1',
      '4.732,25',
      '3.630,06',
      '23/02/2023',
      '11/01/2023',
      '0',
      'CHEQUE',
      '43',
    ),
    payable(
      '02/01/2023',
      '01300',
      'FORNECEDOR EM ABERTO',
      'AAA-1',
      '1',
      '1.000,00',
      '0,00',
      '15/01/2023',
      '',
      '0',
      'BOLETO',
      '13',
    ),
    payable(
      '03/01/2023',
      '01400',
      'FORNECEDOR PAGO A MAIS',
      'BBB-1',
      '1',
      '500,00',
      '510,00',
      '10/01/2023',
      '10/01/2023',
      '0',
      'PIX',
      '7',
    ),
    payable(
      '04/01/2023',
      '01500',
      'FORN A VISTA',
      'CCC-1',
      '1',
      '200,00',
      '200,00',
      'A VISTA',
      '04/01/2023',
      '0',
      'DINHEIRO',
      '0',
    ),
    totalDoDia('6.717,38', '4.625,19'),
  ];

  const r = parseFKNAp(rows);

  it('reconhece 5 Payables', () => {
    expect(r.ok).toHaveLength(5);
  });

  it('1 DailyTotal datado pelo último Payable visto', () => {
    expect(r.dailyTotals).toHaveLength(1);
    expect(r.dailyTotals[0]?.totalDue).toBe(6717.38);
    expect(r.dailyTotals[0]?.totalPaid).toBe(4625.19);
    expect(r.dailyTotals[0]?.accountType).toBe('AP');
    expect(r.dailyTotals[0]?.date.toISOString()).toBe('2023-01-04T00:00:00.000Z');
  });

  it('balances vazio (AP não usa balances)', () => {
    expect(r.balances).toHaveLength(0);
  });

  it('status: paid quando amountPaid ≈ amount', () => {
    expect(r.ok[0]?.status).toBe('paid');
  });

  it('status: partial quando 0 < amountPaid < amount', () => {
    expect(r.ok[1]?.status).toBe('partial');
  });

  it('status: open quando amountPaid ≈ 0', () => {
    expect(r.ok[2]?.status).toBe('open');
    expect(r.ok[2]?.paidAt).toBeNull();
  });

  it('status: overpaid quando amountPaid > amount + epsilon', () => {
    expect(r.ok[3]?.status).toBe('overpaid');
  });

  it('VCTO=A VISTA: dueDate vira issuedAt + warning', () => {
    const aVista = r.ok[4];
    expect(aVista).toBeDefined();
    expect(aVista?.dueDate.toISOString()).toBe('2023-01-04T00:00:00.000Z');
    expect(aVista?.issuedAt.toISOString()).toBe('2023-01-04T00:00:00.000Z');
    const w = r.warnings.find((w) => w.message.includes('A VISTA'));
    expect(w).toBeDefined();
  });

  it('docNumber raw preservado + warning quando contém "$"', () => {
    expect(r.ok[1]?.docNumber).toBe('$4821/1');
    const w = r.warnings.find((w) => w.message.includes('caractere não-padrão'));
    expect(w).toBeDefined();
  });

  it('datas em UTC', () => {
    expect(r.ok[0]?.issuedAt.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(r.ok[0]?.dueDate.toISOString()).toBe('2023-03-30T00:00:00.000Z');
    expect(r.ok[0]?.paidAt?.toISOString()).toBe('2023-03-30T00:00:00.000Z');
  });

  it('zero erros', () => {
    expect(r.errors).toHaveLength(0);
  });
});

describe('parseFKNAp — robustez', () => {
  it('TOTAL DO DIA antes de qualquer Payable: ParseError', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      totalDoDia('100,00', '100,00'),
      payable(
        '01/01/2023',
        '14003',
        'X',
        'D-1',
        '1',
        '100,00',
        '100,00',
        '30/03/2023',
        '30/03/2023',
        '0',
        'BOLETO',
        '88',
      ),
    ];
    const r = parseFKNAp(rows);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.reason).toContain('antes de qualquer Payable');
    expect(r.ok).toHaveLength(1);
  });

  it('VCTO=A VISTA com EMIS vazio: ParseError', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      payable(
        '',
        '14003',
        'X',
        'D-1',
        '1',
        '100,00',
        '100,00',
        'A VISTA',
        '01/01/2023',
        '0',
        'PIX',
        '0',
      ),
    ];
    const r = parseFKNAp(rows);
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0]?.reason).toContain('EMIS');
  });

  it('VALOR não-numérico: ParseError pontual, segue', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      payable(
        '01/01/2023',
        '14003',
        'BUG',
        'X',
        '1',
        'abc,XX',
        '0,00',
        '30/03/2023',
        '',
        '0',
        'BOLETO',
        '88',
      ),
      payable(
        '01/01/2023',
        '14003',
        'OK',
        'Y',
        '1',
        '50,00',
        '50,00',
        '30/03/2023',
        '30/03/2023',
        '0',
        'BOLETO',
        '88',
      ),
    ];
    const r = parseFKNAp(rows);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('VALOR');
  });

  it('cabeçalho ausente: ParseError global', () => {
    const rows = [['linha qualquer'], ['outra'], ['mais uma']];
    const r = parseFKNAp(rows);
    expect(r.ok).toHaveLength(0);
    expect(r.errors.some((e) => e.reason.includes('cabeçalho'))).toBe(true);
  });

  it('linhas em branco entre Payables: ignoradas silenciosamente', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      payable(
        '01/01/2023',
        '14003',
        'X',
        'A',
        '1',
        '50,00',
        '50,00',
        '30/03/2023',
        '30/03/2023',
        '0',
        'BOLETO',
        '88',
      ),
      [''],
      payable(
        '02/01/2023',
        '14003',
        'Y',
        'B',
        '1',
        '60,00',
        '60,00',
        '30/03/2023',
        '30/03/2023',
        '0',
        'BOLETO',
        '88',
      ),
    ];
    const r = parseFKNAp(rows);
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });
});

describe('parseFKNAp — fixture real (gregorutt_cp_2023_ate_20abr2026.csv)', () => {
  const exists = existsSync(REAL_CP);

  it.skipIf(!exists)('parseia o CSV real sem erros', () => {
    const buf = readFileSync(REAL_CP);
    const decoder = new TextDecoder('windows-1252');
    const content = decoder.decode(buf);
    const rows = extractCSV(content, ';');
    const r = parseFKNAp(rows);

    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(6000);
    expect(r.dailyTotals.length).toBeGreaterThan(800);

    const first = r.ok[0];
    expect(first?.issuedAt.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(first?.vendorCode).toBe(14003);
    expect(first?.amount).toBe(285.13);
    expect(first?.amountPaid).toBe(285.13);
    expect(first?.status).toBe('paid');
    expect(first?.paymentMethod).toBe('BOLETO');
    expect(first?.docNumber).toBe('130208-1');

    for (const p of r.ok) {
      expect(p.amount).toBeGreaterThanOrEqual(0);
      expect(p.amountPaid).toBeGreaterThanOrEqual(0);
    }

    const statuses = new Set(r.ok.map((p) => p.status));
    expect(statuses.has('paid')).toBe(true);

    const dollarDocs = r.warnings.filter((w) =>
      w.message.includes('caractere não-padrão'),
    );
    expect(dollarDocs.length).toBeGreaterThan(0);
  });
});
