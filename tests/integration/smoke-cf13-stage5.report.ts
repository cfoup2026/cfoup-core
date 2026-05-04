/**
 * Formatador do relatório do smoke CF13 Estágio 5 — Cobertura.
 * Estende o relatório do 4.5 com:
 *  - Status de cobertura (cobertura_completa / com_confianca_reduzida / insuficiente).
 *  - Distribuição de pendências por tipo.
 *  - Pendentes-classificação agregados (top 5 buckets `(LE, semana, direcao)`).
 *  - Recorrências esperadas vs encontradas (a partir da pendência
 *    `recorrencia_ausente`).
 *  - Distribuição de ações sugeridas.
 *  - Motivos de insuficiência (vazio em Gregorutt OK).
 *
 * Linguagem de produto: nada de "bloqueante", "buraco", "input".
 */
import type {
  AcaoCobertura,
  ClassifyEventosOutput,
  CoberturaResult,
  EventoCaixa,
  HistoricoOperacional,
  Pendencia,
  ProjecaoCliente,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
  TipoMotivoInsuficiencia,
  TipoPendencia,
} from '../../src/index.js';

export interface StageFiveReportInput {
  mode: 'full' | 'sample';
  stage1Eventos: readonly EventoCaixa[];
  bridged: ClassifyEventosOutput;
  historico: HistoricoOperacional;
  reconciliacao: ReconciliacaoResult;
  comercial: ReconciliacaoComercialResult;
  projecao: ProjecaoCliente;
  cobertura: CoberturaResult;
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

export function printStageFiveReport(input: StageFiveReportInput): void {
  const cob = input.cobertura;
  const stats = cob.estatisticas;

  /* Pendências por tipo (ordem fixa para legibilidade). */
  const tiposOrdenados: TipoPendencia[] = [
    'semana_zerada',
    'recorrencia_ausente',
    'pendentes_classificacao_agregados',
  ];

  /* Top 5 agregados de pendentes-classificação (por valor_total desc). */
  const agregados = cob.pendencias.filter(
    (p): p is Pendencia & {
      direcao: NonNullable<Pendencia['direcao']>;
      quantidade_eventos: number;
      valor_total: number;
    } => p.tipo === 'pendentes_classificacao_agregados',
  );
  const topAgregados = [...agregados]
    .sort((a, b) => b.valor_total - a.valor_total)
    .slice(0, 5);

  /* Recorrências esperadas vs encontradas (proxy):
   *  - "esperadas" = pendências `recorrencia_ausente` + recorrências
   *     elegíveis que NÃO viraram pendência (já cobertas pela trava
   *     anti-duplicação).
   *  - "ausentes" = pendências do tipo.
   *  Como Stage 5 não expõe diretamente "esperadas total", reportamos
   *  apenas o número de ausentes e listamos as recorrências do
   *  histórico ativas + elegíveis para contexto. */
  const ausentes = cob.pendencias.filter(
    (p) => p.tipo === 'recorrencia_ausente',
  );
  const recorrenciasAtivasFortes = input.historico.recorrencias.filter(
    (r) => r.ativa && r.confianca !== 'baixa',
  ).length;

  /* Distribuição de ações sugeridas. */
  const acoesCount = new Map<AcaoCobertura, number>();
  for (const p of cob.pendencias) {
    for (const a of p.acoes_sugeridas) {
      acoesCount.set(a, (acoesCount.get(a) ?? 0) + 1);
    }
  }
  const acoesOrdenadas = [...acoesCount.entries()].sort((a, b) => b[1] - a[1]);

  /* Motivos de insuficiência (agrupados por tipo). */
  const motivosPorTipo = new Map<TipoMotivoInsuficiencia, number>();
  for (const m of cob.motivosInsuficiencia) {
    motivosPorTipo.set(m.tipo, (motivosPorTipo.get(m.tipo) ?? 0) + 1);
  }

  const lines = [
    '',
    '=== CF13 Stage 5 — Smoke com Cobertura ===',
    `Modo: ${input.mode}`,
    '',
    '[Stage 1 base]',
    `Total eventos:                      ${fmt(input.stage1Eventos.length)}`,
    '',
    '[Stage 4.5 — Bridge]',
    `Classificados:                      ${fmt(input.bridged.estatisticas.classificados)} (${pct(input.bridged.estatisticas.classificados, input.bridged.estatisticas.totalEventos)})`,
    '',
    '[Stage 4 — Projeção]',
    `Caixa inicial consolidado:          ${brl(input.projecao.consolidado.caixaInicial.valor)}`,
    `Caixa final semana 13:              ${brl(input.projecao.consolidado.semanas[12]!.caixa_final)}`,
    '',
    '[Stage 5 — Cobertura]',
    `Status:                             ${cob.status}`,
    '',
    '  Motivos de insuficiência:',
    ...(cob.motivosInsuficiencia.length === 0
      ? ['    (nenhum)']
      : [...motivosPorTipo.entries()].map(
          ([t, n]) => `    ${t.padEnd(30)} ${fmt(n).padStart(6)}`,
        )),
    '',
    '  Pendências detectadas:',
    ...tiposOrdenados.map(
      (t) =>
        `    ${t.padEnd(36)} ${fmt(stats.pendenciasPorTipo.get(t) ?? 0).padStart(6)}`,
    ),
    `    ${'TOTAL'.padEnd(36)} ${fmt(cob.pendencias.length).padStart(6)}`,
    '',
    '  Pendentes-classificação:',
    `    Total eventos:                  ${fmt(stats.totalEventosPendentesClassificacao)}`,
    `    Valor total:                    ${brl(stats.valorTotalPendentesClassificacao)}`,
    `    Buckets agregados:              ${fmt(agregados.length)}`,
    ...(topAgregados.length === 0
      ? []
      : ['    Top 5 (LE / semana / direcao):']),
    ...topAgregados.map(
      (a) =>
        `      ${a.legal_entity_id} / ${a.semana_iso} / ${a.direcao}: ${fmt(a.quantidade_eventos)} ev, ${brl(a.valor_total)}`,
    ),
    '',
    '  Recorrências (Stage 2):',
    `    Ativas + confiança não-baixa:   ${fmt(recorrenciasAtivasFortes)}`,
    `    Ausentes detectadas (semanas):  ${fmt(ausentes.length)}`,
    '',
    '  Distribuição de ações sugeridas:',
    ...acoesOrdenadas.map(
      ([a, n]) => `    ${a.padEnd(36)} ${fmt(n).padStart(6)} pendências`,
    ),
    '',
    '  Cobertura por unidade:',
    ...[...stats.pendenciasPorUnidade.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([le, n]) =>
          `    ${le.padEnd(20)} ${fmt(n).padStart(6)} pendências`,
      ),
    `    Semanas distintas com pendência: ${fmt(stats.semanasComPendencia)}`,
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
