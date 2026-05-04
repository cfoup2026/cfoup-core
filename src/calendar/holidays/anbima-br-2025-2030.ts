/**
 * Feriados bancários nacionais BR — seed ANBIMA, 2025–2030.
 *
 * Hardcoded de propósito (auditável). Datas em `'YYYY-MM-DD'` UTC, lookup
 * O(1) via `Set`. Inclui Carnaval (segunda + terça), Sexta Santa, Corpus
 * Christi (móveis) e os 9 feriados nacionais fixos. Estaduais e municipais
 * ficam fora desta seed (V1 — adicionar por PJ no Prompt 2 se necessário).
 *
 * Páscoas usadas como referência para os móveis:
 *   2025: 20/04 · 2026: 05/04 · 2027: 28/03 · 2028: 16/04 · 2029: 01/04 · 2030: 21/04
 *
 * Carnaval segunda = Páscoa − 48 dias; terça = Páscoa − 47.
 * Sexta-feira Santa = Páscoa − 2 dias.
 * Corpus Christi = Páscoa + 60 dias.
 *
 * Feriado de Consciência Negra (20/11) entrou na lista nacional em 2024.
 * Para anos anteriores (não cobertos por esta seed), tratar caso a caso.
 *
 * Validar manualmente contra ANBIMA/FEBRABAN antes de cada virada de ano.
 */
export const ANBIMA_BR_HOLIDAYS_2025_2030: ReadonlySet<string> = new Set([
  /* 2025 (Páscoa 20/04) */
  '2025-01-01', // Confraternização Universal
  '2025-03-03', // Carnaval (seg)
  '2025-03-04', // Carnaval (ter)
  '2025-04-18', // Sexta-feira Santa
  '2025-04-21', // Tiradentes
  '2025-05-01', // Dia do Trabalho
  '2025-06-19', // Corpus Christi
  '2025-09-07', // Independência
  '2025-10-12', // N. Sra. Aparecida
  '2025-11-02', // Finados
  '2025-11-15', // Proclamação da República
  '2025-11-20', // Consciência Negra
  '2025-12-25', // Natal

  /* 2026 (Páscoa 05/04) */
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-04-03',
  '2026-04-21',
  '2026-05-01',
  '2026-06-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-11-20',
  '2026-12-25',

  /* 2027 (Páscoa 28/03) */
  '2027-01-01',
  '2027-02-08',
  '2027-02-09',
  '2027-03-26',
  '2027-04-21',
  '2027-05-01',
  '2027-05-27',
  '2027-09-07',
  '2027-10-12',
  '2027-11-02',
  '2027-11-15',
  '2027-11-20',
  '2027-12-25',

  /* 2028 (Páscoa 16/04, ano bissexto) */
  '2028-01-01',
  '2028-02-28',
  '2028-02-29',
  '2028-04-14',
  '2028-04-21',
  '2028-05-01',
  '2028-06-15',
  '2028-09-07',
  '2028-10-12',
  '2028-11-02',
  '2028-11-15',
  '2028-11-20',
  '2028-12-25',

  /* 2029 (Páscoa 01/04) */
  '2029-01-01',
  '2029-02-12',
  '2029-02-13',
  '2029-03-30',
  '2029-04-21',
  '2029-05-01',
  '2029-05-31',
  '2029-09-07',
  '2029-10-12',
  '2029-11-02',
  '2029-11-15',
  '2029-11-20',
  '2029-12-25',

  /* 2030 (Páscoa 21/04) */
  '2030-01-01',
  '2030-03-04',
  '2030-03-05',
  '2030-04-19',
  '2030-04-21',
  '2030-05-01',
  '2030-06-20',
  '2030-09-07',
  '2030-10-12',
  '2030-11-02',
  '2030-11-15',
  '2030-11-20',
  '2030-12-25',
]);

/** Anos cobertos pela seed atual. */
export const ANBIMA_BR_YEARS_COVERED: readonly number[] = [
  2025, 2026, 2027, 2028, 2029, 2030,
];
