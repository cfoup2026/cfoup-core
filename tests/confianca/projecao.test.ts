import { describe, expect, it } from 'vitest';
import {
  calcularConfiancaProjecao,
  type ConfiancaSemana,
} from '../../src/index.js';
import { mkSemana } from './fixtures.js';

function semanaConf(
  idx: number,
  confianca: ConfiancaSemana['confianca'],
): ConfiancaSemana {
  const sem = mkSemana({ semana_iso: '2026-W22' });
  return {
    semana: idx + 1,
    data_inicio: sem.inicio.toISOString(),
    data_fim: sem.fim.toISOString(),
    peso_total: 0,
    peso_alta: 0,
    peso_baixa: 0,
    pct_alta: null,
    pct_baixa: null,
    confianca,
    pendencias_criticas_ids: [],
  };
}

describe('projecao — confianca_projecao = pior das 13', () => {
  it('todas alta → alta', () => {
    const semanas = Array.from({ length: 13 }, (_, i) => semanaConf(i, 'alta'));
    expect(calcularConfiancaProjecao(semanas)).toBe('alta');
  });

  it('1 media entre 12 alta → media', () => {
    const semanas = Array.from({ length: 13 }, (_, i) =>
      i === 5 ? semanaConf(i, 'media') : semanaConf(i, 'alta'),
    );
    expect(calcularConfiancaProjecao(semanas)).toBe('media');
  });

  it('1 baixa entre 12 alta → baixa', () => {
    const semanas = Array.from({ length: 13 }, (_, i) =>
      i === 7 ? semanaConf(i, 'baixa') : semanaConf(i, 'alta'),
    );
    expect(calcularConfiancaProjecao(semanas)).toBe('baixa');
  });

  it('mistura media + baixa → baixa', () => {
    const semanas = Array.from({ length: 13 }, (_, i) => {
      if (i < 5) return semanaConf(i, 'media');
      if (i < 10) return semanaConf(i, 'alta');
      return semanaConf(i, 'baixa');
    });
    expect(calcularConfiancaProjecao(semanas)).toBe('baixa');
  });

  it('todas baixa → baixa', () => {
    const semanas = Array.from({ length: 13 }, (_, i) => semanaConf(i, 'baixa'));
    expect(calcularConfiancaProjecao(semanas)).toBe('baixa');
  });

  it('todas media → media', () => {
    const semanas = Array.from({ length: 13 }, (_, i) => semanaConf(i, 'media'));
    expect(calcularConfiancaProjecao(semanas)).toBe('media');
  });

  it('lista vazia → alta (degenerado, sem piora)', () => {
    expect(calcularConfiancaProjecao([])).toBe('alta');
  });
});
