/**
 * Ordenação determinística de `PendenciaCF13[]` segundo Item 1 §3.6:
 *
 *  1. `severidade` desc: `critica` → `media` → `baixa`.
 *  2. `semanaId` asc (lex sort de ISO `YYYY-MM-DD` é cronológico).
 *     `undefined` vai ao final dentro da mesma severidade.
 *  3. Tiebreaker estável: `id` asc (lex).
 *
 * Função pura — recebe array, devolve cópia ordenada. Não muta input.
 */
import type { PendenciaCF13, SeveridadePendencia } from '../types.js';

const ORDEM_SEVERIDADE: Readonly<Record<SeveridadePendencia, number>> = {
  critica: 0,
  media: 1,
  baixa: 2,
};

export function ordenarPendencias(
  pendencias: readonly PendenciaCF13[],
): PendenciaCF13[] {
  /* Cópia rasa — sort é in-place; queremos preservar o array original. */
  return [...pendencias].sort(comparar);
}

function comparar(a: PendenciaCF13, b: PendenciaCF13): number {
  const sa = ORDEM_SEVERIDADE[a.severidade];
  const sb = ORDEM_SEVERIDADE[b.severidade];
  if (sa !== sb) return sa - sb;

  /* `undefined` ao final dentro da mesma severidade. */
  const aSem = a.semanaId;
  const bSem = b.semanaId;
  if (aSem === undefined && bSem !== undefined) return 1;
  if (aSem !== undefined && bSem === undefined) return -1;
  if (aSem !== undefined && bSem !== undefined && aSem !== bSem) {
    return aSem.localeCompare(bSem);
  }

  /* Tiebreaker: `id` asc. */
  return a.id.localeCompare(b.id);
}
