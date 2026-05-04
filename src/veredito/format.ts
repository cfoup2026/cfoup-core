/**
 * Formatadores BR determinísticos (§6.2 do spec).
 *
 * **Sem `Intl`** — `Intl` depende de locale do runtime e ICU, que pode
 * variar entre Node versions, ambientes Docker, navegadores. Stage 7
 * exige determinismo byte-a-byte; implementamos formatação manual.
 *
 * Convenção:
 *  - Valor em BRL: separador de milhar `.`, decimal `,`, 2 casas.
 *    `12345.6 → "12.345,60"`. `0.5 → "0,50"`. `1234567.89 → "1.234.567,89"`.
 *  - Data: ISO 8601 → `DD/MM` (ano omitido). UTC para evitar timezone
 *    drift. `"2026-05-25T00:00:00.000Z" → "25/05"`.
 *
 * Negativos preservam sinal (`-1234.5 → "-1.234,50"`). Sinais de
 * formatação contextuais (parênteses, "R$") são responsabilidade dos
 * templates, não dos formatadores.
 */

/**
 * Formata número para BRL sem prefixo `R$`, padrão: `12.345,60`.
 *
 * Truncamento/arredondamento: `toFixed(2)` (round-half-to-even via
 * banker's rounding em V8 — comportamento estável). Para os valores
 * típicos do CF13 (saldo, mínimo, falta), 2 casas é o esperado.
 */
export function formatarBRL(valor: number): string {
  if (!Number.isFinite(valor)) {
    /* Defesa: NaN/Infinity nunca chegam aqui no fluxo normal. Stage 4
     *  garante números finitos. Mas se chegarem, retornamos string
     *  determinística sem quebrar. */
    return '0,00';
  }
  const negativo = valor < 0;
  const abs = Math.abs(valor);
  const fixed = abs.toFixed(2); // "12345.60"
  const [inteiro, decimal] = fixed.split('.') as [string, string];

  /* Insere `.` a cada 3 dígitos da direita pra esquerda. */
  let comMilhar = '';
  for (let i = 0; i < inteiro.length; i++) {
    if (i > 0 && (inteiro.length - i) % 3 === 0) {
      comMilhar += '.';
    }
    comMilhar += inteiro[i];
  }

  return `${negativo ? '-' : ''}${comMilhar},${decimal}`;
}

/**
 * Formata data ISO 8601 para `DD/MM` em UTC. Ignora componente de
 * tempo. Aceita string ISO ou `Date`.
 */
export function formatarDataDDMM(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) {
    /* Defesa: data inválida vira "00/00" pra não quebrar template.
     *  Em uso normal, Stage 4 sempre fornece datas válidas. */
    return '00/00';
  }
  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}`;
}
