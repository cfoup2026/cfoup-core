import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrazilCalendarPolicy } from '../../../src/calendar/index.js';
import type { Receivable } from '../../../src/types/index.js';
import {
  IngestaoError,
  fknArAdapter,
  type AdapterContext,
} from '../../../src/ingestion/index.js';
import { RECEIVABLES_FIXTURE } from '../fixtures/receivables.js';

const calendar = new BrazilCalendarPolicy();

const ctx: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  source_company_code: 'comp1',
  calendar,
};

describe('fknArAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('produz EventoCaixa[] com tamanho da fixture', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    expect(eventos).toHaveLength(RECEIVABLES_FIXTURE.length);
  });

  it('Receivable em aberto → confirmado / entrada com data_esperada=data_vencimento', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const aberto = eventos.find((e) => e.origem_ref === 'fkn-ar:1')!;
    expect(aberto.status).toBe('confirmado');
    expect(aberto.direcao).toBe('entrada');
    expect(aberto.valor).toBe(4250);
    if (aberto.status === 'confirmado') {
      expect(aberto.data_realizada).toBeNull();
      expect(aberto.data_vencimento.toISOString()).toBe(
        '2026-05-20T00:00:00.000Z',
      );
      // passthrough nesta etapa: data_esperada === data_vencimento
      expect(aberto.data_esperada.toISOString()).toBe(
        aberto.data_vencimento.toISOString(),
      );
    }
  });

  it('Receivable recebido → realizado / entrada com data_esperada=data_realizada', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const recebido = eventos.find((e) => e.origem_ref === 'fkn-ar:2')!;
    expect(recebido.status).toBe('realizado');
    expect(recebido.direcao).toBe('entrada');
    expect(recebido.valor).toBe(9800);
    if (recebido.status === 'realizado') {
      expect(recebido.data_realizada.toISOString()).toBe(
        '2026-04-28T00:00:00.000Z',
      );
      expect(recebido.data_esperada.toISOString()).toBe(
        recebido.data_realizada.toISOString(),
      );
    }
  });

  it('realizado em SÁBADO preserva data_esperada=data_realizada — sem calendário', () => {
    // :3.paidAt = 2026-04-25 (sábado). Para `realizado`, calendar NÃO é
    // aplicado: data_esperada permanece em sábado.
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const sabado = eventos.find((e) => e.origem_ref === 'fkn-ar:3')!;
    expect(sabado.status).toBe('realizado');
    if (sabado.status === 'realizado') {
      expect(sabado.data_realizada.toISOString()).toBe(
        '2026-04-25T00:00:00.000Z',
      );
      expect(sabado.data_realizada.getUTCDay()).toBe(6);
      expect(sabado.data_esperada.toISOString()).toBe(
        sabado.data_realizada.toISOString(),
      );
    }
  });

  it('confirmado com vencimento em FIM DE SEMANA move data_esperada (caso interno: terça=Tiradentes em 2026)', () => {
    // dueDate em feriado: cria Receivable com dueDate em 2026-04-21 (Tiradentes — terça).
    // Próximo dia útil = 2026-04-22 (quarta).
    const recebivelFeriado: Receivable = {
      ...RECEIVABLES_FIXTURE[0]!,
      id: 'fkn-ar:tiradentes',
      dueDate: new Date(Date.UTC(2026, 3, 21)),
      paidAt: null,
    };
    const eventos = fknArAdapter([recebivelFeriado], ctx);
    const e = eventos[0]!;
    expect(e.status).toBe('confirmado');
    if (e.status === 'confirmado') {
      expect(e.data_vencimento.toISOString()).toBe(
        '2026-04-21T00:00:00.000Z',
      );
      expect(e.data_esperada.toISOString()).toBe(
        '2026-04-22T00:00:00.000Z',
      );
    }
  });

  it('campos comuns: bucket técnico, criticidade pendente, confiança alta', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    for (const e of eventos) {
      expect(e.bucket_id).toBe('pendente_classificacao');
      expect(e.bucket_nome).toBe('Pendente de classificação');
      expect(e.criticidade).toBe('pendente');
      expect(e.confianca).toBe('alta');
      expect(e.confianca_origem).toBe('sistema');
      expect(e.is_transferencia).toBe(false);
      expect(e.origem).toBe('fkn');
      expect(e.contraparte_tipo).toBe('cliente');
    }
  });

  it('valor sempre positivo; direção sempre entrada', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    for (const e of eventos) {
      expect(e.valor).toBeGreaterThan(0);
      expect(e.direcao).toBe('entrada');
    }
  });

  it('contraparte_id derivado de customerCode', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const ev1 = eventos.find((e) => e.origem_ref === 'fkn-ar:1')!;
    expect(ev1.contraparte_id).toBe('1001');
  });

  it('documento_ref preenchido quando docNumber não vazio', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const comDoc = eventos.find((e) => e.origem_ref === 'fkn-ar:1')!;
    expect(comDoc.documento_ref).toBe('NF-12001/01');
    const semDoc = eventos.find((e) => e.origem_ref === 'fkn-ar:4')!;
    expect(semDoc.documento_ref).toBeUndefined();
  });

  it('id determinístico fkn_${receivable.id}_${cliente_id}_${legal_entity_id}', () => {
    const eventos = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const ev = eventos.find((e) => e.origem_ref === 'fkn-ar:1')!;
    expect(ev.id).toBe('fkn_fkn-ar:1_c1_le1');
  });

  it('determinismo: mesmo input → mesmo output (com clock fixo)', () => {
    const a = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    const b = fknArAdapter(RECEIVABLES_FIXTURE, ctx);
    expect(a).toEqual(b);
  });

  it('valor <= 0 lança IngestaoError', () => {
    const bad: Receivable = {
      ...RECEIVABLES_FIXTURE[0]!,
      id: 'fkn-ar:bad',
      amount: -100,
    };
    expect(() => fknArAdapter([bad], ctx)).toThrow(IngestaoError);
    expect(() => fknArAdapter([bad], ctx)).toThrow(/valor deve ser positivo/);
  });

  it('dueDate inválida lança IngestaoError', () => {
    const bad: Receivable = {
      ...RECEIVABLES_FIXTURE[0]!,
      id: 'fkn-ar:nodate',
      dueDate: new Date(Number.NaN),
    };
    expect(() => fknArAdapter([bad], ctx)).toThrow(IngestaoError);
    expect(() => fknArAdapter([bad], ctx)).toThrow(/dueDate/);
  });
});
