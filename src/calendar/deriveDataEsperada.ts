import { addUTCDays } from '../utils/date.js';
import type { CalendarPolicy, ContraparteHistory } from './CalendarPolicy.js';

/**
 * Deriva `data_esperada` a partir de `data_vencimento` aplicando:
 *
 *  1. **Ajuste por contraparte** (hook ativo desde Estágio 2.2): se
 *     `contraparteHistory` e `contraparteId` são fornecidos e a
 *     contraparte tem `padrao_estavel = true` E `mediana_dias !== 0`,
 *     desloca a base por `mediana_dias` dias.
 *
 *  2. **Calendário operacional** (regra §7.1 do CF13): se a base cair
 *     em sábado, domingo ou feriado bancário nacional, move para o
 *     próximo dia útil. Caso contrário mantém.
 *
 * Eventos `realizado` NÃO devem passar por aqui — `data_esperada =
 * data_realizada` direto (fato consumado é fato consumado).
 * `data_vencimento` original permanece preservada no `EventoCaixa`
 * para drill-down — não é sobrescrita.
 *
 * Compatibilidade Stage 1: chamadas sem `contraparteHistory`/`contraparteId`
 * (caminho dos adapters FKN AP/AR) mantêm comportamento idêntico ao
 * que era em 1.3 — calendário puro sobre `data_vencimento`.
 */
export function deriveDataEsperada(
  dataVencimento: Date,
  calendar: CalendarPolicy,
  contraparteHistory?: ContraparteHistory,
  contraparteId?: string,
): Date {
  let base = dataVencimento;

  // Hook ativo: ajuste por padrão histórico da contraparte.
  if (contraparteHistory !== undefined && contraparteId !== undefined) {
    const stats = contraparteHistory.get(contraparteId);
    if (stats !== undefined && stats.padrao_estavel && stats.mediana_dias !== 0) {
      base = addUTCDays(dataVencimento, stats.mediana_dias);
    }
  }

  if (calendar.isBusinessDay(base)) return base;
  return calendar.nextBusinessDay(base);
}
