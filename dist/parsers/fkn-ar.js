import { parseDDMMYYtoUTC } from '../utils/date.js';
import { parseBRLNumber } from '../utils/number.js';
const STATUS_EPSILON = 0.01;
const EXPECTED_HEADERS = [
    'EMIS',
    'COD.',
    'CLIENTE',
    'FIL',
    'DUPLIC.',
    'ID',
    'VALOR',
    'VALOR PAGO',
    'VCTO',
    'PGTO',
    'ATR',
    'PORTADOR',
    'TIP',
    'NOSSO NRO / BCO',
];
const A_VISTA_RE = /^A\s*VISTA$/i;
const TOTAL_DO_DIA_RE = /^TOTAL\s+DO\s+DIA/i;
const REPORT_FOOTER_RE = /^(TOTAL\s+(GERAL|L[IÍ]QUIDO)|DESCONTADOS|CAUCIONADOS|OUTROS|A\s+VISTA[,\s]|Obs:?)/i;
const LEGEND_LINE_RE = /^\(.*\)/;
const PGTO_NULL_SENTINEL = '00/00/00';
const DOC_NUMBER_STANDARD_RE = /^[A-Za-z0-9\s\-/.]+$/;
/**
 * Faz o parse de um relatório FKN de Contas a Receber, no mesmo modelo
 * de 2 camadas do AP: este parser recebe linhas já tokenizadas pelo
 * `extractCSV` (camada 1, genérica).
 *
 * Diferenças observadas em relação ao AP:
 * - Cabeçalho de 14 colunas (AP tem 12), incluindo ID, TIP e NOSSO NRO/BCO.
 * - Datas em formato `DD/MM/YY` (AP usa `DD/MM/YYYY`); convenção de século
 *   YY 00-79 → 2000+YY, YY 80-99 → 1900+YY (parseDDMMYYtoUTC).
 * - PGTO sentinel "não pago" é `00/00/00` (AP usa `00/00/0000`).
 * - Linhas `;Obs:;...` aparecem entre Receivables (~1684 no Gregorutt CR);
 *   tratadas como skip silencioso.
 * - Rodapés agregados extras: DESCONTADOS, CAUCIONADOS, OUTROS — também skip.
 *
 * Garantias idênticas ao AP: nunca lança, datas UTC, amounts não-negativos,
 * status calculado pelo parser, ParseResult com errors/warnings estruturados.
 *
 * Rastreabilidade: cada Receivable tem `dueDateSource`. VCTO 'A VISTA' vira
 * `'inferred_from_issue_date'`; data válida no extrato vira `'explicit'`.
 *
 * TODO [refactor]: Payable ainda não tem `dueDateSource`. Replicar o campo
 * em src/types/payable.ts e em src/parsers/fkn-ap.ts (com fixture sintética
 * AP atualizada). Estimativa: 1h. Razão da assimetria temporária: AR
 * estreou o campo hoje, AP migra amanhã (2026-04-29).
 */
export function parseFKNAr(rows) {
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
            if (isHeaderRow(row))
                headerSeen = true;
            continue;
        }
        const trimmed = row.map((c) => c.trim());
        const col0 = trimmed[0] ?? '';
        const col1 = trimmed[1] ?? '';
        if (REPORT_FOOTER_RE.test(col1))
            continue;
        if (LEGEND_LINE_RE.test(col0))
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
                    reason: 'TOTAL DO DIA antes de qualquer Receivable — sem data de referência',
                });
                continue;
            }
            dailyTotals.push({
                date: lastSeenDate,
                totalDue,
                totalPaid,
                accountType: 'AR',
            });
            continue;
        }
        const receivable = parseReceivableRow(trimmed, lineNumber, raw, errors, warnings);
        if (receivable === null)
            continue;
        lastSeenDate = receivable.issuedAt;
        ok.push(receivable);
    }
    if (!headerSeen) {
        errors.push({
            line: 0,
            raw: '',
            reason: 'cabeçalho FKN AR não encontrado (esperava EMIS;COD.;CLIENTE;FIL;DUPLIC.;ID;VALOR;...)',
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
function parseReceivableRow(cols, lineNumber, raw, errors, warnings) {
    const emisStr = cols[0] ?? '';
    const codStr = cols[1] ?? '';
    const customerName = cols[2] ?? '';
    const filStr = cols[3] ?? '';
    const docNumber = cols[4] ?? '';
    const installmentId = cols[5] ?? '';
    const valorStr = cols[6] ?? '';
    const valorPagoStr = cols[7] ?? '';
    const vctoStr = cols[8] ?? '';
    const pgtoStr = cols[9] ?? '';
    const atrStr = cols[10] ?? '';
    const paymentMethod = cols[11] ?? '';
    const documentType = cols[12] ?? '';
    const bankRef = cols[13] ?? '';
    const issuedAt = parseDDMMYYtoUTC(emisStr);
    if (issuedAt === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `EMIS inválido: ${JSON.stringify(emisStr)}`,
        });
        return null;
    }
    const customerCode = parseInteger(codStr);
    if (customerCode === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `COD. (customerCode) não-numérico: ${JSON.stringify(codStr)}`,
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
    let dueDateSource;
    if (A_VISTA_RE.test(vctoStr)) {
        dueDate = issuedAt;
        dueDateSource = 'inferred_from_issue_date';
        warnings.push({
            line: lineNumber,
            message: 'VCTO=A VISTA: dueDate inferido de issuedAt',
        });
    }
    else {
        const parsed = parseDDMMYYtoUTC(vctoStr);
        if (parsed === null) {
            errors.push({
                line: lineNumber,
                raw,
                reason: `VCTO inválido: ${JSON.stringify(vctoStr)}`,
            });
            return null;
        }
        dueDate = parsed;
        dueDateSource = 'explicit';
    }
    let paidAt = null;
    if (pgtoStr !== '' && pgtoStr !== PGTO_NULL_SENTINEL) {
        const parsed = parseDDMMYYtoUTC(pgtoStr);
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
    if (docNumber !== '' && !DOC_NUMBER_STANDARD_RE.test(docNumber)) {
        warnings.push({
            line: lineNumber,
            message: `docNumber contém caractere não-padrão: ${JSON.stringify(docNumber)}`,
        });
    }
    const status = computeStatus(amount, amountPaid);
    return {
        id: `fkn-ar:${lineNumber}`,
        dueDate,
        dueDateSource,
        customerCode,
        customerName,
        docNumber,
        installmentId,
        branch,
        amount,
        amountPaid,
        issuedAt,
        paidAt,
        daysLate,
        paymentMethod,
        documentType,
        bankRef,
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
//# sourceMappingURL=fkn-ar.js.map