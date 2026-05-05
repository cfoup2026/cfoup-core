/**
 * Adapter: `SemanaProjecao` interno (snake_case, `Date`) →
 * `SemanaProjecao` do contrato (camelCase, ISO string).
 *
 * Funções puras — não mutam input. Determinístico.
 */
import type { SemanaProjecao as SemanaProjecaoInterna } from '../../../types/projecao.js';
import type { EventoCaixa } from '../../../types/EventoCaixa.js';
import { formatarRotuloSemana } from '../helpers/formatarRotuloSemana.js';
import type { SemanaProjecao as SemanaProjecaoContract } from '../types.js';

/** Converte `Date` UTC para ISO `YYYY-MM-DD`. */
export function formatarISODate(date: Date): string {
  const ano = date.getUTCFullYear();
  const mes = date.getUTCMonth() + 1;
  const dia = date.getUTCDate();
  const m = mes < 10 ? `0${mes}` : String(mes);
  const d = dia < 10 ? `0${dia}` : String(dia);
  return `${ano}-${m}-${d}`;
}

export interface AdaptarSemanaArgs {
  /** Semana interna do core. */
  semana: SemanaProjecaoInterna;
  /** 1..13 — posição na grade. */
  indice: number;
  /** Index `id → EventoCaixa` para split direcional dos `evento_ids`.
   *  IDs ausentes do index são silenciosamente ignorados (caso degenerado
   *  — `validarReferenciasResolviveis` do Stage 6 já garantiu integridade
   *  no fluxo normal). */
  eventoIndex: ReadonlyMap<string, EventoCaixa>;
}

export function adaptarSemana(args: AdaptarSemanaArgs): SemanaProjecaoContract {
  const { semana: s, indice, eventoIndex } = args;

  const inicioISO = formatarISODate(s.inicio);
  const fimISO = formatarISODate(s.fim);
  const rotulo = formatarRotuloSemana(inicioISO, fimISO, indice);

  /* Split por direção. Eventos pendentes (com data) ficam fora dos totais
   *  do Stage 4 por design — não entram aqui também. */
  const eventosEntradaIds: string[] = [];
  const eventosSaidaIds: string[] = [];
  for (const id of s.evento_ids) {
    const ev = eventoIndex.get(id);
    if (ev === undefined) continue;
    if (ev.direcao === 'entrada') eventosEntradaIds.push(id);
    else eventosSaidaIds.push(id);
  }
  /* Determinismo: ordem lex. */
  eventosEntradaIds.sort((a, b) => a.localeCompare(b));
  eventosSaidaIds.sort((a, b) => a.localeCompare(b));

  const entradas = s.total_entradas;
  const saidas = s.total_saidas;
  /* `s.variacao_liquida = total_entradas - total_saidas` por construção
   *  do Stage 4. Replicamos via subtração para o caso degenerado de
   *  algum float drift; mas em fluxo normal são iguais. */
  const saldoSemana = entradas - saidas;
  const caixaFinalSemana = s.caixa_final;
  const caixaMinimoOp = s.caixa_minimo_op;
  const gapMinimoOperacional = caixaFinalSemana - caixaMinimoOp;

  return {
    indice,
    inicio: inicioISO,
    fim: fimISO,
    rotulo,
    caixaInicialSemana: s.caixa_inicial,
    entradas,
    saidas,
    saldoSemana,
    caixaFinalSemana,
    caixaMinimoOp,
    gapMinimoOperacional,
    abaixoDoMinimo: gapMinimoOperacional < 0,
    saldoNegativo: caixaFinalSemana < 0,
    eventosEntradaIds,
    eventosSaidaIds,
  };
}
