/**
 * Política de calendário operacional, plugável por `legal_entity_id`
 * (cada PJ pode ter feriados regionais distintos no futuro).
 *
 * Implementação pública atual: `BrazilCalendarPolicy`. Outras (ex: US,
 * EU) podem implementar a mesma interface — sem dependência específica
 * do BR aqui.
 *
 * Distinção semântica importante entre os dois métodos:
 *  - `isBusinessDay(d)` é puro: classifica `d`.
 *  - `nextBusinessDay(d)` retorna o **próximo dia útil estritamente
 *    depois** de `d`. Sempre avança ao menos 1 dia, mesmo se `d` já é
 *    útil. Não confunda com `deriveDataEsperada(d, calendar)`, que é
 *    "ficar em `d` se `d` for útil; senão, mover".
 */
export interface CalendarPolicy {
  /** Identificador da política (ex: 'br', 'us'). */
  readonly id: string;
  /** True quando `date` é dia útil para esta política. */
  isBusinessDay(date: Date): boolean;
  /** Próximo dia útil **estritamente após** `date`. Sempre avança. */
  nextBusinessDay(date: Date): Date;
}

/**
 * Ajuste mínimo por contraparte que `deriveDataEsperada` precisa
 * consultar — desacoplado do tipo `ContraparteStats` (que vive em
 * `src/types/historico.ts`) para que o módulo `calendar` permaneça
 * fundação sem depender do `historico`. Como `ContraparteStats` tem
 * `padrao_estavel: boolean` e `mediana_dias: number` em sua superfície,
 * é estruturalmente compatível: o caller passa
 * `Map<string, ContraparteStats>` direto.
 */
export interface ContraparteAdjustment {
  /** True quando a contraparte tem padrão observado consistente. */
  padrao_estavel: boolean;
  /** Mediana do delta `data_realizada - data_vencimento` em dias.
   *  Positivo = paga em atraso; negativo = adianta. Aplicado quando
   *  `padrao_estavel` é true e mediana ≠ 0. */
  mediana_dias: number;
}

/**
 * Mapa `contraparte_id → ContraparteAdjustment`. Em Estágio 2.2 o
 * `MotorHistorico` produz `Map<string, ContraparteStats>`, que é
 * assignável a este tipo (covariância em ReadonlyMap).
 *
 * Quando passado a `deriveDataEsperada`, eventos confirmados de uma
 * contraparte estável têm `data_esperada` deslocada por `mediana_dias`
 * antes da regra de calendário operacional.
 */
export type ContraparteHistory = ReadonlyMap<string, ContraparteAdjustment>;
