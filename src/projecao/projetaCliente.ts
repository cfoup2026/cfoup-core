/**
 * Estágio 4.2 — Consolidado por cliente + neutralização de
 * transferência interna.
 *
 * Pipeline interno:
 *  1. Para cada `legal_entity_id` ativa, chama `projetaUnidade` (4.1) —
 *     retorno vai intacto pra `unidades[]`.
 *  2. Soma bruta de buckets por semana.
 *  3. Avaliação de transferências (`avaliaTransferencias`).
 *  4. Aplicação de subtrações nos buckets + remoção de `evento_ids`.
 *  5. Recálculo de totais (`total_entradas`, `total_saidas`,
 *     `variacao_liquida`).
 *  6. Roll-forward consolidado (`caixa_inicial[k+1] = caixa_final[k]`).
 *
 * Inverter ou pular passos quebra `caixa_final = caixa_inicial +
 * variacao_liquida` quando há transferência interna na janela.
 */
import type {
  CaixaInicial,
  CaixaInicialConsolidado,
  EstatisticasConsolidadas,
  EventoCaixa,
  ProjecaoCliente,
  ProjecaoConsolidada,
  ProjecaoUnidade,
  ProjetaClienteInput,
  SemanaProjecao,
} from '../types/index.js';
import { ProjecaoError } from '../types/projecao.js';
import { aplicaCaixaMinimoOpEm } from './calculaCaixaMinimoOp.js';
import {
  avaliaTransferencias,
  type BucketConsolidado,
  type SubtracaoConsolidado,
} from './neutralizaTransferencia.js';
import { projetaUnidade } from './projetaUnidade.js';
import {
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanasJanela,
} from './semanas.js';

const JANELA_SEMANAS = 13;

/**
 * Função pura. Mesmo input + `geradoEm` → output `deepEqual`.
 *
 * @throws `ProjecaoError` em input inválido (cliente_id ausente,
 *   geradoEm inválido, calendar ausente).
 */
export function projetaCliente(input: ProjetaClienteInput): ProjecaoCliente {
  /* ─── 1. Validação ─── */
  if (typeof input.cliente_id !== 'string' || input.cliente_id === '') {
    throw new ProjecaoError('projetaCliente: cliente_id ausente');
  }
  if (
    !(input.geradoEm instanceof Date) ||
    Number.isNaN(input.geradoEm.getTime())
  ) {
    throw new ProjecaoError('projetaCliente: geradoEm ausente ou inválido');
  }
  if (
    input.calendar === null ||
    input.calendar === undefined ||
    typeof input.calendar.isBusinessDay !== 'function'
  ) {
    throw new ProjecaoError('projetaCliente: calendar ausente ou inválido');
  }

  /* ─── 2. Unidades ativas em ordem lex ─── */
  const idsAtivas = [...input.legal_entity_ids_ativas].sort((a, b) =>
    a.localeCompare(b),
  );

  const unidades: ProjecaoUnidade[] = idsAtivas.map((id) => {
    const opts: Parameters<typeof projetaUnidade>[0] = {
      eventos: input.eventos,
      saldos: input.saldos,
      cliente_id: input.cliente_id,
      legal_entity_id: id,
      geradoEm: input.geradoEm,
      calendar: input.calendar,
    };
    if (input.contraparteHistory !== undefined) {
      opts.contraparteHistory = input.contraparteHistory;
    }
    return projetaUnidade(opts);
  });

  /* ─── 3. Janela e caixa inicial consolidado ─── */
  const janela = semanasJanela(input.geradoEm, JANELA_SEMANAS);

  const por_unidade = new Map<string, CaixaInicial>();
  let valorInicial = 0;
  let alguma_stale = false;
  let alguma_ausente = false;
  for (const u of unidades) {
    por_unidade.set(u.legal_entity_id, u.caixaInicial);
    valorInicial += u.caixaInicial.valor;
    if (u.caixaInicial.stale) alguma_stale = true;
    if (u.caixaInicial.ausente) alguma_ausente = true;
  }
  const caixaInicial: CaixaInicialConsolidado = {
    valor: valorInicial,
    por_unidade,
    alguma_stale,
    alguma_ausente,
  };

  /* ─── 4. Soma bruta de buckets por semana ─── */
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
    evento_ids: Set<string>;
    eventos_pendentes_com_data_ids: Set<string>;
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
    evento_ids: new Set<string>(),
    eventos_pendentes_com_data_ids: new Set<string>(),
  }));

  for (const u of unidades) {
    for (let k = 0; k < u.semanas.length; k++) {
      const src = u.semanas[k]!;
      const acc = accums[k]!;
      acc.entradas_realizadas += src.entradas_realizadas;
      acc.entradas_confirmadas += src.entradas_confirmadas;
      acc.entradas_estimadas += src.entradas_estimadas;
      acc.saidas_realizadas += src.saidas_realizadas;
      acc.saidas_confirmadas += src.saidas_confirmadas;
      acc.saidas_estimadas += src.saidas_estimadas;
      for (const id of src.evento_ids) acc.evento_ids.add(id);
      for (const id of src.eventos_pendentes_com_data_ids)
        acc.eventos_pendentes_com_data_ids.add(id);
    }
  }

  /* ─── 5. Avaliação + neutralização de transferências ─── */
  const eventosCliente = input.eventos.filter(
    (e) => e.cliente_id === input.cliente_id,
  );
  const unidadesPorId = new Map<string, ProjecaoUnidade>();
  for (const u of unidades) unidadesPorId.set(u.legal_entity_id, u);

  const avaliacao = avaliaTransferencias({
    eventosCliente,
    eventosTodos: input.eventos,
    unidadesPorId,
    janela,
  });

  // Aplica subtrações.
  for (const sub of avaliacao.subtracoes) {
    const acc = accums[sub.semanaIdx]!;
    aplicaSubtracao(acc, sub);
  }

  /* ─── 6. Recalcula totais + roll-forward consolidado ─── */
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
      // Determinismo: ordena lex.
      evento_ids: [...acc.evento_ids].sort((a, b) => a.localeCompare(b)),
      eventos_pendentes_com_data_ids: [
        ...acc.eventos_pendentes_com_data_ids,
      ].sort((a, b) => a.localeCompare(b)),
      // Defaults — `calculaCaixaMinimoOp` (4.3) sobrepõe.
      caixa_minimo_op: 0,
      caixa_minimo_op_provenance: {
        margem_aplicada: 0,
        margem_origem: 'agregado_por_unidade',
        base_pre_margem: 0,
        eventos_considerados_ids: [],
        por_unidade: new Map(),
      },
    });
    rolling = caixa_final;
  }

  /* ─── 7. Estatísticas ─── */
  const eventosTotalConsolidado = unidades.reduce(
    (sum, u) => sum + u.estatisticas.eventosTotal,
    0,
  );
  const validasCount = avaliacao.registros.filter((r) => r.valido).length;
  const estatisticas: EstatisticasConsolidadas = {
    unidadesAtivas: idsAtivas.length,
    eventosTotalConsolidado,
    transferenciasMarcadasEventos: avaliacao.marcadosCount,
    transferenciasParesAvaliados: avaliacao.registros.length,
    transferenciasNeutralizadasValidas: validasCount,
    transferenciasNeutralizadasInvalidas:
      avaliacao.registros.length - validasCount,
  };

  const consolidado: ProjecaoConsolidada = {
    cliente_id: input.cliente_id,
    legal_entity_ids: idsAtivas,
    geradoEm: input.geradoEm,
    janela,
    caixaInicial,
    semanas,
    transferenciasNeutralizadas: avaliacao.registros,
    estatisticas,
  };

  /* ─── 8. Caixa mínimo operacional (4.3) ─── */
  // Aplica `calculaCaixaMinimoOp` por cima do que veio até aqui.
  // Sempre rodado — quando `volatilidades` ausente, usa fallback 10%.
  return aplicaCaixaMinimoOpEm(
    {
      cliente_id: input.cliente_id,
      geradoEm: input.geradoEm,
      unidades,
      consolidado,
    },
    input.eventos,
    input.volatilidades,
  );
}

/* ─────────── Helpers internos ─────────── */

/** Aplica subtração de valor + remove evento_id da semana. */
function aplicaSubtracao(
  acc: {
    entradas_realizadas: number;
    entradas_confirmadas: number;
    entradas_estimadas: number;
    saidas_realizadas: number;
    saidas_confirmadas: number;
    saidas_estimadas: number;
    evento_ids: Set<string>;
  },
  sub: SubtracaoConsolidado,
): void {
  const bucket: BucketConsolidado = sub.bucket;
  acc[bucket] = acc[bucket] - sub.valor;
  acc.evento_ids.delete(sub.evento_id);
}
