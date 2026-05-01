import type { CalendarPolicy, ContraparteHistory } from './CalendarPolicy.js';

/**
 * Deriva `data_esperada` a partir de `data_vencimento` aplicando o
 * calendário operacional. Regra §7.1 do CF13:
 *
 *  - Se `data_vencimento` é dia útil → `data_esperada = data_vencimento`
 *    (passthrough, NÃO move).
 *  - Se cai em sábado, domingo ou feriado bancário nacional →
 *    `data_esperada = calendar.nextBusinessDay(data_vencimento)`.
 *
 * Importante: aplicar **somente** a eventos `confirmado`/`estimado`.
 * Eventos `realizado` mantêm `data_esperada = data_realizada` direto, sem
 * passar por aqui — fato consumado é fato consumado (Pix/TED ocorrem fora
 * de dia útil).
 *
 * `data_vencimento` permanece preservada para drill-down — não é sobrescrita.
 *
 * O parâmetro `contraparteHistory` é um hook **no-op** nesta etapa. O Motor
 * de Histórico (Prompt 2) vai prover ajuste por padrão de antecipação/atraso
 * de cada contraparte ANTES da regra de calendário (chamando primeiro o
 * histórico, depois o calendário). A assinatura já aceita o argumento para
 * que adapters do 1.3 não precisem mudar quando 2.x ativar.
 */
export function deriveDataEsperada(
  dataVencimento: Date,
  calendar: CalendarPolicy,
  contraparteHistory?: ContraparteHistory,
): Date {
  // Hook contraparteHistory: no-op nesta etapa. Marca-se como `void` pra
  // satisfazer linters de "argumento não-usado" sem suprimir a interface.
  void contraparteHistory;

  if (calendar.isBusinessDay(dataVencimento)) {
    return dataVencimento;
  }
  return calendar.nextBusinessDay(dataVencimento);
}
