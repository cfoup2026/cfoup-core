/**
 * Tipos do Motor de Classificação Financeira Standard.
 *
 * Princípios fundamentais:
 *  - A classificação original da empresa nunca é apagada.
 *  - Dado contábil é traduzido, nunca reclassificado.
 *  - Toda classificação carrega `confidenceScore`, `confidenceLevel`,
 *    `classificationMethod`, `status` e `exceptionReason`.
 *  - Bucket (camada visível ao dono) e StandardCategory (camada interna)
 *    são duas camadas distintas. Bucket vem do `getBucketForCategory()`.
 */
export {};
//# sourceMappingURL=types.js.map