import type { BalanceSheetEntry } from '../types/balance-sheet.js';
import type { ParseResult } from '../types/parse-result.js';
import type { ExtractedLine } from '../utils/pdf.js';
/** Resultado do parser Kinlex Balanço. */
export interface ParseKinlexBalancoResult extends ParseResult<BalanceSheetEntry> {
    metadata: KinlexBalancoMetadata;
}
export interface KinlexBalancoMetadata {
    companyName: string;
    cnpj: string;
    /** Data do "Balanço encerrado em DD/MM/YYYY", UTC. */
    referenceDate: Date | null;
    /** Período "01/01/YYYY a 31/12/YYYY" do exercício, UTC. */
    period: {
        start: Date;
        end: Date;
    } | null;
    title: string;
}
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
export declare function parseKinlexBalanco(input: Uint8Array | ArrayBuffer | Buffer): Promise<ParseKinlexBalancoResult>;
/** Versão pura — recebe linhas já extraídas. Útil pra tests com fixture textual. */
export declare function parseKinlexBalancoFromLines(lines: ExtractedLine[]): ParseKinlexBalancoResult;
//# sourceMappingURL=kinlex-balanco.d.ts.map