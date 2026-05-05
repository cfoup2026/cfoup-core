/**
 * Adapter: `ConfiancaResult` interno → `ConfiancaResult` do contrato.
 *
 * Mudanças:
 *  - `por_unidade` interno → `unidades` (nome) com `legalEntityId`.
 *  - `consolidado` interno → `consolidado` do contrato (sem
 *    `legalEntityId` no escopo do consolidado).
 *  - Cada `ConfiancaSemana` interna ganha `semanaZerada` e
 *    `temPendenciaCritica` derivados; renomeia campos para camelCase.
 *  - `pendenciaCriticaPresente`: agregador booleano (qualquer pendência
 *    crítica em qualquer escopo) — útil pro UI mostrar dot vermelho.
 */
import type {
  ConfiancaResult as ConfiancaResultInterna,
  ConfiancaSemana as ConfiancaSemanaInterna,
  ConfiancaUnidade,
} from '../../../confianca/types.js';
import type {
  ConfiancaNivel,
  ConfiancaResult as ConfiancaResultContract,
  ConfiancaSemana as ConfiancaSemanaContract,
} from '../types.js';

export function adaptarConfianca(
  fonte: ConfiancaResultInterna,
): ConfiancaResultContract {
  const consolidado = adaptarNivelConfianca(fonte.consolidado);
  const unidades = fonte.por_unidade.map((u) => ({
    ...adaptarNivelConfianca(u),
    legalEntityId: u.legal_entity_id,
  }));

  /* Agregador: alguma pendência crítica em qualquer lugar? */
  const pendenciaCriticaPresente =
    fonte.consolidado.pendencias_criticas.length > 0 ||
    fonte.por_unidade.some((u) => u.pendencias_criticas.length > 0);

  return {
    consolidado,
    unidades,
    pendenciaCriticaPresente,
  };
}

/* ─────────── Helpers internos ─────────── */

function adaptarNivelConfianca(u: ConfiancaUnidade): ConfiancaNivel {
  return {
    projecao: u.confianca_projecao,
    semanas: u.semanas.map(adaptarSemanaConfianca),
  };
}

function adaptarSemanaConfianca(
  s: ConfiancaSemanaInterna,
): ConfiancaSemanaContract {
  return {
    indice: s.semana,
    nivel: s.confianca,
    pesoTotal: s.peso_total,
    pesoAlta: s.peso_alta,
    pesoBaixa: s.peso_baixa,
    percentAlta: s.pct_alta,
    percentBaixa: s.pct_baixa,
    semanaZerada: s.peso_total === 0,
    temPendenciaCritica: s.pendencias_criticas_ids.length > 0,
    pendenciasCriticasIds: [...s.pendencias_criticas_ids],
  };
}
