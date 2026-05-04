/**
 * Eco do status de cobertura por unidade (Stage 5 → Stage 6 → Stage 7).
 *
 * Stage 6 NÃO altera `CoberturaResult`. Só ecoa em `cobertura_aplicada[]`
 * para Stage 7 ler num lugar só.
 *
 * **Derivação por unidade** (porque `CoberturaResult` no repo só tem
 * `status` global):
 *  - `motivosInsuficiencia` para a unidade → `'cobertura_insuficiente'`.
 *  - Senão se `pendencias` para a unidade → `'cobertura_com_confianca_reduzida'`.
 *  - Senão → `'cobertura_completa'`.
 */
import type {
  CoberturaResult,
  CoberturaStatus,
} from '../types/index.js';
import type { CoberturaAplicadaItem } from './types.js';

export interface MapearCoberturaInput {
  cobertura: CoberturaResult;
  legal_entity_ids: readonly string[];
}

/**
 * Mapeia `CoberturaResult` para `CoberturaAplicadaItem[]` por unidade
 * ativa. Lista ordenada por `legal_entity_id` lex (determinismo).
 */
export function mapearCoberturaParaEcho(
  input: MapearCoberturaInput,
): CoberturaAplicadaItem[] {
  const { cobertura, legal_entity_ids } = input;

  /* Index motivos e pendências por legal_entity_id para lookup O(1). */
  const motivosPorUnidade = new Set<string>();
  for (const m of cobertura.motivosInsuficiencia) {
    motivosPorUnidade.add(m.legal_entity_id);
  }
  const pendenciasPorUnidade = new Set<string>();
  for (const p of cobertura.pendencias) {
    pendenciasPorUnidade.add(p.legal_entity_id);
  }

  const out: CoberturaAplicadaItem[] = [...legal_entity_ids]
    .sort((a, b) => a.localeCompare(b))
    .map((legal_entity_id) => ({
      legal_entity_id,
      status: derivarStatus(
        legal_entity_id,
        motivosPorUnidade,
        pendenciasPorUnidade,
      ),
    }));

  return out;
}

function derivarStatus(
  legal_entity_id: string,
  motivosPorUnidade: ReadonlySet<string>,
  pendenciasPorUnidade: ReadonlySet<string>,
): CoberturaStatus {
  if (motivosPorUnidade.has(legal_entity_id)) {
    return 'cobertura_insuficiente';
  }
  if (pendenciasPorUnidade.has(legal_entity_id)) {
    return 'cobertura_com_confianca_reduzida';
  }
  return 'cobertura_completa';
}
