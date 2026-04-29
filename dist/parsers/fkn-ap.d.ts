import type { Payable } from '../types/payable.js';
import type { DailyTotal } from '../types/daily-total.js';
import type { ParseResult } from '../types/parse-result.js';
/** Resultado do parser FKN AP — estende ParseResult adicionando totais diários. */
export interface ParseFKNApResult extends ParseResult<Payable> {
    /** Linhas TOTAL DO DIA presentes no relatório, datadas pela última data vista. */
    dailyTotals: DailyTotal[];
}
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
export declare function parseFKNAp(rows: string[][]): ParseFKNApResult;
//# sourceMappingURL=fkn-ap.d.ts.map