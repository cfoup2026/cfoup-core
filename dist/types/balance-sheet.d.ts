/** Variantes de uma entrada do Balanço Patrimonial. */
export type BalanceSheetEntryKind = 'section_header' | 'line_item' | 'subtotal';
/**
 * Tipo contábil do saldo, conforme reportado pelo PDF.
 * D = devedor (típico de ATIVO), C = credor (típico de PASSIVO/PL).
 *
 * NUNCA é convertido em sinal aritmético pelo parser. É contabilidade,
 * não aritmética; quem consumir interpreta no contexto.
 */
export type BalanceType = 'D' | 'C';
/**
 * Origem do valor numérico extraído do Balanço Kinlex.
 * Princípio: extracted nunca é sobrescrito por computed.
 * Validação cruzada (ATIVO == PASSIVO, somas batem) é trabalho separado.
 */
export type BalanceSheetValueSource = 'extracted';
/**
 * Cabeçalho de seção sem valor numérico. Não observado nos Balanços
 * Gregorutt 2023/2024/2025 (todas as linhas têm valor); mantido pra
 * robustez caso outras versões/contadores tragam puramente estrutural.
 */
export interface BalanceSheetSectionHeader {
    id: string;
    kind: 'section_header';
    label: string;
    /** Profundidade hierárquica (0 = raiz ATIVO/PASSIVO, cresce para dentro). */
    level: number;
    /**
     * Hierarquia até o pai exclusive. Exemplo na linha
     * "BANCOS CONTA MOVIMENTO" (folha): ['ATIVO','ATIVO CIRCULANTE','DISPONÍVEL','BANCOS CONTA MOVIMENTO'].
     */
    sectionPath: string[];
    rawLine: string;
}
/** Nó-folha do Balanço: valor atômico, sem filhos abaixo. */
export interface BalanceSheetLineItem {
    id: string;
    kind: 'line_item';
    label: string;
    level: number;
    sectionPath: string[];
    /** Sempre não-negativo. Sinal contábil vive em `balanceType`. */
    amount: number;
    balanceType: BalanceType;
    valueSource: BalanceSheetValueSource;
    rawLine: string;
}
/** Nó interno do Balanço: tem filhos abaixo. Inclui ATIVO/PASSIVO raízes. */
export interface BalanceSheetSubtotal {
    id: string;
    kind: 'subtotal';
    label: string;
    level: number;
    sectionPath: string[];
    amount: number;
    balanceType: BalanceType;
    valueSource: BalanceSheetValueSource;
    rawLine: string;
}
/** União discriminada de qualquer entrada extraída do Balanço. */
export type BalanceSheetEntry = BalanceSheetSectionHeader | BalanceSheetLineItem | BalanceSheetSubtotal;
//# sourceMappingURL=balance-sheet.d.ts.map