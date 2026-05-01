/**
 * Formatador do relatório do smoke CF13 Estágio 3. Estende o padrão
 * do Stage 1 com as três frentes do estágio 3 (banco↔CP/CR,
 * transferência interna, Vendas↔AR).
 */
import type {
  EventoCaixa,
  HistoricoOperacional,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
  VendaComercial,
} from '../../src/index.js';

export interface StageThreeReportInput {
  /** Modo do smoke: 'full' (Gregorutt local) ou 'sample' (CI). */
  mode: 'full' | 'sample';
  /** Eventos da saída do Stage 1 (antes do estimador). */
  stage1Eventos: readonly EventoCaixa[];
  /** Saída do MotorHistorico (Stage 2). */
  historico: HistoricoOperacional;
  /** Saída da reconciliação banco↔CP/CR + transferência (Stage 3). */
  reconciliacao: ReconciliacaoResult;
  /** Saída da reconciliação Vendas↔AR (Stage 3). */
  comercial: ReconciliacaoComercialResult;
  /** Vendas pré-reconciliação (output do `fknVendasAdapter`). */
  vendas: readonly VendaComercial[];
  /** Eventos com `is_transferencia=true` no output final (espera-se par). */
  transferencias: readonly EventoCaixa[];
  /** Tempo total do smoke, em milissegundos. */
  elapsedMs: number;
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

export function printStageThreeReport(input: StageThreeReportInput): void {
  const stage1Counts = countByStatus(input.stage1Eventos);
  const apCount = input.stage1Eventos.filter(
    (e) => e.origem === 'fkn' && e.contraparte_tipo === 'fornecedor',
  ).length;
  const arCount = input.stage1Eventos.filter(
    (e) => e.origem === 'fkn' && e.contraparte_tipo === 'cliente',
  ).length;
  const cefCount = input.stage1Eventos.filter((e) => e.origem === 'cef').length;

  const recAlta = input.historico.recorrencias.filter(
    (r) => r.confianca === 'alta',
  ).length;
  const recMedia = input.historico.recorrencias.filter(
    (r) => r.confianca === 'media',
  ).length;
  const contrapartesEstaveis = [...input.historico.contraparteHistory.values()]
    .filter((c) => c.padrao_estavel).length;

  const recPendsByTipo = new Map<string, number>();
  for (const p of input.reconciliacao.pendencias) {
    recPendsByTipo.set(p.tipo, (recPendsByTipo.get(p.tipo) ?? 0) + 1);
  }
  const transferPendCount = recPendsByTipo.get('transferencia_ambigua') ?? 0;
  const reconPendCount =
    input.reconciliacao.pendencias.length - transferPendCount;

  const comStats = input.comercial.estatisticas;
  const lines = [
    '',
    '=== CF13 Stage 3 — Smoke Gregorutt ===',
    `Modo: ${input.mode}`,
    '',
    '[Stage 1 base]',
    `FKN AP:        ${fmt(apCount).padStart(7)} eventos`,
    `FKN AR:        ${fmt(arCount).padStart(7)} eventos`,
    `CEF:           ${fmt(cefCount).padStart(7)} eventos`,
    `Total Stage 1: ${fmt(input.stage1Eventos.length).padStart(7)} (realizado: ${fmt(stage1Counts.realizado)} / confirmado: ${fmt(stage1Counts.confirmado)})`,
    '',
    '[Stage 2]',
    `Estimados gerados:                  ${fmt(input.historico.eventosEstimados.length)}`,
    `Recorrências detectadas:            ${fmt(input.historico.recorrencias.length)} (alta: ${fmt(recAlta)}, media: ${fmt(recMedia)})`,
    `Contrapartes com padrão estável:    ${fmt(contrapartesEstaveis)}`,
    '',
    '[Stage 3.1 — banco ↔ CP/CR (P1 + P2)]',
    `Matches aplicados:                  ${fmt(input.reconciliacao.estatisticas.matchesAplicados)} ` +
      `(P1: ${fmt(input.reconciliacao.estatisticas.matchesAplicadosPassada1)}, ` +
      `P2: ${fmt(input.reconciliacao.estatisticas.matchesAplicadosPassada2)})`,
    `Eventos absorvidos:                 ${fmt(input.reconciliacao.eventosBancariosAbsorvidos.length)}`,
    `CEF não absorvidos (tarifas/IOF):   ${fmt(input.reconciliacao.estatisticas.eventosBancariosNaoAbsorvidos)}`,
    `Pendências de reconciliação:        ${fmt(reconPendCount)}`,
    '',
    '[Stage 3.2 — transferência interna]',
    `Pares de transferência marcados:    ${fmt(input.transferencias.length / 2)}`,
    `Pendências de transferência:        ${fmt(transferPendCount)}`,
    '',
    '[Stage 3.2 — Vendas ↔ AR]',
    `Vendas FKN:                         ${fmt(input.vendas.length)}`,
    `Vendas com AR vinculado:            ${fmt(comStats.matchesAplicados)}`,
    `Vendas sem AR:                      ${fmt(comStats.vendasSemAr)}`,
    `AR sem venda:                       ${fmt(comStats.arSemVenda)}`,
    `Pendências de venda ambígua:        ${fmt(comStats.ambiguidades)}`,
    '',
    '---',
    `Determinismo: OK (validado em assertion)`,
    `Tempo total: ${fmt(input.elapsedMs)} ms`,
    '',
  ];
  for (const line of lines) {
    console.log(line);
  }
}
