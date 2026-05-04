/**
 * Tipos do Estágio 4.5 — Classification Bridge.
 *
 * Bridge fino entre o pipeline CF13 e o Motor de Classificação do
 * Núcleo (`src/classification/classify.ts`). Bridge consome o motor
 * existente — não recria classificação, sem heurística inline.
 *
 * Ponto de plug: a interface `ClassifierAdapter`. Bridge core
 * (`classifyEventos`) só conhece a interface; implementação concreta
 * (`NucleusClassifierAdapter`) traduz `EventoCaixa ↔ SourceTransaction`
 * e mapeia `bucket → criticidade`.
 */
import type { Criticidade } from '../types/index.js';

/**
 * Resultado de classificação no formato do CF13. O adapter traduz o
 * `ClassificationResult` do motor (do Núcleo) para esta forma simples,
 * aplicando o mapeamento `bucket → criticidade` do Estágio 4.5.
 *
 * `null` (ao invés de uma instância deste tipo) significa "motor não
 * classificou" — Bridge mantém o evento como `pendente_classificacao`.
 */
export interface ClassificationResult {
  /** Um dos 12 buckets do Núcleo (ex: `'folha'`, `'caixa'`). */
  bucket_id: string;
  /** Label PT-BR exibível (ex: `'Folha Pagamento'`). */
  bucket_nome: string;
  /** Criticidade derivada do bucket via mapa fixo do Estágio 4.5. */
  criticidade: Criticidade;
}

/**
 * Estatísticas determinísticas do run de classificação. Soma das
 * componentes deve fechar:
 *  - `classificados + naoClassificados === totalEventos`.
 *  - `Σ porBucket.values() === classificados`.
 *  - `Σ porCriticidade.values() === classificados`.
 *  - `requiresOwnerConfirmationCount` é subset de `classificados`.
 */
export interface ClassificationStats {
  /** Total de eventos no input. */
  totalEventos: number;
  /** Eventos que entraram no Bridge já classificados (`bucket_id !=
   *  pendente_classificacao`) e foram passados intactos (idempotência). */
  jaClassificadosNoInput: number;
  /** Eventos novos que o motor classificou nesta passada. */
  classificados: number;
  /** Eventos que continuaram em `pendente_classificacao` após o Bridge. */
  naoClassificados: number;
  /** Distribuição por bucket (apenas dos classificados nesta passada).
   *  `bucket_id → quantidade`. */
  porBucket: Map<string, number>;
  /** Distribuição por criticidade (idem). */
  porCriticidade: Map<Criticidade, number>;
  /** Eventos onde o motor sinalizou `requiresOwnerConfirmation=true`.
   *  Bridge respeita o resultado mesmo assim — Stage 5/6 trata. */
  requiresOwnerConfirmationCount: number;
  /** Tempo total da chamada em ms (observabilidade — não afeta
   *  determinismo do output, mas vai pra logs e relatório do smoke). */
  tempoTotalMs: number;
}

/**
 * Erro interno do Bridge. Lançado pelo `NucleusClassifierAdapter` quando
 * o motor retorna algo fora do enum esperado (ex: bucket desconhecido,
 * tradução de criticidade não-mapeada). Princípio do nucleus: fail
 * visivelmente em vez de inventar valor neutro silencioso.
 */
export class ClassificationError extends Error {
  override readonly name = 'ClassificationError' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ClassificationError.prototype);
  }
}
