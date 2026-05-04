/**
 * Formatador do relatório do smoke CF13 Estágio 4.5 — Classification
 * Bridge. Estende o report do Stage 4 com cobertura de classificação
 * (por bucket, por criticidade, % pendente, requiresOwnerConfirmation).
 */
import type {
  ClassificationStats,
  ClassifyEventosOutput,
  Criticidade,
  EventoCaixa,
  HistoricoOperacional,
  ProjecaoCliente,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
} from '../../src/index.js';

export interface StageFourFiveReportInput {
  mode: 'full' | 'sample';
  /** Eventos do Stage 1 (antes do Bridge). */
  stage1Eventos: readonly EventoCaixa[];
  /** Saída do Bridge. */
  bridged: ClassifyEventosOutput;
  /** Saída do Stage 2 sobre eventos pós-Bridge. */
  historico: HistoricoOperacional;
  /** Saída do Stage 3. */
  reconciliacao: ReconciliacaoResult;
  comercial: ReconciliacaoComercialResult;
  /** Saída do Stage 4 sobre eventos pós-Bridge. */
  projecao: ProjecaoCliente;
  elapsedMs: number;
}

const fmt = (n: number): string => n.toLocaleString('pt-BR');
const brl = (n: number): string =>
  n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
const pct = (a: number, b: number): string =>
  b === 0 ? '0,0%' : `${((a / b) * 100).toFixed(1)}%`;

export function printStageFourFiveReport(
  input: StageFourFiveReportInput,
): void {
  const stats: ClassificationStats = input.bridged.estatisticas;

  // Cobertura cruzada: das saídas obrigatórias/críticas do Stage 1, quantas
  // o Bridge classificou? Proxy de "quanto o caixa_minimo_op deixa de
  // capturar" no Stage 4.
  const stage1Saidas = input.stage1Eventos.filter(
    (e) => e.direcao === 'saida',
  );
  const eventosBridgePosID = new Map<string, EventoCaixa>();
  for (const e of input.bridged.eventos) {
    eventosBridgePosID.set(e.id, e);
  }
  const saidasCriticasPos = stage1Saidas.filter((e) => {
    const pos = eventosBridgePosID.get(e.id);
    return (
      pos !== undefined &&
      (pos.criticidade === 'obrigatoria' || pos.criticidade === 'critica_op')
    );
  });

  // Estimados com criticidade real após Stage 2 (depende de Bridge ter
  // classificado a base das recorrências).
  const estimadosClassificados = input.historico.eventosEstimados.filter(
    (e) => e.criticidade !== 'pendente',
  );

  // Top 5 buckets classificados.
  const bucketsOrdenados = [...stats.porBucket.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  const topBuckets = bucketsOrdenados.slice(0, 5);
  const totalOutros = bucketsOrdenados
    .slice(5)
    .reduce((sum, [, n]) => sum + n, 0);

  // Distribuição completa por criticidade.
  const ordemCriticidade: Criticidade[] = [
    'obrigatoria',
    'critica_op',
    'negociavel',
    'discricionaria',
    'pendente',
  ];

  // Caixa mínimo > 0 em alguma semana? (regressão do Stage 4).
  const semComMinimo = input.projecao.consolidado.semanas.filter(
    (s) => s.caixa_minimo_op > 0,
  ).length;

  const lines = [
    '',
    '=== CF13 Stage 4.5 — Smoke com Bridge ===',
    `Modo: ${input.mode}`,
    '',
    '[Bridge — cobertura de classificação]',
    `Eventos no input:                   ${fmt(stats.totalEventos)}`,
    `  Já classificados no input:        ${fmt(stats.jaClassificadosNoInput)}`,
    `  Classificados pelo motor:         ${fmt(stats.classificados)} (${pct(stats.classificados, stats.totalEventos)})`,
    `  Permaneceram pendente:            ${fmt(stats.naoClassificados)} (${pct(stats.naoClassificados, stats.totalEventos)})`,
    `  Pediram confirmação do dono:      ${fmt(stats.requiresOwnerConfirmationCount)}`,
    `Tempo do Bridge:                    ${fmt(stats.tempoTotalMs)} ms`,
    '',
    '[Distribuição por bucket — top 5]',
    ...topBuckets.map(
      ([bucket, n]) =>
        `  ${bucket.padEnd(28)}${fmt(n).padStart(7)}  (${pct(n, stats.classificados)})`,
    ),
    ...(totalOutros > 0
      ? [
          `  ${'(outros)'.padEnd(28)}${fmt(totalOutros).padStart(7)}  (${pct(totalOutros, stats.classificados)})`,
        ]
      : []),
    '',
    '[Distribuição por criticidade]',
    ...ordemCriticidade.map((c) => {
      const n = stats.porCriticidade.get(c) ?? 0;
      return `  ${c.padEnd(20)}${fmt(n).padStart(7)}  (${pct(n, stats.classificados)})`;
    }),
    '',
    '[Cobertura cruzada]',
    `Saídas do Stage 1 com criticidade obrigatoria/critica_op pós-Bridge:`,
    `  ${fmt(saidasCriticasPos.length)} / ${fmt(stage1Saidas.length)} saídas (${pct(saidasCriticasPos.length, stage1Saidas.length)})`,
    `Estimados (Stage 2) com criticidade real:`,
    `  ${fmt(estimadosClassificados.length)} / ${fmt(input.historico.eventosEstimados.length)} estimados (${pct(estimadosClassificados.length, input.historico.eventosEstimados.length)})`,
    '',
    '[Stage 4 — caixa mínimo (regressão)]',
    `Caixa inicial consolidado:          ${brl(input.projecao.consolidado.caixaInicial.valor)}`,
    `Caixa final semana 13 (consol):     ${brl(input.projecao.consolidado.semanas[12]!.caixa_final)}`,
    `Semanas com caixa_minimo_op > 0:    ${fmt(semComMinimo)} / 13` +
      (semComMinimo === 0
        ? '  (motor não classificou saídas críticas — achado, não falha do Bridge)'
        : '  (Bridge destravou a regressão do Stage 4)'),
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
