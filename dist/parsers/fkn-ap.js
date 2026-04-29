import { parseDDMMYYYYtoUTC } from '../utils/date.js';
import { parseBRLNumber } from '../utils/number.js';
const STATUS_EPSILON = 0.01;
const EXPECTED_HEADERS = [
    'EMIS',
    'CONTA',
    'FORNECEDOR',
    'DOCUM.',
    'FIL',
    'VALOR',
    'VALOR PAGO',
    'VCTO',
    'PGTO',
    'ATR',
    'PORTADOR',
    'PRZ',
];
const A_VISTA_RE = /^A\s*VISTA$/i;
const TOTAL_DO_DIA_RE = /^TOTAL\s+DO\s+DIA/i;
const REPORT_FOOTER_RE = /^TOTAL\s+(GERAL|L[IÍ]QUIDO)/i;
const LEGEND_LINE_RE = /^\(.*\)/;
const PGTO_NULL_SENTINEL = '00/00/0000';
const DOC_NUMBER_STANDARD_RE = /^[A-Za-z0-9\s\-/.]+$/;
/**
 * Faz o parse de um relatório FKN de Contas a Pagar, no formato em que
 * cada Payable é uma linha e linhas "TOTAL DO DIA" agregam o dia anterior.
 *
 * Camada 2 da arquitetura: recebe linhas já tokenizadas pelo extractCSV
 * (camada 1, genérica). Não toca em I/O, encoding ou recorte de campos.
 *
 * Garantias:
 * - Nunca lança: problemas pontuais viram ParseError/ParseWarning, parser segue.
 * - Datas em UTC.
 * - amount e amountPaid sempre não-negativos; sinal vive em status.
 * - status calculado pelo parser com epsilon 0.01 sobre |amount - amountPaid|.
 * - VCTO='A VISTA' usa issuedAt como dueDate (warning emitido).
 * - TOTAL DO DIA antes de qualquer Payable vira ParseError.
 *
 * Particularidades do formato FKN observadas no CSV de produção:
 * - PGTO='00/00/0000' é sentinel de "não pago" (vai pra paidAt=null sem warning).
 * - PGTO em formato data inválido (ex: '30/04/2502') emite warning e mantém
 *   paidAt=null, sem perder o Payable.
 * - Linhas de rodapé do relatório (TOTAL GERAL, TOTAL LÍQUIDO) e legendas
 *   entre parênteses (ex: "($) Pagamento parcial...") são ignoradas em silêncio.
 */
export function parseFKNAp(rows) {
    const ok = [];
    const dailyTotals = [];
    const errors = [];
    const warnings = [];
    let headerSeen = false;
    let lastSeenDate = null;
    for (let i = 0; i < rows.length; i++) {
        const lineNumber = i + 1;
        const row = rows[i] ?? [];
        const raw = row.join(';');
        if (isBlankRow(row))
            continue;
        if (!headerSeen) {
            if (isHeaderRow(row)) {
                headerSeen = true;
            }
            continue;
        }
        const trimmed = row.map((c) => c.trim());
        const col1 = trimmed[1] ?? '';
        if (REPORT_FOOTER_RE.test(col1))
            continue;
        if (LEGEND_LINE_RE.test(trimmed[0] ?? ''))
            continue;
        if (TOTAL_DO_DIA_RE.test(col1)) {
            const totalDueStr = trimmed[2] ?? '';
            const totalPaidStr = trimmed[3] ?? '';
            const totalDue = parseBRLNumber(totalDueStr);
            const totalPaid = parseBRLNumber(totalPaidStr);
            if (totalDue === null || totalPaid === null) {
                errors.push({
                    line: lineNumber,
                    raw,
                    reason: `TOTAL DO DIA com valor inválido: due=${JSON.stringify(totalDueStr)} pago=${JSON.stringify(totalPaidStr)}`,
                });
                continue;
            }
            if (lastSeenDate === null) {
                errors.push({
                    line: lineNumber,
                    raw,
                    reason: 'TOTAL DO DIA antes de qualquer Payable — sem data de referência',
                });
                continue;
            }
            dailyTotals.push({
                date: lastSeenDate,
                totalDue,
                totalPaid,
                accountType: 'AP',
            });
            continue;
        }
        const payable = parsePayableRow(trimmed, lineNumber, raw, errors, warnings);
        if (payable === null)
            continue;
        lastSeenDate = payable.issuedAt;
        ok.push(payable);
    }
    if (!headerSeen) {
        errors.push({
            line: 0,
            raw: '',
            reason: 'cabeçalho FKN não encontrado (esperava EMIS;CONTA;FORNECEDOR;...)',
        });
    }
    return { ok, dailyTotals, balances: [], errors, warnings };
}
function isBlankRow(row) {
    return row.every((c) => c.trim() === '');
}
function isHeaderRow(row) {
    if (row.length < EXPECTED_HEADERS.length)
        return false;
    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
        if ((row[i] ?? '').trim() !== EXPECTED_HEADERS[i])
            return false;
    }
    return true;
}
function parsePayableRow(cols, lineNumber, raw, errors, warnings) {
    const emisStr = cols[0] ?? '';
    const contaStr = cols[1] ?? '';
    const vendorName = cols[2] ?? '';
    const docNumber = cols[3] ?? '';
    const filStr = cols[4] ?? '';
    const valorStr = cols[5] ?? '';
    const valorPagoStr = cols[6] ?? '';
    const vctoStr = cols[7] ?? '';
    const pgtoStr = cols[8] ?? '';
    const atrStr = cols[9] ?? '';
    const paymentMethod = cols[10] ?? '';
    const przStr = cols[11] ?? '';
    const issuedAt = parseDDMMYYYYtoUTC(emisStr);
    if (issuedAt === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `EMIS inválido: ${JSON.stringify(emisStr)}`,
        });
        return null;
    }
    const vendorCode = parseInteger(contaStr);
    if (vendorCode === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `CONTA (vendorCode) não-numérico: ${JSON.stringify(contaStr)}`,
        });
        return null;
    }
    const branch = parseInteger(filStr);
    if (branch === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `FIL (branch) não-numérico: ${JSON.stringify(filStr)}`,
        });
        return null;
    }
    const amount = parseBRLNumber(valorStr);
    if (amount === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `VALOR não-numérico: ${JSON.stringify(valorStr)}`,
        });
        return null;
    }
    const amountPaid = parseBRLNumber(valorPagoStr);
    if (amountPaid === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `VALOR PAGO não-numérico: ${JSON.stringify(valorPagoStr)}`,
        });
        return null;
    }
    let dueDate;
    if (A_VISTA_RE.test(vctoStr)) {
        dueDate = issuedAt;
        warnings.push({
            line: lineNumber,
            message: 'VCTO=A VISTA: dueDate usado como issuedAt',
        });
    }
    else {
        const parsed = parseDDMMYYYYtoUTC(vctoStr);
        if (parsed === null) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `VCTO inválido: ${JSON.stringify(vctoStr)}`,
            });
            return null;
        }
        dueDate = parsed;
    }
    let paidAt = null;
    if (pgtoStr !== '' && pgtoStr !== PGTO_NULL_SENTINEL) {
        const parsed = parseDDMMYYYYtoUTC(pgtoStr);
        if (parsed === null) {
            warnings.push({
                line: lineNumber,
                message: `PGTO em formato inválido (${JSON.stringify(pgtoStr)}): paidAt mantido null`,
            });
        }
        else {
            paidAt = parsed;
        }
    }
    const daysLate = parseInteger(atrStr);
    if (daysLate === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `ATR (daysLate) não-numérico: ${JSON.stringify(atrStr)}`,
        });
        return null;
    }
    const term = parseInteger(przStr);
    if (term === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `PRZ (term) não-numérico: ${JSON.stringify(przStr)}`,
        });
        return null;
    }
    if (docNumber !== '' && !DOC_NUMBER_STANDARD_RE.test(docNumber)) {
        warnings.push({
            line: lineNumber,
            message: `docNumber contém caractere não-padrão: ${JSON.stringify(docNumber)}`,
        });
    }
    const status = computeStatus(amount, amountPaid);
    return {
        id: `fkn-ap:${lineNumber}`,
        dueDate,
        vendorCode,
        vendorName,
        docNumber,
        branch,
        amount,
        amountPaid,
        issuedAt,
        paidAt,
        daysLate,
        paymentMethod,
        term,
        status,
    };
}
function computeStatus(amount, amountPaid) {
    if (amountPaid <= STATUS_EPSILON)
        return 'open';
    if (amountPaid > amount + STATUS_EPSILON)
        return 'overpaid';
    if (Math.abs(amountPaid - amount) <= STATUS_EPSILON)
        return 'paid';
    return 'partial';
}
function parseInteger(s) {
    const t = s.trim();
    if (t === '')
        return null;
    if (!/^-?\d+$/.test(t))
        return null;
    const n = Number(t);
    if (!Number.isFinite(n))
        return null;
    return n;
}
//# sourceMappingURL=fkn-ap.js.map