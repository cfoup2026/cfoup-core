/**
 * Enums do schema CF13 — pipeline de fluxo de caixa 13 semanas.
 *
 * Todos são string-literal unions (sem `enum`), seguindo a convenção
 * já estabelecida no nucleus (TransactionDirection, PaymentStatus, etc).
 * Literais são exatamente os do `CFOup_CF13_Spec_v0.md` §3.
 */

/** Direção financeira de um evento de caixa. */
export type Direcao = 'entrada' | 'saida';

/**
 * Sistema-fonte ou processo que gerou o evento. Usado pra rastrear
 * provenance e decidir handlers downstream (reconciliação, classificação).
 */
export type Origem =
  | 'pluggy'
  | 'enotas'
  | 'erp'
  | 'fkn'
  | 'cef'
  | 'contabil'
  | 'csv'
  | 'manual';

/**
 * Estado do evento na linha do tempo. Discriminator das variantes de
 * `EventoCaixa` — define quais campos de data são obrigatórios.
 *
 * - 'realizado': já aconteceu (caixa moveu). Exige `data_realizada`.
 * - 'confirmado': agendado com vencimento conhecido. Exige `data_vencimento`.
 * - 'estimado': previsão sem confirmação dura.
 * - 'pendente': aguardando classificação ou validação humana.
 */
export type Status = 'realizado' | 'confirmado' | 'estimado' | 'pendente';

/**
 * Quão essencial é o pagamento/recebimento para a operação.
 * `pendente` significa que ainda não foi avaliado.
 */
export type Criticidade =
  | 'obrigatoria'
  | 'critica_op'
  | 'negociavel'
  | 'discricionaria'
  | 'pendente';

/** Faixa qualitativa da certeza atribuída ao evento. */
export type Confianca = 'alta' | 'media' | 'baixa';

/** Quem definiu a confiança — sistema (regra automática) ou usuário (override). */
export type ConfiancaOrigem = 'sistema' | 'usuario';

/** Tipo da contraparte do evento, quando conhecido. */
export type ContraparteTipo = 'cliente' | 'fornecedor' | 'interno' | 'outro';
