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

/* ─────────── Enums (string union types) ─────────── */

/** Sistema-fonte de onde a transação foi extraída. */
export type SourceSystem =
  | 'bank'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'erp'
  | 'accounting'
  | 'invoice'
  | 'card'
  | 'sales'
  | 'manual';

/** Direção financeira: entrada, saída, ou neutra (transferências, ajustes). */
export type Direction = 'inflow' | 'outflow' | 'neutral';

/** Canal pelo qual o pagamento foi efetuado. Não é categoria final. */
export type PaymentChannel =
  | 'pix'
  | 'ted'
  | 'doc'
  | 'boleto'
  | 'check'
  | 'card'
  | 'cash'
  | 'transfer'
  | 'deposit'
  | 'wire'
  | 'unknown';

/**
 * 12 buckets visíveis ao dono. É o que aparece em telas e relatórios.
 * Códigos `OUT_*`/`IN_*` ficam internos ao motor.
 *
 * `contas_receber` e `contas_pagar` representam saldo de títulos em aberto,
 * não recebem categorias de transação (`isPosition: true`).
 */
export type Bucket =
  | 'receita'
  | 'deducoes'
  | 'custos_diretos'
  | 'folha'
  | 'despesas_operacionais'
  | 'caixa'
  | 'contas_receber'
  | 'contas_pagar'
  | 'despesas_financeiras'
  | 'retiradas_socios'
  | 'investimentos'
  | 'estoque';

/** Macro-classe contábil, agrupa categorias por natureza econômica. */
export type MacroClass =
  | 'revenue'
  | 'direct_cost'
  | 'people'
  | 'opex'
  | 'tax'
  | 'debt'
  | 'financial'
  | 'capex'
  | 'owner'
  | 'transfer'
  | 'refund'
  | 'inventory'
  | 'accounting_translation'
  | 'undefined';

/** Como a classificação foi obtida — define provenance. */
export type ClassificationMethod =
  | 'source_mapping'
  | 'accounting_translation'
  | 'counterparty_rule'
  | 'keyword_rule'
  | 'original_account_rule'
  | 'cost_center_rule'
  | 'reconciliation_match'
  | 'batch_match'
  | 'owner_confirmed'
  | 'account_code_hint'
  | 'manual'
  | 'fallback';

/** Faixa qualitativa derivada do `confidenceScore`. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Estado final do `ClassificationResult`.
 *  - 'classified': categoria atribuída com confiança alta.
 *  - 'translated': dado contábil traduzido em linguagem de dono.
 *  - 'needs_confirmation': sugestão pronta, depende do dono.
 *  - 'pending': sem sugestão útil; vira pendência agrupada.
 *  - 'ignored': descartado por escolha explícita (ex: regra do dono).
 */
export type ClassificationStatus =
  | 'classified'
  | 'translated'
  | 'needs_confirmation'
  | 'pending'
  | 'ignored';

/** Por que uma transação virou exceção e foi pra Pendências de Setup. */
export type ExceptionReason =
  | 'generic_original_category'
  | 'unknown_counterparty'
  | 'bank_only_weak_description'
  | 'possible_transfer'
  | 'card_payment_without_detail'
  | 'possible_duplicate'
  | 'unmatched_bank_transaction'
  | 'large_other_category'
  | 'low_confidence'
  | 'accounting_generic_account'
  | 'receivables_advance'
  | 'loan_needs_breakdown'
  | 'refund_or_chargeback'
  | 'none';

/** Cardinalidade de um match de reconciliação banco × CR/CP. */
export type ReconciliationMatchType =
  | 'one_to_one'
  | 'one_to_many'
  | 'many_to_one'
  | 'many_to_many'
  | 'partial';

/** Estado de um `ReconciliationMatch`. */
export type ReconciliationStatus =
  | 'matched'
  | 'needs_confirmation'
  | 'unmatched'
  | 'ignored';

/** Como um match foi encontrado — provenance da reconciliação. */
export type ReconciliationMatchReason =
  | 'same_amount_same_date'
  | 'same_amount_near_date'
  | 'counterparty_similarity'
  | 'batch_total_match'
  | 'document_number_match'
  | 'manual_owner_match';

/** Tipo de regra criada pela empresa para classificar transações futuras. */
export type RuleType =
  | 'counterparty'
  | 'keyword'
  | 'original_account'
  | 'cost_center'
  | 'payment_channel'
  | 'amount_pattern'
  | 'accounting_account';

/** Quem criou a regra — provenance do consentimento. */
export type CreatedBy = 'system' | 'owner' | 'admin';

/* ─────────── Interfaces de domínio ─────────── */

/**
 * Transação bruta vinda de qualquer sistema-fonte. É a entrada do motor.
 * Datas em UTC. `amount` sempre não-negativo — sinal vive em `direction`.
 *
 * Campos `original*` preservam a classificação da empresa exatamente como
 * veio. Nunca devem ser sobrescritos por nada que o motor produzir.
 */
export interface SourceTransaction {
  /** Identificador estável dentro do contexto de processamento. */
  id: string;
  /** Empresa (multi-tenant). */
  companyId: string;
  /** Sistema-fonte que originou o registro. */
  sourceSystem: SourceSystem;
  /** ID externo no sistema-fonte, quando disponível. */
  sourceTransactionId?: string;
  /** Data principal da transação (lançamento, emissão ou liquidação), UTC. */
  transactionDate: Date;
  /** Vencimento, em CR/CP. */
  dueDate?: Date;
  /** Liquidação efetiva, em CR/CP. */
  paidDate?: Date;
  /** Direção financeira. */
  direction: Direction;
  /** Valor sempre não-negativo. */
  amount: number;
  /** ISO 4217. Em V1 esperamos sempre 'BRL'. */
  currency: string;
  /** Nome da contraparte (cliente, fornecedor, terceiro), conforme veio. */
  counterpartyName?: string;
  /** Número de documento (NF, duplicata, boleto). */
  documentNumber?: string;
  /** Histórico/descrição livre. */
  description?: string;
  /** Canal usado, quando inferível. */
  paymentChannel?: PaymentChannel;
  /** Nome da conta original no sistema-fonte. */
  originalAccountName?: string;
  /** Código da conta original. */
  originalAccountCode?: string;
  /** Grupo (ex: 'Despesas operacionais'). */
  originalGroupName?: string;
  /** Subgrupo (ex: 'Aluguel e condomínio'). */
  originalSubgroupName?: string;
  /** Centro de custo. */
  originalCostCenter?: string;
  /** Categoria original explícita, quando o sistema-fonte traz. */
  originalCategory?: string;
  /** Texto bruto da classificação original, quando vier sem estrutura. */
  originalClassificationRaw?: string;
  /** Quando o registro foi criado no sistema-fonte. */
  createdAt?: Date;
}

/**
 * União literal dos códigos das 42 categorias standard do motor. Existe
 * para que mapas externos (ex: `AccountCodeHintMap`) usem o tipo exato
 * em vez de `string`, com checagem em tempo de compilação contra typos.
 *
 * Mantenha esta união sincronizada com `STANDARD_CATEGORIES` em
 * `categories.ts` — os testes existentes detectam divergência: o teste
 * que itera `STANDARD_CATEGORIES` falha se algum código aqui ficar fora.
 */
export type StandardCategoryCode =
  // Inflows (12)
  | 'IN_CUSTOMER_RECEIPT'
  | 'IN_CUSTOMER_ADVANCE'
  | 'IN_INVOICED_REVENUE'
  | 'IN_CARD_SETTLEMENT'
  | 'IN_MARKETPLACE'
  | 'IN_LOAN'
  | 'IN_OWNER_CAPITAL'
  | 'IN_REFUND'
  | 'IN_INVESTMENT_INCOME'
  | 'IN_ASSET_SALE'
  | 'IN_TRANSFER'
  | 'IN_OTHER'
  // Outflows (30)
  | 'OUT_SUPPLIER_DIRECT'
  | 'OUT_SERVICE_DIRECT'
  | 'OUT_PAYROLL'
  | 'OUT_CONTRACTORS'
  | 'OUT_BENEFITS'
  | 'OUT_COMMISSION'
  | 'OUT_TAXES_SALES'
  | 'OUT_TAXES_OTHER'
  | 'OUT_REFUND_CUSTOMER'
  | 'OUT_RENT'
  | 'OUT_UTILITIES'
  | 'OUT_SOFTWARE'
  | 'OUT_MARKETING'
  | 'OUT_LOGISTICS'
  | 'OUT_TRAVEL'
  | 'OUT_OFFICE'
  | 'OUT_PROFESSIONAL_FEES'
  | 'OUT_INSURANCE'
  | 'OUT_REPAIR_MAINTENANCE'
  | 'OUT_BANK_FEES'
  | 'OUT_INTEREST'
  | 'OUT_DEBT_PRINCIPAL'
  | 'OUT_CARD_PAYMENT'
  | 'OUT_CAPEX'
  | 'OUT_OWNER_DRAW'
  | 'OUT_INVENTORY_PURCHASE'
  | 'OUT_INVENTORY_CONSUMED'
  | 'OUT_INVENTORY_WRITEOFF'
  | 'OUT_TRANSFER'
  | 'OUT_OTHER';

/**
 * Definição de uma das 42 categorias internas do motor. Imutável (configuração).
 *
 * Os `affects*` controlam quais relatórios derivados sentem essa categoria.
 * Especialmente importantes em estoque: `OUT_INVENTORY_CONSUMED` afeta
 * margem e EBITDA, mas NÃO consome caixa — sem isso o fluxo 13 semanas
 * dobra a saída.
 */
export interface StandardCategory {
  /** Código estável (ex: 'OUT_RENT'). */
  code: StandardCategoryCode;
  /** Direção da categoria. */
  direction: Direction;
  /** Macro-classe econômica. */
  macroClass: MacroClass;
  /** Bucket visível ao dono. `null` quando a categoria não aparece em bucket
   *  (pendências, transferências entre contas próprias, cartão sem detalhe). */
  bucket: Bucket | null;
  /** Label técnico (PT-BR). */
  label: string;
  /** Label que o dono vê em telas (PT-BR, sem jargão). */
  ownerFriendlyLabel: string;
  /** Descrição estendida, opcional. */
  description?: string;
  /** Entra na linha de receita do DRE gerencial. */
  affectsRevenue: boolean;
  /** Entra no cálculo de margem bruta (custos diretos + CMV). */
  affectsGrossMargin: boolean;
  /** Entra no EBITDA. */
  affectsEbitda: boolean;
  /** Consome ou gera caixa de fato (entra no fluxo 13 semanas). */
  affectsCashRunway: boolean;
  /** Afeta posição de dívida. */
  affectsDebt: boolean;
  /** Conta como distribuição/aporte do sócio. */
  affectsOwnerDistribution: boolean;
  /** Candidata natural a virar lançamento recorrente. */
  isRecurringCandidate: boolean;
  /** Quando relevante, exige abertura (ex: 'Outras despesas'). */
  requiresBreakdown: boolean;
  /** Categoria habilitada na carteira de regras. */
  active: boolean;
}

/**
 * Tradução de uma conta contábil para linguagem de dono.
 *
 * `originalAccountNamePattern` é matched case-insensitive contra
 * `originalAccountName`/`originalGroupName`/`originalSubgroupName` da
 * `SourceTransaction`. Pode ser substring (não regex) — reduz risco de
 * confundir tradução com regex.
 */
export interface AccountingTranslation {
  /** Identificador estável da tradução. */
  id: string;
  /** Padrão de nome da conta original (substring case-insensitive). */
  originalAccountNamePattern: string;
  /** Padrão opcional pro grupo, refina o match. */
  originalGroupNamePattern?: string;
  /** Padrão opcional pro subgrupo. */
  originalSubgroupNamePattern?: string;
  /** Label que o dono vê em telas. */
  ownerFriendlyLabel: string;
  /** Explicação curta CFOup ("o que esse número representa pra mim?"). */
  cfoupExplanation: string;
  /** Macro-classe da conta traduzida. */
  macroClass: MacroClass;
  /** Bucket visível. `null` quando é conta genérica (pede confirmação). */
  bucket: Bucket | null;
  /** Conta genérica relevante exige que o dono detalhe. */
  requiresBreakdown: boolean;
  /** Tradução ativa na carteira. */
  active: boolean;
}

/**
 * Resultado da classificação de uma única `SourceTransaction`.
 * Estrutura imutável e auditável — sempre traz provenance completa.
 */
export interface ClassificationResult {
  /** Aponta pra `SourceTransaction.id`. */
  sourceTransactionId: string;
  /** Mesma empresa da transação. */
  companyId: string;
  /** Código de uma das 41 categorias. Ausente em traduções contábeis. */
  standardCategoryCode?: string;
  /** Bucket visível. `null` quando a categoria não tem bucket ou
   *  quando o resultado é pendência sem sugestão. */
  bucket: Bucket | null;
  /** Label que o dono vê (preenchido em translated/classified). */
  ownerFriendlyLabel?: string;
  /** Confiança, 0..1. */
  confidenceScore: number;
  /** Faixa derivada de `confidenceScore`. */
  confidenceLevel: ConfidenceLevel;
  /** Como chegamos à classificação. */
  classificationMethod: ClassificationMethod;
  /** True se a classificação preserva o rótulo original (caso contábil). */
  originalLabelPreserved: boolean;
  /** True se o dono precisa confirmar antes de virar regra. */
  requiresOwnerConfirmation: boolean;
  /** Por que virou exceção (ou 'none' se classificação limpa). */
  exceptionReason: ExceptionReason;
  /** Estado final. */
  status: ClassificationStatus;
  /** Notas livres em PT-BR (debug, contexto). */
  notes?: string;
}

/**
 * Regra criada pela empresa pra classificar transações futuras.
 * `confidenceBoost` soma ao score base quando a regra casa (cap em 1.0).
 */
export interface ClassificationRule {
  /** Identificador da regra. */
  id: string;
  /** Empresa dona da regra. */
  companyId: string;
  /** Tipo da regra — define qual campo será comparado contra `pattern`. */
  ruleType: RuleType;
  /** Padrão a casar (substring case-insensitive, exceto amount_pattern). */
  pattern: string;
  /** Categoria que a regra atribui. */
  standardCategoryCode: string;
  /** Aplica também a transações futuras (V2 pode considerar histórico). */
  appliesToFutureTransactions: boolean;
  /** Quem criou. */
  createdBy: CreatedBy;
  /** Boost de confiança, 0..1. */
  confidenceBoost: number;
  /** Regra ativa. */
  active: boolean;
  /** Quando foi criada. */
  createdAt?: Date;
}

/**
 * Match entre transação bancária e CR/CP. Aceita 1:1, 1:N, N:1, N:N e parcial.
 * `amountDifference` em valor absoluto — diferença ≤ 1% do bancário é tolerada
 * em V1 (parametrizável em `findBatchMatch`).
 */
export interface ReconciliationMatch {
  /** Identificador do match. */
  id: string;
  /** Empresa. */
  companyId: string;
  /** Transação bancária do lado banco. */
  bankTransactionId: string;
  /** IDs das transações casadas (CR/CP). */
  matchedTransactionIds: string[];
  /** Cardinalidade. */
  matchType: ReconciliationMatchType;
  /** Valor casado (soma dos `matchedTransactionIds`). */
  amountMatched: number;
  /** Diferença absoluta entre bancário e somado. */
  amountDifference: number;
  /** Confiança do match, 0..1. */
  confidenceScore: number;
  /** Como o match foi encontrado. */
  matchReason: ReconciliationMatchReason;
  /** Estado. */
  status: ReconciliationStatus;
  /** Quando o match foi gerado. */
  createdAt?: Date;
}

/**
 * Pendência agrupada — o dono nunca resolve linha por linha. O agrupamento
 * é feito em `groupClassificationExceptions()` e o dono confirma o grupo
 * inteiro, o que vira uma `ClassificationRule`.
 */
export interface GroupedException {
  /** Identificador do grupo. */
  id: string;
  /** Empresa. */
  companyId: string;
  /** Por que esse grupo virou exceção. */
  exceptionReason: ExceptionReason;
  /** Label legível em PT-BR (ex: "Pagamentos para 'AMERICAN EXPRESS'"). */
  groupLabel: string;
  /** IDs das transações do grupo. */
  transactionIds: string[];
  /** Soma absoluta dos valores no grupo. */
  totalAmount: number;
  /** Quantidade de transações no grupo. */
  count: number;
  /** Sugestão de categoria, quando o motor consegue inferir. */
  suggestedCategoryCode?: string;
  /** Sugestão de bucket. */
  suggestedBucket?: Bucket;
  /** Sugestão de label pro dono. */
  suggestedOwnerLabel?: string;
  /** Confiança da sugestão, 0..1. */
  confidenceScore: number;
  /** True quando o dono precisa decidir (default em pendências). */
  requiresOwnerAction: boolean;
}

/**
 * Mapa externo de hints por código de conta original. Permite que um
 * consumidor (ex: cfoup-overview-v3) injete conhecimento específico do
 * cliente sem que isso vire tabela hardcoded dentro do core.
 *
 *  - `exact`: match por código completo. Sinal forte.
 *  - `prefix`: match por prefixo (ex: '4.1.' bate '4.1.001', '4.1.002').
 *    Sinal médio — exige confirmação pela descrição para virar
 *    `classified` com confiança alta. Sem confirmação, o motor devolve
 *    `needs_confirmation`.
 *
 * Não persiste, não muta. Construído pelo consumidor a cada chamada.
 */
export interface AccountCodeHintMap {
  /** Código exato → categoria sugerida. Sinal forte. */
  exact?: Readonly<Record<string, StandardCategoryCode>>;
  /** Prefixo de código → categoria sugerida. Sinal médio.
   *  Avaliados na ordem listada; primeiro que casa ganha. */
  prefix?: ReadonlyArray<{
    pattern: string;
    category: StandardCategoryCode;
    confidence: 'medium';
  }>;
}
