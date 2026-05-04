import { describe, expect, it } from 'vitest';
import {
  ehMaterial,
  LIMITE_MATERIALIDADE_ABS_BRL,
  PCT_MATERIALIDADE_SAIDAS_SEMANA,
} from '../../src/index.js';

describe('materialidade — ehMaterial', () => {
  it('limite absoluto exato (R$ 5.000) → material por absoluto', () => {
    const r = ehMaterial(5000, 0);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('limite_absoluto');
  });

  it('R$ 4.999 sem ser >=10% das saídas → NÃO é material', () => {
    const r = ehMaterial(4999, 100_000); // 10% = 10k; 4999 < 10k.
    expect(r.is_material).toBe(false);
    expect(r.trigger).toBeUndefined();
  });

  it('R$ 6.000 com saidasSemana=0 → material por absoluto', () => {
    const r = ehMaterial(6000, 0);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('limite_absoluto');
  });

  it('R$ 1.000 com saidasSemana=8.000 (12.5% > 10%) → material por relativo', () => {
    const r = ehMaterial(1000, 8000);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('pct_10_saidas_semana');
  });

  it('relativo VENCE absoluto quando ambos casam', () => {
    // Valor 6000 ≥ 5000 (absoluto) E ≥ 10% × 50.000 = 5000 (relativo).
    const r = ehMaterial(6000, 50_000);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('pct_10_saidas_semana');
  });

  it('exatamente 10% de saidasSemana → material por relativo', () => {
    // 10% × 20_000 = 2_000.
    const r = ehMaterial(2000, 20_000);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('pct_10_saidas_semana');
  });

  it('limite customizado vence default', () => {
    const r = ehMaterial(3000, 0, 1000);
    expect(r.is_material).toBe(true);
    expect(r.trigger).toBe('limite_absoluto');
  });

  it('constantes têm valores documentados', () => {
    expect(LIMITE_MATERIALIDADE_ABS_BRL).toBe(5000);
    expect(PCT_MATERIALIDADE_SAIDAS_SEMANA).toBe(0.1);
  });
});
