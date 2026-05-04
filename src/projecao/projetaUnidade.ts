/**
 * Estágio 4.1 — Projeção semanal por unidade.
 *
 * Aloca `EventoCaixa[]` em 13 semanas ISO a partir de `geradoEm`,
 * por `legal_entity_id`. Calcula `caixa_inicial`/`entradas`/`saidas`/
 * `caixa_final` com roll-forward determinístico.
 *
 * Fora de escopo desta etapa:
 *  - Consolidação por `cliente_id` (4.2).
 *  - Neutralização de transferência interna (4.2).
 *  - Caixa mínimo operacional (4.3).
 *  - Veredito (Stage 7).
 *
 * Imutabilidade absoluta: `EventoCaixa` que entra é o mesmo que sai.
 * `allocationDate` (resultado do hook + calendário) vive em
 * `ProjecaoUnidade.allocationDatesByEventoId`.
 */
import { deriveDataEsperada } from '../calendar/deriveDataEsperada.js';
import type {
  CaixaInicial,
  EventoCaixa,
  OpeningBalanceSnapshot,
  ProjecaoUnidade,
  ProjecaoUnidadeEstatisticas,
  ProjetaUnidadeInput,
  SemanaProjecao,
} from '../types/index.js';
import { ProjecaoError } from '../types/projecao.js';
import {
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanaIsoOf,
  semanasJanela,
} from './semanas.js';

const JANELA_SEMANAS = 13;
const STALE_DIAS = 7;
const DAY_MS = 86_400_000;

/**
 * Função pura. Mesma entrada + `geradoEm` → mesma saída (`deepEqual`).
 *
 * @throws `ProjecaoError` em input inválido (realizado sem
 *   `data_realizada`, `geradoEm`/`calendar` ausentes).
 */
export function projetaUnidade(input: ProjetaUnidadeInput): ProjecaoUnidade {
  /* ─── 1. Validação de input ─── */
  if (!(input.geradoEm instanceof Date) || Number.isNaN(input.geradoEm.getTime())) {
    throw new ProjecaoError('projetaUnidade: geradoEm ausente ou inválido');
  }
  if (
    input.calendar === null ||
    input.calendar === undefined ||
    typeof input.calendar.isBusinessDay !== 'function'
  ) {
    throw new ProjecaoError('projetaUnidade: calendar ausente ou inválido');
  }

  /* ─── 2. Filtro por unidade ─── */
  const eventosUnidade = input.eventos.filter(
    (e) =>
      e.cliente_id === input.cliente_id &&
      e.legal_entity_id === input.legal_entity_id,
  );

  /* ─── 3. Janela de 13 semanas ISO ─── */
  const janela = semanasJanela(input.geradoEm, JANELA_SEMANAS);
  const inicioSemana1 = inicioDaSemanaIso(janela[0]!);
  const fimSemana13 = fimDaSemanaIso(janela[JANELA_SEMANAS - 1]!);

  /* ─── 4. Caixa inicial ─── */
  const caixaInicial = computaCaixaInicial(
    input.saldos,
    input.cliente_id,
    input.legal_entity_id,
    input.geradoEm,
  );

  /* ─── 5. allocationDate por evento ─── */
  const allocationDatesByEventoId = new Map<string, Date>();
  const eventosNaoAlocados: string[] = [];
  let confirmadosComHookAplicado = 0;

  // Hook conta para QUALQUER confirmado da unidade onde a contraparte
  // tem padrao_estavel + mediana ≠ 0 — mesmo se calendário coincidir
  // o resultado, o hook ATUOU.
  for (const ev of eventosUnidade) {
    const allocDate = computaAllocationDate(ev, input);
    if (allocDate === null) {
      eventosNaoAlocados.push(ev.id);
      continue;
    }
    allocationDatesByEventoId.set(ev.id, allocDate);
    if (
      ev.status === 'confirmado' &&
      hookAtuouEm(ev.contraparte_id, input.contraparteHistory)
    ) {
      confirmadosComHookAplicado += 1;
    }
  }

  /* ─── 6. Bucketização ─── */
  // Index `semana_iso → array index` pra lookup O(1).
  const indexByWeek = new Map<string, number>();
  for (let i = 0; i < janela.length; i++) {
    indexByWeek.set(janela[i]!, i);
  }

  // Inicializa estrutura por semana com zeros + buckets vazios.
  type SemanaAccum = {
    semana_iso: string;
    inicio: Date;
    fim: Date;
    entradas_realizadas: number;
    entradas_confirmadas: number;
    entradas_estimadas: number;
    saidas_realizadas: number;
    saidas_confirmadas: number;
    saidas_estimadas: number;
    evento_ids: string[];
    eventos_pendentes_com_data_ids: string[];
  };
  const accums: SemanaAccum[] = janela.map((semana_iso) => ({
    semana_iso,
    inicio: inicioDaSemanaIso(semana_iso),
    fim: fimDaSemanaIso(semana_iso),
    entradas_realizadas: 0,
    entradas_confirmadas: 0,
    entradas_estimadas: 0,
    saidas_realizadas: 0,
    saidas_confirmadas: 0,
    saidas_estimadas: 0,
    evento_ids: [],
    eventos_pendentes_com_data_ids: [],
  }));

  const eventosAtrasados: string[] = [];
  const eventosForaDaJanela: string[] = [];

  // Itera eventos em ordem determinística (id lex) pra que `evento_ids`
  // por semana saia ordenado sem precisar reordenar depois.
  const eventosOrdenados = [...eventosUnidade].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  for (const ev of eventosOrdenados) {
    const allocDate = allocationDatesByEventoId.get(ev.id);
    if (allocDate === undefined) continue; // não alocado

    if (allocDate.getTime() < inicioSemana1.getTime()) {
      eventosAtrasados.push(ev.id);
      continue;
    }
    if (allocDate.getTime() > fimSemana13.getTime()) {
      eventosForaDaJanela.push(ev.id);
      continue;
    }

    const targetWeek = semanaIsoOf(allocDate);
    const idx = indexByWeek.get(targetWeek);
    if (idx === undefined) {
      // Não deveria acontecer dada a checagem de fronteira acima, mas
      // mantém defesa: classifica como fora da janela.
      eventosForaDaJanela.push(ev.id);
      continue;
    }

    const acc = accums[idx]!;

    // Pendentes com data_esperada ficam FORA dos totais (§3.D do spec).
    if (ev.status === 'pendente') {
      acc.eventos_pendentes_com_data_ids.push(ev.id);
      continue;
    }

    acc.evento_ids.push(ev.id);
    if (ev.status === 'realizado') {
      if (ev.direcao === 'entrada') acc.entradas_realizadas += ev.valor;
      else acc.saidas_realizadas += ev.valor;
    } else if (ev.status === 'confirmado') {
      if (ev.direcao === 'entrada') acc.entradas_confirmadas += ev.valor;
      else acc.saidas_confirmadas += ev.valor;
    } else if (ev.status === 'estimado') {
      if (ev.direcao === 'entrada') acc.entradas_estimadas += ev.valor;
      else acc.saidas_estimadas += ev.valor;
    }
  }

  /* ─── 7. Roll-forward + composição final das semanas ─── */
  const semanas: SemanaProjecao[] = [];
  let rolling = caixaInicial.valor;
  for (const acc of accums) {
    const total_entradas =
      acc.entradas_realizadas + acc.entradas_confirmadas + acc.entradas_estimadas;
    const total_saidas =
      acc.saidas_realizadas + acc.saidas_confirmadas + acc.saidas_estimadas;
    const variacao_liquida = total_entradas - total_saidas;
    const caixa_final = rolling + variacao_liquida;
    semanas.push({
      semana_iso: acc.semana_iso,
      inicio: acc.inicio,
      fim: acc.fim,
      caixa_inicial: rolling,
      entradas_realizadas: acc.entradas_realizadas,
      entradas_confirmadas: acc.entradas_confirmadas,
      entradas_estimadas: acc.entradas_estimadas,
      saidas_realizadas: acc.saidas_realizadas,
      saidas_confirmadas: acc.saidas_confirmadas,
      saidas_estimadas: acc.saidas_estimadas,
      total_entradas,
      total_saidas,
      variacao_liquida,
      caixa_final,
      evento_ids: acc.evento_ids,
      eventos_pendentes_com_data_ids: acc.eventos_pendentes_com_data_ids,
      // Default conservador: 0 + fallback. `calculaCaixaMinimoOp` (4.3)
      // produz NOVAS instâncias com valores reais quando chamada.
      caixa_minimo_op: 0,
      caixa_minimo_op_provenance: {
        margem_aplicada: 0.1,
        margem_origem: 'fallback_10pct',
        base_pre_margem: 0,
        eventos_considerados_ids: [],
      },
    });
    rolling = caixa_final;
  }

  /* ─── 8. Estatísticas ─── */
  const eventosNaGrade =
    accums.reduce(
      (sum, a) => sum + a.evento_ids.length + a.eventos_pendentes_com_data_ids.length,
      0,
    );
  const estatisticas: ProjecaoUnidadeEstatisticas = {
    eventosTotal: eventosUnidade.length,
    eventosNaGrade,
    eventosAtrasadosCount: eventosAtrasados.length,
    eventosForaDaJanelaCount: eventosForaDaJanela.length,
    eventosNaoAlocadosCount: eventosNaoAlocados.length,
    confirmadosComHookAplicado,
  };

  return {
    cliente_id: input.cliente_id,
    legal_entity_id: input.legal_entity_id,
    geradoEm: input.geradoEm,
    janela,
    caixaInicial,
    semanas,
    allocationDatesByEventoId,
    eventosAtrasados,
    eventosForaDaJanela,
    eventosNaoAlocados,
    estatisticas,
  };
}

/* ─────────── Helpers internos ─────────── */

/**
 * Calcula `allocationDate` para um evento. Política:
 *  - `realizado` → `data_realizada` (já é fato; sem hook).
 *  - `confirmado` → `deriveDataEsperada(data_vencimento, calendar, hook?)`
 *    — passa pelo hook de contraparte + calendário operacional.
 *  - `estimado` → `data_esperada` (já passou pelo hook na 2.2).
 *  - `pendente` com `data_esperada` → `data_esperada`.
 *  - `pendente` sem `data_esperada` E sem `data_vencimento` → `null`
 *    (vai pra `eventosNaoAlocados`).
 */
function computaAllocationDate(
  ev: EventoCaixa,
  input: ProjetaUnidadeInput,
): Date | null {
  if (ev.status === 'realizado') {
    if (
      !(ev.data_realizada instanceof Date) ||
      Number.isNaN(ev.data_realizada.getTime())
    ) {
      throw new ProjecaoError(
        `evento ${ev.id}: realizado sem data_realizada válida`,
      );
    }
    return ev.data_realizada;
  }
  if (ev.status === 'confirmado') {
    return deriveDataEsperada(
      ev.data_vencimento,
      input.calendar,
      input.contraparteHistory,
      ev.contraparte_id,
    );
  }
  // estimado e pendente: data_esperada é a fonte canônica.
  // estimado já passou por hook na 2.2; não reaplicamos.
  if (ev.data_esperada instanceof Date && !Number.isNaN(ev.data_esperada.getTime())) {
    return ev.data_esperada;
  }
  return null;
}

/**
 * `true` quando o hook teria efeito (contraparte presente no map,
 * `padrao_estavel=true`, `mediana_dias ≠ 0`). Usado APENAS para a
 * estatística `confirmadosComHookAplicado` — `deriveDataEsperada`
 * aplica internamente a mesma condição.
 */
function hookAtuouEm(
  contraparteId: string | undefined,
  hook: ProjetaUnidadeInput['contraparteHistory'],
): boolean {
  if (contraparteId === undefined || hook === undefined) return false;
  const stats = hook.get(contraparteId);
  if (stats === undefined) return false;
  return stats.padrao_estavel && stats.mediana_dias !== 0;
}

/**
 * Seleciona o snapshot mais recente com `data_referencia ≤ geradoEm`
 * dentro do `(cliente_id, legal_entity_id)` solicitado. Critério de
 * stale é `(geradoEm − data_referencia) > 7 dias` em milissegundos.
 *
 * Determinismo: tiebreaker secundário por `id` lex em caso de empate
 * de data.
 */
function computaCaixaInicial(
  saldos: readonly OpeningBalanceSnapshot[],
  cliente_id: string,
  legal_entity_id: string,
  geradoEm: Date,
): CaixaInicial {
  const elegiveis = saldos.filter(
    (s) =>
      s.cliente_id === cliente_id &&
      s.legal_entity_id === legal_entity_id &&
      s.data_referencia.getTime() <= geradoEm.getTime(),
  );

  if (elegiveis.length === 0) {
    return { valor: 0, stale: false, ausente: true };
  }

  // Ordem desc por data_referencia, depois asc por id (det).
  const ordenado = [...elegiveis].sort((a, b) => {
    const dd = b.data_referencia.getTime() - a.data_referencia.getTime();
    if (dd !== 0) return dd;
    return a.id.localeCompare(b.id);
  });
  const escolhido = ordenado[0]!;

  const ageDias =
    (geradoEm.getTime() - escolhido.data_referencia.getTime()) / DAY_MS;
  const stale = ageDias > STALE_DIAS;

  return {
    valor: escolhido.valor,
    data_referencia: escolhido.data_referencia,
    origem_snapshot_id: escolhido.id,
    stale,
    ausente: false,
  };
}
