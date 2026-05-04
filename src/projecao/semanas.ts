/**
 * Utilidades de semana ISO 8601. UTC consistentemente — alinhado com
 * o resto do CF13 (`utils/date.ts` ancora tudo em UTC para evitar
 * off-by-one por timezone do servidor).
 *
 * Definições:
 *  - Semana ISO começa segunda, termina domingo.
 *  - Semana 1 do ano é a que contém a primeira quinta-feira (ou
 *    equivalente: a que contém 4 de janeiro).
 *  - Identificador `YYYY-Www`, ex: `"2026-W18"`.
 */
import { addUTCDays } from '../utils/date.js';
import { ProjecaoError } from '../types/projecao.js';

const DAY_MS = 86_400_000;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;

/**
 * Identificador ISO da semana à qual `date` pertence.
 *
 * Implementação: a "semana ISO" de uma data é determinada pela
 * quinta-feira da mesma semana (regra ISO 8601). A quinta-feira
 * sempre cai no mesmo ano ISO. Calcula-se quantas semanas se passaram
 * desde o início desse ano até a quinta-feira, contando inclusiva.
 */
export function semanaIsoOf(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ProjecaoError('semanaIsoOf: data inválida');
  }
  // Normaliza para meia-noite UTC do mesmo dia (usa só componentes UTC).
  const t = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // ISO: domingo é dia 7; segunda=1, ..., sábado=6.
  const dayNum = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
  // Avança/recua para a quinta-feira (4) da mesma semana.
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const isoYear = t.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Segunda-feira da semana ISO, 00:00:00.000 UTC.
 *
 * Implementação: 4 de janeiro está sempre na semana 1 (regra ISO).
 * A partir da segunda-feira da semana 1, deslocamento é trivialmente
 * `(week - 1) * 7` dias.
 */
export function inicioDaSemanaIso(semanaIso: string): Date {
  const m = WEEK_RE.exec(semanaIso);
  if (m === null) {
    throw new ProjecaoError(
      `semanaIso inválida: esperado "YYYY-Www", recebido ${JSON.stringify(semanaIso)}`,
    );
  }
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) {
    throw new ProjecaoError(
      `semanaIso inválida: número de semana fora de [1,53]: ${semanaIso}`,
    );
  }
  // 4 de janeiro do ano-ISO está sempre na semana 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  // Segunda-feira da semana 1: jan4 - (dayNum - 1) dias.
  const week1Monday = addUTCDays(jan4, 1 - dayNum);
  return addUTCDays(week1Monday, (week - 1) * 7);
}

/**
 * Domingo da semana ISO, 23:59:59.999 UTC. Usado como fronteira
 * superior do bucket (intervalo fechado-fechado por convenção do
 * pipeline; eventos com `getTime()` no instante exato pertencem à
 * semana).
 */
export function fimDaSemanaIso(semanaIso: string): Date {
  const inicio = inicioDaSemanaIso(semanaIso);
  // Próxima segunda 00:00 menos 1ms = domingo 23:59:59.999.
  return new Date(addUTCDays(inicio, 7).getTime() - 1);
}

/**
 * Janela de `n` semanas ISO consecutivas a partir da semana de
 * `geradoEm` (inclusiva). Exemplo: `geradoEm=2026-05-01` (sex, W18),
 * `n=13` → `["2026-W18", "2026-W19", ..., "2026-W30"]`.
 */
export function semanasJanela(geradoEm: Date, n: number): string[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new ProjecaoError(
      `semanasJanela: n deve ser inteiro ≥ 1, recebido ${n}`,
    );
  }
  const inicio = inicioDaSemanaIso(semanaIsoOf(geradoEm));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(semanaIsoOf(addUTCDays(inicio, i * 7)));
  }
  return out;
}
