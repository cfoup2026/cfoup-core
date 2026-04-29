import { parseYYYYMMDDtoUTC } from '../utils/date.js';
import { parseCSVLine } from '../utils/csv.js';
const DELIMITER = ';';
const EXPECTED_HEADERS = [
    'Conta',
    'Data_Mov',
    'Nr_Doc',
    'Historico',
    'Valor',
    'Deb_Cred',
];
const SALDO_DOC_NUMBER = '000000';
const SALDO_HISTORY_PATTERN = /SALDO\s+DIA/i;
/**
 * Faz o parse do extrato em formato TXT da Caixa Econômica Federal (CEF).
 *
 * Formato esperado (header + linhas):
 *   "Conta";"Data_Mov";"Nr_Doc";"Historico";"Valor";"Deb_Cred"
 *   "0423012920005778782426";"20250401";"310325";"COB COMPE";"5964.52";"C"
 *
 * Garantias:
 * - Nunca lança exceção: erros viram entradas em `errors` e o parser segue.
 * - Linhas em branco são ignoradas silenciosamente.
 * - Linhas com Nr_Doc=000000 e histórico contendo "SALDO DIA" viram
 *   `BalanceSnapshot`, não `Transaction`. Um warning é emitido pra rastrear.
 * - Datas são sempre UTC (Date.UTC).
 */
export function parseCEFTxt(content) {
    const ok = [];
    const balances = [];
    const errors = [];
    const warnings = [];
    const rawLines = content.split(/\r?\n/);
    let headerSeen = false;
    for (let idx = 0; idx < rawLines.length; idx++) {
        const lineNumber = idx + 1;
        const raw = rawLines[idx] ?? '';
        const trimmed = raw.trim();
        if (trimmed === '')
            continue;
        const fields = parseCSVLine(trimmed, DELIMITER);
        if (!headerSeen) {
            if (isHeaderRow(fields)) {
                headerSeen = true;
                continue;
            }
            errors.push({
                line: lineNumber,
                raw,
                reason: `cabeçalho inválido: esperava ${EXPECTED_HEADERS.join(';')}`,
            });
            return { ok, balances, errors, warnings };
        }
        if (fields.length !== EXPECTED_HEADERS.length) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `quantidade de colunas inesperada (${fields.length}, esperava ${EXPECTED_HEADERS.length})`,
            });
            continue;
        }
        const [accountId, dateStr, docNumber, history, valueStr, debCred] = fields;
        const date = parseYYYYMMDDtoUTC(dateStr);
        if (date === null) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `data inválida: ${JSON.stringify(dateStr)}`,
            });
            continue;
        }
        const amount = parseAmount(valueStr);
        if (amount === null) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `valor não-numérico: ${JSON.stringify(valueStr)}`,
            });
            continue;
        }
        const direction = parseDirection(debCred);
        if (direction === null) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `Deb_Cred inválido: ${JSON.stringify(debCred)} (esperava "C" ou "D")`,
            });
            continue;
        }
        const isSaldoDia = docNumber === SALDO_DOC_NUMBER && SALDO_HISTORY_PATTERN.test(history);
        if (isSaldoDia) {
            balances.push({
                accountId,
                date,
                amount: direction === 'credit' ? amount : -amount,
                source: 'bank-statement',
            });
            warnings.push({
                line: lineNumber,
                message: 'saldo informativo, não é movimentação',
            });
            continue;
        }
        ok.push({
            id: `cef-txt:${lineNumber}`,
            accountId,
            date,
            docNumber,
            history,
            amount,
            direction,
        });
    }
    if (!headerSeen) {
        errors.push({
            line: 0,
            raw: '',
            reason: 'arquivo vazio ou sem cabeçalho reconhecível',
        });
    }
    return { ok, balances, errors, warnings };
}
function isHeaderRow(fields) {
    if (fields.length !== EXPECTED_HEADERS.length)
        return false;
    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
        if (fields[i] !== EXPECTED_HEADERS[i])
            return false;
    }
    return true;
}
function parseAmount(valueStr) {
    if (valueStr.trim() === '')
        return null;
    const n = Number(valueStr);
    if (!Number.isFinite(n))
        return null;
    return Math.abs(n);
}
function parseDirection(debCred) {
    const v = debCred.trim().toUpperCase();
    if (v === 'C')
        return 'credit';
    if (v === 'D')
        return 'debit';
    return null;
}
//# sourceMappingURL=cef-txt.js.map