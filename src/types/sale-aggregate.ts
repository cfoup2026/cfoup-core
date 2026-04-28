import type { MarginPercentSource } from './sale.js';

/** Escopo de um totalizador de vendas. */
export type SaleAggregateScope = 'customer' | 'global';

/**
 * Linha de totalização de um relatório FKN de Vendas, mantida em tipo
 * separado de `Sale` por princípio: fato (uma venda) vs metadado (um
 * agregado calculado pelo emissor do relatório).
 *
 * - scope='customer': linha "TOTAL - NOTAS:" que fecha o bloco de um cliente.
 * - scope='global':   linha "TOTAL GERAL:" no fim do relatório.
 */
export interface SaleAggregate {
  scope: SaleAggregateScope;
  /** Código do cliente quando `scope='customer'`; null quando 'global'. */
  customerCode: number | null;
  /** Nome do cliente quando `scope='customer'`; null quando 'global'. */
  customerName: string | null;
  /** Quantidade de notas no agregado. */
  invoiceCount: number;
  /** Soma de VALOR NOTA. */
  totalAmount: number;
  /** Soma de VALOR CUSTO. */
  totalCost: number;
  /** Margem percentual reportada pelo emissor, ou recalculada, ou null. */
  marginPercent: number | null;
  /** Origem de `marginPercent`. */
  marginPercentSource: MarginPercentSource;
}
