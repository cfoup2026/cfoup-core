import { extractTextLines } from '../utils/pdf.js';
import { addUTCDays, parseDDMMYYYYtoUTC } from '../utils/date.js';
import { parseBRLNumber } from '../utils/number.js';
const TX_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{6})\s+(.+?)\s+([\d.]+,\d{1,2})\s+([CD])$/;
const SALDO_INTERCALADO_RE = /^Saldo\s+([\d.]+,\d{1,2})\s+([CD])$/i;
const SALDO_ANTERIOR_RE = /^SALDO\s+ANTERIOR\s+([\d.]+,\d{1,2})(?:\s+([CD]))?$/i;
const HEADER_RE = /^(?:NR\.|DOC\.|DATA MOV\.|HIST.?RICO|VALOR|Extrato(?: por per.?odo)?|DATA MOV\..*HIST.?RICO.*VALOR)$/i;
const FOOTER_RE = /^\*\s*\d+/;
const SALDO_DIA_HISTORY_RE = /SALDO\s+DIA/i;
const SALDO_DOC_NUMBER = '000000';
const ACCOUNT_LINE_RE = /Conta\s*:?\s*(\d[\d.\-/ ]{4,})/i;
/**
 * Faz o parse do extrato em formato PDF nativo (texto selecionável) da CEF,
 * incluindo extratos com saldo intercalado entre transações.
 *
 * Layout reconhecido (cada item separado por whitespace):
 *   01/04/2026  310326  COB COMPE  3.046,64 C       <- Transaction
 *   Saldo  37.540,91 C                              <- BalanceSnapshot intercalado
 *   01/04/2026  000000  SALDO DIA  39.271,62 C      <- BalanceSnapshot (mesma regra do TXT)
 *   SALDO ANTERIOR  0,00                            <- BalanceSnapshot de abertura
 *   * 661 - ...                                     <- rodapé, ignorado
 *
 * Garantias idênticas às do parser TXT: nunca lança em caso de problema
 * de linha (vai pra `errors`/`warnings`); só pode falhar globalmente se o
 * PDF estiver corrompido ou criptografado, e mesmo nesses casos retorna
 * um ParseResult com erro estruturado.
 */
export async function parseCEFPdf(input) {
    let lines;
    try {
        lines = await extractTextLines(input);
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : 'falha ao extrair texto do PDF';
        return {
            ok: [],
            balances: [],
            errors: [{ line: 0, raw: '', reason }],
            warnings: [],
        };
    }
    return parseCEFPdfFromLines(lines);
}
/**
 * Versão pura e síncrona — recebe linhas já extraídas e devolve o ParseResult.
 * Útil pra testes com fixtures textuais sem precisar gerar PDFs.
 */
export function parseCEFPdfFromLines(lines) {
    const ok = [];
    const balances = [];
    const errors = [];
    const warnings = [];
    const accountId = findAccountId(lines);
    if (accountId === '') {
        warnings.push({
            line: lines[0]?.lineIndex ?? 0,
            message: 'número da conta não localizado no PDF — Transaction.accountId fica vazio',
        });
    }
    const pending = [];
    let lastTxDate = null;
    for (const line of lines) {
        const text = line.text;
        const lineNumber = line.lineIndex;
        if (HEADER_RE.test(text))
            continue;
        if (FOOTER_RE.test(text))
            continue;
        if (/^DATA MOV\..*VALOR$/i.test(text))
            continue;
        const txMatch = TX_RE.exec(text);
        if (txMatch !== null) {
            const dateStr = txMatch[1] ?? '';
            const docNumber = txMatch[2] ?? '';
            const history = txMatch[3] ?? '';
            const valueStr = txMatch[4] ?? '';
            const debCred = txMatch[5] ?? '';
            const date = parseDDMMYYYYtoUTC(dateStr);
            if (date === null) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: `data inválida: ${JSON.stringify(dateStr)}`,
                });
                continue;
            }
            const amount = parseBRLNumber(valueStr);
            if (amount === null) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: `valor não-numérico: ${JSON.stringify(valueStr)}`,
                });
                continue;
            }
            const direction = parseDirection(debCred);
            if (direction === null) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: `Deb_Cred inválido: ${JSON.stringify(debCred)}`,
                });
                continue;
            }
            flushPending(pending, date, accountId, balances);
            const isSaldoDia = docNumber === SALDO_DOC_NUMBER && SALDO_DIA_HISTORY_RE.test(history);
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
                lastTxDate = date;
                continue;
            }
            ok.push({
                id: `cef-pdf:${lineNumber}`,
                accountId,
                date,
                docNumber,
                history: history.trim(),
                amount,
                direction,
            });
            lastTxDate = date;
            continue;
        }
        const interMatch = SALDO_INTERCALADO_RE.exec(text);
        if (interMatch !== null) {
            const valueStr = interMatch[1] ?? '';
            const debCred = interMatch[2] ?? 'C';
            const amount = parseBRLNumber(valueStr);
            if (amount === null) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: `valor de saldo intercalado não-numérico: ${JSON.stringify(valueStr)}`,
                });
                continue;
            }
            const signedAmount = debCred.toUpperCase() === 'D' ? -amount : amount;
            if (lastTxDate === null) {
                pending.push({ kind: 'opening', amount: signedAmount, lineIndex: lineNumber });
            }
            else {
                balances.push({
                    accountId,
                    date: lastTxDate,
                    amount: signedAmount,
                    source: 'bank-statement',
                });
            }
            continue;
        }
        const antMatch = SALDO_ANTERIOR_RE.exec(text);
        if (antMatch !== null) {
            const valueStr = antMatch[1] ?? '';
            const debCred = antMatch[2] ?? 'C';
            const amount = parseBRLNumber(valueStr);
            if (amount === null) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: `valor de SALDO ANTERIOR não-numérico: ${JSON.stringify(valueStr)}`,
                });
                continue;
            }
            const signedAmount = debCred.toUpperCase() === 'D' ? -amount : amount;
            pending.push({ kind: 'anterior', amount: signedAmount, lineIndex: lineNumber });
            warnings.push({
                line: lineNumber,
                message: 'saldo anterior — data inferida como dia anterior à 1ª transação',
            });
            continue;
        }
        errors.push({
            line: lineNumber,
            raw: text,
            reason: 'linha não reconhecida',
        });
    }
    if (pending.length > 0) {
        warnings.push({
            line: pending[0]?.lineIndex ?? 0,
            message: 'PDF sem transações: saldos pendentes (SALDO ANTERIOR/abertura) descartados',
        });
    }
    return { ok, balances, errors, warnings };
}
function flushPending(pending, firstTxDate, accountId, balances) {
    if (pending.length === 0)
        return;
    for (const p of pending) {
        const date = p.kind === 'anterior' ? addUTCDays(firstTxDate, -1) : firstTxDate;
        balances.push({
            accountId,
            date,
            amount: p.amount,
            source: 'bank-statement',
        });
    }
    pending.length = 0;
}
function parseDirection(debCred) {
    const v = debCred.trim().toUpperCase();
    if (v === 'C')
        return 'credit';
    if (v === 'D')
        return 'debit';
    return null;
}
function findAccountId(lines) {
    for (const line of lines) {
        const m = ACCOUNT_LINE_RE.exec(line.text);
        if (m !== null) {
            return (m[1] ?? '').replace(/\s/g, '');
        }
    }
    return '';
}
//# sourceMappingURL=cef-pdf.js.map