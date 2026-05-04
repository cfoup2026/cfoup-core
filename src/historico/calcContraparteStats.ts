import type {
  ContraparteStats,
  EventoCaixa,
} from '../types/index.js';
import { HistoricoError } from '../types/index.js';
import { diffDays, mean, median, populationStddev } from './stats.js';

/**
 * Calcula `ContraparteStats` para cada `contraparte_id` com pelo menos
 * 1 evento `realizado` que tenha `data_vencimento` E `data_realizada`
 * preenchidas.
 *
 * Eventos ineligíveis (ignorados em silêncio):
 *  - `status !== 'realizado'`.
 *  - `data_vencimento` ausente (ex: extrato CEF — sem vencimento).
 *  - `contraparte_id` ausente.
 *
 * Falha visivelmente:
 *  - Evento `realizado` cuja `data_realizada` não é `Date` válida →
 *    `HistoricoError`. Stage 1 já valida; aqui é rede de segurança contra
 *    eventos construídos manualmente bypassando o adapter.
 *
 * Saída: contrapartes com `padrao_estavel=false` ainda são retornadas
 * (com flag de baixa confiança via `confianca_inferencia`). Estágio 4
 * decide se ignora ou usa como pendência informativa.
 */
export function calcContraparteStats(
  eventos: readonly EventoCaixa[],
): Map<string, ContraparteStats> {
  // Agrupa deltas por contraparte_id.
  const groups = new Map<string, number[]>();

  for (const e of eventos) {
    if (e.status !== 'realizado') continue;

    // Validação defensiva — Stage 1 garante mas não custa proteger.
    const dr = e.data_realizada;
    if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) {
      throw new HistoricoError(
        `evento ${e.id}: realizado sem data_realizada válida`,
      );
    }

    if (e.data_vencimento === undefined) continue;
    if (e.contraparte_id === undefined) continue;

    const delta = diffDays(dr, e.data_vencimento);
    const arr = groups.get(e.contraparte_id);
    if (arr === undefined) {
      groups.set(e.contraparte_id, [delta]);
    } else {
      arr.push(delta);
    }
  }

  const result = new Map<string, ContraparteStats>();
  for (const [contraparte_id, deltas] of groups) {
    deltas.sort((a, b) => a - b);
    const n = deltas.length;
    const med = median(deltas, true);
    const avg = mean(deltas);
    const sd = populationStddev(deltas, avg);
    const min_dias = deltas[0]!;
    const max_dias = deltas[n - 1]!;

    const padrao_estavel = n >= 6 && sd <= 3 && Math.abs(med) >= 1;
    const confianca_inferencia: 'alta' | 'media' | 'baixa' = padrao_estavel
      ? 'alta'
      : n >= 6
        ? 'media'
        : 'baixa';

    result.set(contraparte_id, {
      contraparte_id,
      n,
      mediana_dias: med,
      media_dias: avg,
      desvio_dias: sd,
      min_dias,
      max_dias,
      padrao_estavel,
      inferido_de: 'delta_vencimento_realizada',
      n_amostras: n,
      confianca_inferencia,
    });
  }

  return result;
}
