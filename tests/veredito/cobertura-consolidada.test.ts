import { describe, expect, it } from 'vitest';
import {
  deriveCoberturaConsolidada,
  deriveStatusUnidade,
} from '../../src/index.js';
import { mkCobertura } from '../confianca/fixtures.js';

describe('cobertura-consolidada — deriveStatusUnidade', () => {
  it('sem motivo nem pendência → cobertura_completa', () => {
    expect(deriveStatusUnidade(mkCobertura(), 'u1')).toBe('cobertura_completa');
  });

  it('com motivoInsuficiencia para a unidade → cobertura_insuficiente', () => {
    const cob = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u1',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
    });
    expect(deriveStatusUnidade(cob, 'u1')).toBe('cobertura_insuficiente');
  });

  it('com pendência mas sem motivo → cobertura_com_confianca_reduzida', () => {
    const cob = mkCobertura({
      pendencias: [
        {
          id: 'p',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_que_era_esperado'],
        },
      ],
    });
    expect(deriveStatusUnidade(cob, 'u1')).toBe('cobertura_com_confianca_reduzida');
  });

  it('motivo OUTRA unidade → para esta, completa', () => {
    const cob = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u_outra',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
    });
    expect(deriveStatusUnidade(cob, 'u1')).toBe('cobertura_completa');
  });
});

describe('cobertura-consolidada — deriveCoberturaConsolidada', () => {
  it('todas unidades cobertura_completa → consolidado cobertura_completa', () => {
    expect(deriveCoberturaConsolidada(mkCobertura(), ['u1', 'u2'])).toBe(
      'cobertura_completa',
    );
  });

  it('1 unidade reduzida, restantes completa → consolidado reduzida', () => {
    const cob = mkCobertura({
      pendencias: [
        {
          id: 'p',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_que_era_esperado'],
        },
      ],
    });
    expect(deriveCoberturaConsolidada(cob, ['u1', 'u2'])).toBe(
      'cobertura_com_confianca_reduzida',
    );
  });

  it('1 unidade insuficiente, outras completas → consolidado insuficiente', () => {
    const cob = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u2',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
    });
    expect(deriveCoberturaConsolidada(cob, ['u1', 'u2'])).toBe(
      'cobertura_insuficiente',
    );
  });

  it('mistura insuficiente + reduzida → insuficiente vence', () => {
    const cob = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u1',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
      pendencias: [
        {
          id: 'p',
          tipo: 'semana_zerada',
          legal_entity_id: 'u2',
          semana_iso: '2026-W19',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_que_era_esperado'],
        },
      ],
    });
    expect(deriveCoberturaConsolidada(cob, ['u1', 'u2'])).toBe(
      'cobertura_insuficiente',
    );
  });

  it('legal_entity_ids_ativas vazio → cobertura_completa (degenerado)', () => {
    expect(deriveCoberturaConsolidada(mkCobertura(), [])).toBe(
      'cobertura_completa',
    );
  });
});
