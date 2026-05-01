/**
 * Tipos do Estágio 3.2 — FKN Vendas auxiliar e reconciliação Vendas↔AR.
 *
 * Princípios:
 *  - `VendaComercial` é estrutura PARALELA ao `EventoCaixa` — vendas
 *    NUNCA viram caixa direto. CR é fonte primária do recebimento;
 *    vendas enriquecem dados comerciais.
 *  - Tipos disjuntos: `VendaComercial` não é atribuível a `EventoCaixa`
 *    e vice-versa (campos discriminantes diferentes).
 *  - Determinismo: matching usa janelas explícitas e tolerância
 *    documentada; mesmo input + `reconciliadoEm` → mesma saída.
 */

/**
 * Prazo de pagamento de uma venda. `'a_vista'` quando recebimento
 * coincide com emissão; `'a_prazo'` quando há vencimento futuro
 * (B2B típico até 120 dias).
 */
export type PrazoVenda = 'a_vista' | 'a_prazo';

/**
 * Linha comercial de venda — espelho do título de receita no AR.
 * NUNCA representada como `EventoCaixa`. Adapter `fknVendasAdapter`
 * emite `VendaComercial[]` direto, sem passar por `buildEventoCaixaBase`.
 *
 * Reconciliação Vendas↔AR opera por chave forte (`documento_ref`) ou
 * fraca (data + valor + cliente), preenchendo `reconciliado_com` aqui
 * sem mutar o AR contraparte.
 */
export interface VendaComercial {
  /** ID determinístico — `${origem}_vendas_${origem_ref}_${cliente}_${le}`. */
  id: string;
  /** Tenant CFOup. */
  cliente_id: string;
  /** Pessoa jurídica dentro do cliente. */
  legal_entity_id: string;
  /** Código FKN da empresa quando aplicável. */
  source_company_code?: string;
  /** Sistema-fonte. Em v0, fixo `'fkn'`. */
  origem: 'fkn';
  /**
   * Identificador comercial mais estável disponível.
   * Resolução determinística no adapter:
   * `documento_ref > num_venda > id_lote_venda`. Falha visível quando
   * nenhum está presente.
   */
  origem_ref: string;
  /** NF emitida quando aplicável. Chave forte de matching com AR. */
  documento_ref?: string;
  /** Emissão da nota — fixa o "marco zero" do prazo B2B. UTC. */
  data_emissao: Date;
  /** Sempre positivo. Devoluções/cancelamentos não entram aqui. */
  valor: number;
  /** CNPJ/CPF do cliente quando conhecido. */
  contraparte_id?: string;
  /** Sempre `'cliente'` em vendas. */
  contraparte_tipo: 'cliente';
  /** Prazo de pagamento. */
  prazo: PrazoVenda;
  /**
   * `id` do `EventoCaixa` AR que casou. Preenchido por
   * `reconciliaVendasAr`. Não muta o AR — link unilateral.
   */
  reconciliado_com?: string;
  /** Timestamp UTC do match. */
  reconciliado_em?: Date;
  /** Quando a venda foi importada. */
  criado_em: Date;
  /** Agente criador (sistema/usuário/integração). */
  criado_por: string;
}

/**
 * Tipos enumerados de pendência comercial. Lista exaustiva.
 *
 *  - `'venda_sem_ar'`: venda sem AR equivalente. Provável NF emitida
 *    sem ter virado título no AR ainda, ou erro de cadastro.
 *  - `'ar_sem_venda'`: AR sem venda comercial associada — sinal de
 *    título no CR cuja origem comercial não foi rastreada.
 *  - `'venda_ambigua'`: venda com 2+ ARs candidatos. Sem decisão
 *    automática — pendência registra os IDs.
 */
export type TipoPendenciaComercial =
  | 'venda_sem_ar'
  | 'ar_sem_venda'
  | 'venda_ambigua';

/**
 * Pendência informativa do estágio comercial. NÃO bloqueia o pipeline;
 * vai para a tela de Pendências de Setup. IDs ordenados (determinismo).
 */
export interface PendenciaComercial {
  /** ID determinístico baseado em `(tipo, ids_relacionados_ordenados)`. */
  id: string;
  tipo: TipoPendenciaComercial;
  /** Descrição curta determinística em PT-BR (sem storytelling). */
  descricao: string;
  /** IDs de `VendaComercial` envolvidas, ordenados. */
  vendas_relacionadas: string[];
  /** IDs de `EventoCaixa` AR envolvidos, ordenados. */
  ar_relacionados: string[];
  /** Quando a pendência foi detectada. */
  detectado_em: Date;
}

/** Estatísticas determinísticas do run de reconciliação Vendas↔AR. */
export interface ReconciliacaoComercialEstatisticas {
  /** Total de vendas na entrada. */
  vendasOriginais: number;
  /** ARs filtrados (entrada + fkn + cliente). */
  arFiltrados: number;
  /** Matches 1:1 aplicados. */
  matchesAplicados: number;
  /** Vendas sem AR correspondente (pendência `venda_sem_ar`). */
  vendasSemAr: number;
  /** ARs sem venda associada (pendência `ar_sem_venda`). */
  arSemVenda: number;
  /** Vendas com 2+ ARs candidatos (pendência `venda_ambigua`). */
  ambiguidades: number;
}

/**
 * Saída de `reconciliaVendasAr`. `vendas` carrega o input com
 * `reconciliado_com`/`reconciliado_em` preenchidos onde houve match.
 * AR não muda — enrichment unilateral.
 */
export interface ReconciliacaoComercialResult {
  vendas: VendaComercial[];
  pendencias: PendenciaComercial[];
  reconciliadoEm: Date;
  estatisticas: ReconciliacaoComercialEstatisticas;
}
