/**
 * Converte uma string `YYYYMMDD` para Date em UTC (00:00:00.000Z do dia).
 * Retorna null se o formato for inválido ou a data não existir
 * (ex: 20250230, 20259999, ano fora de [1900, 2100]).
 *
 * Por que UTC: `new Date('2025-04-01')` em America/Sao_Paulo (UTC-3) cria
 * um Date que, formatado com `toLocaleDateString('pt-BR')`, vira 31/03.
 * Usar `Date.UTC` ancora o instante e elimina o off-by-one por timezone.
 */
export function parseYYYYMMDDtoUTC(s: string): Date | null {
  if (typeof s !== 'string' || s.length !== 8) return null;
  if (!/^\d{8}$/.test(s)) return null;

  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));

  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);

  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}
