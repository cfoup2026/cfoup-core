import type { Receivable } from '../types/receivable.js';
import type { DailyTotal } from '../types/daily-total.js';
import type { ParseResult } from '../types/parse-result.js';
/** Resultado do parser FKN AR — estende ParseResult adicionando totais diários. */
export interface ParseFKNArResult extends ParseResult<Receivable> {
    /** Linhas TOTAL DO DIA presentes no relatório, datadas pela última data vista. */
    dailyTotals: DailyTotal[];
}
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
export declare function parseFKNAr(rows: string[][]): ParseFKNArResult;
//# sourceMappingURL=fkn-ar.d.ts.map