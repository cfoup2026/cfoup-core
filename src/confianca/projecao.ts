/**
 * Confiança da projeção (§9.4): pior das 13 semanas.
 *
 * Hierarquia: `baixa < media < alta`. Qualquer semana `baixa` rebaixa
 * a projeção; sem `baixa` mas com pelo menos uma `media` → `media`;
 * todas `alta` → `alta`.
 *
 * Calculado independentemente por unidade e por consolidado — Stage 6
 * não soma resultados; cada escopo agrega suas próprias 13 semanas.
 */
import type { Confianca } from '../types/index.js';
import type { ConfiancaSemana } from './types.js';

/**
 * Pior dos valores de confiança em uma lista de semanas.
 *
 * Vazio → `'alta'` por construção (não há piora). Caller deve garantir
 * que `semanas.length > 0` quando relevante; em Stage 6, sempre 13.
 */
export function calcularConfiancaProjecao(
  semanas: readonly ConfiancaSemana[],
): Confianca {
  let pior: Confianca = 'alta';
  for (const s of semanas) {
    if (s.confianca === 'baixa') return 'baixa';
    if (s.confianca === 'media' && pior === 'alta') {
      pior = 'media';
    }
  }
  return pior;
}
