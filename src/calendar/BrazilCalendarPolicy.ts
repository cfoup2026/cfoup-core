import { addUTCDays } from '../utils/date.js';
import type { CalendarPolicy } from './CalendarPolicy.js';
import { ANBIMA_BR_HOLIDAYS_2025_2030 } from './holidays/anbima-br-2025-2030.js';

/** Formata um Date como `'YYYY-MM-DD'` em UTC. */
function toISODateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calendário operacional Brasil — regra §7.1 do CF13:
 * sábado, domingo ou feriado bancário nacional ANBIMA → não é dia útil.
 *
 * Datas dos feriados são hardcoded em `holidays/anbima-br-2025-2030.ts`.
 * Estaduais e municipais ficam fora da V1.
 *
 * Convenção de Date: todas as entradas devem ser UTC (00:00:00.000Z do dia).
 * Os parsers do nucleus já entregam datas em UTC; consumidores em outras
 * timezones precisam converter antes de chamar.
 */
export class BrazilCalendarPolicy implements CalendarPolicy {
  readonly id = 'br' as const;

  isBusinessDay(date: Date): boolean {
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return false; // 0=domingo, 6=sábado
    return !ANBIMA_BR_HOLIDAYS_2025_2030.has(toISODateUTC(date));
  }

  /**
   * Próximo dia útil **estritamente após** `date` — sempre avança ao menos
   * 1 dia, mesmo se `date` já for útil. Para "fica em `date` se útil, senão
   * move", use `deriveDataEsperada(date, calendar)`.
   *
   * Pula sequências de feriados/pontes (ex: véspera de feriado em sexta
   * anda direto pra próxima segunda; sequência longa entre Natal e Ano
   * Novo anda direto pra primeiro dia útil de janeiro).
   */
  nextBusinessDay(date: Date): Date {
    let next = addUTCDays(date, 1);
    while (!this.isBusinessDay(next)) {
      next = addUTCDays(next, 1);
    }
    return next;
  }
}
