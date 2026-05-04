/**
 * Interface fina entre `classifyEventos` (core do Bridge) e o motor de
 * classificação real. Razão arquitetural:
 *  - Bridge não conhece detalhes do motor — só conhece esta interface.
 *  - Se motor mudar (versão, refactor, troca de implementação), só o
 *    adapter muda.
 *  - Testes do Bridge usam mocks; não precisam do motor real.
 */
import type { EventoCaixa } from '../types/index.js';
import type { ClassificationResult } from './types.js';

export interface ClassifierAdapter {
  /**
   * Classifica um único `EventoCaixa`. Síncrono, puro do ponto de vista
   * do Bridge (qualquer cache vive INTERNO ao adapter, transparente).
   *
   * Retorna `null` quando o motor não conseguiu classificar. Bridge
   * mantém o evento como `pendente_classificacao` nesse caso —
   * **sem fallback heurístico**, sem regex local.
   *
   * Implementações concretas devem documentar:
   *  - Quais campos de `EventoCaixa` consomem.
   *  - Tradução `Origem → SourceSystem` (ou equivalente do motor).
   *  - Tradução do output do motor para `ClassificationResult` do Bridge.
   *
   * Lança `ClassificationError` em valor inesperado vindo do motor
   * (bucket desconhecido, criticidade fora do enum, etc).
   */
  classify(evento: EventoCaixa): ClassificationResult | null;
}
