import { parseDDMMYYYYtoUTC } from '../utils/date.js';
import { parseSignedBRLNumber } from '../utils/number.js';
const EXPECTED_HEADERS = [
    'DATA',
    'NOTA',
    'VENDEDOR',
    'PRAZO',
    'VALOR NOTA',
    'VALOR CUSTO',
    '%LUC',
];
const CUSTOMER_HEADER_RE = /^CLIENTE:\s+(\d+)\s+(.+?)\s*$/;
const RULER_RE = /^-{3,}\s*$/;
const TOTAL_NOTAS_RE = /^TOTAL\s*-\s*NOTAS:?$/i;
const TOTAL_GERAL_RE = /^TOTAL\s+GERAL:?$/i;
/**
 * Faz o parse de um relatório FKN de Vendas por Cliente por Nota.
 * Layer 2 da arquitetura: recebe linhas tokenizadas pelo `extractCSV`.
 *
 * Diferenças estruturais em relação aos parsers AP/AR:
 * - **Não é flat**: vendas vêm agrupadas por cliente. Um header
 *   `CLIENTE: 000001 NOME...` precede o bloco de vendas; a venda em si
 *   não traz o cliente. O parser mantém estado `currentCustomer`.
 * - **Cada bloco fecha com**: linha "TOTAL - NOTAS:" + linha-régua "----"
 *   (ambas por cliente). No fim do relatório, uma linha "TOTAL GERAL:".
 * - **Datas em DD/MM/YYYY** (igual AP, diferente do AR).
 * - **VALOR NOTA pode ser negativo** (devoluções, raras): viram
 *   `movementType='return'` com `movementTypeSource='inferred_from_negative_amount'`
 *   + warning. `amount` e `cost` ficam não-negativos (Math.abs).
 *
 * Garantias FKN padrão: nunca lança, datas UTC, ParseResult com errors/warnings,
 * skip silencioso de cabeçalhos/rulers, ParseError pontual em linha inválida.
 */
export function parseFKNVendas(rows) {
    const ok = [];
    const aggregates = [];
    const errors = [];
    const warnings = [];
    let headerSeen = false;
    let currentCustomer = null;
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
        if (RULER_RE.test((row[0] ?? '').trim()))
            continue;
        const customerHeader = parseCustomerHeader(row);
        if (customerHeader !== null) {
            currentCustomer = customerHeader;
            continue;
        }
        const trimmed = row.map((c) => c.trim());
        const col2 = trimmed[2] ?? '';
        if (TOTAL_NOTAS_RE.test(col2)) {
            const aggregate = parseAggregateRow(trimmed, 'customer', currentCustomer, lineNumber, raw, errors);
            if (aggregate !== null)
                aggregates.push(aggregate);
            continue;
        }
        if (TOTAL_GERAL_RE.test(col2)) {
            const aggregate = parseAggregateRow(trimmed, 'global', null, lineNumber, raw, errors);
            if (aggregate !== null)
                aggregates.push(aggregate);
            continue;
        }
        const sale = parseSaleRow(trimmed, row, currentCustomer, lineNumber, raw, errors, warnings);
        if (sale !== null)
            ok.push(sale);
    }
    if (!headerSeen) {
        errors.push({
            line: 0,
            raw: '',
            reason: 'cabeçalho FKN Vendas não encontrado (esperava DATA;NOTA;VENDEDOR;PRAZO;VALOR NOTA;VALOR CUSTO;%LUC)',
        });
    }
    return { ok, aggregates, balances: [], errors, warnings };
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
function parseCustomerHeader(row) {
    const first = row[0] ?? '';
    const m = CUSTOMER_HEADER_RE.exec(first);
    if (m === null)
        return null;
    const code = Number(m[1]);
    if (!Number.isFinite(code))
        return null;
    const name = (m[2] ?? '').trim();
    return { code, name };
}
function parseSaleRow(cols, rawCols, currentCustomer, lineNumber, raw, errors, warnings) {
    const dataStr = cols[0] ?? '';
    const notaStr = cols[1] ?? '';
    const vendedor = cols[2] ?? '';
    const prazo = cols[3] ?? '';
    const valorStr = cols[4] ?? '';
    const custoStr = cols[5] ?? '';
    const lucStr = cols[6] ?? '';
    const issuedAt = parseDDMMYYYYtoUTC(dataStr);
    if (issuedAt === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `linha não reconhecida ou DATA inválida: ${JSON.stringify(dataStr)}`,
        });
        return null;
    }
    if (currentCustomer === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: 'venda sem header CLIENTE: precedente — sem código/nome de cliente',
        });
        return null;
    }
    const signedAmount = parseSignedBRLNumber(valorStr);
    if (signedAmount === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `VALOR NOTA não-numérico: ${JSON.stringify(valorStr)}`,
        });
        return null;
    }
    const signedCost = parseSignedBRLNumber(custoStr);
    if (signedCost === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `VALOR CUSTO não-numérico: ${JSON.stringify(custoStr)}`,
        });
        return null;
    }
    let movementType = 'sale';
    let movementTypeSource = 'explicit';
    if (signedAmount < 0) {
        movementType = 'return';
        movementTypeSource = 'inferred_from_negative_amount';
        warnings.push({
            line: lineNumber,
            message: 'VALOR NOTA negativo: movementType inferido como return',
        });
    }
    const amount = Math.abs(signedAmount);
    const cost = Math.abs(signedCost);
    const csvMargin = parseSignedBRLNumber(lucStr);
    const { marginPercent, marginPercentSource } = resolveMargin(csvMargin, amount, cost);
    return {
        id: `fkn-vendas:${lineNumber}`,
        issuedAt,
        customerCode: currentCustomer.code,
        customerName: currentCustomer.name,
        invoiceNumber: notaStr,
        salesperson: vendedor,
        paymentTerm: prazo,
        amount,
        cost,
        marginPercent,
        marginPercentSource,
        movementType,
        movementTypeSource,
        rawColumns: rawCols.slice(0, EXPECTED_HEADERS.length),
    };
}
function parseAggregateRow(cols, scope, currentCustomer, lineNumber, raw, errors) {
    if (scope === 'customer' && currentCustomer === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: 'TOTAL - NOTAS sem header CLIENTE: precedente',
        });
        return null;
    }
    const countStr = cols[3] ?? '';
    const totalAmountStr = cols[4] ?? '';
    const totalCostStr = cols[5] ?? '';
    const lucStr = cols[6] ?? '';
    const invoiceCount = parseInteger(countStr);
    if (invoiceCount === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `${scope === 'global' ? 'TOTAL GERAL' : 'TOTAL - NOTAS'}: contagem inválida ${JSON.stringify(countStr)}`,
        });
        return null;
    }
    const totalAmount = parseSignedBRLNumber(totalAmountStr);
    const totalCost = parseSignedBRLNumber(totalCostStr);
    if (totalAmount === null || totalCost === null) {
        errors.push({
            line: lineNumber,
            raw,
            reason: `${scope === 'global' ? 'TOTAL GERAL' : 'TOTAL - NOTAS'}: valores numéricos inválidos`,
        });
        return null;
    }
    const csvMargin = parseSignedBRLNumber(lucStr);
    const { marginPercent, marginPercentSource } = resolveMargin(csvMargin, Math.abs(totalAmount), Math.abs(totalCost));
    return {
        scope,
        customerCode: scope === 'customer' && currentCustomer ? currentCustomer.code : null,
        customerName: scope === 'customer' && currentCustomer ? currentCustomer.name : null,
        invoiceCount,
        totalAmount,
        totalCost,
        marginPercent,
        marginPercentSource,
    };
}
/**
 * Resolve `marginPercent` segundo a regra: CSV manda, computa só se cost
 * e amount permitirem, senão devolve null com 'unavailable'. Nunca
 * sobrescreve valor vindo do CSV mesmo quando recalcular daria diferente.
 */
function resolveMargin(csvValue, amount, cost) {
    if (csvValue !== null) {
        return { marginPercent: csvValue, marginPercentSource: 'from_csv' };
    }
    if (amount === 0 || cost === 0) {
        return { marginPercent: null, marginPercentSource: 'unavailable' };
    }
    return {
        marginPercent: ((amount - cost) / amount) * 100,
        marginPercentSource: 'computed',
    };
}
function parseInteger(s) {
    const t = s.trim().replace(/\./g, '');
    if (t === '')
        return null;
    if (!/^-?\d+$/.test(t))
        return null;
    const n = Number(t);
    if (!Number.isFinite(n))
        return null;
    return n;
}
//# sourceMappingURL=fkn-vendas.js.map