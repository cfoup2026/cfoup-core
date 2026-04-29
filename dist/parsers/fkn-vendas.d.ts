import type { Sale } from '../types/sale.js';
import type { SaleAggregate } from '../types/sale-aggregate.js';
import type { ParseResult } from '../types/parse-result.js';
/** Resultado do parser FKN Vendas — estende ParseResult com agregados. */
export interface ParseFKNVendasResult extends ParseResult<Sale> {
    /** Linhas TOTAL - NOTAS (por cliente) e TOTAL GERAL (global). */
    aggregates: SaleAggregate[];
}
/**
 * Faz o parse de um relatório FKN de Vendas por Cliente por Nota.
 * Layer 2 da arquitetura: recebe linhas tokenizadas pelo `extractCSV`.
 *
 * Diferenças estruturais em relação aos parsers AP/AR:
 * - **Não é flat**: vendas vêm agrupadas por cliente. Um header
 *   `CLIENTE: 000001 NOME...` precede o bloco de vendas; a venda em si
 *   não traz o cliente. O parser mantém estado `currentCustomer`.
 * - **Cada bloco fecha com**: linha "TOTAL - NOTAS:" + linha-régua "----"
 *   (ambas por cliente). No fim do relatório, uma linha "TOTAL GERAL:".
 * - **Datas em DD/MM/YYYY** (igual AP, diferente do AR).
 * - **VALOR NOTA pode ser negativo** (devoluções, raras): viram
 *   `movementType='return'` com `movementTypeSource='inferred_from_negative_amount'`
 *   + warning. `amount` e `cost` ficam não-negativos (Math.abs).
 *
 * Garantias FKN padrão: nunca lança, datas UTC, ParseResult com errors/warnings,
 * skip silencioso de cabeçalhos/rulers, ParseError pontual em linha inválida.
 */
export declare function parseFKNVendas(rows: string[][]): ParseFKNVendasResult;
//# sourceMappingURL=fkn-vendas.d.ts.map