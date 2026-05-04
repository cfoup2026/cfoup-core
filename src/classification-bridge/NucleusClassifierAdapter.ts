/**
 * Implementação concreta do `ClassifierAdapter` que envolve o
 * `classifyTransaction` do Motor de Classificação do Núcleo
 * (`src/classification/classify.ts`).
 *
 * Responsabilidades:
 *  1. Traduzir `EventoCaixa` → `SourceTransaction` (input do motor).
 *  2. Chamar `classifyTransaction(sourceTx, options)`.
 *  3. Traduzir o `ClassificationResult` do Núcleo (com `bucket` +
 *     `confidenceScore` + `status`) → `ClassificationResult` do Bridge
 *     (com `bucket_id` + `bucket_nome` + `criticidade`).
 *  4. Aplicar o mapa `bucket → criticidade` aprovado no Stage 4.5.
 *  5. Sinalizar `requiresOwnerConfirmation` via canal lateral
 *     (`lastRequiresConfirmation`) — Bridge core lê pra estatística.
 *
 * **Não faz heurística inline.** Delega 100% da decisão ao motor; só
 * atua sobre o `bucket` que o motor emite. `bucket === null` → retorna
 * `null` ao Bridge core (evento permanece pendente).
 */
import type {
  Bucket,
  ClassificationOptions,
  ClassificationResult as NucleusClassificationResult,
  Direction as NucleusDirection,
  SourceSystem,
  SourceTransaction,
} from '../classification/index.js';
import { BUCKETS, classifyTransaction } from '../classification/index.js';
import type {
  Criticidade,
  EventoCaixa,
  Origem,
} from '../types/index.js';
import type { ClassifierAdapter } from './ClassifierAdapter.js';
import {
  ClassificationError,
  type ClassificationResult,
} from './types.js';

/**
 * Mapa estático `Bucket → Criticidade` aprovado no Estágio 4.5
 * (Ronaldo, 2026-05-04). Critérios de design:
 *  - Receita e Contas a Receber → `pendente` (não-aplicável: `criticidade`
 *    serve pra `caixa_minimo_op`, que filtra `direcao='saida'`. Atribuir
 *    valor "obrigatoria" para entradas seria cosmético e potencialmente
 *    confundir Stage 5/6 mais tarde).
 *  - `caixa` → `negociavel` (NÃO `pendente`) — evita "pendência crítica
 *    falsa" em transferência/saque/depósito interno.
 *  - Folha, Deduções → `obrigatoria` (passivo trabalhista/fiscal).
 *  - Custos diretos, Operacionais, Financeiras, Estoque → `critica_op`
 *    (operação para sem isso, mas há margem de negociação).
 *  - Retiradas Sócios, Investimentos → `discricionaria` (CAPEX/M&A).
 */
const BUCKET_TO_CRITICIDADE: Record<Bucket, Criticidade> = {
  receita: 'pendente',
  deducoes: 'obrigatoria',
  custos_diretos: 'critica_op',
  folha: 'obrigatoria',
  despesas_operacionais: 'critica_op',
  caixa: 'negociavel',
  contas_receber: 'pendente',
  contas_pagar: 'negociavel',
  despesas_financeiras: 'critica_op',
  retiradas_socios: 'discricionaria',
  investimentos: 'discricionaria',
  estoque: 'critica_op',
};

/**
 * Mapa `Origem (CF13) → SourceSystem (Núcleo)` aprovado.
 *
 * Casos não-óbvios:
 *  - `'fkn'` é ambíguo: depende de `direcao` + `contraparte_tipo` para
 *    distinguir AR de AP. Tratado em `mapSourceSystem()` que recebe o
 *    evento inteiro, não só a origem.
 *  - `'pluggy'` → `'bank'`: aggregator de open banking; semanticamente
 *    transação bancária.
 *  - `'enotas'` → `'invoice'`: serviço de NF-e.
 *  - `'historico'` (estimados do Stage 2) → `'manual'`: estimados não
 *    têm sistema-fonte; `'manual'` é o fallback mais neutro.
 *  - `'csv'` → `'manual'`: import genérico sem sistema-fonte conhecido.
 */
function mapSourceSystem(evento: EventoCaixa): SourceSystem {
  const origem: Origem = evento.origem;
  switch (origem) {
    case 'pluggy':
      return 'bank';
    case 'cef':
      return 'bank';
    case 'enotas':
      return 'invoice';
    case 'erp':
      return 'erp';
    case 'contabil':
      return 'accounting';
    case 'csv':
      return 'manual';
    case 'manual':
      return 'manual';
    case 'historico':
      return 'manual';
    case 'fkn': {
      // FKN: o sistema fonte é o ERP, mas para o motor de classificação,
      // 'accounts_receivable' / 'accounts_payable' guiam regras dedicadas.
      // Decidimos pela contraparte_tipo (preenchida por fkn-ar/ap.adapter).
      if (evento.contraparte_tipo === 'cliente') return 'accounts_receivable';
      if (evento.contraparte_tipo === 'fornecedor') return 'accounts_payable';
      // Fallback raro (FKN sem contraparte_tipo): trata como ERP genérico.
      return 'erp';
    }
  }
}

function mapDirection(d: EventoCaixa['direcao']): NucleusDirection {
  return d === 'entrada' ? 'inflow' : 'outflow';
}

/**
 * Constrói `SourceTransaction` a partir de `EventoCaixa`. Campos do
 * `SourceTransaction` ausentes em `EventoCaixa` ficam `undefined` —
 * o motor opera sem eles, reduzindo a chance de match de keywords.
 *
 * **Estágio 1.6** preserva texto observado da origem em campos opcionais
 * de `EventoCaixa`:
 *  - `descricao_origem` → `SourceTransaction.description`
 *  - `contraparte_nome_origem` → `SourceTransaction.counterpartyName`
 *  - `conta_origem_nome` → `SourceTransaction.originalAccountName`
 *
 * Disponibilidade depende do adapter Stage 1:
 *  - CEF preenche `descricao_origem` (de `Transaction.history`).
 *  - FKN AP/AR preenchem `contraparte_nome_origem` (de
 *    `vendorName`/`customerName`).
 *  - `conta_origem_nome` reservado para sistemas com plano de contas
 *    estruturado (Pluggy, contábil) — ainda nenhum adapter preenche.
 *
 * Quando o evento não traz nenhum desses campos, o motor cai nos
 * fallbacks por `direction + amount + sourceSystem + documentNumber`.
 */
function eventoToSourceTransaction(evento: EventoCaixa): SourceTransaction {
  const transactionDate =
    evento.status === 'realizado'
      ? evento.data_realizada
      : evento.data_esperada;

  const sourceTx: SourceTransaction = {
    id: evento.id,
    companyId: evento.legal_entity_id, // decisão: companyId === legal_entity_id
    sourceSystem: mapSourceSystem(evento),
    transactionDate,
    direction: mapDirection(evento.direcao),
    amount: evento.valor,
    currency: 'BRL',
  };

  if (evento.documento_ref !== undefined)
    sourceTx.documentNumber = evento.documento_ref;
  if (evento.status === 'confirmado' || evento.status === 'realizado') {
    if (evento.data_vencimento !== undefined)
      sourceTx.dueDate = evento.data_vencimento;
  }
  if (evento.status === 'realizado') {
    sourceTx.paidDate = evento.data_realizada;
  }
  if (evento.criado_em instanceof Date) {
    sourceTx.createdAt = evento.criado_em;
  }

  // Estágio 1.6 — texto observado da origem alimenta o motor.
  if (evento.descricao_origem !== undefined)
    sourceTx.description = evento.descricao_origem;
  if (evento.contraparte_nome_origem !== undefined)
    sourceTx.counterpartyName = evento.contraparte_nome_origem;
  if (evento.conta_origem_nome !== undefined)
    sourceTx.originalAccountName = evento.conta_origem_nome;

  return sourceTx;
}

/**
 * Adapter concreto sobre o `classifyTransaction` do Núcleo.
 *
 * Sinaliza `requiresOwnerConfirmation` por canal lateral
 * (`lastRequiresConfirmation`) — `classifyEventos` lê após cada
 * chamada. Mantém o tipo público `ClassificationResult` enxuto.
 *
 * Determinístico: o motor é puro síncrono (regex + lookup); duas
 * chamadas com mesmo input retornam mesmo output.
 */
export interface NucleusClassifierAdapterOptions {
  /** Repassado a `classifyTransaction` em todas as chamadas. Permite
   *  injetar `rules` da empresa, `accountCodeHints`, etc. */
  classifierOptions?: ClassificationOptions;
}

export class NucleusClassifierAdapter implements ClassifierAdapter {
  /** Sinalização lateral lida por `classifyEventos` após cada `classify`. */
  public lastRequiresConfirmation = false;

  private readonly options: ClassificationOptions;

  constructor(options: NucleusClassifierAdapterOptions = {}) {
    this.options = options.classifierOptions ?? {};
  }

  classify(evento: EventoCaixa): ClassificationResult | null {
    this.lastRequiresConfirmation = false;

    const sourceTx = eventoToSourceTransaction(evento);
    const result: NucleusClassificationResult = classifyTransaction(
      sourceTx,
      this.options,
    );

    // Decisão Stage 4.5: aceitar todo resultado com bucket !== null.
    // Bridge não filtra por confidenceLevel (Stage 6 trata) nem por
    // requiresOwnerConfirmation (apenas conta).
    if (result.bucket === null) {
      return null;
    }

    this.lastRequiresConfirmation = result.requiresOwnerConfirmation;

    const bucketMeta = BUCKETS[result.bucket];
    if (bucketMeta === undefined) {
      // Defesa: motor emitiu bucket fora do enum esperado.
      throw new ClassificationError(
        `bucket inesperado retornado pelo motor: ${JSON.stringify(result.bucket)}`,
      );
    }
    const criticidade = BUCKET_TO_CRITICIDADE[result.bucket];
    if (criticidade === undefined) {
      // Defesa: bucket existe em BUCKETS mas não está no nosso mapa.
      throw new ClassificationError(
        `bucket sem mapeamento de criticidade: ${result.bucket}`,
      );
    }

    return {
      bucket_id: result.bucket,
      bucket_nome: bucketMeta.label,
      criticidade,
    };
  }
}

/* Export interno do mapa para o doc/teste. */
export { BUCKET_TO_CRITICIDADE };
