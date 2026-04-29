/**
 * Parser char-by-char de uma única linha CSV-like.
 * Respeita aspas duplas e aspas escapadas dentro de campo (`""` → `"`).
 * Não trata multi-line (newlines dentro de aspas) — chame por linha já segmentada.
 *
 * Por que não regex/split: extratos misturam aspas, separadores dentro de
 * histórico e formatos sutilmente diferentes; uma máquina de estados
 * pequena é mais previsível que regex e mais correta que split simples.
 */
export function parseCSVLine(line, delimiter) {
    if (delimiter.length !== 1) {
        throw new Error('parseCSVLine: delimiter deve ter exatamente 1 caractere');
    }
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charAt(i);
        if (inQuotes) {
            if (ch === '"') {
                if (line.charAt(i + 1) === '"') {
                    current += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
                continue;
            }
            current += ch;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            continue;
        }
        if (ch === delimiter) {
            fields.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    fields.push(current);
    return fields;
}
//# sourceMappingURL=csv.js.map