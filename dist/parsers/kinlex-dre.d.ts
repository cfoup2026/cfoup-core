import type { DREEntry } from '../types/dre.js';
import type { ParseResult } from '../types/parse-result.js';
import type { ExtractedLine } from '../utils/pdf.js';
/** Resultado do parser Kinlex DRE — estende ParseResult com metadata do PDF. */
export interface ParseKinlexDREResult extends ParseResult<DREEntry> {
    metadata: KinlexDREMetadata;
}
export interface KinlexDREMetadata {
    /** Nome da empresa, conforme cabeçalho do PDF. */
    companyName: string;
    /** CNPJ, conforme cabeçalho do PDF. */
    cnpj: string;
    /**
     * Data de referência do DRE, parseada do título
     * "DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM DD/MM/YYYY". UTC. Null
     * se o título não bater no padrão.
     */
    referenceDate: Date | null;
    /** Título completo da demonstração, raw. */
    title: string;
}
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
export declare function parseKinlexDRE(input: Uint8Array | ArrayBuffer | Buffer): Promise<ParseKinlexDREResult>;
/**
 * Versão pura — recebe linhas já extraídas e devolve o ParseResult.
 * Útil pra testes com fixtures textuais sintéticas.
 */
export declare function parseKinlexDREFromLines(lines: ExtractedLine[]): ParseKinlexDREResult;
//# sourceMappingURL=kinlex-dre.d.ts.map