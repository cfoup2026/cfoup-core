import type { AccountCodeHintMap } from '../../src/classification/types.js';

/**
 * Hints do plano de contas FKN para o motor de classificação do cfoup-core.
 *
 * Escopo desta rodada (NÃO ampliar sozinho — ampliação só com base no
 * relatório do smoke):
 *
 *   - `exact` cobre 13 códigos com mapeamento óbvio para um
 *     `StandardCategoryCode`.
 *   - `prefix` cobre as 4 famílias FKN (01xxx, 16xxx, 17xxx, 18xxx) com
 *     `confidence: 'medium'`. O motor exige confirmação adicional via
 *     descrição para virar `classified`; sem confirmação, devolve
 *     `needs_confirmation`.
 *
 * Códigos deixados de fora intencionalmente:
 *
 *   - 18004 DESPESAS              (genérico — fallback de descrição decide)
 *   - 00166 DESPESAS AUTOMOTIVAS  (ambíguo entre combustível, manutenção,
 *                                  IPVA, seguro — fallback de descrição
 *                                  decide; será revisitado após o smoke)
 *
 * Fonte: cfoup-overview-v3/adapters/fkn/account-code-hints.ts (cópia exata).
 * Coexistência temporária — o original em overview-v3 fica intocado até
 * a fixture nova ser validada e baseline aceito.
 */
export const fknAccountCodeHints: AccountCodeHintMap = {
  exact: {
    // 01xxx — Insumos / Fornecedor direto
    '01021': 'OUT_SUPPLIER_DIRECT', // AVANZI QUIMICA
    '01131': 'OUT_SUPPLIER_DIRECT', // LW COMERCIO
    '01167': 'OUT_SUPPLIER_DIRECT', // CHEMIX
    '01201': 'OUT_SUPPLIER_DIRECT', // NOVAPLASTICS
    '01219': 'OUT_SUPPLIER_DIRECT', // LOUVETIQUE
    '01267': 'OUT_SUPPLIER_DIRECT', // 2RC EMBALAGENS
    '00278': 'OUT_SUPPLIER_DIRECT', // OCC QUIMICA
    '00305': 'OUT_SUPPLIER_DIRECT', // RINEN IND

    // 16xxx — Operacional / Folha
    '16008': 'OUT_REPAIR_MAINTENANCE', // MANUTENCAO
    '16025': 'OUT_PAYROLL', // DIARIA
    '16028': 'OUT_BENEFITS', // PAGAMENTO CONDUÇÕES (vale-transporte)

    // 17xxx — Comercial / Comissão
    '17004': 'OUT_COMMISSION', // COMISSAO VENDAS

    // 18xxx — Despesas gerais / Frete
    '18008': 'OUT_LOGISTICS', // FRETE LALAMOVE
  },
  prefix: [
    // Ordem importa: primeiro que casa ganha (cfoup-core).
    { pattern: '01', category: 'OUT_SUPPLIER_DIRECT', confidence: 'medium' },
    { pattern: '16', category: 'OUT_PAYROLL', confidence: 'medium' },
    { pattern: '17', category: 'OUT_COMMISSION', confidence: 'medium' },
    { pattern: '18', category: 'OUT_OFFICE', confidence: 'medium' },
  ],
};
