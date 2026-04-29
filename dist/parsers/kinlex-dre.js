import { extractTextLines } from '../utils/pdf.js';
import { parseDDMMYYYYtoUTC } from '../utils/date.js';
import { parseBRLNumber } from '../utils/number.js';
/** Subtotais Kinlex reconhecidos por nome (lista fechada, observada nos DREs Gregorutt). */
const KNOWN_SUBTOTAL_LABELS = new Set([
    'RECEITA LÍQUIDA',
    'LUCRO BRUTO',
    'DESPESAS OPERACIONAIS',
    'RESULTADO OPERACIONAL',
    'RESULTADO ANTES DO IR E CSL',
    'LUCRO LÍQUIDO DO EXERCÍCIO',
]);
const VALUE_TOKEN_RE = /\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?/g;
const COMPANY_RE = /^Empresa:\s*(.+?)\s*$/i;
const CNPJ_RE = /^C\.N\.P\.J\.:\s*([\d./\-]+)/i;
const TITLE_RE = /DEMONSTRAÇÃO\s+DO\s+RESULTADO\s+DO\s+EXERCÍCIO/i;
const TITLE_DATE_RE = /EM\s+(\d{2}\/\d{2}\/\d{4})/i;
const SIGNATURE_RULER_RE = /_{3,}/;
const SKIP_HEADER_RE = /^(Folha:|Número\s+livro:|C\.N\.P\.J\.:|Empresa:)/i;
const EMPTY_METADATA = {
    companyName: '',
    cnpj: '',
    referenceDate: null,
    title: '',
};
/**
 * Faz o parse de um DRE em formato PDF Kinlex (página única, layout
 * hierárquico: RECEITA BRUTA → DEDUÇÕES → ... → LUCRO LÍQUIDO).
 *
 * Garantias:
 * - Nunca lança em erro de linha; PDF corrompido vira ParseError global.
 * - Datas em UTC.
 * - Subtotais Kinlex (RECEITA LÍQUIDA, LUCRO BRUTO, etc) são preservados
 *   como vieram. Validação cruzada não é responsabilidade do parser.
 * - Linhas com 2 valores numéricos viram `value1`/`value2` brutos. O
 *   significado das duas colunas Kinlex não está rotulado no PDF; um
 *   warning único é emitido na 1ª ocorrência.
 * - Negativos parentizados `(540.223,20)` viram value negativo + `isNegative=true`.
 */
export async function parseKinlexDRE(input) {
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
    return parseKinlexDREFromLines(lines);
}
/**
 * Versão pura — recebe linhas já extraídas e devolve o ParseResult.
 * Útil pra testes com fixtures textuais sintéticas.
 */
export function parseKinlexDREFromLines(lines) {
    const ok = [];
    const errors = [];
    const warnings = [];
    const metadata = extractMetadata(lines);
    let currentSection = null;
    let signaturePassed = false;
    let twoColumnWarningEmitted = false;
    for (const line of lines) {
        const text = line.text;
        const lineNumber = line.lineIndex;
        if (signaturePassed)
            continue;
        if (SIGNATURE_RULER_RE.test(text)) {
            signaturePassed = true;
            continue;
        }
        if (SKIP_HEADER_RE.test(text))
            continue;
        if (TITLE_RE.test(text))
            continue;
        if (text.trim() === '')
            continue;
        const values = extractValues(text);
        if (values.length === 0) {
            const header = {
                id: `kinlex-dre:${lineNumber}`,
                kind: 'section_header',
                label: text,
                rawLine: text,
            };
            ok.push(header);
            currentSection = text;
            continue;
        }
        if (values.length > 2) {
            errors.push({
                line: lineNumber,
                raw: text,
                reason: `linha com ${values.length} valores numéricos — esperava 1 ou 2`,
            });
            continue;
        }
        const labelText = stripValueTokens(text).trim();
        const canonicalLabel = canonicalizeLabel(labelText);
        if (KNOWN_SUBTOTAL_LABELS.has(canonicalLabel)) {
            const v = values[0];
            if (v === undefined) {
                errors.push({
                    line: lineNumber,
                    raw: text,
                    reason: 'subtotal sem valor numérico após classificação',
                });
                continue;
            }
            if (values.length > 1) {
                warnings.push({
                    line: lineNumber,
                    message: `subtotal Kinlex "${canonicalLabel}" veio com 2 valores; usando o 1º como valor canônico`,
                });
            }
            const subtotal = {
                id: `kinlex-dre:${lineNumber}`,
                kind: 'subtotal',
                label: labelText,
                section: currentSection,
                isNegative: v.isNegative,
                value: v.value,
                valueSource: 'extracted',
                rawLine: text,
            };
            ok.push(subtotal);
            continue;
        }
        const v1 = values[0];
        if (v1 === undefined) {
            errors.push({
                line: lineNumber,
                raw: text,
                reason: 'linha com label e dígitos mas sem valor numérico válido',
            });
            continue;
        }
        const v2 = values[1] ?? null;
        if (v2 !== null && !twoColumnWarningEmitted) {
            warnings.push({
                line: lineNumber,
                message: 'DRE Kinlex tem 2 colunas numéricas sem rótulo no cabeçalho — preservando como value1/value2; significado a ser determinado pelo consumidor',
            });
            twoColumnWarningEmitted = true;
        }
        const lineItem = {
            id: `kinlex-dre:${lineNumber}`,
            kind: 'line_item',
            label: labelText,
            section: currentSection,
            isNegative: v1.isNegative,
            value1: v1.value,
            value2: v2 === null ? null : v2.value,
            valueSource: 'extracted',
            rawLine: text,
        };
        ok.push(lineItem);
    }
    if (ok.length === 0 && errors.length === 0) {
        errors.push({
            line: 0,
            raw: '',
            reason: 'nenhuma entrada DRE reconhecida — PDF vazio ou layout inesperado',
        });
    }
    return { ok, balances: [], errors, warnings, metadata };
}
function extractMetadata(lines) {
    let companyName = '';
    let cnpj = '';
    let title = '';
    let referenceDate = null;
    for (const line of lines) {
        const text = line.text;
        const company = COMPANY_RE.exec(text);
        if (company !== null && companyName === '') {
            companyName = (company[1] ?? '').trim();
        }
        const cnpjMatch = CNPJ_RE.exec(text);
        if (cnpjMatch !== null && cnpj === '') {
            cnpj = (cnpjMatch[1] ?? '').trim();
        }
        if (TITLE_RE.test(text) && title === '') {
            title = text;
            const dateMatch = TITLE_DATE_RE.exec(text);
            if (dateMatch !== null) {
                referenceDate = parseDDMMYYYYtoUTC(dateMatch[1] ?? '');
            }
        }
    }
    return { companyName, cnpj, referenceDate, title };
}
function extractValues(text) {
    const matches = text.match(VALUE_TOKEN_RE) ?? [];
    const out = [];
    for (const m of matches) {
        const isNegative = m.startsWith('(') && m.endsWith(')');
        const body = isNegative ? m.slice(1, -1) : m;
        const n = parseBRLNumber(body);
        if (n === null)
            continue;
        out.push({ value: isNegative ? -n : n, isNegative });
    }
    return out;
}
function stripValueTokens(text) {
    return text.replace(VALUE_TOKEN_RE, '').replace(/\s+/g, ' ').trim();
}
/**
 * Normaliza espaçamento múltiplo do PDF Kinlex (`RECEITA   LÍQUIDA` →
 * `RECEITA LÍQUIDA`) pra bater contra a lista fechada de subtotais.
 * `extractTextLines` já colapsa whitespace, mas labels podem chegar com
 * traços ou prefixos `(-)` que removemos antes de comparar.
 */
function canonicalizeLabel(s) {
    return s
        .replace(/^\(-\)\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}
//# sourceMappingURL=kinlex-dre.js.map