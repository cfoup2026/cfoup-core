/**
 * Parser char-by-char de uma única linha CSV-like.
 * Respeita aspas duplas e aspas escapadas dentro de campo (`""` → `"`).
 * Não trata multi-line (newlines dentro de aspas) — chame por linha já segmentada.
 *
 * Por que não regex/split: extratos misturam aspas, separadores dentro de
 * histórico e formatos sutilmente diferentes; uma máquina de estados
 * pequena é mais previsível que regex e mais correta que split simples.
 */
export declare function parseCSVLine(line: string, delimiter: string): string[];
//# sourceMappingURL=csv.d.ts.map