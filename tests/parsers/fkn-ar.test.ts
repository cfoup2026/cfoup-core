import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractCSV } from '../../src/csv/extractor.js';
import { parseFKNAr } from '../../src/parsers/fkn-ar.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_CR = resolve(fixturesDir, 'gregorutt_cr_2023_ate_20abr2026.csv');

const HEADER_PREAMBLE: string[][] = [
  ['GREGORUTT IND. E COM. LTDA', 'PAG.: 1 de 154', ''],
  ['', 'DATA: 20/04/2026', ''],
  ['SISTEMA DE GESTÃO EMPRESARIAL', '15:52', ''],
  ['CONTAS A RECEBER POR DATA: GERAL', 'FKN(074)-00', ''],
  [
    'EMIS',
    'COD.',
    'CLIENTE',
    'FIL',
    'DUPLIC.',
    'ID',
    'VALOR',
    'VALOR PAGO',
    'VCTO',
    'PGTO',
    'ATR',
    'PORTADOR',
    'TIP',
    'NOSSO NRO / BCO',
    '',
  ],
];

function receivable(
  emis: string,
  cod: string,
  cliente: string,
  fil: string,
  duplic: string,
  id: string,
  valor: string,
  valorPago: string,
  vcto: string,
  pgto: string,
  atr: string,
  portador: string,
  tip: string,
  nossoNro: string,
): string[] {
  return [
    emis, cod, cliente, fil, duplic, id, valor, valorPago,
    vcto, pgto, atr, portador, tip, nossoNro, '',
  ];
}

function totalDoDia(due: string, paid: string): string[] {
  return ['', 'TOTAL DO DIA..:', due, paid, 'JUROS/DESC:', '0,00', 'QTD:', '5', ''];
}

describe('parseFKNAr — happy path com fixture sintética', () => {
  const rows = [
    ...HEADER_PREAMBLE,
    receivable(
      '03/01/23',
      '001747',
      'MAURILIO SOARES BA',
      '01',
      '018794/1',
      '62333',
      '334,12',
      '334,12',
      'A VISTA',
      '03/01/23',
      '0',
      'PIX',
      '',
      '/005',
    ),
    receivable(
      '03/01/23',
      '002174',
      'SNOW CLEAN DISTRIB',
      '01',
      '018795/1',
      '62339',
      '5.051,50',
      '5.047,80',
      '31/01/23',
      '26/01/23',
      '0',
      'BOLETO',
      '',
      '/005',
    ),
    receivable(
      '03/01/23',
      '002245',
      'MGD SOLUCOES',
      '01',
      '018798/1',
      '62342',
      '2.641,21',
      '0,00',
      '18/01/23',
      '00/00/00',
      '1188',
      'BOLETO',
      '',
      '',
    ),
    receivable(
      '04/01/23',
      '003000',
      'CLIENTE PAGOU MAIS',
      '01',
      '018800/1',
      '62350',
      '500,00',
      '510,00',
      '10/01/23',
      '10/01/23',
      '0',
      'PIX',
      '',
      '',
    ),
    totalDoDia('8.526,83', '5.892,02'),
    ['', 'Obs:', 'ENTRADA PARA CARTORIO 27/01/23 6,25', ''],
    receivable(
      '05/01/23',
      '004000',
      'NORMAL',
      '01',
      '018801/1',
      '62360',
      '100,00',
      '100,00',
      '15/01/23',
      '15/01/23',
      '0',
      'BOLETO',
      '',
      '',
    ),
  ];

  const r = parseFKNAr(rows);

  it('reconhece 5 Receivables', () => {
    expect(r.ok).toHaveLength(5);
  });

  it('1 DailyTotal accountType=AR', () => {
    expect(r.dailyTotals).toHaveLength(1);
    expect(r.dailyTotals[0]?.accountType).toBe('AR');
    expect(r.dailyTotals[0]?.totalDue).toBe(8526.83);
  });

  it('VCTO=A VISTA: dueDateSource=inferred_from_issue_date', () => {
    const aVista = r.ok[0];
    expect(aVista?.dueDate.toISOString()).toBe('2023-01-03T00:00:00.000Z');
    expect(aVista?.issuedAt.toISOString()).toBe('2023-01-03T00:00:00.000Z');
    expect(aVista?.dueDateSource).toBe('inferred_from_issue_date');
  });

  it('VCTO data válida: dueDateSource=explicit', () => {
    const normal = r.ok[1];
    expect(normal?.dueDate.toISOString()).toBe('2023-01-31T00:00:00.000Z');
    expect(normal?.dueDateSource).toBe('explicit');
  });

  it('PGTO=00/00/00 vira paidAt=null sem warning', () => {
    const naopago = r.ok[2];
    expect(naopago?.paidAt).toBeNull();
    expect(naopago?.status).toBe('open');
    const sentinelWarnings = r.warnings.filter((w) =>
      w.message.includes('00/00/00'),
    );
    expect(sentinelWarnings).toHaveLength(0);
  });

  it('status: paid / partial / open / overpaid corretos', () => {
    expect(r.ok[0]?.status).toBe('paid');
    expect(r.ok[1]?.status).toBe('partial');
    expect(r.ok[2]?.status).toBe('open');
    expect(r.ok[3]?.status).toBe('overpaid');
  });

  it('linha Obs: ignorada silenciosamente, parser segue', () => {
    expect(r.ok).toHaveLength(5);
    const obsErrors = r.errors.filter((e) => e.raw.includes('Obs:'));
    expect(obsErrors).toHaveLength(0);
  });

  it('campos AR-específicos preservados raw', () => {
    expect(r.ok[0]?.installmentId).toBe('62333');
    expect(r.ok[0]?.bankRef).toBe('/005');
    expect(r.ok[2]?.documentType).toBe('');
    expect(r.ok[2]?.bankRef).toBe('');
  });

  it('zero erros', () => {
    expect(r.errors).toHaveLength(0);
  });

  it('amounts sempre não-negativos', () => {
    for (const x of r.ok) {
      expect(x.amount).toBeGreaterThanOrEqual(0);
      expect(x.amountPaid).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('parseFKNAr — robustez', () => {
  it('cabeçalho ausente: ParseError global', () => {
    const r = parseFKNAr([['linha qualquer'], ['outra']]);
    expect(r.ok).toHaveLength(0);
    expect(r.errors.some((e) => e.reason.includes('cabeçalho'))).toBe(true);
  });

  it('TOTAL DO DIA antes de qualquer Receivable: ParseError', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      totalDoDia('100,00', '100,00'),
      receivable(
        '03/01/23',
        '001',
        'X',
        '01',
        'D-1',
        'I-1',
        '100,00',
        '100,00',
        '03/01/23',
        '03/01/23',
        '0',
        'PIX',
        '',
        '',
      ),
    ];
    const r = parseFKNAr(rows);
    expect(r.errors[0]?.reason).toContain('antes de qualquer Receivable');
    expect(r.ok).toHaveLength(1);
  });

  it('rodapés DESCONTADOS / CAUCIONADOS / OUTROS: skip silencioso', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      receivable(
        '03/01/23',
        '001',
        'X',
        '01',
        'D-1',
        'I-1',
        '100,00',
        '100,00',
        '03/01/23',
        '03/01/23',
        '0',
        'PIX',
        '',
        '',
      ),
      ['', 'DESCONTADOS.......', '0,00', '0,00'],
      ['', 'CAUCIONADOS.......', '0,00', '0,00'],
      ['', 'OUTROS (cs,demais)', '12.000,00', '11.000,00'],
    ];
    const r = parseFKNAr(rows);
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(1);
  });

  it('VALOR não-numérico: erro pontual, parser segue', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      receivable(
        '03/01/23',
        '001',
        'BUG',
        '01',
        'D-1',
        'I',
        'abc,XX',
        '0,00',
        '03/01/23',
        '00/00/00',
        '0',
        'PIX',
        '',
        '',
      ),
      receivable(
        '03/01/23',
        '002',
        'OK',
        '01',
        'D-2',
        'I',
        '50,00',
        '50,00',
        '03/01/23',
        '03/01/23',
        '0',
        'BOLETO',
        '',
        '',
      ),
    ];
    const r = parseFKNAr(rows);
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });

  it('PGTO em formato data inválida: warning + paidAt=null, mantém Receivable', () => {
    const rows = [
      ...HEADER_PREAMBLE,
      receivable(
        '03/01/23',
        '001',
        'X',
        '01',
        'D-1',
        'I',
        '100,00',
        '100,00',
        '03/01/23',
        '99/99/23',
        '0',
        'PIX',
        '',
        '',
      ),
    ];
    const r = parseFKNAr(rows);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]?.paidAt).toBeNull();
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.message.includes('PGTO'))).toBe(true);
  });
});

describe('parseFKNAr — fixture real (gregorutt_cr_2023_ate_20abr2026.csv)', () => {
  const exists = existsSync(REAL_CR);

  it.skipIf(!exists)('parseia o CSV real sem erros', () => {
    const buf = readFileSync(REAL_CR);
    const decoder = new TextDecoder('windows-1252');
    const content = decoder.decode(buf);
    const rows = extractCSV(content, ';');
    const r = parseFKNAr(rows);

    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(10000);
    expect(r.dailyTotals.length).toBeGreaterThan(700);

    const first = r.ok[0];
    expect(first?.issuedAt.toISOString()).toBe('2023-01-03T00:00:00.000Z');
    expect(first?.customerCode).toBe(1747);
    expect(first?.amount).toBe(334.12);

    const aVistas = r.ok.filter(
      (x) => x.dueDateSource === 'inferred_from_issue_date',
    );
    expect(aVistas.length).toBeGreaterThan(0);

    const explicits = r.ok.filter((x) => x.dueDateSource === 'explicit');
    expect(explicits.length).toBeGreaterThan(0);
  });
});
