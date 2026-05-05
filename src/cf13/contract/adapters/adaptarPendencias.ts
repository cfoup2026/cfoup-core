/**
 * Adapter: unifica 4 fontes internas de pendência → `PendenciaCF13[]`.
 *
 * **Mapeamento de origem (Item 3 §5 + ajustes pós-revisão):**
 *  1. `MotivoInsuficiencia[]`     (Stage 5) → `'cobertura'` + `'critica'`
 *  2. `Pendencia[]`               (Stage 5) — origem depende do
 *                                  `cobertura.status` interno:
 *      • `cobertura_insuficiente`            → `'cobertura'`
 *      • `cobertura_com_confianca_reduzida`  → `'confianca'`
 *      • `cobertura_completa`                → `'confianca'`
 *                                              (não emite na prática;
 *                                               status interno é vazio)
 *      Severidade segue `severidadePorTipoCobertura`.
 *  3. `PendenciaCritica[]`        (Stage 6) → `'confianca'` + `'critica'`.
 *  4. `ErroDeMarcacao[]`          (Stage 7) → `'confianca'` + `'media'`.
 *      `'veredito'` no contrato fica reservado para pendências
 *      derivadas das categorias `ALERTA`/`CRITICO` do próprio veredito —
 *      fora do escopo v0.
 *
 * **Deduplicação `PendenciaCritica`:** Stage 6 emite a mesma pendência
 * em escopos diferentes (consolidado + por_unidade). Para preservar o
 * drill-down por unidade, **a versão de unidade vence** (carrega
 * `unidadeId` real). Múltiplas unidades para o mesmo `evento_id` (caso
 * de transferência) são todas preservadas. Versão consolidada só
 * permanece quando não há nenhuma versão de unidade do mesmo evento.
 *
 * Ordenação final via `ordenarPendencias` (severidade desc → semanaId
 * asc → id asc).
 */
import type {
  CoberturaResult as CoberturaResultInterna,
  Pendencia as PendenciaInterna,
  MotivoInsuficiencia,
} from '../../../types/cobertura.js';
import type {
  ConfiancaResult as ConfiancaResultInterna,
  PendenciaCritica,
} from '../../../confianca/types.js';
import type {
  ErroDeMarcacao,
  VereditoResult as VereditoResultInterna,
} from '../../../veredito/types.js';
import type { EventoCaixa } from '../../../types/EventoCaixa.js';
import { ordenarPendencias } from '../helpers/ordenarPendencias.js';
import {
  severidadeMotivoInsuficiencia,
  severidadePorTipoCobertura,
} from '../helpers/mapearOrigem.js';
import { toAcaoSugerida } from './adaptarCobertura.js';
import type {
  OrigemPendencia,
  PendenciaCF13,
  SeveridadePendencia,
} from '../types.js';

export interface AdaptarPendenciasArgs {
  cobertura: CoberturaResultInterna;
  confianca: ConfiancaResultInterna;
  veredito: VereditoResultInterna;
  /** Janela do consolidado: `inicio` (ISO `YYYY-MM-DD`) por índice 1..13.
   *  Usada para `semanaId` em `Pendencia` (mapeia `semana_iso` →
   *  `inicio`) e em `PendenciaCritica` (mapeia índice 1..13). */
  janelaSemanaIso: readonly string[];
  janelaInicios: readonly string[];
  eventoIndex: ReadonlyMap<string, EventoCaixa>;
}

export function adaptarPendencias(
  args: AdaptarPendenciasArgs,
): PendenciaCF13[] {
  const {
    cobertura,
    confianca,
    veredito,
    janelaSemanaIso,
    janelaInicios,
    eventoIndex,
  } = args;

  /* `semana_iso → semanaId (ISO YYYY-MM-DD)` lookup. */
  const inicioPorSemanaIso = new Map<string, string>();
  for (let i = 0; i < janelaSemanaIso.length; i++) {
    inicioPorSemanaIso.set(janelaSemanaIso[i]!, janelaInicios[i]!);
  }

  /* Origem para pendências de cobertura — depende do status global interno. */
  const origemPendCobertura: OrigemPendencia =
    cobertura.status === 'cobertura_insuficiente' ? 'cobertura' : 'confianca';

  const out: PendenciaCF13[] = [];

  /* ─── (1) Motivos de insuficiência (cobertura, severidade crítica). ─── */
  for (const m of cobertura.motivosInsuficiencia) {
    out.push(adaptarMotivo(m));
  }

  /* ─── (2) Pendências de cobertura (origem depende do status). ─── */
  for (const p of cobertura.pendencias) {
    out.push(
      adaptarPendenciaCobertura(p, inicioPorSemanaIso, origemPendCobertura),
    );
  }

  /* ─── (3) Pendências críticas (Stage 6) — versão de unidade vence. ─── */
  /* Step 1: emite todas as versões por_unidade. Múltiplas unidades para
   *         o mesmo evento_id (transferência) são todas preservadas. */
  const evIdsComUnidade = new Set<string>();
  for (const u of confianca.por_unidade) {
    for (const p of u.pendencias_criticas) {
      evIdsComUnidade.add(p.evento_id);
      out.push(adaptarPendenciaCritica(p, eventoIndex, janelaInicios));
    }
  }
  /* Step 2: emite versões do consolidado APENAS quando não há nenhuma
   *         versão de unidade pro mesmo evento_id (caso degenerado —
   *         denominador da unidade promove pendência que o consolidado
   *         não emitiu, ou vice-versa). */
  for (const p of confianca.consolidado.pendencias_criticas) {
    if (evIdsComUnidade.has(p.evento_id)) continue;
    out.push(adaptarPendenciaCritica(p, eventoIndex, janelaInicios));
  }

  /* ─── (4) Erros de marcação (Stage 7) — origem 'confianca'. ─── */
  for (const e of veredito.erros_de_marcacao) {
    out.push(adaptarErroMarcacao(e));
  }

  return ordenarPendencias(out);
}

/* ─────────── Helpers de cada fonte ─────────── */

function adaptarMotivo(m: MotivoInsuficiencia): PendenciaCF13 {
  const severidade: SeveridadePendencia = severidadeMotivoInsuficiencia(m.tipo);
  const tituloPorTipo: Record<MotivoInsuficiencia['tipo'], string> = {
    saldo_abertura_ausente: 'Saldo de abertura ausente',
    banco_sem_dado_recente: 'Banco sem dado recente',
  };

  /* `acaoSugerida` opcional: primeira da lista. Pode estar vazia em
   *  casos degenerados — Stage 5 sempre popula, mas defensivo. */
  const acao = m.acoes_sugeridas[0];

  const pend: PendenciaCF13 = {
    id: `cob:motivo:${m.tipo}:${m.legal_entity_id}`,
    origem: 'cobertura',
    severidade,
    titulo: tituloPorTipo[m.tipo],
    detalhe: m.descricao,
    unidadeId: m.legal_entity_id,
  };
  /* `semanaId` ausente: motivos são da unidade como um todo (não de
   *  uma semana). */
  if (acao !== undefined) {
    pend.acaoSugerida = toAcaoSugerida(acao);
  }
  return pend;
}

function adaptarPendenciaCobertura(
  p: PendenciaInterna,
  inicioPorSemanaIso: ReadonlyMap<string, string>,
  origem: OrigemPendencia,
): PendenciaCF13 {
  const severidade = severidadePorTipoCobertura(p.tipo);

  const tituloPorTipo: Record<PendenciaInterna['tipo'], string> = {
    semana_zerada: 'Semana sem eventos',
    recorrencia_ausente: 'Recorrência esperada ausente',
    pendentes_classificacao_agregados: 'Eventos pendentes de classificação',
  };

  const acao = p.acoes_sugeridas[0];
  const semanaId = inicioPorSemanaIso.get(p.semana_iso);

  const pend: PendenciaCF13 = {
    id: `cob:pend:${p.id}`,
    origem,
    severidade,
    titulo: tituloPorTipo[p.tipo],
    detalhe: p.descricao,
    unidadeId: p.legal_entity_id,
  };
  if (semanaId !== undefined) {
    pend.semanaId = semanaId;
  }
  /* valorImpacto: `valor_total` (pendentes_classificacao_agregados) ou
   *  `valor_esperado` (recorrencia_ausente). semana_zerada não tem. */
  if (p.valor_total !== undefined) {
    pend.valorImpacto = p.valor_total;
  } else if (p.valor_esperado !== undefined) {
    pend.valorImpacto = p.valor_esperado;
  }
  if (acao !== undefined) {
    pend.acaoSugerida = toAcaoSugerida(acao);
  }
  return pend;
}

function adaptarPendenciaCritica(
  p: PendenciaCritica,
  eventoIndex: ReadonlyMap<string, EventoCaixa>,
  janelaInicios: readonly string[],
): PendenciaCF13 {
  /* `unidadeId`: LE real do evento (a `PendenciaCritica` do consolidado
   *  carrega `legal_entity_id = 'consolidado:<cliente_id>'`; só o
   *  evento sabe o LE original). */
  const ev = eventoIndex.get(p.evento_id);
  const unidadeId = ev?.legal_entity_id ?? p.legal_entity_id;

  /* `semanaId`: lookup `p.semana` (1..13) → janelaInicios[p.semana - 1]. */
  const idx = p.semana - 1;
  const semanaId =
    idx >= 0 && idx < janelaInicios.length ? janelaInicios[idx] : undefined;

  const tituloPorMotivo: Record<PendenciaCritica['motivo'], string> = {
    status_pendente: 'Saída pendente em semana próxima',
    criticidade_obrigatoria_critica_op_pendente:
      'Saída crítica/obrigatória pendente',
  };

  /* ID inclui o legal_entity_id da PendenciaCritica (escopo de origem)
   *  para distinguir versões da mesma pendência emitidas em escopos
   *  diferentes (caso de transferência: mesmas pendências em u1+u2). */
  const pend: PendenciaCF13 = {
    id: `conf:critica:${p.legal_entity_id}:${p.evento_id}:s${p.semana}`,
    origem: 'confianca',
    severidade: 'critica',
    titulo: tituloPorMotivo[p.motivo],
    detalhe: `Evento ${p.evento_id} (bucket ${p.bucket_id}, ${p.status}/${p.criticidade}).`,
    unidadeId,
    valorImpacto: p.valor,
  };
  if (semanaId !== undefined) {
    pend.semanaId = semanaId;
  }
  /* TODO: `acaoSugerida` indisponível — `PendenciaCritica` não carrega
   *  `acoes_sugeridas`. Telas downstream podem inferir do bucket/status. */
  return pend;
}

function adaptarErroMarcacao(e: ErroDeMarcacao): PendenciaCF13 {
  return {
    id: `conf:erro:${e.tipo}:${e.cliente_id}`,
    /* Origem `'confianca'` (não `'veredito'`): erro de marcação é
     *  problema de qualidade/classificação do dado. `'veredito'` no
     *  contrato fica reservado para pendências derivadas das categorias
     *  ALERTA/CRITICO emitidas pelo próprio Stage 7. */
    origem: 'confianca',
    severidade: 'media',
    titulo: 'Possível transferência interna mal marcada',
    detalhe: `Consolidado em risco mas todas as unidades aparentam OK — ${e.legal_entity_ids.join(', ')}.`,
    /* Sem `semanaId`, `unidadeId`, `valorImpacto`, `acaoSugerida` — erro
     *  é cross-unidade. */
  };
}
