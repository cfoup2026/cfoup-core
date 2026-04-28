import type { BalanceSnapshot } from './balance.js';

/**
 * Resultado padrão de qualquer parser. Nunca lança exceção:
 * problemas localizados viram entradas em `errors` ou `warnings` e o parser
 * continua processando o restante do arquivo.
 */
export interface ParseResult<T> {
  /** Itens parseados com sucesso. */
  ok: T[];
  /** Saldos informativos extraídos junto. Não são movimentações. */
  balances: BalanceSnapshot[];
  /** Falhas de parsing por linha. O item correspondente NÃO entra em `ok`. */
  errors: ParseError[];
  /** Avisos não-bloqueantes. O item correspondente em geral entra em `ok` ou `balances`. */
  warnings: ParseWarning[];
}

export interface ParseError {
  /** Número da linha no arquivo de entrada (1-indexado). */
  line: number;
  /** Conteúdo bruto da linha. */
  raw: string;
  /** Motivo legível em português. */
  reason: string;
}

export interface ParseWarning {
  /** Número da linha no arquivo de entrada (1-indexado). */
  line: number;
  /** Mensagem legível em português. */
  message: string;
}
