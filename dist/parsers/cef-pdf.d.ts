import type { Transaction } from '../types/transaction.js';
import type { ParseResult } from '../types/parse-result.js';
import type { ExtractedLine } from '../utils/pdf.js';
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
export declare function parseCEFPdf(input: Uint8Array | ArrayBuffer | Buffer): Promise<ParseResult<Transaction>>;
/**
 * Versão pura e síncrona — recebe linhas já extraídas e devolve o ParseResult.
 * Útil pra testes com fixtures textuais sem precisar gerar PDFs.
 */
export declare function parseCEFPdfFromLines(lines: ExtractedLine[]): ParseResult<Transaction>;
//# sourceMappingURL=cef-pdf.d.ts.map