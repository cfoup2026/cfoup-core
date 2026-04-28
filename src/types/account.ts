/** Conta bancária identificada no extrato. */
export interface Account {
  /** Identificador estável dentro do parser. */
  id: string;
  /** Tipo da conta. */
  type: AccountType;
  /** Nome ou código do banco (ex: "CEF", "Caixa", "001"). */
  bank: string;
  /** Agência, quando informada pelo extrato. */
  agency?: string;
  /** Número da conta conforme aparece no extrato. */
  number: string;
  /** Titular da conta, quando informado. */
  holder: string;
}

export type AccountType = 'checking' | 'savings';
