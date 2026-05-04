/**
 * Derivação de status consolidado de cobertura (§4 + §8.1 do spec).
 *
 * `CoberturaResult` no repo expõe um `status` global, mas não tem
 * `consolidado.status` explícito. A regra normativa: saldo de abertura
 * ausente em qualquer unidade ativa torna o consolidado insuficiente.
 *
 * **Função pura** que itera as unidades ativas, deriva status individual
 * (mesma lógica de `mapearCoberturaParaEcho` do Stage 6), e aplica:
 *
 *  1. Alguma `cobertura_insuficiente` → consolidado `cobertura_insuficiente`.
 *  2. Senão alguma `cobertura_com_confianca_reduzida` → consolidado
 *     `cobertura_com_confianca_reduzida`.
 *  3. Senão → `cobertura_completa`.
 *
 * **NÃO muta `CoberturaResult`.**
 */
import type { CoberturaResult, CoberturaStatus } from '../types/index.js';

/**
 * Status de cobertura por uma unidade específica, derivado de
 * `pendencias[]` + `motivosInsuficiencia[]`.
 */
export function deriveStatusUnidade(
  cobertura: CoberturaResult,
  legal_entity_id: string,
): CoberturaStatus {
  const temMotivo = cobertura.motivosInsuficiencia.some(
    (m) => m.legal_entity_id === legal_entity_id,
  );
  if (temMotivo) return 'cobertura_insuficiente';
  const temPendencia = cobertura.pendencias.some(
    (p) => p.legal_entity_id === legal_entity_id,
  );
  if (temPendencia) return 'cobertura_com_confianca_reduzida';
  return 'cobertura_completa';
}

/**
 * Status consolidado a partir do array de unidades ativas.
 *
 * Aceita lista vazia → retorna `'cobertura_completa'` (degenerado:
 * sem unidades ativas, nada a cobrir).
 */
export function deriveCoberturaConsolidada(
  cobertura: CoberturaResult,
  legal_entity_ids_ativas: readonly string[],
): CoberturaStatus {
  let temReduzida = false;
  for (const id of legal_entity_ids_ativas) {
    const s = deriveStatusUnidade(cobertura, id);
    if (s === 'cobertura_insuficiente') return 'cobertura_insuficiente';
    if (s === 'cobertura_com_confianca_reduzida') temReduzida = true;
  }
  return temReduzida
    ? 'cobertura_com_confianca_reduzida'
    : 'cobertura_completa';
}
