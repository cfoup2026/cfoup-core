import { describe, expect, it } from 'vitest';
import {
  ReconciliacaoError,
  detectaTransferenciaInterna,
  type EventoCaixa,
} from '../../src/index.js';
import { mkEvento, utc } from './fixtures/mkEvento.js';

const DETECT_EM = new Date('2026-05-30T12:00:00.000Z');

describe('detectaTransferenciaInterna — par válido', () => {
  it('saída U1 + entrada U2 mesmo cliente, mesmo valor, mesmo dia → ambos marcados', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 50000,
      data_realizada: utc(2026, 5, 11),
      data_esperada: utc(2026, 5, 11),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });

    expect(r.paresDetectados).toBe(1);
    const sOut = r.eventos.find((e) => e.id === 's')!;
    const eOut = r.eventos.find((e) => e.id === 'e')!;
    expect(sOut.is_transferencia).toBe(true);
    expect(eOut.is_transferencia).toBe(true);
    expect(sOut.transferencia_par_id).toBe('e');
    expect(eOut.transferencia_par_id).toBe('s');
    expect(r.pendencias.length).toBe(0);
  });

  it('mesmo dia (diff=0) → marca', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(1);
  });

  it('diferença de centavos (R$ 0.01) → marca (dentro de ±0.02)', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000.01,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(1);
  });
});

describe('detectaTransferenciaInterna — não-match (regras estritas)', () => {
  it('diferença de R$ 5 → NÃO marca (tolerância só centavos)', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 50005,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
    expect(r.eventos.find((e) => e.id === 's')!.is_transferencia).toBe(false);
    expect(r.eventos.find((e) => e.id === 'e')!.is_transferencia).toBe(false);
  });

  it('3 dias de defasagem → NÃO marca (janela ±2)', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 13),
      data_esperada: utc(2026, 5, 13),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
  });

  it('cliente_id diferentes → NÃO marca (não é transferência interna)', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c2',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
  });

  it('mesma legal_entity_id → NÃO marca (não é inter-unidade)', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const entrada = mkEvento({
      id: 'e',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const r = detectaTransferenciaInterna([saida, entrada], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
  });

  it('direção igual (duas saídas) → NÃO marca', () => {
    const s1 = mkEvento({
      id: 's1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const s2 = mkEvento({
      id: 's2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([s1, s2], { detectadoEm: DETECT_EM });
    expect(r.paresDetectados).toBe(0);
  });

  it('confirmado + realizado → NÃO marca (só realizado entra)', () => {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 5000,
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const real = mkEvento({
      id: 'r',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const r = detectaTransferenciaInterna([conf, real], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
    expect(r.eventos.find((e) => e.id === 'r')!.is_transferencia).toBe(false);
  });
});

describe('detectaTransferenciaInterna — ambiguidade', () => {
  it('1 saída + 2 entradas elegíveis → pendência transferencia_ambigua, nada marcado', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const e1 = mkEvento({
      id: 'e1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const e2 = mkEvento({
      id: 'e2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 11),
      data_esperada: utc(2026, 5, 11),
      cliente_id: 'c1',
      legal_entity_id: 'u3',
    });
    const r = detectaTransferenciaInterna([saida, e1, e2], {
      detectadoEm: DETECT_EM,
    });
    expect(r.paresDetectados).toBe(0);
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('transferencia_ambigua');
    expect(r.pendencias[0]!.eventos_relacionados).toEqual(['e1', 'e2', 's']);
    // Nenhum dos eventos é marcado.
    expect(r.eventos.every((e) => e.is_transferencia === false)).toBe(true);
  });
});

describe('detectaTransferenciaInterna — preservação e determinismo', () => {
  it('eventos não-realizado preservados (estimado, pendente)', () => {
    const est = mkEvento({
      id: 'est',
      status: 'estimado',
      origem: 'historico',
      direcao: 'saida',
      valor: 1000,
      data_esperada: utc(2026, 5, 10),
    });
    const pend = mkEvento({
      id: 'pend',
      status: 'pendente',
      origem: 'manual',
      direcao: 'saida',
      valor: 100,
      data_esperada: utc(2026, 5, 10),
    });
    const r = detectaTransferenciaInterna([est, pend], {
      detectadoEm: DETECT_EM,
    });
    expect(r.eventos.length).toBe(2);
    // Estimado/pendente não têm is_transferencia tocado pela função;
    // mantêm o que vinha do input (false).
    expect(r.eventos.every((e) => e.is_transferencia === false)).toBe(true);
  });

  it('determinismo: 2 chamadas → deepEqual', () => {
    const eventos: EventoCaixa[] = [
      mkEvento({
        id: 's',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 5000,
        data_realizada: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
        cliente_id: 'c1',
        legal_entity_id: 'u1',
      }),
      mkEvento({
        id: 'e',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 5000,
        data_realizada: utc(2026, 5, 11),
        data_esperada: utc(2026, 5, 11),
        cliente_id: 'c1',
        legal_entity_id: 'u2',
      }),
    ];
    const a = detectaTransferenciaInterna(eventos, { detectadoEm: DETECT_EM });
    const b = detectaTransferenciaInterna(eventos, { detectadoEm: DETECT_EM });
    expect(b).toEqual(a);
  });

  it('input com realizado sem data_realizada válida → ReconciliacaoError', () => {
    const base = mkEvento({
      id: 'bad',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
    });
    const ruim = {
      ...base,
      data_realizada: new Date(NaN),
    } as unknown as EventoCaixa;
    expect(() =>
      detectaTransferenciaInterna([ruim], { detectadoEm: DETECT_EM }),
    ).toThrow(ReconciliacaoError);
  });

  it('múltiplos pares de clientes diferentes detectados independentemente', () => {
    const eventos = [
      // Cliente C1, par válido
      mkEvento({
        id: 's1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
        cliente_id: 'c1',
        legal_entity_id: 'u1',
      }),
      mkEvento({
        id: 'e1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 1000,
        data_realizada: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
        cliente_id: 'c1',
        legal_entity_id: 'u2',
      }),
      // Cliente C2, par válido (independente)
      mkEvento({
        id: 's2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 5000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
        cliente_id: 'c2',
        legal_entity_id: 'ua',
      }),
      mkEvento({
        id: 'e2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 5000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
        cliente_id: 'c2',
        legal_entity_id: 'ub',
      }),
    ];
    const r = detectaTransferenciaInterna(eventos, { detectadoEm: DETECT_EM });
    expect(r.paresDetectados).toBe(2);
    for (const id of ['s1', 'e1', 's2', 'e2']) {
      expect(r.eventos.find((e) => e.id === id)!.is_transferencia).toBe(true);
    }
  });
});
