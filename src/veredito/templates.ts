/**
 * Renderização de texto do veredito (§6.2 do spec).
 *
 * Templates determinísticos, sem hedging. Quebra de string fixa.
 * Formatação BR (R$, datas DD/MM) via `format.ts` — sem `Intl`.
 *
 * Templates:
 *
 *   CRITICO: "Caixa fica negativo na semana {N} ({DD/MM}). Falta R$ {valor} pra cobrir as obrigações da semana."
 *   ALERTA:  "Caixa fica abaixo do mínimo operacional na semana {N}. Saldo projetado R$ {x}, mínimo R$ {y}."
 *   ATENCAO: "Projeção fecha positiva, mas confiança baixa. {N} pendências relevantes."
 *   LIMPO:   "Caixa atravessa as 13 semanas acima do mínimo operacional."
 *   DADOS_INSUFICIENTES: "Dados insuficientes para calcular o veredito com segurança."
 */
import { formatarBRL, formatarDataDDMM } from './format.js';
import type { Veredito, VereditoDetalhes } from './types.js';

/**
 * Renderiza texto a partir de `veredito` + `detalhes`. Determinístico:
 * mesma entrada → mesma string byte a byte.
 *
 * Quando algum campo opcional necessário pelo template está ausente
 * (caso degenerado), usa string vazia / 0 — não quebra. Testes
 * cobrem o caso normal; o defensive fallback não é caminho esperado.
 */
export function renderTexto(
  veredito: Veredito,
  detalhes: VereditoDetalhes,
): string {
  switch (veredito) {
    case 'CRITICO': {
      const N = detalhes.semana_critica ?? 0;
      const data = detalhes.data_critica
        ? formatarDataDDMM(detalhes.data_critica)
        : '00/00';
      const valor = formatarBRL(detalhes.valor_falta ?? 0);
      return `Caixa fica negativo na semana ${N} (${data}). Falta R$ ${valor} pra cobrir as obrigações da semana.`;
    }
    case 'ALERTA': {
      const N = detalhes.semana_critica ?? 0;
      const x = formatarBRL(detalhes.saldo_projetado ?? 0);
      const y = formatarBRL(detalhes.minimo_operacional ?? 0);
      return `Caixa fica abaixo do mínimo operacional na semana ${N}. Saldo projetado R$ ${x}, mínimo R$ ${y}.`;
    }
    case 'ATENCAO': {
      const N = detalhes.pendencias_relevantes ?? 0;
      return `Projeção fecha positiva, mas confiança baixa. ${N} pendências relevantes.`;
    }
    case 'LIMPO': {
      return 'Caixa atravessa as 13 semanas acima do mínimo operacional.';
    }
    case 'DADOS_INSUFICIENTES': {
      return 'Dados insuficientes para calcular o veredito com segurança.';
    }
  }
}
