/** Variantes de uma entrada do DRE — discriminator em union. */
export type DREEntryKind = 'section_header' | 'line_item' | 'subtotal';
/**
 * Origem do valor numérico extraído de um DRE Kinlex.
 *
 * Princípio: extracted nunca é sobrescrito por computed. Validação
 * cruzada (somar detalhes vs subtotais) é trabalho separado, não parser.
 *
 * Hoje só temos 'extracted' — o tipo está aberto pra 'computed' futuro
 * quando entrar uma camada de validação opcional.
 */
export type DREValueSource = 'extracted';
/** Cabeçalho de seção sem valor numérico (RECEITA BRUTA, CUSTOS, DESPESAS COM VENDAS, etc). */
export interface DRESectionHeader {
    id: string;
    kind: 'section_header';
    /** Texto raw da seção, ex: 'RECEITA BRUTA'. */
    label: string;
    /** Linha bruta extraída do PDF (já com whitespace colapsado). */
    rawLine: string;
}
/**
 * Linha de detalhe (fato): receita, custo ou despesa real.
 * `value1` e `value2` ficam crus — o significado das duas colunas Kinlex
 * não é nomeado pelo PDF. Um warning único é emitido na 1ª ocorrência
 * com 2 valores. Renomeação fica pra quando comparar 3+ DREs lado a lado.
 */
export interface DRELineItem {
    id: string;
    kind: 'line_item';
    /** Texto raw da linha (preserva '(-)' decorativo se houver). */
    label: string;
    /** Última seção vista (nome do último DRESectionHeader). null antes da 1ª. */
    section: string | null;
    /** True se o `value1` veio entre parênteses (despesa/dedução/saída). */
    isNegative: boolean;
    /** Valor primário, já com sinal aplicado se isNegative. */
    value1: number | null;
    /**
     * Valor secundário, raw. Empiricamente nas DREs Kinlex aparece como
     * subtotal acumulado do subgrupo, mas isso é INFERÊNCIA — preservado
     * sem rótulo até confirmar o significado lado-a-lado em múltiplos DREs.
     */
    value2: number | null;
    valueSource: DREValueSource;
    rawLine: string;
}
/**
 * Subtotal de seção ou global (RECEITA LÍQUIDA, LUCRO BRUTO, ...,
 * LUCRO LÍQUIDO DO EXERCÍCIO). Reconhecido por nome (lista fechada).
 */
export interface DRESubtotal {
    id: string;
    kind: 'subtotal';
    /** Texto raw do subtotal, ex: 'RECEITA LÍQUIDA'. */
    label: string;
    /** Seção pai quando aplicável; null pra subtotais globais. */
    section: string | null;
    /** True se o valor veio parentizado. */
    isNegative: boolean;
    /** Valor extraído direto do PDF. Nunca recalculado. */
    value: number | null;
    /** Sempre 'extracted' por ora. */
    valueSource: DREValueSource;
    rawLine: string;
}
/** União discriminada de qualquer entrada extraída do DRE. */
export type DREEntry = DRESectionHeader | DRELineItem | DRESubtotal;
//# sourceMappingURL=dre.d.ts.map