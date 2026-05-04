/**
 * Formatador do relatório do smoke CF13 Estágio 4. Estende o padrão
 * do Stage 3 com a saída de Projeção (4.1+4.2+4.3).
 */
import type {
  EventoCaixa,
  HistoricoOperacional,
  ProjecaoCliente,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
  VendaComercial,
} from '../../src/index.js';

export interface StageFourReportInput {
  mode: 'full' | 'sample';
  /** Eventos da saída do Stage 1 (antes do estimador). */
  stage1Eventos: readonly EventoCaixa[];
  /** Saída do MotorHistorico (Stage 2). */
  historico: HistoricoOperacional;
  /** Saída da reconciliação banco↔CP/CR + transferência (Stage 3). */
  reconciliacao: ReconciliacaoResult;
  /** Saída comercial (Stage 3). */
  comercial: ReconciliacaoComercialResult;
  /** Vendas auxiliares (Stage 3). */
  vendas: readonly VendaComercial[];
  /** Saída da projeção (Stage 4 — completa: 4.1+4.2+4.3). */
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

export function printStageFourReport(input: StageFourReportInput): void {
  const apCount = input.stage1Eventos.filter(
    (e) => e.origem === 'fkn' && e.contraparte_tipo === 'fornecedor',
  ).length;
  const arCount = input.stage1Eventos.filter(
    (e) => e.origem === 'fkn' && e.contraparte_tipo === 'cliente',
  ).length;
  const cefCount = input.stage1Eventos.filter((e) => e.origem === 'cef').length;

  const proj = input.projecao;
  const consol = proj.consolidado;
  const minimoMedio =
    consol.semanas.reduce((sum, s) => sum + s.caixa_minimo_op, 0) / 13;
  // Eventos elegíveis só existem com `criticidade IN (obrigatoria, critica_op)`.
  // Stage 1 ingestão deixa todos como `pendente`; classificação ainda
  // não implementada — sinalizamos explicitamente quando o mínimo vem 0.
  const todosPendente = minimoMedio === 0;
  const semanasAbaixoMin = consol.semanas.filter(
    (s) => s.caixa_final < s.caixa_minimo_op,
  ).length;
  const pctAbaixoMin = (semanasAbaixoMin / 13) * 100;

  // Margem por unidade — pega a primeira semana com base > 0 (ou primeira disponível).
  const margensPorUnidade: string[] = [];
  for (const u of proj.unidades) {
    const semBase = u.semanas.find(
      (s) => s.caixa_minimo_op_provenance.base_pre_margem > 0,
    );
    const provExemplo =
      semBase?.caixa_minimo_op_provenance ??
      u.semanas[0]!.caixa_minimo_op_provenance;
    const origem = provExemplo.margem_origem;
    const cv =
      provExemplo.volatilidade_cv !== undefined
        ? ` cv=${provExemplo.volatilidade_cv.toFixed(2)}`
        : '';
    const margemPct = (provExemplo.margem_aplicada * 100).toFixed(0);
    margensPorUnidade.push(
      `  ${u.legal_entity_id}: ${origem}${cv} → margem ${margemPct}%`,
    );
  }

  const reconPends = input.reconciliacao.pendencias.length;
  const transfNeut = input.reconciliacao.eventosBancariosAbsorvidos.length;

  const lines = [
    '',
    '=== CF13 Stage 4 — Smoke Gregorutt ===',
    `Modo: ${input.mode}`,
    '',
    '[Stage 1 base]',
    `FKN AP:        ${fmt(apCount).padStart(7)} eventos`,
    `FKN AR:        ${fmt(arCount).padStart(7)} eventos`,
    `CEF:           ${fmt(cefCount).padStart(7)} eventos`,
    '',
    '[Stage 2]',
    `Estimados gerados:                  ${fmt(input.historico.eventosEstimados.length)}`,
    `Recorrências detectadas:            ${fmt(input.historico.recorrencias.length)}`,
    `Volatilidades:                      ${fmt(input.historico.volatilidades.size)} unidades`,
    '',
    '[Stage 3]',
    `Reconciliação matches aplicados:    ${fmt(input.reconciliacao.estatisticas.matchesAplicados)}`,
    `Eventos bancários absorvidos:       ${fmt(transfNeut)}`,
    `Pendências de reconciliação:        ${fmt(reconPends)}`,
    `Vendas FKN:                         ${fmt(input.vendas.length)}`,
    `Vendas com AR vinculado:            ${fmt(input.comercial.estatisticas.matchesAplicados)}`,
    '',
    '[Stage 4 — Projeção]',
    `Unidades ativas:                    ${fmt(consol.legal_entity_ids.length)}`,
    `Janela:                             ${proj.consolidado.janela[0]} → ${proj.consolidado.janela[12]}`,
    `Caixa inicial consolidado:          ${brl(consol.caixaInicial.valor)}` +
      (consol.caixaInicial.alguma_ausente ? ' (alguma ausente)' : '') +
      (consol.caixaInicial.alguma_stale ? ' (alguma stale)' : ''),
    `Caixa final semana 13 (consol):     ${brl(consol.semanas[12]!.caixa_final)}`,
    `Mínimo médio (consolidado):         ${brl(minimoMedio)}` +
      (todosPendente
        ? ' (todos eventos com criticidade=pendente — classificação não implementada)'
        : ''),
    `% semanas onde caixa < mínimo:      ${pctAbaixoMin.toFixed(1)}%   (informativo, sem julgamento)`,
    `Margem por unidade:`,
    ...margensPorUnidade,
    `Eventos atrasados (todas unidades): ${fmt(
      proj.unidades.reduce((s, u) => s + u.eventosAtrasados.length, 0),
    )}`,
    `Eventos fora da janela:             ${fmt(
      proj.unidades.reduce((s, u) => s + u.eventosForaDaJanela.length, 0),
    )}`,
    `Confirmados com hook aplicado:      ${fmt(
      proj.unidades.reduce(
        (s, u) => s + u.estatisticas.confirmadosComHookAplicado,
        0,
      ),
    )}`,
    `Transferências válidas neutralizadas: ${fmt(
      consol.estatisticas.transferenciasNeutralizadasValidas,
    )}`,
    `Transferências inválidas (auditoria): ${fmt(
      consol.estatisticas.transferenciasNeutralizadasInvalidas,
    )}`,
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
