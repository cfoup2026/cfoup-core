import { ACCOUNTING_TRANSLATIONS } from './accounting-translations.js';
import { getBucketForCategory, getCategoryByCode } from './categories.js';
import { applyClassificationRules } from './rules.js';
import type {
  AccountCodeHintMap,
  ClassificationMethod,
  ClassificationResult,
  ClassificationRule,
  ClassificationStatus,
  ConfidenceLevel,
  Direction,
  ExceptionReason,
  SourceTransaction,
} from './types.js';

/* ─────────── API pública ─────────── */

/** Opções de execução do motor. */
export interface ClassificationOptions {
  /** Regras da empresa, aplicadas com prioridade máxima. */
  rules?: readonly ClassificationRule[];
  /** Quando o banco já casou em reconciliação, herda a categoria do CR/CP
   *  associado — evita classificar duas vezes a mesma realidade econômica. */
  reconciliationCategoryCode?: string;
  /** Mapa externo de hints por `originalAccountCode`. Sinal de
   *  classificação adicional, opcional. Sem este campo o motor mantém
   *  o comportamento de fallback inalterado. */
  accountCodeHints?: AccountCodeHintMap;
}

/** Lowercase + remoção de acentos. Para comparações case-insensitive. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Versão normalizada de uma `SourceTransaction`. Não altera o original
 * — devolve uma cópia com os campos textuais relevantes em forma comparável.
 *
 * Útil para inspeção/teste; o motor usa `normalizeText()` internamente
 * conforme precisa, sem persistir a versão normalizada.
 */
export function normalizeTransaction(transaction: SourceTransaction): {
  description: string | null;
  counterpartyName: string | null;
  originalAccountName: string | null;
  originalCategory: string | null;
  originalGroupName: string | null;
  originalSubgroupName: string | null;
} {
  const norm = (s?: string): string | null =>
    s === undefined ? null : normalizeText(s);
  return {
    description: norm(transaction.description),
    counterpartyName: norm(transaction.counterpartyName),
    originalAccountName: norm(transaction.originalAccountName),
    originalCategory: norm(transaction.originalCategory),
    originalGroupName: norm(transaction.originalGroupName),
    originalSubgroupName: norm(transaction.originalSubgroupName),
  };
}

/** Faixa qualitativa derivada do `confidenceScore`. */
export function calculateConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

/* ─────────── Detectores ─────────── */

/** Termos genéricos cuja presença na conta original pede confirmação do dono. */
const GENERIC_TERMS: readonly string[] = [
  'outros',
  'outras',
  'diversas',
  'diversos',
  'varias contas',
  'despesas diversas',
  'lancamentos gerais',
  'ajustes',
  'outras despesas',
  'outras receitas',
];

/**
 * Verdadeiro quando a classificação original é genérica (não acionável).
 * Comparação case-insensitive e sem acentos.
 */
export function detectGenericCategory(
  transaction: SourceTransaction,
): boolean {
  const fields = [
    transaction.originalCategory,
    transaction.originalAccountName,
    transaction.originalSubgroupName,
    transaction.originalGroupName,
    transaction.originalClassificationRaw,
    transaction.description,
  ];
  for (const raw of fields) {
    if (raw === undefined) continue;
    const norm = normalizeText(raw);
    for (const term of GENERIC_TERMS) {
      if (norm.includes(term)) return true;
    }
  }
  return false;
}

/** Frases que sinalizam transferência entre contas próprias. */
const TRANSFER_PHRASES: readonly string[] = [
  'transferencia entre contas',
  'transferencia propria',
  'transferencia mesma titularidade',
  'transf entre contas',
  'transf entre contas proprias',
  'entre contas proprias',
  'mesma titularidade',
  'ted entre contas proprias',
];

/** Verdadeiro quando a transação é movimentação entre contas próprias. */
export function detectTransfer(transaction: SourceTransaction): boolean {
  const fields = [
    transaction.description,
    transaction.originalCategory,
    transaction.originalAccountName,
    transaction.counterpartyName,
  ];
  for (const raw of fields) {
    if (raw === undefined) continue;
    const norm = normalizeText(raw);
    for (const phrase of TRANSFER_PHRASES) {
      if (norm.includes(phrase)) return true;
    }
  }
  return false;
}

/** Sinais de pagamento de cartão sem detalhe da despesa subjacente. */
const CARD_NO_DETAIL_PATTERNS: readonly string[] = [
  'pagamento de fatura',
  'pgto fatura',
  'pagamento fatura cartao',
  'fatura do cartao',
  'fatura cartao',
  'american express',
  'amex pagamento',
  'pgto cartao',
];

/**
 * Verdadeiro para saídas de cartão sem detalhe — counterparty é
 * emissor/processadora ou descrição é "pagamento de fatura" sem categoria.
 */
export function detectCardPaymentWithoutDetail(
  transaction: SourceTransaction,
): boolean {
  if (transaction.direction !== 'outflow') return false;
  const fields = [
    transaction.counterpartyName,
    transaction.description,
    transaction.originalCategory,
  ];
  for (const raw of fields) {
    if (raw === undefined) continue;
    const norm = normalizeText(raw);
    for (const pat of CARD_NO_DETAIL_PATTERNS) {
      if (norm.includes(pat)) return true;
    }
  }
  return false;
}

/* ─────────── Tradução contábil ─────────── */

/**
 * Traduz uma transação contábil para linguagem de dono.
 *
 * NUNCA atribui `standardCategoryCode` — dado contábil não vira categoria
 * standard. Sempre `status: 'translated'`, `originalLabelPreserved: true`,
 * `classificationMethod: 'accounting_translation'`.
 *
 * Conta genérica e relevante (`requiresBreakdown`) marca
 * `requiresOwnerConfirmation: true` e `exceptionReason: 'accounting_generic_account'`.
 */
export function translateAccountingTransaction(
  transaction: SourceTransaction,
): ClassificationResult {
  const candidates: string[] = [];
  if (transaction.originalAccountName !== undefined)
    candidates.push(normalizeText(transaction.originalAccountName));
  if (transaction.originalSubgroupName !== undefined)
    candidates.push(normalizeText(transaction.originalSubgroupName));
  if (transaction.originalGroupName !== undefined)
    candidates.push(normalizeText(transaction.originalGroupName));

  for (const t of ACCOUNTING_TRANSLATIONS) {
    if (!t.active) continue;
    const pattern = normalizeText(t.originalAccountNamePattern);
    if (!candidates.some((c) => c.includes(pattern))) continue;

    const isGeneric = t.requiresBreakdown && t.bucket === null;
    const score = isGeneric ? 0.55 : 0.92;

    return {
      sourceTransactionId: transaction.id,
      companyId: transaction.companyId,
      bucket: t.bucket,
      ownerFriendlyLabel: t.ownerFriendlyLabel,
      confidenceScore: score,
      confidenceLevel: calculateConfidenceLevel(score),
      classificationMethod: 'accounting_translation',
      originalLabelPreserved: true,
      requiresOwnerConfirmation: isGeneric,
      exceptionReason: isGeneric ? 'accounting_generic_account' : 'none',
      status: 'translated',
    };
  }

  // Sem tradução — preserva o label original como fallback.
  const fallbackLabel =
    transaction.originalAccountName ??
    transaction.originalGroupName ??
    'Conta contábil sem tradução';

  return {
    sourceTransactionId: transaction.id,
    companyId: transaction.companyId,
    bucket: null,
    ownerFriendlyLabel: fallbackLabel,
    confidenceScore: 0.3,
    confidenceLevel: 'low',
    classificationMethod: 'accounting_translation',
    originalLabelPreserved: true,
    requiresOwnerConfirmation: true,
    exceptionReason: 'accounting_generic_account',
    status: 'translated',
  };
}

/* ─────────── Heurísticas por keyword ─────────── */

interface KeywordRule {
  /** Termos a buscar (já normalizados — sem acentos, lowercase). */
  keywords: readonly string[];
  /** Categoria a atribuir. */
  code: string;
  /** Direção exigida. Omitir = qualquer. */
  direction?: Direction;
  /** Score base. */
  score: number;
  /** Método declarado para auditoria. */
  method: ClassificationMethod;
}

/**
 * Heurísticas por keyword, ordenadas das mais específicas para as mais
 * genéricas. A primeira que casa ganha. Mantenha pares (keyword, code)
 * sem ambiguidade dentro da própria lista — termos curtos demais
 * ('comissao', 'juros') ficam de fora; só frases acionáveis entram.
 */
const KEYWORD_RULES: readonly KeywordRule[] = [
  /* Folha e gente */
  {
    keywords: [
      'salario',
      'folha pagamento',
      'folha de pagamento',
      '13 salario',
      '13o salario',
      'ferias remuneradas',
    ],
    code: 'OUT_PAYROLL',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'vale refeicao',
      'vale alimentacao',
      'plano de saude',
      'plano odontologico',
      'gympass',
      'beneficios da equipe',
    ],
    code: 'OUT_BENEFITS',
    direction: 'outflow',
    score: 0.9,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'comissao de venda',
      'comissao sobre venda',
      'comissao vendas',
      'comissao vendedor',
    ],
    code: 'OUT_COMMISSION',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'prestador pj',
      'autonomo',
      'freelancer',
      'pessoa juridica prestador',
      'rpa autonomo',
    ],
    code: 'OUT_CONTRACTORS',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },

  /* Impostos */
  {
    keywords: [
      'das simples nacional',
      'das mei',
      'simples nacional das',
      'pis cofins',
      'pis/cofins',
      'icms sobre vendas',
      'iss servico prestado',
      'guia das',
    ],
    code: 'OUT_TAXES_SALES',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'iptu',
      'ipva',
      'taxa de licenca',
      'alvara de funcionamento',
      'taxa administrativa',
    ],
    code: 'OUT_TAXES_OTHER',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },

  /* Dívida */
  {
    keywords: [
      'amortizacao principal',
      'pagamento principal',
      'principal emprestimo',
      'amortizacao financiamento',
    ],
    code: 'OUT_DEBT_PRINCIPAL',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'juros de emprestimo',
      'juros sobre emprestimo',
      'juros cheque especial',
      'juros financiamento',
    ],
    code: 'OUT_INTEREST',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'emprestimo recebido',
      'liberacao emprestimo',
      'capital de giro recebido',
      'liberacao financiamento',
    ],
    code: 'IN_LOAN',
    direction: 'inflow',
    score: 0.9,
    method: 'keyword_rule',
  },

  /* Estoque (consumo/writeoff antes de purchase pra desambiguar 'baixa') */
  {
    keywords: [
      'baixa estoque consumido',
      'cmv',
      'consumo de estoque',
      'baixa cmv',
      'estoque consumido em venda',
    ],
    code: 'OUT_INVENTORY_CONSUMED',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'perda estoque',
      'baixa estoque por avaria',
      'obsolescencia',
      'quebra estoque',
      'estoque obsoleto',
      'baixa por perda',
    ],
    code: 'OUT_INVENTORY_WRITEOFF',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'compra mercadoria',
      'compra de insumo',
      'compra materia prima',
      'aquisicao mercadoria',
      'compra insumos producao',
    ],
    code: 'OUT_INVENTORY_PURCHASE',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },

  /* CAPEX e venda de ativo */
  {
    keywords: [
      'imobilizado',
      'aquisicao maquina',
      'compra equipamento',
      'imovel para operacao',
      'instalacao operacional',
    ],
    code: 'OUT_CAPEX',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'venda de imobilizado',
      'venda de ativo',
      'alienacao imobilizado',
      'baixa imobilizado venda',
    ],
    code: 'IN_ASSET_SALE',
    direction: 'inflow',
    score: 0.92,
    method: 'keyword_rule',
  },

  /* Sócios */
  {
    keywords: [
      'retirada socio',
      'pro labore',
      'pro-labore',
      'distribuicao de lucro',
      'distribuicao lucro',
    ],
    code: 'OUT_OWNER_DRAW',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'aporte socio',
      'aporte de capital',
      'capital social aporte',
      'integralizacao capital',
    ],
    code: 'IN_OWNER_CAPITAL',
    direction: 'inflow',
    score: 0.92,
    method: 'keyword_rule',
  },

  /* Reembolsos e devoluções */
  {
    keywords: [
      'reembolso recebido',
      'reembolso a favor',
      'estorno recebido',
      'estorno favor',
      'chargeback recebido',
    ],
    code: 'IN_REFUND',
    direction: 'inflow',
    score: 0.85,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'devolucao para cliente',
      'estorno cliente',
      'reembolso cliente',
      'chargeback cliente',
    ],
    code: 'OUT_REFUND_CUSTOMER',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },

  /* Receitas adquirente / marketplace */
  {
    keywords: [
      'mercado livre',
      'mercadolivre',
      'amazon repasse',
      'shopee repasse',
      'magazine luiza repasse',
      'magalu repasse',
    ],
    code: 'IN_MARKETPLACE',
    direction: 'inflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'cielo repasse',
      'stone liquidacao',
      'getnet liquidacao',
      'rede liquidacao',
      'pagseguro liquidacao',
      'liquidacao adquirente',
    ],
    code: 'IN_CARD_SETTLEMENT',
    direction: 'inflow',
    score: 0.92,
    method: 'keyword_rule',
  },

  /* Financeiro */
  {
    keywords: [
      'rendimento aplicacao',
      'rendimento cdb',
      'juros aplicacao',
      'rendimento conta remunerada',
    ],
    code: 'IN_INVESTMENT_INCOME',
    direction: 'inflow',
    score: 0.9,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'tarifa bancaria',
      'manutencao conta',
      'tarifa ted',
      'tarifa doc',
      'tarifa mensalidade',
      'cesta de servicos',
    ],
    code: 'OUT_BANK_FEES',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },

  /* OPEX */
  {
    keywords: ['aluguel', 'condominio', 'locacao imovel'],
    code: 'OUT_RENT',
    direction: 'outflow',
    score: 0.92,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'energia eletrica',
      'agua e esgoto',
      'internet operacional',
      'telefonia',
      'conta de luz',
      'conta de agua',
      'conta de internet',
    ],
    code: 'OUT_UTILITIES',
    direction: 'outflow',
    score: 0.9,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'software',
      'saas',
      'licenca de software',
      'assinatura mensal software',
    ],
    code: 'OUT_SOFTWARE',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'marketing',
      'publicidade',
      'anuncio digital',
      'google ads',
      'facebook ads',
      'meta ads',
      'agencia de marketing',
    ],
    code: 'OUT_MARKETING',
    direction: 'outflow',
    score: 0.9,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'frete',
      'transportadora',
      'correios',
      'last mile',
      'jadlog',
      'logistica de entrega',
    ],
    code: 'OUT_LOGISTICS',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'viagem corporativa',
      'passagem aerea',
      'hospedagem',
      'reembolso viagem',
      'diaria de viagem',
    ],
    code: 'OUT_TRAVEL',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'material de escritorio',
      'cafe escritorio',
      'limpeza escritorio',
      'papelaria escritorio',
      'suprimentos escritorio',
    ],
    code: 'OUT_OFFICE',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'honorarios contabeis',
      'honorarios advocaticios',
      'contabilidade mensal',
      'advocacia',
      'consultoria juridica',
      'consultoria contabil',
    ],
    code: 'OUT_PROFESSIONAL_FEES',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'seguro frota',
      'seguro vida',
      'seguro predial',
      'apolice de seguro',
      'seguro empresarial',
    ],
    code: 'OUT_INSURANCE',
    direction: 'outflow',
    score: 0.88,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'manutencao preventiva',
      'reparo equipamento',
      'conserto',
      'manutencao predial',
    ],
    code: 'OUT_REPAIR_MAINTENANCE',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },

  /* Custo direto / serviço */
  {
    keywords: [
      'servico prestado terceirizado',
      'subcontratacao servico',
      'mao de obra terceirizada',
      'servico direto producao',
    ],
    code: 'OUT_SERVICE_DIRECT',
    direction: 'outflow',
    score: 0.85,
    method: 'keyword_rule',
  },
  {
    keywords: [
      'fornecedor de mercadoria',
      'fornecedor produto',
      'compra direta fornecedor',
      'fornecedor direto',
    ],
    code: 'OUT_SUPPLIER_DIRECT',
    direction: 'outflow',
    score: 0.8,
    method: 'keyword_rule',
  },
];

/** Aplica heurísticas; retorna o primeiro match ou `null`. */
function applyKeywordHeuristics(
  transaction: SourceTransaction,
): { code: string; score: number; method: ClassificationMethod } | null {
  const haystack = buildHaystack(transaction);
  for (const rule of KEYWORD_RULES) {
    if (rule.direction !== undefined && rule.direction !== transaction.direction)
      continue;
    for (const kw of rule.keywords) {
      if (haystack.includes(kw))
        return { code: rule.code, score: rule.score, method: rule.method };
    }
  }
  return null;
}

/** Junta todos os campos textuais relevantes em uma string normalizada. */
function buildHaystack(transaction: SourceTransaction): string {
  const parts: string[] = [];
  const push = (s: string | undefined): void => {
    if (s !== undefined) parts.push(normalizeText(s));
  };
  push(transaction.description);
  push(transaction.counterpartyName);
  push(transaction.originalAccountName);
  push(transaction.originalCategory);
  push(transaction.originalGroupName);
  push(transaction.originalSubgroupName);
  push(transaction.originalClassificationRaw);
  return parts.join(' | ');
}

/* ─────────── Classificação por sistema-fonte ─────────── */

/**
 * AR → IN_CUSTOMER_RECEIPT por padrão; IN_CUSTOMER_ADVANCE quando
 * `originalCategory` ou `description` mencionam adiantamento.
 */
function classifyAR(transaction: SourceTransaction): ClassificationResult {
  const haystack = buildHaystack(transaction);
  if (
    haystack.includes('adiantamento') ||
    haystack.includes('antecipacao cliente')
  ) {
    return makeClassified(
      transaction,
      'IN_CUSTOMER_ADVANCE',
      'source_mapping',
      0.88,
      'receivables_advance',
    );
  }
  // CR liquidado tem alta confiança; CR ainda em aberto, média.
  const score = transaction.paidDate !== undefined ? 0.92 : 0.7;
  return makeClassified(
    transaction,
    'IN_CUSTOMER_RECEIPT',
    'source_mapping',
    score,
  );
}

/* ─────────── Construtores de resultado ─────────── */

interface MakeArgs {
  ownerFriendlyLabel?: string;
  notes?: string;
}

function makeClassified(
  transaction: SourceTransaction,
  code: string,
  method: ClassificationMethod,
  score: number,
  exceptionReason: ExceptionReason = 'none',
  extra: MakeArgs = {},
): ClassificationResult {
  const cat = getCategoryByCode(code);
  const level = calculateConfidenceLevel(score);
  const status: ClassificationStatus =
    level === 'high' ? 'classified' : 'needs_confirmation';
  const result: ClassificationResult = {
    sourceTransactionId: transaction.id,
    companyId: transaction.companyId,
    standardCategoryCode: code,
    bucket: cat?.bucket ?? null,
    confidenceScore: score,
    confidenceLevel: level,
    classificationMethod: method,
    originalLabelPreserved: true,
    requiresOwnerConfirmation: level !== 'high',
    exceptionReason,
    status,
  };
  const label = extra.ownerFriendlyLabel ?? cat?.ownerFriendlyLabel;
  if (label !== undefined) result.ownerFriendlyLabel = label;
  if (extra.notes !== undefined) result.notes = extra.notes;
  return result;
}

function makePending(
  transaction: SourceTransaction,
  code: string | null,
  score: number,
  exceptionReason: ExceptionReason,
  method: ClassificationMethod = 'fallback',
): ClassificationResult {
  const cat = code !== null ? getCategoryByCode(code) : undefined;
  const level = calculateConfidenceLevel(score);
  const result: ClassificationResult = {
    sourceTransactionId: transaction.id,
    companyId: transaction.companyId,
    bucket: cat?.bucket ?? null,
    confidenceScore: score,
    confidenceLevel: level,
    classificationMethod: method,
    originalLabelPreserved: true,
    requiresOwnerConfirmation: true,
    exceptionReason,
    status: 'pending',
  };
  if (code !== null) result.standardCategoryCode = code;
  if (cat?.ownerFriendlyLabel !== undefined)
    result.ownerFriendlyLabel = cat.ownerFriendlyLabel;
  return result;
}

/* ─────────── Account code hints ─────────── */

interface AccountCodeHintMatch {
  category: string;
  isExact: boolean;
}

/**
 * Resolve um `originalAccountCode` contra o mapa de hints. `exact` tem
 * prioridade sobre `prefix`. Em `prefix`, a primeira entrada da lista
 * que casa ganha (chamador controla a ordem).
 */
function resolveAccountCodeHint(
  code: string,
  hintMap: AccountCodeHintMap,
): AccountCodeHintMatch | null {
  if (hintMap.exact !== undefined) {
    const cat = hintMap.exact[code];
    if (cat !== undefined) return { category: cat, isExact: true };
  }
  if (hintMap.prefix !== undefined) {
    for (const p of hintMap.prefix) {
      if (code.startsWith(p.pattern)) {
        return { category: p.category, isExact: false };
      }
    }
  }
  return null;
}

/**
 * Score-table do dispatch de hint:
 *
 *  - Exact + sem contradição: 0.92 → high → classified
 *  - Exact + descrição contradiz fortemente: 0.70 → medium → needs_confirmation
 *  - Prefix + descrição apoia: 0.86 → high → classified
 *  - Prefix sozinho ou contradito: 0.65 → medium → needs_confirmation
 *
 * Categoria proposta SEMPRE vem do hint — descrição só modula score/status.
 * `exceptionReason: 'none'` em ambos os casos: hint dá categoria limpa,
 * não é "exceção" no sentido de pendência sem sugestão.
 */
function makeAccountCodeHintResult(
  transaction: SourceTransaction,
  code: string,
  isExact: boolean,
  heuristicAgrees: boolean,
  heuristicContradicts: boolean,
): ClassificationResult {
  let score: number;
  let status: ClassificationStatus;

  if (isExact) {
    if (heuristicContradicts) {
      score = 0.7;
      status = 'needs_confirmation';
    } else {
      score = 0.92;
      status = 'classified';
    }
  } else {
    if (heuristicAgrees) {
      score = 0.86;
      status = 'classified';
    } else {
      score = 0.65;
      status = 'needs_confirmation';
    }
  }

  const cat = getCategoryByCode(code);
  const result: ClassificationResult = {
    sourceTransactionId: transaction.id,
    companyId: transaction.companyId,
    standardCategoryCode: code,
    bucket: cat?.bucket ?? null,
    confidenceScore: score,
    confidenceLevel: calculateConfidenceLevel(score),
    classificationMethod: 'account_code_hint',
    originalLabelPreserved: true,
    requiresOwnerConfirmation: status !== 'classified',
    exceptionReason: 'none',
    status,
  };
  if (cat?.ownerFriendlyLabel !== undefined) {
    result.ownerFriendlyLabel = cat.ownerFriendlyLabel;
  }
  return result;
}

/* ─────────── Função principal ─────────── */

/**
 * Classifica uma transação. Pura, síncrona, nunca lança.
 *
 * Ordem de prioridade:
 *  1. Regras explícitas da empresa (sempre ganham).
 *  2. `accounting` → tradução, nunca categoria standard.
 *  3. Transferência entre contas próprias (cross-cutting).
 *  4. Reconciliação prévia (banco) — herda categoria.
 *  5. Cartão sem detalhe → pendência `card_payment_without_detail`.
 *  6. AR → IN_CUSTOMER_RECEIPT/ADVANCE.
 *  7. Sales → IN_INVOICED_REVENUE (inflow) ou OUT_REFUND_CUSTOMER (return).
 *  8. Account code hints (`accountCodeHints`) sobre `originalAccountCode`.
 *  9. Heurísticas por keyword (AP/ERP/manual/bank).
 * 10. Genérico relevante → pendência (com ou sem categoria sugerida).
 * 11. Banco sem match → pendência `unmatched_bank_transaction`.
 * 12. Fallback final → IN_OTHER/OUT_OTHER.
 *
 * Sempre retorna `bucket` derivado do código quando há código atribuído,
 * `null` em pendências sem categoria.
 */
export function classifyTransaction(
  transaction: SourceTransaction,
  options: ClassificationOptions = {},
): ClassificationResult {
  /* 1. Regras da empresa */
  if (options.rules !== undefined && options.rules.length > 0) {
    const ruleResult = applyClassificationRules(transaction, options.rules);
    if (ruleResult !== null) return ruleResult;
  }

  /* 2. Contábil */
  if (transaction.sourceSystem === 'accounting') {
    return translateAccountingTransaction(transaction);
  }

  /* 3. Transferência */
  if (detectTransfer(transaction)) {
    const code =
      transaction.direction === 'inflow' ? 'IN_TRANSFER' : 'OUT_TRANSFER';
    return makeClassified(transaction, code, 'source_mapping', 0.9);
  }

  /* 4. Reconciliação prévia */
  if (options.reconciliationCategoryCode !== undefined) {
    return makeClassified(
      transaction,
      options.reconciliationCategoryCode,
      'reconciliation_match',
      0.92,
    );
  }

  /* 5. Cartão sem detalhe */
  if (detectCardPaymentWithoutDetail(transaction)) {
    const result: ClassificationResult = {
      sourceTransactionId: transaction.id,
      companyId: transaction.companyId,
      standardCategoryCode: 'OUT_CARD_PAYMENT',
      bucket: null,
      ownerFriendlyLabel: 'Pagamento de fatura — precisa abrir',
      confidenceScore: 0.55,
      confidenceLevel: 'low',
      classificationMethod: 'keyword_rule',
      originalLabelPreserved: true,
      requiresOwnerConfirmation: true,
      exceptionReason: 'card_payment_without_detail',
      status: 'needs_confirmation',
    };
    return result;
  }

  /* 6. AR */
  if (transaction.sourceSystem === 'accounts_receivable') {
    return classifyAR(transaction);
  }

  /* 7. Sales — faturamento (NF emitida) ou devolução */
  if (transaction.sourceSystem === 'sales') {
    if (transaction.direction === 'outflow') {
      // Devolução de venda (movementType='return' no parser FKN Vendas).
      return makeClassified(
        transaction,
        'OUT_REFUND_CUSTOMER',
        'source_mapping',
        0.9,
      );
    }
    // Venda regular (NF emitida): receita reconhecida no DRE accrual.
    // Score alto e determinístico — vendas sempre dispatcham aqui.
    return makeClassified(
      transaction,
      'IN_INVOICED_REVENUE',
      'source_mapping',
      0.92,
    );
  }

  /* 8. Account code hints — sinal externo opcional sobre originalAccountCode */
  if (
    options.accountCodeHints !== undefined &&
    transaction.originalAccountCode !== undefined
  ) {
    const hint = resolveAccountCodeHint(
      transaction.originalAccountCode,
      options.accountCodeHints,
    );
    if (hint !== null) {
      // Consulta a heurística por keyword apenas pra detectar concordância
      // ou contradição com a descrição. Não persiste resultado da heurística.
      // Não altera o fallback: caminho sem hint segue inalterado pro step 9.
      const heuristic = applyKeywordHeuristics(transaction);
      const heuristicAgrees =
        heuristic !== null && heuristic.code === hint.category;
      const heuristicContradicts =
        heuristic !== null && heuristic.code !== hint.category;
      return makeAccountCodeHintResult(
        transaction,
        hint.category,
        hint.isExact,
        heuristicAgrees,
        heuristicContradicts,
      );
    }
  }

  /* 9. Heurísticas */
  const heuristic = applyKeywordHeuristics(transaction);
  if (heuristic !== null) {
    // Mesmo classificada, se a conta original é genérica, é pendência fraca.
    if (detectGenericCategory(transaction)) {
      return makePending(
        transaction,
        heuristic.code,
        Math.min(heuristic.score, 0.55),
        'generic_original_category',
        heuristic.method,
      );
    }
    return makeClassified(
      transaction,
      heuristic.code,
      heuristic.method,
      heuristic.score,
    );
  }

  /* 8. Genérico sem heurística */
  if (detectGenericCategory(transaction)) {
    const fallback =
      transaction.direction === 'inflow' ? 'IN_OTHER' : 'OUT_OTHER';
    return makePending(transaction, fallback, 0.4, 'generic_original_category');
  }

  /* 9. Banco sem match */
  if (transaction.sourceSystem === 'bank') {
    const fallback =
      transaction.direction === 'inflow' ? 'IN_OTHER' : 'OUT_OTHER';
    return makePending(
      transaction,
      fallback,
      0.35,
      'unmatched_bank_transaction',
    );
  }

  /* 10. Fallback final */
  const fallback =
    transaction.direction === 'inflow' ? 'IN_OTHER' : 'OUT_OTHER';
  return makePending(transaction, fallback, 0.4, 'low_confidence');
}

/* Re-export pra ergonomia (usuário pode importar tudo daqui ou de index.ts). */
export { getBucketForCategory };
