/**
 * Estatísticas básicas usadas pelo motor de histórico.
 *
 * Funções puras, sem dependências, propositalmente compactas. Não fazem
 * tratamento defensivo (caller é responsável por garantir array não-vazio
 * onde aplicável).
 */

/** Mediana de um array. Aceita array já ordenado ou não — `sorted=true`
 *  evita reordenação se o caller já passar ordenado. Lança em array vazio. */
export function median(values: readonly number[], sorted = false): number {
  if (values.length === 0) {
    throw new Error('median: array vazio');
  }
  const arr = sorted ? values : [...values].sort((a, b) => a - b);
  const n = arr.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return arr[mid]!;
  return (arr[mid - 1]! + arr[mid]!) / 2;
}

/** Média aritmética. Lança em array vazio. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean: array vazio');
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Desvio-padrão populacional (divide por `n`, não `n-1`).
 * Uso: estatística descritiva sobre população completa observada
 * (não amostragem de população maior).
 */
export function populationStddev(values: readonly number[], avg?: number): number {
  if (values.length === 0) throw new Error('populationStddev: array vazio');
  const m = avg ?? mean(values);
  let sumSq = 0;
  for (const v of values) {
    const d = v - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

/** Diferença em dias entre duas datas UTC, arredondada pra inteiro. */
export function diffDays(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.round(ms / 86_400_000);
}
