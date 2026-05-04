import { describe, expect, it } from 'vitest';
import {
  calcularConfiancaSemana,
  ConfiancaError,
  type EventoCaixa,
} from '../../src/index.js';
import { mkEventoConf, mkSemana, utc } from './fixtures.js';

const baseSemana = mkSemana({ semana_iso: '2026-W22' });

describe('semana — peso_total = 0', () => {
  it('sem eventos → baixa, motivo=peso_total_zero, pcts null', () => {
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('baixa');
    expect(r.motivo_baixa).toBe('peso_total_zero');
    expect(r.peso_total).toBe(0);
    expect(r.pct_alta).toBeNull();
    expect(r.pct_baixa).toBeNull();
    expect(r.pendencias_criticas_ids).toEqual([]);
  });

  it('data_inicio/fim são ISO 8601', () => {
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [],
      pendenciasCriticas: [],
    });
    // W22 começa Mon 2026-05-25 e termina Sun 2026-05-31.
    expect(r.data_inicio).toBe('2026-05-25T00:00:00.000Z');
    expect(r.data_fim).toBe('2026-05-31T23:59:59.999Z');
  });
});

describe('semana — avaliação em ordem', () => {
  it('1 evento confianca=alta → alta', () => {
    const ev = mkEventoConf({
      id: 'e1',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [ev],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('alta');
    expect(r.motivo_baixa).toBeUndefined();
    expect(r.pct_alta).toBe(1);
    expect(r.pct_baixa).toBe(0);
  });

  it('50% alta + 50% baixa → baixa por pct_baixa_alta', () => {
    const evA = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 500,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const evB = mkEventoConf({
      id: 'b',
      status: 'realizado',
      direcao: 'saida',
      valor: 500,
      confianca: 'baixa',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [evA, evB],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('baixa');
    expect(r.motivo_baixa).toBe('pct_baixa_alta');
    expect(r.pct_alta).toBe(0.5);
    expect(r.pct_baixa).toBe(0.5);
  });

  it('60% alta + 40% media → media (pct_alta entre 0.5 e 0.75)', () => {
    const evA = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 600,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const evM = mkEventoConf({
      id: 'm',
      status: 'realizado',
      direcao: 'entrada',
      valor: 400,
      confianca: 'media',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [evA, evM],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('media');
    expect(r.motivo_baixa).toBeUndefined();
    expect(r.pct_alta).toBe(0.6);
    expect(r.pct_baixa).toBe(0);
  });

  it('80% alta + 20% media → alta (pct_alta ≥ 0.75)', () => {
    const evA = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 800,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const evM = mkEventoConf({
      id: 'm',
      status: 'realizado',
      direcao: 'entrada',
      valor: 200,
      confianca: 'media',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [evA, evM],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('alta');
  });

  it('40% alta + 60% media → baixa por pct_alta_baixa (pct_alta < 0.5)', () => {
    const evA = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 400,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const evM = mkEventoConf({
      id: 'm',
      status: 'realizado',
      direcao: 'entrada',
      valor: 600,
      confianca: 'media',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [evA, evM],
      pendenciasCriticas: [],
    });
    expect(r.confianca).toBe('baixa');
    expect(r.motivo_baixa).toBe('pct_alta_baixa');
  });

  it('pendência crítica vence pcts → baixa, motivo=pendencia_critica', () => {
    const evA = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [evA],
      pendenciasCriticas: [
        {
          evento_id: 'critica-id',
          legal_entity_id: 'u1',
          cliente_id: 'c1',
          semana: 5,
          valor: 9999,
          direcao: 'saida',
          status: 'pendente',
          criticidade: 'pendente',
          bucket_id: 'pendente_classificacao',
          motivo: 'status_pendente',
          trigger_materialidade: 'limite_absoluto',
        },
      ],
    });
    expect(r.confianca).toBe('baixa');
    expect(r.motivo_baixa).toBe('pendencia_critica');
    expect(r.pendencias_criticas_ids).toEqual(['critica-id']);
  });
});

describe('semana — confiança não resolvida lança erro', () => {
  it('evento com confianca undefined → ConfiancaError', () => {
    const ev = mkEventoConf({
      id: 'bad',
      status: 'realizado',
      direcao: 'entrada',
      valor: 100,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const evRuim = { ...ev, confianca: undefined } as unknown as EventoCaixa;
    expect(() =>
      calcularConfiancaSemana({
        semana: 5,
        semanaProjecao: baseSemana,
        eventos: [evRuim],
        pendenciasCriticas: [],
      }),
    ).toThrow(ConfiancaError);
  });
});

describe('semana — pendencias_criticas_ids ordenadas lex', () => {
  it('múltiplas pendências aparecem em ordem lex', () => {
    const ev = mkEventoConf({
      id: 'e',
      status: 'realizado',
      direcao: 'entrada',
      valor: 100,
      confianca: 'alta',
      data_realizada: utc(2026, 6, 3),
    });
    const r = calcularConfiancaSemana({
      semana: 5,
      semanaProjecao: baseSemana,
      eventos: [ev],
      pendenciasCriticas: [
        {
          evento_id: 'z',
          legal_entity_id: 'u1',
          cliente_id: 'c1',
          semana: 5,
          valor: 100,
          direcao: 'saida',
          status: 'pendente',
          criticidade: 'pendente',
          bucket_id: 'x',
          motivo: 'status_pendente',
          trigger_materialidade: 'limite_absoluto',
        },
        {
          evento_id: 'a',
          legal_entity_id: 'u1',
          cliente_id: 'c1',
          semana: 5,
          valor: 100,
          direcao: 'saida',
          status: 'pendente',
          criticidade: 'pendente',
          bucket_id: 'x',
          motivo: 'status_pendente',
          trigger_materialidade: 'limite_absoluto',
        },
      ],
    });
    expect(r.pendencias_criticas_ids).toEqual(['a', 'z']);
  });
});
