import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrazilCalendarPolicy } from '../../../src/calendar/index.js';
import type { Payable } from '../../../src/types/index.js';
import {
  IngestaoError,
  fknApAdapter,
  type AdapterContext,
} from '../../../src/ingestion/index.js';
import { PAYABLES_FIXTURE } from '../fixtures/payables.js';

const calendar = new BrazilCalendarPolicy();

const ctx: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  source_company_code: 'comp1',
  calendar,
};

describe('fknApAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('produz EventoCaixa[] com tamanho da fixture', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    expect(eventos).toHaveLength(PAYABLES_FIXTURE.length);
  });

  it('Payable em aberto → status confirmado / saida com data_esperada=data_vencimento', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const aberto = eventos.find((e) => e.origem_ref === 'fkn-ap:1')!;
    expect(aberto.status).toBe('confirmado');
    expect(aberto.direcao).toBe('saida');
    expect(aberto.valor).toBe(1500);
    if (aberto.status === 'confirmado') {
      expect(aberto.data_realizada).toBeNull();
      expect(aberto.data_vencimento.toISOString()).toBe(
        '2026-05-15T00:00:00.000Z',
      );
      // passthrough nesta etapa: data_esperada === data_vencimento
      expect(aberto.data_esperada.toISOString()).toBe(
        aberto.data_vencimento.toISOString(),
      );
    }
  });

  it('Payable liquidado → status realizado / saida com data_esperada=data_realizada', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const baixado = eventos.find((e) => e.origem_ref === 'fkn-ap:2')!;
    expect(baixado.status).toBe('realizado');
    expect(baixado.direcao).toBe('saida');
    expect(baixado.valor).toBe(800.5);
    if (baixado.status === 'realizado') {
      expect(baixado.data_realizada.toISOString()).toBe(
        '2026-04-30T00:00:00.000Z',
      );
      expect(baixado.data_esperada.toISOString()).toBe(
        baixado.data_realizada.toISOString(),
      );
    }
  });

  it('realizado em SÁBADO preserva data_esperada=data_realizada — sem calendário', () => {
    // :3.paidAt = 2026-04-18 (sábado). Para `realizado`, calendar NÃO é
    // aplicado: data_esperada permanece em sábado mesmo sendo dia não-útil.
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const atrasado = eventos.find((e) => e.origem_ref === 'fkn-ap:3')!;
    expect(atrasado.status).toBe('realizado');
    if (atrasado.status === 'realizado') {
      expect(atrasado.data_realizada.toISOString()).toBe(
        '2026-04-18T00:00:00.000Z',
      );
      // Sanity check: 2026-04-18 é mesmo sábado.
      expect(atrasado.data_realizada.getUTCDay()).toBe(6);
      expect(atrasado.data_esperada.toISOString()).toBe(
        atrasado.data_realizada.toISOString(),
      );
    }
  });

  it('confirmado com vencimento em DOMINGO move data_esperada para próximo dia útil', () => {
    // :4.dueDate = 2026-04-05 (domingo). Próximo dia útil = 2026-04-06 (segunda).
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const dominical = eventos.find((e) => e.origem_ref === 'fkn-ap:4')!;
    expect(dominical.status).toBe('confirmado');
    if (dominical.status === 'confirmado') {
      // data_vencimento permanece em domingo (preservada para drill-down).
      expect(dominical.data_vencimento.toISOString()).toBe(
        '2026-04-05T00:00:00.000Z',
      );
      expect(dominical.data_vencimento.getUTCDay()).toBe(0);
      // data_esperada move para segunda.
      expect(dominical.data_esperada.toISOString()).toBe(
        '2026-04-06T00:00:00.000Z',
      );
      expect(dominical.data_esperada.getUTCDay()).toBe(1);
    }
  });

  it('campos comuns: bucket técnico, criticidade pendente, confiança alta, is_transferencia false', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    for (const e of eventos) {
      expect(e.bucket_id).toBe('pendente_classificacao');
      expect(e.bucket_nome).toBe('Pendente de classificação');
      expect(e.criticidade).toBe('pendente');
      expect(e.confianca).toBe('alta');
      expect(e.confianca_origem).toBe('sistema');
      expect(e.is_transferencia).toBe(false);
      expect(e.origem).toBe('fkn');
      expect(e.cliente_id).toBe('c1');
      expect(e.legal_entity_id).toBe('le1');
      expect(e.source_company_code).toBe('comp1');
    }
  });

  it('valor sempre positivo; direção sempre saida', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    for (const e of eventos) {
      expect(e.valor).toBeGreaterThan(0);
      expect(e.direcao).toBe('saida');
    }
  });

  it('contraparte_tipo=fornecedor; contraparte_id derivado do vendorCode', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    for (const e of eventos) {
      expect(e.contraparte_tipo).toBe('fornecedor');
      expect(e.contraparte_id).toBeDefined();
    }
    const ev1 = eventos.find((e) => e.origem_ref === 'fkn-ap:1')!;
    expect(ev1.contraparte_id).toBe('12345');
  });

  it('documento_ref preenchido quando docNumber não vazio; ausente quando vazio', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const comDoc = eventos.find((e) => e.origem_ref === 'fkn-ap:1')!;
    expect(comDoc.documento_ref).toBe('NF 555');
    const semDoc = eventos.find((e) => e.origem_ref === 'fkn-ap:4')!;
    expect(semDoc.documento_ref).toBeUndefined();
  });

  it('id determinístico no formato fkn_${payable.id}_${cliente_id}_${legal_entity_id}', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const ev = eventos.find((e) => e.origem_ref === 'fkn-ap:1')!;
    expect(ev.id).toBe('fkn_fkn-ap:1_c1_le1');
  });

  it('determinismo: mesmo input → mesmo output (com clock fixo)', () => {
    const a = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const b = fknApAdapter(PAYABLES_FIXTURE, ctx);
    expect(a).toEqual(b);
  });

  it('valor <= 0 lança IngestaoError', () => {
    const bad: Payable = {
      ...PAYABLES_FIXTURE[0]!,
      id: 'fkn-ap:bad',
      amount: -100,
    };
    expect(() => fknApAdapter([bad], ctx)).toThrow(IngestaoError);
    expect(() => fknApAdapter([bad], ctx)).toThrow(/valor deve ser positivo/);
  });

  it('valor zero lança IngestaoError', () => {
    const bad: Payable = {
      ...PAYABLES_FIXTURE[0]!,
      id: 'fkn-ap:zero',
      amount: 0,
    };
    expect(() => fknApAdapter([bad], ctx)).toThrow(IngestaoError);
  });

  it('dueDate inválida lança IngestaoError', () => {
    const bad: Payable = {
      ...PAYABLES_FIXTURE[0]!,
      id: 'fkn-ap:nodate',
      dueDate: new Date(Number.NaN),
    };
    expect(() => fknApAdapter([bad], ctx)).toThrow(IngestaoError);
    expect(() => fknApAdapter([bad], ctx)).toThrow(/dueDate/);
  });

  it('paidAt inválida (NaN) em título marcado pago lança IngestaoError', () => {
    const bad: Payable = {
      ...PAYABLES_FIXTURE[1]!,
      id: 'fkn-ap:bad-paid',
      paidAt: new Date(Number.NaN),
    };
    expect(() => fknApAdapter([bad], ctx)).toThrow(IngestaoError);
  });

  /* ─── Estágio 1.6 — texto observado da origem ─── */

  it('preenche contraparte_nome_origem com vendorName (raw)', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    const ev = eventos.find((e) => e.origem_ref === 'fkn-ap:1')!;
    expect(ev.contraparte_nome_origem).toBe('Fornecedor Alpha LTDA');
  });

  it('vendorName em branco → contraparte_nome_origem undefined (não vazia)', () => {
    const semNome: Payable = {
      ...PAYABLES_FIXTURE[0]!,
      id: 'fkn-ap:noname',
      vendorName: '   ',
    };
    const eventos = fknApAdapter([semNome], ctx);
    expect(eventos[0]!.contraparte_nome_origem).toBeUndefined();
  });

  it('FKN AP não preenche descricao_origem nem conta_origem_nome (formato CSV não traz)', () => {
    const eventos = fknApAdapter(PAYABLES_FIXTURE, ctx);
    for (const ev of eventos) {
      expect(ev.descricao_origem).toBeUndefined();
      expect(ev.conta_origem_nome).toBeUndefined();
    }
  });
});
