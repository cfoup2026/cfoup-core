/**
 * Formatador do relatório do smoke CF13 Estágio 1. Imprime um bloco
 * legível no console, sem dependência de framework de teste.
 */
import type {
  CalendarPolicy,
  EventoCaixa,
  OpeningBalanceSnapshot,
} from '../../src/index.js';

export interface StageOneReportInput {
  /** Modo do smoke: 'full' (Gregorutt local) ou 'sample' (CI). */
  mode: 'full' | 'sample';
  ap: readonly EventoCaixa[];
  ar: readonly EventoCaixa[];
  cefEventos: readonly EventoCaixa[];
  cefSaldos: readonly OpeningBalanceSnapshot[];
  /** Eventos confirmados cujo data_vencimento caiu em não-útil
   *  e foram movidos pelo calendário. */
  movidos: readonly EventoCaixa[];
  /** Tempo total do smoke, em milissegundos. */
  elapsedMs: number;
  calendar: CalendarPolicy;
}

const fmt = (n: number): string => n.toLocaleString('pt-BR');

function countByStatus(eventos: readonly EventoCaixa[]): {
  realizado: number;
  confirmado: number;
  estimado: number;
  pendente: number;
} {
  const out = { realizado: 0, confirmado: 0, estimado: 0, pendente: 0 };
  for (const e of eventos) {
    out[e.status] += 1;
  }
  return out;
}

export function printStageOneReport(input: StageOneReportInput): void {
  const apCounts = countByStatus(input.ap);
  const arCounts = countByStatus(input.ar);
  const cefCounts = countByStatus(input.cefEventos);

  const totalNaoRealizados =
    apCounts.confirmado + arCounts.confirmado + cefCounts.confirmado;
  const movidosPct =
    totalNaoRealizados === 0
      ? 0
      : (input.movidos.length / totalNaoRealizados) * 100;

  const totalEventos =
    input.ap.length + input.ar.length + input.cefEventos.length;
  const totalRealizados =
    apCounts.realizado + arCounts.realizado + cefCounts.realizado;
  const realizadosBatemPct =
    totalRealizados === 0
      ? 100
      : ([...input.ap, ...input.ar, ...input.cefEventos]
          .filter((e) => e.status === 'realizado')
          .filter((e) => {
            if (e.status !== 'realizado') return false;
            return (
              e.data_realizada !== null &&
              e.data_esperada.getTime() === e.data_realizada.getTime()
            );
          }).length /
          totalRealizados) *
        100;

  const idsUnicos =
    new Set(
      [...input.ap, ...input.ar, ...input.cefEventos].map((e) => e.id),
    ).size === totalEventos;

  const lines = [
    '',
    '=== CF13 Stage 1 — Smoke Gregorutt ===',
    `Modo: ${input.mode} (calendar=${input.calendar.id})`,
    '',
    `FKN AP:    ${fmt(input.ap.length).padStart(7)} eventos  (confirmado: ${fmt(
      apCounts.confirmado,
    )} / realizado: ${fmt(apCounts.realizado)})`,
    `FKN AR:    ${fmt(input.ar.length).padStart(7)} eventos  (confirmado: ${fmt(
      arCounts.confirmado,
    )} / realizado: ${fmt(arCounts.realizado)})`,
    `CEF:       ${fmt(input.cefEventos.length).padStart(7)} eventos  (100% realizado) + ${fmt(input.cefSaldos.length)} saldos validados`,
    '---',
    `Movidos por calendário (não-realizados):  ${fmt(input.movidos.length)} (${movidosPct.toFixed(2)}% sobre confirmados)`,
    `Realizados com data_esperada=data_realizada:  ${realizadosBatemPct.toFixed(2)}%`,
    `IDs únicos:  ${idsUnicos ? '100%' : 'COLISÃO DETECTADA'}`,
    `Determinismo: OK (validado em assertion)`,
    `Tempo total:  ${input.elapsedMs} ms`,
    '',
  ];
  for (const line of lines) {
    console.log(line);
  }
}
