import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrazilCalendarPolicy } from '../../../src/calendar/index.js';
import {
  IngestaoError,
  fknVendasAdapter,
  type AdapterContext,
} from '../../../src/ingestion/index.js';
import type { Sale, VendaComercial } from '../../../src/types/index.js';
import { SALES_FIXTURE } from '../fixtures/sales.js';

const calendar = new BrazilCalendarPolicy();

const ctx: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  source_company_code: 'comp1',
  calendar,
};

describe('fknVendasAdapter — output básico', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('5 sales na fixture, 1 é return → 4 VendaComercial[]', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    expect(vendas).toHaveLength(4);
    expect(vendas.every((v) => v.origem === 'fkn')).toBe(true);
    expect(vendas.every((v) => v.contraparte_tipo === 'cliente')).toBe(true);
  });

  it('return e cancellation NÃO viram VendaComercial', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const fromReturn = vendas.find((v) => v.origem_ref === 'NF-557');
    expect(fromReturn).toBeUndefined();
  });

  it('campos básicos preservados (valor, data_emissao, contraparte_id)', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const v1 = vendas.find((v) => v.origem_ref === 'NF-555')!;
    expect(v1.valor).toBe(1200);
    expect(v1.data_emissao.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(v1.contraparte_id).toBe('1001');
    expect(v1.documento_ref).toBe('NF-555');
    expect(v1.source_company_code).toBe('comp1');
  });

  it('prazo derivado: "À VISTA" → a_vista, "30/60/90" → a_prazo', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const aVista = vendas.find((v) => v.origem_ref === 'NF-555')!;
    const aPrazo = vendas.find((v) => v.origem_ref === 'NF-556')!;
    expect(aVista.prazo).toBe('a_vista');
    expect(aPrazo.prazo).toBe('a_prazo');
  });

  it('customerCode = 0 → VendaComercial sem contraparte_id', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const consumFinal = vendas.find((v) => v.origem_ref === 'NF-558')!;
    expect(consumFinal.contraparte_id).toBeUndefined();
  });
});

describe('fknVendasAdapter — origem_ref e ID determinístico', () => {
  it('com invoiceNumber → origem_ref = invoiceNumber', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const v = vendas.find((x) => x.documento_ref === 'NF-555')!;
    expect(v.origem_ref).toBe('NF-555');
  });

  it('sem invoiceNumber → origem_ref = parser id', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    // Sale 3 tem invoiceNumber vazio. origem_ref deve ser 'fkn-sale:3'.
    const v = vendas.find((x) => x.origem_ref === 'fkn-sale:3')!;
    expect(v).toBeDefined();
    expect(v.documento_ref).toBeUndefined();
  });

  it('id determinístico: rodar 2× → mesmos ids', () => {
    const a = fknVendasAdapter(SALES_FIXTURE, ctx);
    const b = fknVendasAdapter(SALES_FIXTURE, ctx);
    expect(a.map((v) => v.id)).toEqual(b.map((v) => v.id));
  });

  it('id segue template fkn_vendas_{ref}_{cli}_{le}', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    const v = vendas.find((x) => x.origem_ref === 'NF-555')!;
    expect(v.id).toBe('fkn_vendas_NF-555_c1_le1');
  });
});

describe('fknVendasAdapter — validação (fail visibly)', () => {
  it('amount = 0 → IngestaoError', () => {
    const bad: Sale = {
      ...SALES_FIXTURE[0]!,
      id: 'bad-1',
      amount: 0,
    };
    expect(() => fknVendasAdapter([bad], ctx)).toThrow(IngestaoError);
  });

  it('amount negativo → IngestaoError', () => {
    const bad: Sale = {
      ...SALES_FIXTURE[0]!,
      id: 'bad-2',
      amount: -100,
    };
    expect(() => fknVendasAdapter([bad], ctx)).toThrow(IngestaoError);
  });

  it('issuedAt NaN → IngestaoError', () => {
    const bad: Sale = {
      ...SALES_FIXTURE[0]!,
      id: 'bad-3',
      issuedAt: new Date(NaN),
    };
    expect(() => fknVendasAdapter([bad], ctx)).toThrow(IngestaoError);
  });

  it('invoiceNumber e id ambos vazios → IngestaoError', () => {
    const bad: Sale = {
      ...SALES_FIXTURE[0]!,
      id: '',
      invoiceNumber: '',
    };
    expect(() => fknVendasAdapter([bad], ctx)).toThrow(IngestaoError);
  });
});

describe('fknVendasAdapter — invariante: VendaComercial não é EventoCaixa', () => {
  it('TS impede atribuir resultado a EventoCaixa[]', () => {
    const vendas = fknVendasAdapter(SALES_FIXTURE, ctx);
    // Validação runtime: estrutura comercial não tem campo `status` nem
    // `direcao` (que `EventoCaixa` exige). Garante separação física.
    for (const v of vendas) {
      // Asserção via cast intencional para inspecionar shape em runtime.
      const asUnknown = v as unknown as Record<string, unknown>;
      expect(asUnknown['status']).toBeUndefined();
      expect(asUnknown['direcao']).toBeUndefined();
      expect(asUnknown['data_realizada']).toBeUndefined();
    }
  });

  it('shape de VendaComercial — campos esperados presentes', () => {
    const vendas: VendaComercial[] = fknVendasAdapter(SALES_FIXTURE, ctx);
    for (const v of vendas) {
      expect(typeof v.id).toBe('string');
      expect(typeof v.cliente_id).toBe('string');
      expect(typeof v.legal_entity_id).toBe('string');
      expect(v.origem).toBe('fkn');
      expect(typeof v.origem_ref).toBe('string');
      expect(v.data_emissao).toBeInstanceOf(Date);
      expect(typeof v.valor).toBe('number');
      expect(v.contraparte_tipo).toBe('cliente');
      expect(['a_vista', 'a_prazo']).toContain(v.prazo);
    }
  });
});
