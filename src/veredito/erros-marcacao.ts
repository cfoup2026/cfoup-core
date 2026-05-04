/**
 * Detecção de erro de marcação de transferência (§6.3 caso inverso).
 *
 * Sintoma: consolidado pior que TODAS as unidades. Em multiunidade
 * sadia, consolidado é igual ou melhor que a pior unidade — porque
 * transferências internas válidas neutralizam no consolidado.
 *
 * Quando o consolidado fica pior, indica que alguma transferência
 * NÃO foi marcada como `is_transferencia=true` no Stage 3, e está
 * sendo dobrada no consolidado.
 *
 * **Stage 7 sinaliza, NÃO corrige.** A correção é manual (dono marca a
 * transferência) ou Stage 3.2 melhorando detecção de pares.
 *
 * Hierarquia de "pior" (do mais grave ao mais leve):
 *   CRITICO > ALERTA > ATENCAO > LIMPO
 *
 * `DADOS_INSUFICIENTES` no consolidado → não emite erro de marcação
 * (nada a comparar).
 */
import type { ErroDeMarcacao, Veredito, VereditoUnidade } from './types.js';

const VEREDITOS_CONSOLIDADO_RUIM = new Set<Veredito>(['CRITICO', 'ALERTA']);
const VEREDITOS_UNIDADE_OK = new Set<Veredito>([
  'LIMPO',
  'ATENCAO',
  /* `DADOS_INSUFICIENTES` em unidade NÃO conta como "OK" — uma unidade
   *  insuficiente significa que não dá pra dizer se está OK. Conservador:
   *  só consideramos erro de marcação quando todas as unidades têm
   *  veredito calculável e bom. */
]);

export interface DetectarErrosMarcacaoInput {
  unidades: readonly VereditoUnidade[];
  consolidado: VereditoUnidade;
  cliente_id: string;
}

export function detectarErrosMarcacao(
  input: DetectarErrosMarcacaoInput,
): ErroDeMarcacao[] {
  const { unidades, consolidado, cliente_id } = input;

  /* Consolidado precisa estar ruim. */
  if (!VEREDITOS_CONSOLIDADO_RUIM.has(consolidado.veredito)) return [];

  /* Caso degenerado: sem unidades — nada a comparar. */
  if (unidades.length === 0) return [];

  /* Todas unidades precisam estar OK (LIMPO ou ATENCAO). */
  for (const u of unidades) {
    if (!VEREDITOS_UNIDADE_OK.has(u.veredito)) return [];
  }

  /* Match: consolidado pior que todas. Sinaliza. */
  const ids = unidades.map((u) => u.legal_entity_id);
  ids.sort((a, b) => a.localeCompare(b));
  return [
    {
      tipo: 'consolidado_pior_que_unidades',
      legal_entity_ids: ids,
      cliente_id,
    },
  ];
}
