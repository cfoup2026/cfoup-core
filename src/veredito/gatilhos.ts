/**
 * Aplicação de gatilhos (§6.1 do spec).
 *
 * Avaliados em ORDEM (primeiro que casa vence):
 *
 *   1. CRITICO  — alguma das 13 semanas tem `caixa_final < 0`.
 *   2. ALERTA   — todas com `caixa_final >= 0`, mas alguma com
 *                 `caixa_final < caixa_minimo_op`.
 *   3. ATENCAO  — todas com `caixa_final >= caixa_minimo_op`,
 *                 mas Stage 6 reportou `confianca_projecao = 'baixa'`.
 *   4. LIMPO    — todas com `caixa_final >= caixa_minimo_op`
 *                 E `confianca_projecao ∈ {'media', 'alta'}`.
 *
 * **Cobertura insuficiente vence tudo (§8.1)** — caller resolve antes
 * de chamar `aplicarGatilhos`. Esta função assume cobertura ≠ insuficiente.
 *
 * Stage 7 lê `caixa_final` (saldo acumulado da semana). `caixa_minimo_op`
 * é o mínimo operacional calculado pelo Stage 4.3.
 */
import type { ProjecaoConsolidada, ProjecaoUnidade } from '../types/index.js';
import type { ConfiancaUnidade } from '../confianca/index.js';
import type { Veredito, VereditoDetalhes } from './types.js';

export interface AplicarGatilhosInput {
  /** Unidade ou consolidado da projeção. Stage 4 garante 13 semanas. */
  projecao: ProjecaoUnidade | ProjecaoConsolidada;
  /** Confiança da unidade (ou consolidado) — Stage 6. */
  confianca: ConfiancaUnidade;
}

export interface AplicarGatilhosOutput {
  veredito: Veredito;
  detalhes: VereditoDetalhes;
}

export function aplicarGatilhos(
  input: AplicarGatilhosInput,
): AplicarGatilhosOutput {
  const semanas = input.projecao.semanas;

  /* (1) CRITICO: primeira semana com caixa_final < 0. */
  for (let idx = 0; idx < semanas.length; idx++) {
    const sem = semanas[idx]!;
    if (sem.caixa_final < 0) {
      return {
        veredito: 'CRITICO',
        detalhes: {
          semana_critica: idx + 1,
          data_critica: sem.inicio.toISOString(),
          valor_falta: Math.abs(sem.caixa_final),
        },
      };
    }
  }

  /* (2) ALERTA: primeira semana com caixa_final < caixa_minimo_op
   *     (já garantido caixa_final >= 0 acima). */
  for (let idx = 0; idx < semanas.length; idx++) {
    const sem = semanas[idx]!;
    if (sem.caixa_final < sem.caixa_minimo_op) {
      return {
        veredito: 'ALERTA',
        detalhes: {
          semana_critica: idx + 1,
          data_critica: sem.inicio.toISOString(),
          saldo_projetado: sem.caixa_final,
          minimo_operacional: sem.caixa_minimo_op,
        },
      };
    }
  }

  /* (3) ATENCAO: confianca baixa com saldos OK. */
  if (input.confianca.confianca_projecao === 'baixa') {
    return {
      veredito: 'ATENCAO',
      detalhes: {
        pendencias_relevantes: input.confianca.pendencias_criticas.length,
      },
    };
  }

  /* (4) LIMPO: tudo verde. */
  return { veredito: 'LIMPO', detalhes: {} };
}
