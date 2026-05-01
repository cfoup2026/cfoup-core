import type {
  EventoCaixa,
  EventoConfirmado,
  EventoRealizado,
  PendenciaComercial,
  ReconciliacaoComercialEstatisticas,
  ReconciliacaoComercialResult,
  TipoPendenciaComercial,
  VendaComercial,
} from '../types/index.js';

/* ─────────── Constantes ─────────── */

const DAY_MS = 86_400_000;
/** Janela máxima quando há `documento_ref` igual nos dois lados.
 *  Cobre prazo B2B até 120 dias com folga, sem abrir falso-positivo
 *  de NF reaproveitada em ano fiscal seguinte. */
const JANELA_DIAS_FORTE = 120;
/** Janela quando `documento_ref` falta em algum lado. Sem chave forte,
 *  data carrega o ônus — ±45 dias entre `data_emissao` da venda e
 *  `data_vencimento` do AR. */
const JANELA_DIAS_FRACA = 45;
const TOLERANCIA_MIN_R$ = 5;
const TOLERANCIA_REL = 0.01;

/* ─────────── API pública ─────────── */

export interface ReconciliaVendasArOptions {
  /** Quando o run está sendo feito (injetado em testes). */
  reconciliadoEm: Date;
}

/**
 * AR (Conta a Receber) candidato — `confirmado` ou `realizado`, com
 * `data_vencimento` opcionalmente presente. Necessário para diferenciar
 * o lookup do tipo concreto sem repetir narrowing nos helpers.
 */
type EventoAr = EventoRealizado | EventoConfirmado;

/**
 * Reconciliação Vendas↔AR (Estágio 3.2 §3.D).
 *
 * Enrichment unilateral: vendas ganham `reconciliado_com` apontando
 * pro AR; AR não muda. Drill-down inverso vem por lookup
 * `vendas.find(v => v.reconciliado_com === ar.id)`.
 *
 * **Política de matching em duas vias:**
 *
 *  - **Via 1 (chave forte):** `documento_ref` presente E IGUAL em ambos
 *    os lados. Match exige mesma NF + mesmo cliente + valor em
 *    tolerância `max(R$ 5, 1%)`. Janela frouxa com teto duro:
 *    `data_vencimento` do AR no intervalo
 *    `[data_emissao, data_emissao + 120 dias]` da venda. Cobre prazo
 *    B2B longo sem reabrir NF reaproveitada em ciclo seguinte.
 *
 *  - **Via 2 (chave fraca):** todos os outros casos — `documento_ref`
 *    ausente em pelo menos um lado, OU presente em ambos mas vindos de
 *    domínios diferentes (ex: FKN grava NOTA na venda e DUPLICATA no
 *    AR). Match exige cliente + valor em tolerância + janela ±45 dias
 *    entre `data_emissao` da venda e `data_vencimento` do AR. Sem
 *    chave forte, data carrega o ônus.
 *
 * **AR sem `data_vencimento`** (raro em CR mas possível em
 * `realizado` direto): cai automaticamente em via fraca usando
 * `data_realizada` como aproximação do vencimento.
 *
 * **Política 1:1 estrita**: 2+ ARs candidatos → pendência
 * `venda_ambigua`. AR sem venda → pendência `ar_sem_venda`. Venda sem
 * AR → pendência `venda_sem_ar`. Política também aplicada em duplicidade:
 * AR já matched é filtrado dos candidatos da próxima venda.
 */
export function reconciliaVendasAr(
  vendas: readonly VendaComercial[],
  eventos: readonly EventoCaixa[],
  options: ReconciliaVendasArOptions,
): ReconciliacaoComercialResult {
  /* 1. Filtrar ARs: entrada + fkn + cliente. AR pode ser confirmado
   *    (em aberto) ou realizado (já recebido). */
  const ars: EventoAr[] = [];
  for (const e of eventos) {
    if (e.direcao !== 'entrada') continue;
    if (e.origem !== 'fkn') continue;
    if (e.contraparte_tipo !== 'cliente') continue;
    if (e.status === 'confirmado' || e.status === 'realizado') {
      ars.push(e);
    }
  }

  /* 2. Índice de ARs por (cliente_id|legal_entity_id|contraparte_id):
   *    venda com `contraparte_id` busca apenas ARs do mesmo cliente.
   *    Vendas sem `contraparte_id` (raras — ex: consumidor final) caem
   *    na lista completa. Sem essa redução, full Gregorutt itera
   *    ~7k×11k = ~77M comparações por run; com o índice, cai pra
   *    centenas. ARs sem `contraparte_id` ficam num pool separado para
   *    contemplar a regra "só checa contraparte se ambos têm". */
  const arsPorContraparte = new Map<string, EventoAr[]>();
  const arsSemContraparte: EventoAr[] = [];
  for (const ar of ars) {
    if (ar.contraparte_id !== undefined) {
      const key = `${ar.cliente_id}|${ar.legal_entity_id}|${ar.contraparte_id}`;
      const lista = arsPorContraparte.get(key);
      if (lista === undefined) arsPorContraparte.set(key, [ar]);
      else lista.push(ar);
    } else {
      arsSemContraparte.push(ar);
    }
  }

  /* 3. Ordem determinística das vendas: data_emissao asc, id lex. */
  const sortedVendas = [...vendas].sort((a, b) => {
    const dd = a.data_emissao.getTime() - b.data_emissao.getTime();
    if (dd !== 0) return dd;
    return a.id.localeCompare(b.id);
  });

  /* 4. Matching */
  const matchedArIds = new Set<string>();
  const vendasOut: VendaComercial[] = [];
  const pendencias: PendenciaComercial[] = [];
  let matches = 0;
  let vendasSemAr = 0;
  let ambiguidades = 0;

  // Primeiro, índice de vendas processadas (mantém ordem original do input).
  const reconciliadasMap = new Map<string, VendaComercial>();

  for (const venda of sortedVendas) {
    /* Subset relevante de ARs:
     *  - Venda com contraparte_id: busca por chave (cliente|le|contra)
     *    + sempre inclui ARs sem contraparte (regra: só checa quando
     *    ambos têm).
     *  - Venda sem contraparte_id: itera tudo. */
    let arsRelevantes: EventoAr[];
    if (venda.contraparte_id !== undefined) {
      const key = `${venda.cliente_id}|${venda.legal_entity_id}|${venda.contraparte_id}`;
      const comContra = arsPorContraparte.get(key) ?? [];
      arsRelevantes =
        arsSemContraparte.length === 0
          ? comContra
          : [...comContra, ...arsSemContraparte];
    } else {
      arsRelevantes = ars;
    }
    const candidates = findCandidates(venda, arsRelevantes, matchedArIds);

    if (candidates.length === 0) {
      pendencias.push(
        buildPendenciaComercial(
          'venda_sem_ar',
          [venda.id],
          [],
          options.reconciliadoEm,
        ),
      );
      vendasSemAr += 1;
      continue;
    }

    if (candidates.length >= 2) {
      pendencias.push(
        buildPendenciaComercial(
          'venda_ambigua',
          [venda.id],
          candidates.map((c) => c.id),
          options.reconciliadoEm,
        ),
      );
      ambiguidades += 1;
      continue;
    }

    // 1 candidato livre → match.
    const ar = candidates[0]!;
    const reconciliada = addReconciliacaoVenda(
      venda,
      ar.id,
      options.reconciliadoEm,
    );
    reconciliadasMap.set(venda.id, reconciliada);
    matchedArIds.add(ar.id);
    matches += 1;
  }

  /* 4. Compor vendas finais preservando ordem de input. */
  for (const v of vendas) {
    vendasOut.push(reconciliadasMap.get(v.id) ?? v);
  }

  /* 5. ARs órfãos: pendência ar_sem_venda. Determinístico (ordenado por id). */
  let arSemVenda = 0;
  const arsOrdenados = [...ars].sort((a, b) => a.id.localeCompare(b.id));
  for (const ar of arsOrdenados) {
    if (matchedArIds.has(ar.id)) continue;
    pendencias.push(
      buildPendenciaComercial(
        'ar_sem_venda',
        [],
        [ar.id],
        options.reconciliadoEm,
      ),
    );
    arSemVenda += 1;
  }

  const estatisticas: ReconciliacaoComercialEstatisticas = {
    vendasOriginais: vendas.length,
    arFiltrados: ars.length,
    matchesAplicados: matches,
    vendasSemAr,
    arSemVenda,
    ambiguidades,
  };

  return {
    vendas: vendasOut,
    pendencias,
    reconciliadoEm: options.reconciliadoEm,
    estatisticas,
  };
}

/* ─────────── Helpers internos ─────────── */

/** Tolerância máxima absoluta de valor entre venda e AR. */
function tolerancia(valorRef: number): number {
  return Math.max(TOLERANCIA_MIN_R$, valorRef * TOLERANCIA_REL);
}

/**
 * Data de referência do AR para a janela temporal. AR `confirmado` usa
 * `data_vencimento`; `realizado` cai em `data_vencimento` quando
 * presente, senão `data_realizada`.
 */
function dataReferenciaAr(ar: EventoAr): Date {
  if (ar.status === 'confirmado') return ar.data_vencimento;
  // realizado: prefere data_vencimento, fallback data_realizada.
  return ar.data_vencimento ?? ar.data_realizada;
}

/**
 * Busca ARs candidatos para uma venda. Aplica política de duas vias
 * (forte/fraca) baseada na presença de `documento_ref`. Filtra ARs
 * já matched (1:1 estrita).
 */
function findCandidates(
  venda: VendaComercial,
  ars: ReadonlyArray<EventoAr>,
  matched: ReadonlySet<string>,
): EventoAr[] {
  const out: EventoAr[] = [];
  const emissaoMs = venda.data_emissao.getTime();
  const tol = tolerancia(venda.valor);

  for (const ar of ars) {
    if (matched.has(ar.id)) continue;
    if (ar.cliente_id !== venda.cliente_id) continue;
    if (ar.legal_entity_id !== venda.legal_entity_id) continue;

    // Contraparte: só checada se ambos têm.
    if (
      venda.contraparte_id !== undefined &&
      ar.contraparte_id !== undefined &&
      venda.contraparte_id !== ar.contraparte_id
    ) {
      continue;
    }

    // Tolerância de valor (mesma fórmula nas duas vias).
    if (Math.abs(ar.valor - venda.valor) > tol) continue;

    const arDocRef = ar.documento_ref;
    const refMs = dataReferenciaAr(ar).getTime();

    const ambosTemDocRef =
      venda.documento_ref !== undefined && arDocRef !== undefined;
    const docRefsBatem =
      ambosTemDocRef && venda.documento_ref === arDocRef;

    if (docRefsBatem) {
      // Via 1 — chave forte. Janela frouxa com teto duro:
      // AR.dataRef em [emissao, emissao + 120 dias].
      const diff = refMs - emissaoMs;
      if (diff < 0 || diff > JANELA_DIAS_FORTE * DAY_MS) continue;
    } else {
      // Via 2 — chave fraca. Cobre 3 sub-casos:
      //  (a) venda sem doc_ref;
      //  (b) AR sem doc_ref;
      //  (c) ambos com doc_ref mas vindos de domínios diferentes
      //      (ex: FKN registra NOTA na venda e DUPLICATA no AR).
      // Janela ±45 dias entre data_emissao e dataRef do AR.
      const diff = Math.abs(refMs - emissaoMs);
      if (diff > JANELA_DIAS_FRACA * DAY_MS) continue;
    }

    out.push(ar);
  }

  return out;
}

/**
 * Clona uma `VendaComercial` adicionando `reconciliado_com`/
 * `reconciliado_em`. Imutável — input nunca é mutado.
 */
function addReconciliacaoVenda(
  v: VendaComercial,
  arId: string,
  reconciliadoEm: Date,
): VendaComercial {
  const clone: VendaComercial = {
    id: v.id,
    cliente_id: v.cliente_id,
    legal_entity_id: v.legal_entity_id,
    origem: v.origem,
    origem_ref: v.origem_ref,
    data_emissao: v.data_emissao,
    valor: v.valor,
    contraparte_tipo: v.contraparte_tipo,
    prazo: v.prazo,
    criado_em: v.criado_em,
    criado_por: v.criado_por,
    reconciliado_com: arId,
    reconciliado_em: reconciliadoEm,
  };
  if (v.source_company_code !== undefined)
    clone.source_company_code = v.source_company_code;
  if (v.documento_ref !== undefined) clone.documento_ref = v.documento_ref;
  if (v.contraparte_id !== undefined) clone.contraparte_id = v.contraparte_id;
  return clone;
}

/**
 * Constrói uma `PendenciaComercial` com ID determinístico baseado em
 * `(tipo, vendas_ordenadas, ars_ordenados)`.
 */
function buildPendenciaComercial(
  tipo: TipoPendenciaComercial,
  vendas: readonly string[],
  ars: readonly string[],
  detectado_em: Date,
): PendenciaComercial {
  const v = [...vendas].sort();
  const a = [...ars].sort();
  const id = `pendc_${tipo}_${[...v, ...a].join('_')}`;
  return {
    id,
    tipo,
    descricao: descricaoFor(tipo, v, a),
    vendas_relacionadas: v,
    ar_relacionados: a,
    detectado_em,
  };
}

/** Descrições determinísticas (sem storytelling). */
function descricaoFor(
  tipo: TipoPendenciaComercial,
  vendas: readonly string[],
  ars: readonly string[],
): string {
  switch (tipo) {
    case 'venda_sem_ar':
      return `Venda sem AR equivalente`;
    case 'ar_sem_venda':
      return `AR sem venda comercial associada`;
    case 'venda_ambigua':
      return `Venda com ${ars.length} ARs candidatos (ids: ${vendas[0] ?? ''})`;
  }
}
