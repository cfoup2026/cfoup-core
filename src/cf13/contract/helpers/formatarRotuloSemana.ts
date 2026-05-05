/**
 * Formata o rótulo PT-BR de uma semana CF13 a partir de duas datas ISO
 * + índice 1-based.
 *
 * Formatos:
 *  - Mesma faixa de mês:  `"Sem {N} · {DD}–{DD} {mmm}"`
 *    Ex: `("2026-04-21", "2026-04-27", 1)` → `"Sem 1 · 21–27 abr"`
 *  - Cruzando mês:        `"Sem {N} · {DD} {mmm} – {DD} {mmm}"`
 *    Ex: `("2026-04-28", "2026-05-04", 2)` → `"Sem 2 · 28 abr – 04 mai"`
 *
 * Convenções:
 *  - Mês abreviado em PT-BR, **minúsculo, sem ponto**.
 *  - Dia zero-padded a 2 dígitos.
 *  - En-dash (`–`, U+2013) entre datas no mesmo mês; espaço-en-dash-espaço
 *    cruzando mês (`" – "`).
 *  - Separador entre `Sem N` e a data: middle dot (`·`, U+00B7) com
 *    espaços ao redor.
 *
 * Determinístico — mesma entrada → mesma string.
 *
 * Não usa `Intl` — implementação manual para evitar variabilidade entre
 * runtimes (ICU diferente, locale ausente).
 */

/** Lookup `mês 1-based → abreviação PT-BR`. Ordem documentada §6 do
 *  Item 1 do contrato. */
const MESES_PT_BR: readonly string[] = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** Parser estrito de `YYYY-MM-DD` em UTC. Retorna `null` em entrada
 *  inválida — chamadores devem normalizar antes (helper interno). */
function parseISODate(iso: string): { ano: number; mes: number; dia: number } | null {
  if (typeof iso !== 'string' || iso.length < 10) return null;
  /* Aceita tanto `YYYY-MM-DD` puro quanto `YYYY-MM-DDT...`. */
  const parte = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parte);
  if (m === null) return null;
  const ano = Number.parseInt(m[1]!, 10);
  const mes = Number.parseInt(m[2]!, 10);
  const dia = Number.parseInt(m[3]!, 10);
  if (mes < 1 || mes > 12) return null;
  if (dia < 1 || dia > 31) return null;
  return { ano, mes, dia };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * @param inicio ISO `YYYY-MM-DD` da segunda da semana.
 * @param fim    ISO `YYYY-MM-DD` do domingo da semana.
 * @param indice 1..13.
 * @throws `Error` quando alguma data não parseia.
 */
export function formatarRotuloSemana(
  inicio: string,
  fim: string,
  indice: number,
): string {
  const ini = parseISODate(inicio);
  const fi = parseISODate(fim);
  if (ini === null) {
    throw new Error(
      `formatarRotuloSemana: 'inicio' inválido (${JSON.stringify(inicio)})`,
    );
  }
  if (fi === null) {
    throw new Error(
      `formatarRotuloSemana: 'fim' inválido (${JSON.stringify(fim)})`,
    );
  }

  const mesIni = MESES_PT_BR[ini.mes - 1]!;
  const mesFim = MESES_PT_BR[fi.mes - 1]!;
  const diaIni = pad2(ini.dia);
  const diaFim = pad2(fi.dia);

  if (ini.mes === fi.mes && ini.ano === fi.ano) {
    /* Mesma faixa de mês. */
    return `Sem ${indice} · ${diaIni}–${diaFim} ${mesIni}`;
  }
  /* Cruzando mês (ou ano). */
  return `Sem ${indice} · ${diaIni} ${mesIni} – ${diaFim} ${mesFim}`;
}
