import { describe, expect, it } from 'vitest';
import { aplicarGatilhos } from '../../src/index.js';
import {
  mkConfiancaUnidade,
  mkUnidadeConf,
  unidadeComSaldos,
} from './fixtures.js';

describe('gatilhos — CRITICO (saldo negativo)', () => {
  it('semana 5 com caixa_final = -1500 → CRITICO com semana_critica=5', () => {
    const u = unidadeComSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([[4, { caixa_final: -1500, caixa_minimo_op: 0 }]]), // idx 4 = sem 5
    );
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'alta',
      }),
    });
    expect(r.veredito).toBe('CRITICO');
    expect(r.detalhes.semana_critica).toBe(5);
    expect(r.detalhes.valor_falta).toBe(1500);
    expect(r.detalhes.data_critica).toBeDefined();
  });

  it('múltiplas semanas negativas → primeira (menor índice) vence', () => {
    const u = unidadeComSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map<number, { caixa_final?: number; caixa_minimo_op?: number }>([
        [3, { caixa_final: -500 }], // sem 4
        [7, { caixa_final: -1000 }], // sem 8
      ]),
    );
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'alta',
      }),
    });
    expect(r.veredito).toBe('CRITICO');
    expect(r.detalhes.semana_critica).toBe(4);
    expect(r.detalhes.valor_falta).toBe(500);
  });
});

describe('gatilhos — ALERTA (abaixo do mínimo, saldo positivo)', () => {
  it('semana 8 com caixa_final < caixa_minimo_op → ALERTA', () => {
    const u = unidadeComSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([
        [
          7, // sem 8
          { caixa_final: 1000, caixa_minimo_op: 5000 },
        ],
      ]),
    );
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'alta',
      }),
    });
    expect(r.veredito).toBe('ALERTA');
    expect(r.detalhes.semana_critica).toBe(8);
    expect(r.detalhes.saldo_projetado).toBe(1000);
    expect(r.detalhes.minimo_operacional).toBe(5000);
  });
});

describe('gatilhos — ATENCAO (confianca baixa, saldos OK)', () => {
  it('todas semanas ≥ minimo MAS confianca_projecao=baixa → ATENCAO', () => {
    /* Saldos zerados; mínimo 0 → "ok" pelo critério (saldo >= mínimo).
     *  Confiança baixa dispara ATENCAO. */
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'baixa',
        pendencias_criticas: [
          {
            evento_id: 'p1',
            legal_entity_id: 'u1',
            cliente_id: 'c1',
            semana: 5,
            valor: 5000,
            direcao: 'saida',
            status: 'pendente',
            criticidade: 'pendente',
            bucket_id: 'pendente_classificacao',
            motivo: 'status_pendente',
            trigger_materialidade: 'limite_absoluto',
          },
        ],
      }),
    });
    expect(r.veredito).toBe('ATENCAO');
    expect(r.detalhes.pendencias_relevantes).toBe(1);
  });
});

describe('gatilhos — LIMPO', () => {
  it('saldos ≥ minimo + confianca media → LIMPO', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'media',
      }),
    });
    expect(r.veredito).toBe('LIMPO');
    expect(r.detalhes).toEqual({});
  });

  it('saldos ≥ minimo + confianca alta → LIMPO', () => {
    const u = mkUnidadeConf({ legal_entity_id: 'u1' });
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'alta',
      }),
    });
    expect(r.veredito).toBe('LIMPO');
  });
});

describe('gatilhos — ordem (primeiro casa vence)', () => {
  it('saldo negativo + abaixo do mínimo → CRITICO (não ALERTA)', () => {
    /* CRITICO vence ALERTA porque é avaliado primeiro. */
    const u = unidadeComSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([[4, { caixa_final: -100, caixa_minimo_op: 5000 }]]), // negativo + abaixo
    );
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'alta',
      }),
    });
    expect(r.veredito).toBe('CRITICO');
  });

  it('confianca baixa + abaixo do mínimo → ALERTA (não ATENCAO)', () => {
    /* ALERTA vence ATENCAO. Saldo positivo mas abaixo do mínimo. */
    const u = unidadeComSaldos(
      mkUnidadeConf({ legal_entity_id: 'u1' }),
      new Map([[4, { caixa_final: 1000, caixa_minimo_op: 5000 }]]),
    );
    const r = aplicarGatilhos({
      projecao: u,
      confianca: mkConfiancaUnidade({
        legal_entity_id: 'u1',
        confianca_projecao: 'baixa',
      }),
    });
    expect(r.veredito).toBe('ALERTA');
  });
});
