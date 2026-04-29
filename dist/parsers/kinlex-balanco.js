import { extractTextLines } from '../utils/pdf.js';
import { parseDDMMYYYYtoUTC } from '../utils/date.js';
import { parseBRLNumber } from '../utils/number.js';
const COMPANY_RE = /Empresa:\s*(.+?)(?:\s+Folha:|$)/i;
const CNPJ_RE = /C\.N\.P\.J\.:\s*([\d./\-]+)/i;
const PERIOD_RE = /Período:\s*(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/i;
const REFERENCE_DATE_RE = /Balanço\s+encerrado\s+em:\s*(\d{2}\/\d{2}\/\d{4})/i;
const TITLE_RE = /BALANÇO\s+PATRIMONIAL/i;
const SIGNATURE_RULER_RE = /_{3,}/;
const COLUMN_HEADER_RE = /^Descrição\s+Saldo\s+Atual$/i;
/** Linha do body: termina com `<valor>D` ou `<valor>C`. */
const BODY_LINE_RE = /^(.*?)\s+([\d.]+,\d{2})([DC])\s*$/;
const EMPTY_METADATA = {
    companyName: '',
    cnpj: '',
    referenceDate: null,
    period: null,
    title: '',
};
/**
 * Faz o parse de um Balanço Patrimonial em PDF Kinlex (página única,
 * estrutura hierárquica aninhada ATIVO/PASSIVO com até 5 níveis).
 *
 * Garantias FKN/Kinlex padrão: nunca lança em erro de linha (PDF
 * corrompido vira ParseError global), datas UTC, ParseResult com
 * errors/warnings estruturados, valores extraídos preservados como
 * vieram (nunca recalculados).
 *
 * Política estrita sobre xStart: se qualquer linha do body não tiver
 * `xStart` populado por `extractTextLines`, o parser emite ParseError
 * fatal. Não degradamos pra level=0 — uma árvore plana destruiria
 * `sectionPath` e induziria consumidores ao erro.
 *
 * Não validamos ATIVO == PASSIVO — princípio: extracted nunca é
 * sobrescrito por computed. Validação cruzada é layer separada.
 */
export async function parseKinlexBalanco(input) {
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
            metadata: EMPTY_METADATA,
        };
    }
    return parseKinlexBalancoFromLines(lines);
}
/** Versão pura — recebe linhas já extraídas. Útil pra tests com fixture textual. */
export function parseKinlexBalancoFromLines(lines) {
    const errors = [];
    const warnings = [];
    const metadata = extractMetadata(lines);
    const bodyLines = [];
    let signaturePassed = false;
    for (const line of lines) {
        if (signaturePassed)
            continue;
        if (SIGNATURE_RULER_RE.test(line.text)) {
            signaturePassed = true;
            continue;
        }
        if (isHeaderLine(line.text))
            continue;
        const m = BODY_LINE_RE.exec(line.text.trim());
        if (m === null)
            continue;
        bodyLines.push({ line, match: m });
    }
    if (bodyLines.length === 0) {
        return {
            ok: [],
            balances: [],
            errors: [
                {
                    line: 0,
                    raw: '',
                    reason: 'Balanço sem linhas reconhecidas (header presente, mas body vazio)',
                },
            ],
            warnings,
            metadata,
        };
    }
    for (const { line } of bodyLines) {
        if (line.xStart === undefined) {
            return {
                ok: [],
                balances: [],
                errors: [
                    {
                        line: line.lineIndex,
                        raw: line.text,
                        reason: 'Balanço requer xStart pra detectar hierarquia. Atualize extractTextLines pra popular xStart antes de parsear Balanço.',
                    },
                ],
                warnings,
                metadata,
            };
        }
    }
    const xToLevel = buildXToLevelMap(bodyLines.map((b) => b.line.xStart));
    const sectionStack = [];
    const preEntries = [];
    for (const { line, match } of bodyLines) {
        const labelRaw = (match[1] ?? '').trim();
        const valueStr = match[2] ?? '';
        const dc = match[3] ?? '';
        const amount = parseBRLNumber(valueStr);
        if (amount === null) {
            errors.push({
                line: line.lineIndex,
                raw: line.text,
                reason: `valor não-numérico no Balanço: ${JSON.stringify(valueStr)}`,
            });
            continue;
        }
        if (dc !== 'D' && dc !== 'C') {
            errors.push({
                line: line.lineIndex,
                raw: line.text,
                reason: `sufixo D/C inválido: ${JSON.stringify(dc)}`,
            });
            continue;
        }
        const level = xToLevel.get(roundX(line.xStart));
        if (level === undefined) {
            errors.push({
                line: line.lineIndex,
                raw: line.text,
                reason: 'xStart não mapeável a nível hierárquico',
            });
            continue;
        }
        while (sectionStack.length > level)
            sectionStack.pop();
        const sectionPath = [...sectionStack];
        sectionStack[level] = labelRaw;
        preEntries.push({
            line,
            label: labelRaw,
            amount,
            balanceType: dc,
            level,
            sectionPath,
        });
    }
    const ok = [];
    for (let i = 0; i < preEntries.length; i++) {
        const cur = preEntries[i];
        if (cur === undefined)
            continue;
        const next = preEntries[i + 1];
        const hasChild = next !== undefined && next.level > cur.level;
        const id = `kinlex-balanco:${cur.line.lineIndex}`;
        if (hasChild) {
            const sub = {
                id,
                kind: 'subtotal',
                label: cur.label,
                level: cur.level,
                sectionPath: cur.sectionPath,
                amount: cur.amount,
                balanceType: cur.balanceType,
                valueSource: 'extracted',
                rawLine: cur.line.text,
            };
            ok.push(sub);
        }
        else {
            const item = {
                id,
                kind: 'line_item',
                label: cur.label,
                level: cur.level,
                sectionPath: cur.sectionPath,
                amount: cur.amount,
                balanceType: cur.balanceType,
                valueSource: 'extracted',
                rawLine: cur.line.text,
            };
            ok.push(item);
        }
    }
    return { ok, balances: [], errors, warnings, metadata };
}
function isHeaderLine(text) {
    if (text.startsWith('Empresa:'))
        return true;
    if (text.startsWith('C.N.P.J.:'))
        return true;
    if (/^Período:/i.test(text))
        return true;
    if (/^Balanço\s+encerrado\s+em:/i.test(text))
        return true;
    if (TITLE_RE.test(text))
        return true;
    if (COLUMN_HEADER_RE.test(text))
        return true;
    if (text.startsWith('Folha:'))
        return true;
    if (text.startsWith('Emissão:'))
        return true;
    if (text.startsWith('Hora:'))
        return true;
    return false;
}
function extractMetadata(lines) {
    let companyName = '';
    let cnpj = '';
    let title = '';
    let referenceDate = null;
    let period = null;
    for (const line of lines) {
        const text = line.text;
        if (companyName === '') {
            const m = COMPANY_RE.exec(text);
            if (m !== null)
                companyName = (m[1] ?? '').trim();
        }
        if (cnpj === '') {
            const m = CNPJ_RE.exec(text);
            if (m !== null)
                cnpj = (m[1] ?? '').trim();
        }
        if (period === null) {
            const m = PERIOD_RE.exec(text);
            if (m !== null) {
                const start = parseDDMMYYYYtoUTC(m[1] ?? '');
                const end = parseDDMMYYYYtoUTC(m[2] ?? '');
                if (start !== null && end !== null)
                    period = { start, end };
            }
        }
        if (referenceDate === null) {
            const m = REFERENCE_DATE_RE.exec(text);
            if (m !== null)
                referenceDate = parseDDMMYYYYtoUTC(m[1] ?? '');
        }
        if (title === '' && TITLE_RE.test(text))
            title = text.trim();
    }
    return { companyName, cnpj, referenceDate, period, title };
}
/**
 * Arredonda X em pontos inteiros — tolerância de 0,5pt em cada direção.
 * Gap real entre níveis Kinlex é ~7,2pt, então essa tolerância funde
 * variações intra-nível sem colapsar níveis adjacentes.
 */
function roundX(x) {
    return Math.round(x);
}
/**
 * Mapeia xStarts únicos do body em níveis 0..N-1. Independe de constantes
 * hardcoded — robusto a pequenas variações de indent entre versões do
 * gerador Kinlex. Mesmo X (com tolerância de 1 casa decimal) → mesmo level.
 */
function buildXToLevelMap(xs) {
    const unique = new Set();
    for (const x of xs)
        unique.add(roundX(x));
    const sorted = [...unique].sort((a, b) => a - b);
    const map = new Map();
    sorted.forEach((x, level) => map.set(x, level));
    return map;
}
//# sourceMappingURL=kinlex-balanco.js.map