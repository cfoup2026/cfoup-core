/**
 * Converte string numérica em formato brasileiro pra number.
 * Ponto = milhar, vírgula = decimal. Aceita opcionalmente espaços nas pontas.
 *
 *   "12,34"        -> 12.34
 *   "1.234,56"     -> 1234.56
 *   "39.271,62"    -> 39271.62
 *   "1.234.567,89" -> 1234567.89
 *   "0,00"         -> 0
 *   "1234,56"      -> 1234.56  (milhar opcional)
 *
 * Retorna null se a string for malformada (vazia, sem vírgula decimal,
 * caracteres inesperados, milhar mal posicionado).
 */
export function parseBRLNumber(s) {
    if (typeof s !== 'string')
        return null;
    const trimmed = s.trim();
    if (trimmed === '')
        return null;
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(trimmed))
        return null;
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const n = Number(normalized);
    if (!Number.isFinite(n))
        return null;
    return n;
}
/**
 * Variante de `parseBRLNumber` que aceita sinal negativo opcional na frente.
 * Espaços entre o sinal e o número também são tolerados (ex: "- 1.234,56").
 *
 *   "-12,34"     -> -12.34
 *   "- 1.234,56" -> -1234.56
 *   "12,34"      -> 12.34   (sem sinal: positivo, igual a parseBRLNumber)
 *
 * Casos onde o sinal vive numa coluna separada (ex: extrato CEF com C/D)
 * NÃO devem usar este helper — o sinal "lógico" vive no tipo de domínio
 * (`direction`, `movementType`, etc), não na string numérica.
 */
export function parseSignedBRLNumber(s) {
    if (typeof s !== 'string')
        return null;
    const trimmed = s.trim();
    if (trimmed === '')
        return null;
    const negative = trimmed.startsWith('-');
    const body = negative ? trimmed.slice(1).trimStart() : trimmed;
    const value = parseBRLNumber(body);
    if (value === null)
        return null;
    if (value === 0)
        return 0;
    return negative ? -value : value;
}
//# sourceMappingURL=number.js.map