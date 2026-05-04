/**
 * Banner de unidade crítica (§6.3 do spec).
 *
 * Ativa quando o consolidado está `LIMPO`/`ATENCAO` mas alguma unidade
 * está em `CRITICO`/`ALERTA` — sinal pro dono de que "média olhada não
 * conta a história". Texto:
 *
 *   "{N} unidade em risco" / "{N} unidades em risco"
 *
 * **Casos especiais:**
 *  - Consolidado em `DADOS_INSUFICIENTES` → banner sempre `null` (não
 *    faz sentido sinalizar "unidade em risco" quando o consolidado nem
 *    foi calculado).
 *  - Consolidado em `CRITICO`/`ALERTA` → banner não aplica (consolidado
 *    já está em risco; o banner é só pra "consolidado parece OK mas...");
 *    `null`.
 *  - Unidades em `DADOS_INSUFICIENTES` NÃO contam como "em risco" — só
 *    `CRITICO`/`ALERTA` agregam.
 */
import type { BannerUnidadeCritica, VereditoUnidade } from './types.js';

const VEREDITOS_RISCO = new Set<VereditoUnidade['veredito']>([
  'CRITICO',
  'ALERTA',
]);
const CONSOLIDADO_PASSIVEL_BANNER = new Set<VereditoUnidade['veredito']>([
  'LIMPO',
  'ATENCAO',
]);

export function calcularBanner(
  unidades: readonly VereditoUnidade[],
  consolidado: VereditoUnidade,
): BannerUnidadeCritica {
  if (!CONSOLIDADO_PASSIVEL_BANNER.has(consolidado.veredito)) {
    return null;
  }

  const unidadesEmRisco = unidades
    .filter((u) => VEREDITOS_RISCO.has(u.veredito))
    .map((u) => u.legal_entity_id);

  if (unidadesEmRisco.length === 0) return null;

  /* Determinismo da ordem: lex por `legal_entity_id`. */
  unidadesEmRisco.sort((a, b) => a.localeCompare(b));

  const N = unidadesEmRisco.length;
  const sufixo = N > 1 ? 's' : '';
  return {
    ativo: true,
    unidades_em_risco: unidadesEmRisco,
    texto: `${N} unidade${sufixo} em risco`,
  };
}
