/* ─────────── Helpers ─────────── */
const DAY_MS = 86_400_000;
/** Diferença em dias entre duas datas UTC (truncadas). */
function daysBetween(a, b) {
    const day = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.abs((day(a) - day(b)) / DAY_MS);
}
/** Mesma data UTC (Y-M-D). */
function sameDay(a, b) {
    return daysBetween(a, b) === 0;
}
/** Diferença relativa entre dois valores positivos. */
function relativeDiff(a, b) {
    if (a === 0 && b === 0)
        return 0;
    const denom = Math.max(Math.abs(a), Math.abs(b));
    return Math.abs(a - b) / denom;
}
function normalizeText(s) {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}
/** Similaridade rude: substring entre os dois nomes (ordem irrelevante). */
function counterpartySimilar(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (na.length < 4 || nb.length < 4)
        return false;
    return na.includes(nb) || nb.includes(na);
}
let matchCounter = 0;
function nextMatchId(companyId) {
    matchCounter += 1;
    return `recmatch_${companyId}_${matchCounter}`;
}
/**
 * Tenta casar uma transação bancária contra candidatos (CR/CP).
 *
 * Ordem de prioridade (a primeira que casa ganha):
 *  1. Mesmo `documentNumber`.
 *  2. Mesmo valor + mesma data.
 *  3. Mesmo valor + data próxima (±3 dias).
 *  4. Soma de múltiplos candidatos = valor (batch).
 *  5. Contraparte parecida + valor próximo (parcial).
 *
 * Diferença ≤ `exactTolerance` (default 1%) → match exato.
 * Diferença > `exactTolerance` mas ≤ `partialTolerance` (default 5%) →
 * match parcial (matchType='partial').
 * Diferença > `partialTolerance` → sem match (`null`).
 */
export function reconcileBankTransaction(bankTransaction, candidates, options = {}) {
    const exact = options.exactTolerance ?? 0.01;
    const partial = options.partialTolerance ?? 0.05;
    if (candidates.length === 0)
        return null;
    const proposal = matchByDocument(bankTransaction, candidates, exact) ??
        matchByAmountAndDate(bankTransaction, candidates, exact) ??
        matchByAmountNearDate(bankTransaction, candidates, exact) ??
        matchByBatchTotal(bankTransaction, candidates, exact) ??
        matchByCounterparty(bankTransaction, candidates, partial);
    if (proposal === null)
        return null;
    return {
        id: nextMatchId(bankTransaction.companyId),
        companyId: bankTransaction.companyId,
        bankTransactionId: bankTransaction.id,
        matchedTransactionIds: proposal.matchedTransactionIds,
        matchType: proposal.matchType,
        amountMatched: proposal.amountMatched,
        amountDifference: proposal.amountDifference,
        confidenceScore: proposal.confidenceScore,
        matchReason: proposal.matchReason,
        status: proposal.confidenceScore >= 0.85 ? 'matched' : 'needs_confirmation',
    };
}
function matchByDocument(bank, candidates, exact) {
    if (bank.documentNumber === undefined)
        return null;
    for (const c of candidates) {
        if (c.documentNumber === undefined)
            continue;
        if (c.documentNumber.trim() !== bank.documentNumber.trim())
            continue;
        const diff = Math.abs(bank.amount - c.amount);
        if (relativeDiff(bank.amount, c.amount) > exact)
            continue;
        return {
            matchType: 'one_to_one',
            matchReason: 'document_number_match',
            matchedTransactionIds: [c.id],
            amountMatched: c.amount,
            amountDifference: diff,
            confidenceScore: 0.95,
        };
    }
    return null;
}
function matchByAmountAndDate(bank, candidates, exact) {
    for (const c of candidates) {
        if (relativeDiff(bank.amount, c.amount) > exact)
            continue;
        if (!sameDay(bank.transactionDate, c.transactionDate))
            continue;
        return {
            matchType: 'one_to_one',
            matchReason: 'same_amount_same_date',
            matchedTransactionIds: [c.id],
            amountMatched: c.amount,
            amountDifference: Math.abs(bank.amount - c.amount),
            confidenceScore: 0.95,
        };
    }
    return null;
}
function matchByAmountNearDate(bank, candidates, exact) {
    for (const c of candidates) {
        if (relativeDiff(bank.amount, c.amount) > exact)
            continue;
        const days = daysBetween(bank.transactionDate, c.transactionDate);
        if (days === 0 || days > 3)
            continue;
        return {
            matchType: 'one_to_one',
            matchReason: 'same_amount_near_date',
            matchedTransactionIds: [c.id],
            amountMatched: c.amount,
            amountDifference: Math.abs(bank.amount - c.amount),
            confidenceScore: 0.85,
        };
    }
    return null;
}
function matchByBatchTotal(bank, candidates, exact) {
    const batch = findBatchMatch(bank, candidates, { tolerance: exact });
    if (batch === null)
        return null;
    return {
        matchType: batch.matchType,
        matchReason: 'batch_total_match',
        matchedTransactionIds: batch.matchedTransactionIds,
        amountMatched: batch.amountMatched,
        amountDifference: batch.amountDifference,
        confidenceScore: 0.85,
    };
}
function matchByCounterparty(bank, candidates, partialTol) {
    if (bank.counterpartyName === undefined)
        return null;
    for (const c of candidates) {
        if (c.counterpartyName === undefined)
            continue;
        if (!counterpartySimilar(bank.counterpartyName, c.counterpartyName))
            continue;
        const diff = Math.abs(bank.amount - c.amount);
        const relDiff = relativeDiff(bank.amount, c.amount);
        if (relDiff > partialTol)
            continue;
        const isPartial = relDiff > 0.01;
        return {
            matchType: isPartial ? 'partial' : 'one_to_one',
            matchReason: 'counterparty_similarity',
            matchedTransactionIds: [c.id],
            amountMatched: c.amount,
            amountDifference: diff,
            confidenceScore: isPartial ? 0.65 : 0.78,
        };
    }
    return null;
}
/**
 * Encontra subset de candidatos cuja soma bate com `primary.amount`.
 *
 * Implementação V1 greedy/recursive (DFS com poda) limitada a
 * `maxCandidates` itens. Aceita pequena diferença parametrizável.
 *
 * **Limitação V1 (declarada no prompt):** split heterogêneo
 * (1 transação bancária = múltiplas naturezas distintas) é tratado como
 * `one_to_many` simples — natureza do match não é decomposta.
 *
 * Retorna `null` quando nenhum subset bate dentro da tolerância.
 */
export function findBatchMatch(primary, candidates, options = {}) {
    const tolerance = options.tolerance ?? 0.01;
    const max = options.maxCandidates ?? 12;
    const desiredType = options.matchType ?? 'one_to_many';
    // Reduz universo (proteção combinatorial) priorizando candidatos com
    // valor menor ou igual ao alvo, ordenados desc.
    const pool = candidates
        .filter((c) => c.amount > 0 && c.amount <= primary.amount * (1 + tolerance))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, max);
    const target = primary.amount;
    let best = null;
    const dfs = (i, picked, sum) => {
        if (best !== null && Math.abs(best.sum - target) <= target * tolerance) {
            // Já achou solução boa, mas seguimos pra ver se há melhor (sum mais perto).
            // Critério: parar quando achamos perfeito.
            if (Math.abs(best.sum - target) === 0)
                return;
        }
        if (sum > target * (1 + tolerance))
            return;
        const diff = Math.abs(sum - target);
        if (diff <= target * tolerance &&
            picked.length >= 2 &&
            (best === null || diff < Math.abs(best.sum - target))) {
            best = { ids: [...picked], sum };
        }
        for (let j = i; j < pool.length; j++) {
            const c = pool[j];
            if (c === undefined)
                continue;
            picked.push(c.id);
            dfs(j + 1, picked, sum + c.amount);
            picked.pop();
        }
    };
    dfs(0, [], 0);
    if (best === null)
        return null;
    const found = best;
    const diff = Math.abs(found.sum - target);
    return {
        id: nextMatchId(primary.companyId),
        companyId: primary.companyId,
        bankTransactionId: primary.id,
        matchedTransactionIds: found.ids,
        matchType: desiredType,
        amountMatched: found.sum,
        amountDifference: diff,
        confidenceScore: 0.85,
        matchReason: 'batch_total_match',
        status: 'matched',
    };
}
//# sourceMappingURL=reconciliation.js.map