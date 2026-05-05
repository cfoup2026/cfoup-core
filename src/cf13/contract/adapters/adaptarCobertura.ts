/**
 * Adapter: `CoberturaResult` interno → `CoberturaResult` do contrato.
 *
 * Mudanças semânticas:
 *  - `status` colapsa de 3 valores (`cobertura_insuficiente |
 *    cobertura_com_confianca_reduzida | cobertura_completa`) para 2
 *    (`'insuficiente' | 'suficiente'`). `cobertura_com_confianca_reduzida`
 *    e `cobertura_completa` mapeiam ambos para `'suficiente'`.
 *  - `motivosInsuficiencia` interno → `insuficienciasCriticas` do contrato.
 *  - `pendencias` (cobertura) interno → `pendenciasConfiancaReduzida` do
 *    contrato. Determinismo de ordem preservado (Stage 5 já ordena).
 *
 * Mapeamento de `semanaIndice`: `Pendencia.semana_iso` (`YYYY-Www`) é
 * convertido para o índice 1..13 via janela do consolidado.
 */
import type {
  CoberturaResult as CoberturaResultInterna,
  Pendencia as PendenciaInterna,
  MotivoInsuficiencia,
} from '../../../types/cobertura.js';
import {
  fonteDeteccao,
  mapearTipoInsuficiencia,
} from '../helpers/mapearOrigem.js';
import type {
  AcaoSugerida,
  CoberturaResult as CoberturaResultContract,
  InsuficienciaCritica,
  PendenciaConfianca,
} from '../types.js';

export interface AdaptarCoberturaArgs {
  cobertura: CoberturaResultInterna;
  /** Janela do consolidado em ordem (`semana_iso` → índice 1..13).
   *  Adapter usa para popular `PendenciaConfianca.semanaIndice`. */
  janelaSemanaIso: readonly string[];
}

export function adaptarCobertura(
  args: AdaptarCoberturaArgs,
): CoberturaResultContract {
  const { cobertura, janelaSemanaIso } = args;

  /* Index `semana_iso → indice 1..13` para lookup O(1). */
  const indicePorIso = new Map<string, number>();
  for (let i = 0; i < janelaSemanaIso.length; i++) {
    indicePorIso.set(janelaSemanaIso[i]!, i + 1);
  }

  const insuficienciasCriticas: InsuficienciaCritica[] =
    cobertura.motivosInsuficiencia.map((m) => adaptarMotivo(m));

  const pendenciasConfiancaReduzida: PendenciaConfianca[] =
    cobertura.pendencias.map((p) => adaptarPendencia(p, indicePorIso));

  /* Status colapsado: insuficiente quando há motivos. */
  const status: CoberturaResultContract['status'] =
    insuficienciasCriticas.length > 0 ? 'insuficiente' : 'suficiente';

  return {
    status,
    insuficienciasCriticas,
    pendenciasConfiancaReduzida,
  };
}

/* ─────────── Helpers internos ─────────── */

function adaptarMotivo(m: MotivoInsuficiencia): InsuficienciaCritica {
  /* TODO: `legalEntityNome`, `accountId`, `accountNome` sem fonte em
   *  v0 — campos opcionais omitidos. */
  return {
    tipo: mapearTipoInsuficiencia(m.tipo),
    legalEntityId: m.legal_entity_id,
    mensagem: m.descricao,
    acoesSugeridas: m.acoes_sugeridas.map(toAcaoSugerida),
  };
}

function adaptarPendencia(
  p: PendenciaInterna,
  indicePorIso: ReadonlyMap<string, number>,
): PendenciaConfianca {
  const indice = indicePorIso.get(p.semana_iso);
  /* Se a pendência referencia uma semana fora da janela atual (caso
   *  degenerado — Stage 5 só emite dentro da janela), default = 0
   *  para sinalizar "fora da grade". Não bloquear. */
  const semanaIndice = indice ?? 0;

  /* Contexto: monta só com campos definidos para respeitar
   *  `exactOptionalPropertyTypes`. Sempre carrega `fonteDeteccao`. */
  const contexto: NonNullable<PendenciaConfianca['contexto']> = {
    fonteDeteccao: fonteDeteccao(p.tipo),
  };
  if (p.contraparte_id !== undefined) {
    contexto.contraparteGrupoId = p.contraparte_id;
  }
  if (p.bucket_id !== undefined) {
    contexto.bucketId = p.bucket_id;
  }
  if (p.valor_esperado !== undefined) {
    contexto.valorEsperado = p.valor_esperado;
  }

  return {
    tipo: p.tipo,
    semanaIndice,
    legalEntityId: p.legal_entity_id,
    mensagem: p.descricao,
    contexto,
    acoesSugeridas: p.acoes_sugeridas.map(toAcaoSugerida),
  };
}

/** Mapeia uma string-enum interna (`AcaoCobertura`) para o tipo
 *  estruturado `AcaoSugerida` do contrato. v0: `id`, `rotulo`, `tipo`
 *  são iguais ao literal — telas downstream traduzem. */
function toAcaoSugerida(literal: string): AcaoSugerida {
  return {
    id: literal,
    rotulo: literal,
    tipo: literal,
  };
}

export { toAcaoSugerida };
