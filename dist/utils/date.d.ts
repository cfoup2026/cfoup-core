/**
 * Converte uma string `YYYYMMDD` para Date em UTC (00:00:00.000Z do dia).
 * Retorna null se o formato for inválido ou a data não existir
 * (ex: 20250230, 20259999, ano fora de [1900, 2100]).
 *
 * Por que UTC: `new Date('2025-04-01')` em America/Sao_Paulo (UTC-3) cria
 * um Date que, formatado com `toLocaleDateString('pt-BR')`, vira 31/03.
 * Usar `Date.UTC` ancora o instante e elimina o off-by-one por timezone.
 */
export declare function parseYYYYMMDDtoUTC(s: string): Date | null;
/**
 * Converte uma string `DD/MM/YYYY` para Date em UTC (00:00:00.000Z do dia).
 * Retorna null se o formato for inválido ou a data não existir.
 *
 * Mesmo racional do `parseYYYYMMDDtoUTC`: ancorar em UTC pra evitar
 * off-by-one em fusos a oeste de Greenwich (ex: America/Sao_Paulo).
 */
export declare function parseDDMMYYYYtoUTC(s: string): Date | null;
/**
 * Converte uma string `DD/MM/YY` para Date em UTC.
 * Convenção de século (igual ao SQL Server padrão): YY em 00–79 → 2000+YY,
 * YY em 80–99 → 1900+YY. Cobre 1980–2079 — suficiente pra dados financeiros
 * recentes; sistemas com datas anteriores precisam usar DD/MM/YYYY.
 */
export declare function parseDDMMYYtoUTC(s: string): Date | null;
/**
 * Retorna um Date em UTC pra um dia anterior (ou posterior, com `delta`
 * negativo) ao Date informado. O Date retornado também aponta pra 00:00 UTC.
 */
export declare function addUTCDays(d: Date, delta: number): Date;
//# sourceMappingURL=date.d.ts.map