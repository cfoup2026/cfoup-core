import type { AccountingTranslation } from './types.js';
/**
 * Tabela inicial de traduções contábeis para linguagem de dono.
 *
 * IMPORTANTE: dado contábil NUNCA é reclassificado. Esta tabela só faz
 * tradução — a conta original, grupo, subgrupo e classificação seguem
 * preservados em `SourceTransaction.original*`.
 *
 * O match é feito em `translateAccountingTransaction()` por substring
 * case-insensitive, com normalização de acentos. Padrões mais específicos
 * vêm primeiro nesta lista.
 *
 * Contas marcadas com `bucket: null` + `requiresBreakdown: true` viram
 * pendência de "conta contábil genérica" — o dono precisa abrir.
 */
export declare const ACCOUNTING_TRANSLATIONS: readonly AccountingTranslation[];
//# sourceMappingURL=accounting-translations.d.ts.map