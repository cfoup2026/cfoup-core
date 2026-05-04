import { describe, expect, it } from 'vitest';
import {
  calcularSaidasSemana,
  detectarPendenciasCriticasSemana,
} from '../../src/index.js';
import { mkEventoConf, utc } from './fixtures.js';

const baseInput = {
  saidasSemana: 0,
  semana: 5,
  legal_entity_id: 'u1',
  cliente_id: 'c1',
};

describe('pendencia-critica — direção e transferência', () => {
  it('ENTRADA com criticidade=pendente NÃO é detectada (§9.3 ajuste)', () => {
    const ev = mkEventoConf({
      id: 'entrada-pendente',
      status: 'confirmado',
      direcao: 'entrada',
      valor: 50_000,
      confianca: 'media',
      criticidade: 'pendente',
      data_vencimento: utc(2026, 5, 15),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 0,
    });
    expect(r).toEqual([]);
  });

  it('SAÍDA com is_transferencia=true NÃO é detectada', () => {
    const ev = mkEventoConf({
      id: 'transf',
      status: 'realizado',
      direcao: 'saida',
      valor: 50_000,
      confianca: 'alta',
      criticidade: 'obrigatoria',
      is_transferencia: true,
      transferencia_par_id: 'par',
      data_realizada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 100_000,
    });
    expect(r).toEqual([]);
  });
});

describe('pendencia-critica — materialidade', () => {
  it('SAÍDA R$ 5.000 sem ser 10%+ das saídas → DETECTADA por absoluto', () => {
    const ev = mkEventoConf({
      id: 'abs-5000',
      status: 'pendente',
      direcao: 'saida',
      valor: 5000,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 100_000, // 10% = 10k; 5000 < 10k.
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.trigger_materialidade).toBe('limite_absoluto');
    expect(r[0]!.motivo).toBe('status_pendente');
  });

  it('SAÍDA R$ 4.999 sem ser 10%+ das saídas → NÃO detectada', () => {
    const ev = mkEventoConf({
      id: 'abs-4999',
      status: 'pendente',
      direcao: 'saida',
      valor: 4999,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 100_000,
    });
    expect(r).toEqual([]);
  });

  it('SAÍDA R$ 1.000 que é 10% das saídas (relativo) → DETECTADA por pct_10', () => {
    const ev = mkEventoConf({
      id: 'rel-1000',
      status: 'pendente',
      direcao: 'saida',
      valor: 1000,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 10_000, // 10% × 10k = 1000.
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.trigger_materialidade).toBe('pct_10_saidas_semana');
  });
});

describe('pendencia-critica — status e criticidade', () => {
  it('SAÍDA material com status=pendente → motivo=status_pendente', () => {
    const ev = mkEventoConf({
      id: 'p',
      status: 'pendente',
      direcao: 'saida',
      valor: 6000,
      confianca: 'baixa',
      criticidade: 'negociavel', // status_pendente vence
      data_esperada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 0,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.motivo).toBe('status_pendente');
  });

  it('SAÍDA material com status=confirmado + criticidade=obrigatoria → motivo=criticidade_*', () => {
    const ev = mkEventoConf({
      id: 'c',
      status: 'confirmado',
      direcao: 'saida',
      valor: 6000,
      confianca: 'media',
      criticidade: 'obrigatoria',
      data_vencimento: utc(2026, 5, 15),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 0,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.motivo).toBe('criticidade_obrigatoria_critica_op_pendente');
  });

  it('SAÍDA material com criticidade=critica_op → DETECTADA', () => {
    const ev = mkEventoConf({
      id: 'co',
      status: 'realizado',
      direcao: 'saida',
      valor: 8000,
      confianca: 'alta',
      criticidade: 'critica_op',
      data_realizada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 0,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.criticidade).toBe('critica_op');
  });

  it('SAÍDA material com criticidade=negociavel + status NÃO pendente → NÃO detectada', () => {
    const ev = mkEventoConf({
      id: 'n',
      status: 'confirmado',
      direcao: 'saida',
      valor: 10_000,
      confianca: 'alta',
      criticidade: 'negociavel',
      data_vencimento: utc(2026, 5, 15),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [ev],
      saidasSemana: 0,
    });
    expect(r).toEqual([]);
  });
});

describe('pendencia-critica — calcularSaidasSemana', () => {
  it('soma |valor| de saídas não-transferência apenas', () => {
    const eventos = [
      mkEventoConf({
        id: 'a',
        status: 'realizado',
        direcao: 'saida',
        valor: 100,
        confianca: 'alta',
        data_realizada: utc(2026, 5, 5),
      }),
      mkEventoConf({
        id: 'b',
        status: 'realizado',
        direcao: 'saida',
        valor: 200,
        confianca: 'alta',
        is_transferencia: true,
        transferencia_par_id: 'x',
        data_realizada: utc(2026, 5, 5),
      }),
      mkEventoConf({
        id: 'c',
        status: 'realizado',
        direcao: 'entrada',
        valor: 500,
        confianca: 'alta',
        data_realizada: utc(2026, 5, 5),
      }),
    ];
    expect(calcularSaidasSemana(eventos)).toBe(100);
  });
});

describe('pendencia-critica — determinismo', () => {
  it('lista ordenada por evento_id lex', () => {
    const evz = mkEventoConf({
      id: 'z',
      status: 'pendente',
      direcao: 'saida',
      valor: 6000,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const eva = mkEventoConf({
      id: 'a',
      status: 'pendente',
      direcao: 'saida',
      valor: 6000,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const r = detectarPendenciasCriticasSemana({
      ...baseInput,
      eventos: [evz, eva],
      saidasSemana: 0,
    });
    expect(r.map((p) => p.evento_id)).toEqual(['a', 'z']);
  });
});
