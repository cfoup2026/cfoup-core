import type { Transaction } from '../types/transaction.js';
import type { ParseResult } from '../types/parse-result.js';
/**
 * Faz o parse do extrato em formato TXT da Caixa Econômica Federal (CEF).
 *
 * Formato esperado (header + linhas):
 *   "Conta";"Data_Mov";"Nr_Doc";"Historico";"Valor";"Deb_Cred"
 *   "0423012920005778782426";"20250401";"310325";"COB COMPE";"5964.52";"C"
 *
 * Garantias:
 * - Nunca lança exceção: erros viram entradas em `errors` e o parser segue.
 * - Linhas em branco são ignoradas silenciosamente.
 * - Linhas com Nr_Doc=000000 e histórico contendo "SALDO DIA" viram
 *   `BalanceSnapshot`, não `Transaction`. Um warning é emitido pra rastrear.
 * - Datas são sempre UTC (Date.UTC).
 */
export declare function parseCEFTxt(content: string): ParseResult<Transaction>;
//# sourceMappingURL=cef-txt.d.ts.map