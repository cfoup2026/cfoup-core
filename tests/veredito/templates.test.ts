import { describe, expect, it } from 'vitest';
import { renderTexto } from '../../src/index.js';

describe('templates — CRITICO', () => {
  it('semana 5 + data 2026-05-25 + valor 1500 → texto exato', () => {
    const t = renderTexto('CRITICO', {
      semana_critica: 5,
      data_critica: '2026-05-25T00:00:00.000Z',
      valor_falta: 1500,
    });
    expect(t).toBe(
      'Caixa fica negativo na semana 5 (25/05). Falta R$ 1.500,00 pra cobrir as obrigações da semana.',
    );
  });

  it('valor decimal 12345.6 formatado corretamente', () => {
    const t = renderTexto('CRITICO', {
      semana_critica: 13,
      data_critica: '2026-07-20T00:00:00.000Z',
      valor_falta: 12345.6,
    });
    expect(t).toBe(
      'Caixa fica negativo na semana 13 (20/07). Falta R$ 12.345,60 pra cobrir as obrigações da semana.',
    );
  });
});

describe('templates — ALERTA', () => {
  it('semana 8 + saldo 1000 + minimo 5000 → texto exato', () => {
    const t = renderTexto('ALERTA', {
      semana_critica: 8,
      data_critica: '2026-06-15T00:00:00.000Z',
      saldo_projetado: 1000,
      minimo_operacional: 5000,
    });
    expect(t).toBe(
      'Caixa fica abaixo do mínimo operacional na semana 8. Saldo projetado R$ 1.000,00, mínimo R$ 5.000,00.',
    );
  });
});

describe('templates — ATENCAO', () => {
  it('3 pendencias → texto exato', () => {
    const t = renderTexto('ATENCAO', { pendencias_relevantes: 3 });
    expect(t).toBe(
      'Projeção fecha positiva, mas confiança baixa. 3 pendências relevantes.',
    );
  });

  it('0 pendencias (caso degenerado) → "0 pendências"', () => {
    const t = renderTexto('ATENCAO', { pendencias_relevantes: 0 });
    expect(t).toBe(
      'Projeção fecha positiva, mas confiança baixa. 0 pendências relevantes.',
    );
  });
});

describe('templates — LIMPO', () => {
  it('texto fixo', () => {
    expect(renderTexto('LIMPO', {})).toBe(
      'Caixa atravessa as 13 semanas acima do mínimo operacional.',
    );
  });
});

describe('templates — DADOS_INSUFICIENTES', () => {
  it('texto fixo', () => {
    expect(renderTexto('DADOS_INSUFICIENTES', {})).toBe(
      'Dados insuficientes para calcular o veredito com segurança.',
    );
  });
});

describe('templates — determinismo', () => {
  it('100 chamadas com mesmos detalhes → mesma string', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(
        renderTexto('CRITICO', {
          semana_critica: 5,
          data_critica: '2026-05-25T00:00:00.000Z',
          valor_falta: 1500.5,
        }),
      );
    }
    expect(set.size).toBe(1);
  });
});
