import type {
  Confianca,
  ConfiancaOrigem,
  ContraparteTipo,
  Criticidade,
  Direcao,
  Origem,
} from './enums.js';

/**
 * Schema base do `EventoCaixa` — pipeline CF13.
 *
 * `EventoCaixa` é uma discriminated union por `status` (ver `Status` em
 * `enums.ts`):
 *
 *  - `EventoRealizado`   exige `data_realizada: Date`.
 *  - `EventoConfirmado`  exige `data_vencimento: Date` e fixa `data_realizada: null`.
 *  - `EventoEstimado`    fixa `data_realizada: null`; `data_vencimento` opcional.
 *  - `EventoPendente`    fixa `data_realizada: null`; `data_vencimento` opcional.
 *
 * Invariantes do spec (§3):
 *  - `valor` SEMPRE positivo. Sinal vive em `direcao`.
 *  - Eventos `realizado` são imutáveis na semântica (não enforçado em tipo;
 *    enforcement em runtime fica para o estágio 1.2).
 *  - Campos de grupo de contraparte (`contraparte_grupo_id/nome`) NÃO entram
 *    aqui. Resolvidos por lookup na tabela global `Contraparte` (§12).
 */

/**
 * Campos compartilhados por todas as variantes do `EventoCaixa`.
 * Exportado para uso pela camada de ingestão (Estágio 1.2) ao construir
 * eventos via `buildEventoCaixaBase`. Consumidores de domínio devem
 * preferir `EventoCaixa` (a union completa) — este tipo é uma peça
 * intermediária. Pertencem a este shape:
 *  - 15 campos sempre obrigatórios (todos exceto `status`, que vai pra cada variante).
 *  - 10 campos opcionais (contraparte, refs, confirmação, competência, cenário, observação).
 */
export interface EventoCaixaBase {
  /** Identificador estável do evento; opaco para o consumidor. */
  id: string;
  /** Valor SEMPRE positivo. Direção vive em `direcao`, não no sinal. */
  valor: number;
  /** Entrada vs saída no fluxo de caixa. */
  direcao: Direcao;
  /** Data prevista do evento. Em `realizado`, coincide com `data_realizada`. */
  data_esperada: Date;
  /** ID do bucket de classificação (ex: 'pendente_classificacao'). */
  bucket_id: string;
  /** Nome legível do bucket — preserva rótulo apresentado ao dono. */
  bucket_nome: string;
  /** Tenant — empresa-cliente CFOup à qual o evento pertence. */
  cliente_id: string;
  /** Pessoa jurídica dentro do cliente. */
  legal_entity_id: string;
  /** Sistema-fonte ou processo que gerou o evento. */
  origem: Origem;
  /** Quão essencial é o pagamento/recebimento para a operação. */
  criticidade: Criticidade;
  /** Faixa qualitativa da certeza do evento. */
  confianca: Confianca;
  /** Quem definiu a confiança — sistema ou usuário. */
  confianca_origem: ConfiancaOrigem;
  /** True se é movimento entre contas próprias — neutralizar no consolidado. */
  is_transferencia: boolean;
  /** Timestamp UTC de criação do registro CF13. */
  criado_em: Date;
  /** ID do agente criador (sistema, usuário, integração). */
  criado_por: string;

  /* ───── Opcionais (10) ───── */

  /** Identificador da contraparte quando conhecido. */
  contraparte_id?: string;
  /** Categoria da contraparte. */
  contraparte_tipo?: ContraparteTipo;
  /** Código original da empresa no sistema-fonte (ex: filial FKN, CNPJ). */
  source_company_code?: string;
  /** Referência opaca ao registro original na origem. */
  origem_ref?: string;
  /** Número de documento (NF, boleto, doc) preservado raw. */
  documento_ref?: string;
  /** ID do agente que confirmou (em `confirmado` ou após confirmação manual). */
  confirmado_por?: string;
  /** Timestamp UTC da confirmação. */
  confirmado_em?: Date;
  /** Mês/ano de competência contábil quando aplicável (ex: '2026-04'). */
  competencia?: string;
  /** ID do cenário de simulação ao qual o evento pertence. */
  cenario_id?: string;
  /** Notas livres em PT-BR. */
  observacao?: string;
}

/**
 * Evento já aconteceu — caixa efetivamente moveu. `data_realizada`
 * obrigatório. `data_vencimento` opcional (eventos sem agendamento prévio
 * podem nem ter tido vencimento).
 *
 * Semântica: eventos realizado são imutáveis (regra do estágio 1.2 em runtime).
 */
export interface EventoRealizado extends EventoCaixaBase {
  status: 'realizado';
  /** Data efetiva da realização. UTC. */
  data_realizada: Date;
  /** Vencimento original quando existir. */
  data_vencimento?: Date;
}

/**
 * Evento agendado com vencimento dado. `data_vencimento` obrigatório.
 * `data_realizada` é null por definição (ainda não aconteceu).
 */
export interface EventoConfirmado extends EventoCaixaBase {
  status: 'confirmado';
  /** Sempre null — evento ainda não aconteceu. */
  data_realizada: null;
  /** Data de vencimento conhecida e firmada. UTC. */
  data_vencimento: Date;
}

/**
 * Previsão sem confirmação dura — projeção do motor CF13. `data_realizada`
 * é null. `data_vencimento` opcional (alguns estimados não têm vencimento
 * conhecido ainda).
 */
export interface EventoEstimado extends EventoCaixaBase {
  status: 'estimado';
  /** Sempre null em estimado. */
  data_realizada: null;
  /** Vencimento estimado quando existir. */
  data_vencimento?: Date;
}

/**
 * Aguardando classificação ou validação humana. Idem regra de datas do
 * `estimado` — `data_realizada` null, `data_vencimento` opcional.
 */
export interface EventoPendente extends EventoCaixaBase {
  status: 'pendente';
  /** Sempre null em pendente. */
  data_realizada: null;
  /** Vencimento quando já houver alguma indicação. */
  data_vencimento?: Date;
}

/**
 * Discriminated union por `status`. Use sempre este tipo em consumidores
 * — variantes individuais são exportadas para narrowing pontual.
 */
export type EventoCaixa =
  | EventoRealizado
  | EventoConfirmado
  | EventoEstimado
  | EventoPendente;
