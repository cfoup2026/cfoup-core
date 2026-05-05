/**
 * Adapter: `VereditoResult` interno → `VereditoResult` do contrato.
 *
 * Mudanças semânticas:
 *  - Veredito enum em UPPERCASE (`'CRITICO' | ... | 'DADOS_INSUFICIENTES'`)
 *    → categoria lowercase com `_` (`'critico' | ... | 'dados_insuficientes'`).
 *  - `detalhes` (snake_case) → `detalhe` (discriminated union camelCase).
 *  - Banner: `unidades_em_risco: string[]` → array de
 *    `{legalEntityId, categoria}` (cross-reference com vereditos).
 *  - `data_critica` (ISO 8601 completo) → `semanaData` (ISO `YYYY-MM-DD`).
 *  - `valor_falta` → `faltante`.
 *  - `pendencias_relevantes` → `pendenciasRelevantes`.
 *
 * `erros_de_marcacao` interno NÃO entra aqui — é tratado em
 * `adaptarPendencias` (vira `PendenciaCF13` com origem `'veredito'`).
 *
 * `mensagem` do banner usa o `texto` interno renderizado pelo Stage 7
 * (`"N unidade(s) em risco"`).
 */
import type {
  BannerUnidadeCritica as BannerInterno,
  Veredito as VereditoInterno,
  VereditoDetalhes,
  VereditoResult as VereditoResultInterna,
  VereditoUnidade as VereditoUnidadeInterna,
} from '../../../veredito/types.js';
import { formatarISODate } from './adaptarSemana.js';
import type {
  BannerUnidadeCritica as BannerContract,
  Veredito as VereditoContract,
  VereditoCategoria,
  VereditoDetalhe,
  VereditoResult as VereditoResultContract,
} from '../types.js';

export function adaptarVeredito(
  fonte: VereditoResultInterna,
): VereditoResultContract {
  const consolidado = adaptarVereditoBase(fonte.consolidado);
  const unidades = fonte.unidades.map((u) => ({
    ...adaptarVereditoBase(u),
    legalEntityId: u.legal_entity_id,
    /* TODO: `legalEntityNome` indisponível em v0. */
  }));

  const categoriaPorLE = new Map<string, VereditoCategoria>();
  for (const u of fonte.unidades) {
    categoriaPorLE.set(u.legal_entity_id, mapearCategoria(u.veredito));
  }

  const bannerUnidadeCritica = adaptarBanner(
    fonte.banner_unidade_critica,
    categoriaPorLE,
  );

  return { consolidado, unidades, bannerUnidadeCritica };
}

/* ─────────── Helpers internos ─────────── */

function adaptarVereditoBase(u: VereditoUnidadeInterna): VereditoContract {
  return {
    categoria: mapearCategoria(u.veredito),
    texto: u.texto,
    detalhe: mapearDetalhe(u.veredito, u.detalhes),
  };
}

function mapearCategoria(v: VereditoInterno): VereditoCategoria {
  switch (v) {
    case 'CRITICO':
      return 'critico';
    case 'ALERTA':
      return 'alerta';
    case 'ATENCAO':
      return 'atencao';
    case 'LIMPO':
      return 'limpo';
    case 'DADOS_INSUFICIENTES':
      return 'dados_insuficientes';
  }
}

function mapearDetalhe(
  v: VereditoInterno,
  d: VereditoDetalhes,
): VereditoDetalhe {
  switch (v) {
    case 'DADOS_INSUFICIENTES':
      return { tipo: 'dados_insuficientes' };
    case 'LIMPO':
      return { tipo: 'limpo' };
    case 'ATENCAO':
      return {
        tipo: 'atencao',
        pendenciasRelevantes: d.pendencias_relevantes ?? 0,
      };
    case 'CRITICO':
      return {
        tipo: 'critico',
        semanaIndice: d.semana_critica ?? 0,
        semanaData: isoDateOuVazio(d.data_critica),
        faltante: d.valor_falta ?? 0,
      };
    case 'ALERTA':
      return {
        tipo: 'alerta',
        semanaIndice: d.semana_critica ?? 0,
        saldoProjetado: d.saldo_projetado ?? 0,
        minimoOperacional: d.minimo_operacional ?? 0,
      };
  }
}

/** Converte ISO 8601 completo (`2026-05-25T00:00:00.000Z`) → ISO date
 *  (`2026-05-25`). Defensivo: vazio se input não parseia. */
function isoDateOuVazio(iso: string | undefined): string {
  if (iso === undefined) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatarISODate(d);
}

function adaptarBanner(
  fonte: BannerInterno,
  categoriaPorLE: ReadonlyMap<string, VereditoCategoria>,
): BannerContract {
  if (fonte === null) {
    return { presente: false, unidadesEmRisco: [], mensagem: '' };
  }
  const unidadesEmRisco = fonte.unidades_em_risco.map((legalEntityId) => ({
    legalEntityId,
    /* Categoria do veredito da unidade em risco. Default 'critico' se
     *  por algum motivo não estiver no map (não deve ocorrer no fluxo
     *  normal). */
    categoria: categoriaPorLE.get(legalEntityId) ?? 'critico',
  }));
  return {
    presente: fonte.ativo,
    unidadesEmRisco,
    mensagem: fonte.texto,
  };
}
