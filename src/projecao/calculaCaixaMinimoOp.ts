/**
 * Estágio 4.3 — Caixa mínimo operacional semanal.
 *
 * Fórmula §5 do spec CF13:
 *
 * ```
 * caixa_minimo_op(semana_n) = soma(eventos onde:
 *     direcao = saida
 *     AND status IN (confirmado, estimado)
 *     AND criticidade IN (obrigatoria, critica_op)
 *     AND is_transferencia = false
 *     AND allocationDate ENTRE inicio(semana_n+1) E fim(semana_n+2)
 * ) × (1 + margem_seguranca)
 * ```
 *
 * Margem:
 *  - `qualidade='alta'` (n_periodos ≥ 12) E `cv` presente → `min(cv, 0.25)`.
 *  - Caso contrário → `0.10` (fallback). Inclui `volatilidades` ausente
 *    ou unidade sem entrada no Map.
 *
 * **Stage 4 não decide nada além do número.** Não compara com
 * `caixa_final`, não emite alerta, não rebaixa confiança. Stage 5/6/7
 * é quem lê e julga.
 *
 * **Limitação aceita** (§4 do spec): mínimo das semanas 12-13 olha
 * para n+1/n+2 = semanas 13/14/15. Eventos da semana 14-15 não foram
 * alocados pelo 4.1 (janela = 13), então **não entram** na soma.
 * Mínimo das duas últimas semanas é subestimado por construção.
 * Refinamento (alocar 15 semanas, expor 13, usar 14-15 só pra mínimo)
 * é v0.1.
 */
import type {
  CaixaMinimoOpProvenance,
  CaixaMinimoOpProvenancePorUnidade,
  EventoCaixa,
  EventoCaixaBase,
  ProjecaoCliente,
  ProjecaoConsolidada,
  ProjecaoUnidade,
  SemanaProjecao,
  VolatilidadeStats,
} from '../types/index.js';
import { ProjecaoError } from '../types/projecao.js';
import { semanaIsoOf } from './semanas.js';

const HORIZONTE = 2;
const TETO_MARGEM = 0.25;
const FALLBACK_MARGEM = 0.1;

/**
 * Critérios elegíveis (§4 do spec):
 *  - direcao=saida
 *  - status ∈ (confirmado, estimado)
 *  - criticidade ∈ (obrigatoria, critica_op)
 *  - is_transferencia=false
 *
 * `realizado` (fato consumado), `pendente` (dado incompleto), entrada
 * e transferência interna ficam fora.
 */
const STATUSES_ELEGIVEIS = new Set<EventoCaixa['status']>([
  'confirmado',
  'estimado',
]);
const CRITICIDADES_ELEGIVEIS = new Set<EventoCaixaBase['criticidade']>([
  'obrigatoria',
  'critica_op',
]);

export interface CalculaCaixaMinimoOpInput {
  unidades: readonly ProjecaoUnidade[];
  consolidado: ProjecaoConsolidada;
  /** Map `legal_entity_id → VolatilidadeStats` (Stage 2.1).
   *  Ausente → todas unidades caem em `fallback_10pct`. */
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>;
  /** Eventos originais (do Stage 3 reconciliado, antes da projeção).
   *  Necessário para resolver `criticidade`/`direcao`/`is_transferencia`,
   *  já que `ProjecaoUnidade` só guarda IDs em `evento_ids`. */
  eventosOriginais: readonly EventoCaixa[];
}

export interface CalculaCaixaMinimoOpOutput {
  unidades: ProjecaoUnidade[];
  consolidado: ProjecaoConsolidada;
}

/**
 * Função pura: NÃO muta input. Retorna NOVAS instâncias de
 * `ProjecaoUnidade` e `ProjecaoConsolidada` com `caixa_minimo_op` e
 * `caixa_minimo_op_provenance` populados em cada `SemanaProjecao`.
 *
 * @throws `ProjecaoError` em volatilidade com `cv` negativo.
 */
export function calculaCaixaMinimoOp(
  input: CalculaCaixaMinimoOpInput,
): CalculaCaixaMinimoOpOutput {
  /* Validação defensiva: volatilidades com cv negativo são erro. */
  if (input.volatilidades !== undefined) {
    for (const [le, stats] of input.volatilidades) {
      if (stats.cv < 0) {
        throw new ProjecaoError(
          `volatilidade ${le}: cv negativo (${stats.cv})`,
        );
      }
    }
  }

  // Index global de eventos por id — lookup O(1) para resolver
  // criticidade/direcao/is_transferencia a partir de evento_ids.
  const eventoPorId = new Map<string, EventoCaixa>();
  for (const ev of input.eventosOriginais) {
    eventoPorId.set(ev.id, ev);
  }

  /* ─── Computa caixa_minimo_op por unidade ─── */
  const novasUnidades: ProjecaoUnidade[] = input.unidades.map((u) =>
    computaUnidade(u, eventoPorId, input.volatilidades),
  );

  /* ─── Compõe consolidado a partir das novas unidades ─── */
  const novoConsolidado = computaConsolidado(
    input.consolidado,
    novasUnidades,
  );

  return { unidades: novasUnidades, consolidado: novoConsolidado };
}

/**
 * Versão "in-place" para integração com `projetaCliente`. Recebe a
 * `ProjecaoCliente` e devolve uma nova `ProjecaoCliente` com o mínimo
 * preenchido. Wrapper sobre `calculaCaixaMinimoOp`.
 */
export function aplicaCaixaMinimoOpEm(
  projecao: ProjecaoCliente,
  eventosOriginais: readonly EventoCaixa[],
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>,
): ProjecaoCliente {
  const opts: CalculaCaixaMinimoOpInput = {
    unidades: projecao.unidades,
    consolidado: projecao.consolidado,
    eventosOriginais,
  };
  if (volatilidades !== undefined) opts.volatilidades = volatilidades;
  const r = calculaCaixaMinimoOp(opts);
  return {
    cliente_id: projecao.cliente_id,
    geradoEm: projecao.geradoEm,
    unidades: r.unidades,
    consolidado: r.consolidado,
  };
}

/* ─────────── Helpers internos ─────────── */

interface ResolucaoMargem {
  margem_aplicada: number;
  margem_origem: 'volatilidade_alta' | 'fallback_10pct';
  volatilidade_cv?: number;
}

function resolveMargem(
  legal_entity_id: string,
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>,
): ResolucaoMargem {
  if (volatilidades === undefined) {
    return { margem_aplicada: FALLBACK_MARGEM, margem_origem: 'fallback_10pct' };
  }
  const stats = volatilidades.get(legal_entity_id);
  if (stats === undefined) {
    return { margem_aplicada: FALLBACK_MARGEM, margem_origem: 'fallback_10pct' };
  }
  if (stats.qualidade !== 'alta') {
    return { margem_aplicada: FALLBACK_MARGEM, margem_origem: 'fallback_10pct' };
  }
  // Teto duro 25% mesmo com CV maior.
  const margem = Math.min(stats.cv, TETO_MARGEM);
  return {
    margem_aplicada: margem,
    margem_origem: 'volatilidade_alta',
    volatilidade_cv: stats.cv,
  };
}

/**
 * Para cada `semana_n` da unidade, soma eventos elegíveis cuja
 * `allocationDate` cai em `[semana_{n+1}, semana_{n+2}]`. Aplica margem
 * uniforme da unidade.
 */
function computaUnidade(
  unidade: ProjecaoUnidade,
  eventoPorId: ReadonlyMap<string, EventoCaixa>,
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>,
): ProjecaoUnidade {
  const margem = resolveMargem(unidade.legal_entity_id, volatilidades);

  // Index `semana_iso → idx` (mesmo da janela; já existe nas semanas).
  const idxByWeek = new Map<string, number>();
  for (let i = 0; i < unidade.janela.length; i++) {
    idxByWeek.set(unidade.janela[i]!, i);
  }

  // Para cada idx de semana, lista de eventos elegíveis ALOCADOS naquela semana.
  // (Vamos usar isso para somar a base de cada semana_n com horizonte +1/+2.)
  const eventosElegiveisPorSemanaIdx: { id: string; valor: number }[][] =
    unidade.janela.map(() => []);

  for (const [eventoId, allocDate] of unidade.allocationDatesByEventoId) {
    const ev = eventoPorId.get(eventoId);
    if (ev === undefined) continue; // não deveria ocorrer
    if (ev.legal_entity_id !== unidade.legal_entity_id) continue;
    if (!isElegivel(ev)) continue;
    // Atrasado/fora_janela já foram excluídos do allocationDatesByEventoId
    // de eventos *na grade*? Não — o map cobre TODOS com data calculável.
    // Filtramos aqui pelos que caem dentro da janela:
    const semana_iso = semanaIsoOf(allocDate);
    const idx = idxByWeek.get(semana_iso);
    if (idx === undefined) continue; // atrasado/fora da janela
    eventosElegiveisPorSemanaIdx[idx]!.push({ id: eventoId, valor: ev.valor });
  }

  // Para cada semana_n, soma eventos das semanas n+1 e n+2.
  const novasSemanas: SemanaProjecao[] = unidade.semanas.map((sem, n) => {
    let base = 0;
    const ids: string[] = [];
    for (let h = 1; h <= HORIZONTE; h++) {
      const target = n + h;
      if (target >= unidade.janela.length) {
        // Limitação documentada: eventos das semanas 14-15 não foram
        // alocados pelo 4.1, então não entram aqui. Mínimo de semanas
        // 12-13 é subestimado.
        continue;
      }
      const eventos = eventosElegiveisPorSemanaIdx[target]!;
      for (const e of eventos) {
        base += e.valor;
        ids.push(e.id);
      }
    }
    ids.sort((a, b) => a.localeCompare(b));
    const caixa_minimo_op = base * (1 + margem.margem_aplicada);
    const provenance: CaixaMinimoOpProvenance = {
      margem_aplicada: margem.margem_aplicada,
      margem_origem: margem.margem_origem,
      base_pre_margem: base,
      eventos_considerados_ids: ids,
    };
    if (margem.volatilidade_cv !== undefined) {
      provenance.volatilidade_cv = margem.volatilidade_cv;
    }
    return {
      ...sem,
      caixa_minimo_op,
      caixa_minimo_op_provenance: provenance,
    };
  });

  return { ...unidade, semanas: novasSemanas };
}

function isElegivel(ev: EventoCaixa): boolean {
  if (ev.direcao !== 'saida') return false;
  if (!STATUSES_ELEGIVEIS.has(ev.status)) return false;
  if (!CRITICIDADES_ELEGIVEIS.has(ev.criticidade)) return false;
  if (ev.is_transferencia === true) return false;
  return true;
}

/**
 * Consolidado = soma direta dos `caixa_minimo_op` por unidade
 * (não recalcula CV global). `por_unidade` na provenance permite
 * drill-down completo: cada unidade aparece com sua margem de origem.
 */
function computaConsolidado(
  consolidado: ProjecaoConsolidada,
  unidades: ProjecaoUnidade[],
): ProjecaoConsolidada {
  // Index unidade.semanas por semana_iso, idx → semana — todas as
  // unidades têm a mesma janela do consolidado (4.1 garante).
  const novasSemanas: SemanaProjecao[] = consolidado.semanas.map(
    (sem, idx) => {
      let caixa_minimo_op = 0;
      let base_pre_margem_total = 0;
      const idsUniao = new Set<string>();
      const por_unidade = new Map<string, CaixaMinimoOpProvenancePorUnidade>();

      for (const u of unidades) {
        const semU = u.semanas[idx];
        if (semU === undefined) continue;
        caixa_minimo_op += semU.caixa_minimo_op;
        base_pre_margem_total += semU.caixa_minimo_op_provenance.base_pre_margem;
        for (const id of semU.caixa_minimo_op_provenance.eventos_considerados_ids) {
          idsUniao.add(id);
        }
        const detalhe: CaixaMinimoOpProvenancePorUnidade = {
          margem_aplicada: semU.caixa_minimo_op_provenance.margem_aplicada,
          // Em unidade, a origem é sempre 'volatilidade_alta' ou 'fallback_10pct'.
          // Defesa: se chegar 'agregado_por_unidade' (não deveria), cai em fallback.
          margem_origem:
            semU.caixa_minimo_op_provenance.margem_origem === 'volatilidade_alta'
              ? 'volatilidade_alta'
              : 'fallback_10pct',
          base_pre_margem: semU.caixa_minimo_op_provenance.base_pre_margem,
        };
        if (semU.caixa_minimo_op_provenance.volatilidade_cv !== undefined) {
          detalhe.volatilidade_cv =
            semU.caixa_minimo_op_provenance.volatilidade_cv;
        }
        por_unidade.set(u.legal_entity_id, detalhe);
      }

      const margem_efetiva =
        base_pre_margem_total > 0
          ? (caixa_minimo_op - base_pre_margem_total) / base_pre_margem_total
          : 0;

      const provenance: CaixaMinimoOpProvenance = {
        margem_aplicada: margem_efetiva,
        margem_origem: 'agregado_por_unidade',
        base_pre_margem: base_pre_margem_total,
        eventos_considerados_ids: [...idsUniao].sort((a, b) =>
          a.localeCompare(b),
        ),
        por_unidade,
      };

      return {
        ...sem,
        caixa_minimo_op,
        caixa_minimo_op_provenance: provenance,
      };
    },
  );

  return { ...consolidado, semanas: novasSemanas };
}
