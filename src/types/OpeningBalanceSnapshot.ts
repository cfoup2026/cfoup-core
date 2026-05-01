import type { Origem } from './enums.js';

/**
 * Snapshot de saldo de abertura — entidade separada de `EventoCaixa`
 * por princípio "fato vs metadado nunca compartilham tipo" (spec §4).
 *
 * Não é movimentação — é o saldo inicial de uma conta bancária num
 * dado `data_referencia`. Consumido pelo motor de runningBalance e
 * pela reconciliação com extrato bancário.
 *
 * Não reusa nenhum campo de `EventoCaixa`.
 */
export interface OpeningBalanceSnapshot {
  /** Identificador estável do snapshot. */
  id: string;
  /** Tenant — empresa-cliente CFOup à qual o saldo pertence. */
  cliente_id: string;
  /** Pessoa jurídica dentro do cliente. */
  legal_entity_id: string;
  /** Conta bancária de referência. */
  conta_bancaria_id: string;
  /** Saldo na data de referência. Pode ser negativo (cheque especial). */
  valor: number;
  /** Data UTC do saldo (00:00 do dia de referência). */
  data_referencia: Date;
  /** Sistema-fonte ou processo que originou o snapshot. */
  origem: Origem;
  /** Timestamp UTC de criação do registro. */
  criado_em: Date;
  /** ID do agente criador. */
  criado_por: string;
}
