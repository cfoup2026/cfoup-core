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
 * Histórico de pagamento por contraparte. Placeholder na Etapa 1.3 —
 * o Motor de Histórico (Prompt 2) vai prover métodos para consultar
 * padrões de antecipação/atraso por contraparte.
 *
 * Hoje: `deriveDataEsperada` aceita o parâmetro mas é no-op.
 */
export interface ContraparteHistory {
  /** Marker reservado pra evitar que `{}` colida acidentalmente.
   *  Será substituído por métodos reais (ex: `getOffsetDays`) no Estágio 2. */
  readonly __cf13_history?: 'estagio-2-pending';
}
