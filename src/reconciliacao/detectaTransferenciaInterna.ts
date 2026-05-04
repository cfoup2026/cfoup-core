import type {
  EventoCaixa,
  EventoRealizado,
  PendenciaReconciliacao,
} from '../types/index.js';
import { ReconciliacaoError } from '../types/index.js';

/* ─────────── Constantes ─────────── */

const DAY_MS = 86_400_000;
/** Janela apertada de transferência interna: ±2 dias entre as duas
 *  pernas. Transferência bancária é precisa — não há tolerância de 5 dias
 *  como em banco↔CP/CR. */
const JANELA_DIAS_TRANSFER = 2;
/** Tolerância de valor: apenas centavos (R$ 0.02). Transferência tem
 *  valor exato — diferenças maiores indicam evento independente, não
 *  par de transferência. */
const TOLERANCIA_CENTAVOS = 0.02;

/* ─────────── API pública ─────────── */

export interface DetectaTransferenciaOptions {
  /** Quando o run está sendo feito (injetado em testes). Usado em
   *  pendências como `detectado_em`. */
  detectadoEm: Date;
}

export interface DetectaTransferenciaResult {
  /**
   * Eventos pós-detecção. Pares casados recebem `is_transferencia=true`
   * e `transferencia_par_id` cruzado. Eventos não pareados ficam intocados
   * (mantêm `is_transferencia=false` do estágio 1.2).
   */
  eventos: EventoCaixa[];
  /** Pendências `transferencia_ambigua` (1 perna A ↔ 2+ pernas B). */
  pendencias: PendenciaReconciliacao[];
  /** Quantidade de pares 1:1 marcados (cada par conta como 1, não 2). */
  paresDetectados: number;
}

/**
 * Detecção de transferência interna (Estágio 3.2 §3.A).
 *
 * Identifica pares de eventos opostos entre duas `legal_entity_id`s do
 * mesmo `cliente_id` e marca ambos com `is_transferencia=true` +
 * `transferencia_par_id` cruzado.
 *
 * **Critérios estritos** (mais apertados que banco↔CP/CR):
 *  - Ambas as pernas em status `realizado`.
 *  - Mesmo `cliente_id` (transferência só vale dentro do tenant).
 *  - `legal_entity_id` diferentes (intra-unidade NÃO é transferência interna).
 *  - `direcao` opostas (uma `entrada`, outra `saida`).
 *  - `valor` exato com tolerância apenas de centavos (`±R$ 0.02`).
 *  - `data_realizada` dentro de ±2 dias.
 *
 * **Política 1:1 estrita:** se uma perna A casa com 2+ pernas B, NADA
 * é marcado e gera-se pendência `transferencia_ambigua`.
 *
 * **Imutável:** clona eventos casados (não muta input). Eventos não
 * pareados retornam por referência — sem cópia desnecessária.
 *
 * **Fail visibly:** evento `realizado` sem `data_realizada` válida
 * lança `ReconciliacaoError`.
 */
export function detectaTransferenciaInterna(
  eventos: readonly EventoCaixa[],
  options: DetectaTransferenciaOptions,
): DetectaTransferenciaResult {
  /* 1. Particionar e validar */
  const realizados: EventoRealizado[] = [];
  const naoElegiveis: EventoCaixa[] = [];

  for (const e of eventos) {
    if (e.status === 'realizado') {
      const dr = e.data_realizada;
      if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) {
        throw new ReconciliacaoError(
          `evento ${e.id}: realizado sem data_realizada válida`,
        );
      }
      realizados.push(e);
    } else {
      naoElegiveis.push(e);
    }
  }

  /* 2. Agrupar por cliente_id (transferência só dentro do tenant) */
  const porCliente = new Map<string, EventoRealizado[]>();
  for (const ev of realizados) {
    const lista = porCliente.get(ev.cliente_id);
    if (lista === undefined) {
      porCliente.set(ev.cliente_id, [ev]);
    } else {
      lista.push(ev);
    }
  }

  /* 3. Detectar pares por cliente — duas passadas pra evitar greedy:
   *    P1) construir mapa de candidatos por evento;
   *    P2) identificar ambiguidades (degree ≥ 2) e bloquear envolvidos;
   *    P3) casar 1:1 apenas pares mutuamente exclusivos.
   *    Sem isso, um evento com degree 1 cuja única ponta tem degree ≥ 2
   *    consumiria a ambiguidade silenciosamente. */
  const matched = new Map<string, string>(); // ev.id → par_id
  const pendencias: PendenciaReconciliacao[] = [];

  // Ordem determinística entre clientes para evitar dependência de insertion order.
  const clienteIds = [...porCliente.keys()].sort();

  for (const cliId of clienteIds) {
    const grupo = porCliente.get(cliId)!;
    // Ordem determinística dentro do grupo: data_realizada asc, id lex.
    const ordenado = [...grupo].sort((a, b) => {
      const dd = a.data_realizada.getTime() - b.data_realizada.getTime();
      if (dd !== 0) return dd;
      return a.id.localeCompare(b.id);
    });

    /* P1) candidatos por evento (relação simétrica). */
    const candidatosMap = new Map<string, EventoRealizado[]>();
    for (const a of ordenado) {
      const cands: EventoRealizado[] = [];
      for (const b of ordenado) {
        if (b.id === a.id) continue;
        if (b.legal_entity_id === a.legal_entity_id) continue;
        if (b.direcao === a.direcao) continue;
        if (Math.abs(b.valor - a.valor) > TOLERANCIA_CENTAVOS) continue;
        const diffMs = Math.abs(
          b.data_realizada.getTime() - a.data_realizada.getTime(),
        );
        if (diffMs > JANELA_DIAS_TRANSFER * DAY_MS) continue;
        cands.push(b);
      }
      candidatosMap.set(a.id, cands);
    }

    /* P2) ambiguidades: eventos com 2+ candidatos. Pendência única por
     *     grupo (dedup por chave ordenada de ids). Todos os envolvidos
     *     ficam bloqueados — não entram em match. */
    const blocked = new Set<string>();
    const pendKeysVistas = new Set<string>();
    for (const a of ordenado) {
      const cands = candidatosMap.get(a.id)!;
      if (cands.length < 2) continue;
      const ids = [a.id, ...cands.map((c) => c.id)].sort();
      const key = ids.join('_');
      if (!pendKeysVistas.has(key)) {
        pendKeysVistas.add(key);
        pendencias.push({
          id: `pend_transferencia_ambigua_${key}`,
          tipo: 'transferencia_ambigua',
          descricao: `Transferência ambígua: 1 perna com ${cands.length} candidatos opostos`,
          eventos_relacionados: ids,
          detectado_em: options.detectadoEm,
        });
      }
      for (const id of ids) blocked.add(id);
    }

    /* P3) match 1:1 mutuamente exclusivo. */
    for (const a of ordenado) {
      if (blocked.has(a.id) || matched.has(a.id)) continue;
      const cands = candidatosMap.get(a.id)!;
      if (cands.length !== 1) continue;
      const b = cands[0]!;
      if (blocked.has(b.id) || matched.has(b.id)) continue;
      // Mutualidade: candidatos de B (não-bloqueados, não-matched) deve
      // ser exatamente {a}. Como a relação é simétrica e ambos passaram
      // por P2, é garantido — mas a checagem deixa o algoritmo robusto.
      const bCands = candidatosMap
        .get(b.id)!
        .filter((x) => !blocked.has(x.id) && !matched.has(x.id));
      if (bCands.length !== 1 || bCands[0]!.id !== a.id) continue;
      matched.set(a.id, b.id);
      matched.set(b.id, a.id);
    }
  }

  /* 4. Compor output: clonar eventos casados, manter os outros por referência */
  const eventosOut: EventoCaixa[] = [];
  for (const ev of realizados) {
    const par = matched.get(ev.id);
    if (par !== undefined) {
      eventosOut.push(marcarTransferencia(ev, par));
    } else {
      eventosOut.push(ev);
    }
  }
  for (const ne of naoElegiveis) eventosOut.push(ne);

  return {
    eventos: eventosOut,
    pendencias,
    paresDetectados: matched.size / 2,
  };
}

/* ─────────── Helpers internos ─────────── */

/**
 * Clona um `EventoRealizado` com `is_transferencia=true` e
 * `transferencia_par_id` setado. Imutável — input nunca é mutado.
 *
 * `exactOptionalPropertyTypes` exige preservar o set de optionals
 * presentes no original.
 */
function marcarTransferencia(
  ev: EventoRealizado,
  parId: string,
): EventoRealizado {
  const clone: EventoRealizado = {
    id: ev.id,
    valor: ev.valor,
    direcao: ev.direcao,
    data_esperada: ev.data_esperada,
    bucket_id: ev.bucket_id,
    bucket_nome: ev.bucket_nome,
    cliente_id: ev.cliente_id,
    legal_entity_id: ev.legal_entity_id,
    origem: ev.origem,
    criticidade: ev.criticidade,
    confianca: ev.confianca,
    confianca_origem: ev.confianca_origem,
    is_transferencia: true,
    criado_em: ev.criado_em,
    criado_por: ev.criado_por,
    status: 'realizado',
    data_realizada: ev.data_realizada,
    transferencia_par_id: parId,
  };

  if (ev.data_vencimento !== undefined) clone.data_vencimento = ev.data_vencimento;
  if (ev.contraparte_id !== undefined) clone.contraparte_id = ev.contraparte_id;
  if (ev.contraparte_tipo !== undefined)
    clone.contraparte_tipo = ev.contraparte_tipo;
  if (ev.source_company_code !== undefined)
    clone.source_company_code = ev.source_company_code;
  if (ev.origem_ref !== undefined) clone.origem_ref = ev.origem_ref;
  if (ev.documento_ref !== undefined) clone.documento_ref = ev.documento_ref;
  if (ev.confirmado_por !== undefined) clone.confirmado_por = ev.confirmado_por;
  if (ev.confirmado_em !== undefined) clone.confirmado_em = ev.confirmado_em;
  if (ev.competencia !== undefined) clone.competencia = ev.competencia;
  if (ev.cenario_id !== undefined) clone.cenario_id = ev.cenario_id;
  if (ev.observacao !== undefined) clone.observacao = ev.observacao;
  if (ev.reconciliado_com !== undefined)
    clone.reconciliado_com = ev.reconciliado_com;
  if (ev.reconciliado_em !== undefined)
    clone.reconciliado_em = ev.reconciliado_em;
  if (ev.descricao_origem !== undefined)
    clone.descricao_origem = ev.descricao_origem;
  if (ev.contraparte_nome_origem !== undefined)
    clone.contraparte_nome_origem = ev.contraparte_nome_origem;
  if (ev.conta_origem_nome !== undefined)
    clone.conta_origem_nome = ev.conta_origem_nome;

  return clone;
}
