/**
 * Erro lançado pela camada de ingestão CF13 quando um input do parser não
 * pode ser convertido em `EventoCaixa` válido. Princípio do nucleus:
 * falhar visivelmente, não silenciar nem gerar default escondido.
 *
 * Casos típicos:
 *  - `valor <= 0` ou não-finito.
 *  - data principal (vencimento, baixa, transação) ausente ou inválida.
 *  - status indecidível com base no input (raramente acontece em parsers
 *    bem-formados; é uma rede de segurança).
 */
export class IngestaoError extends Error {
  /** Marcador estável para identificação em catch. */
  override readonly name = 'IngestaoError' as const;

  constructor(message: string) {
    super(message);
    // Preserva a cadeia de protótipos quando transpilado para targets
    // antigos do TS — evita quebra de `instanceof` em alguns runtimes.
    Object.setPrototypeOf(this, IngestaoError.prototype);
  }
}
