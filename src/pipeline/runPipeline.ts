/**
 * Orquestrador unificado do pipeline CF13: Stage 1 → Bridge → 2 → 3 → 4.
 *
 * Recebe input já adaptado pelo Stage 1 (eventos + saldos + vendas
 * opcionais) e roda Bridge → MotorHistorico → MotorReconciliacao →
 * projetaCliente em ordem fixa, devolvendo todas as estruturas
 * intermediárias para auditoria/relatório.
 *
 * Carregamento de fixtures (parsers + adapters Stage 1) fica fora
 * deste helper — é responsabilidade dos smokes/runtimes que conhecem
 * o formato dos arquivos. Este módulo só conhece tipos do CF13.
 *
 * Uso típico (smokes):
 *
 * ```ts
 * const { eventos, saldos } = await loadGregoruttStage1();
 * const vendas = loadVendas();
 * const out = runPipeline({
 *   eventos, saldos, vendas,
 *   cliente_id: 'gregorutt',
 *   legal_entity_ids_ativas: ['companhia_1'],
 *   geradoEm, calendar,
 *   classifier: new NucleusClassifierAdapter(),
 * });
 * ```
 *
 * `classifier` opcional — quando omitido, Bridge é PULADO (eventos
 * passam intactos do Stage 1 para Stage 2). Útil para smokes legados
 * (Stage 1-4 sem Bridge) e para diagnóstico.
 */
import { BrazilCalendarPolicy } from '../calendar/index.js';
import type { CalendarPolicy } from '../calendar/CalendarPolicy.js';
import {
  classifyEventos,
  type ClassifyEventosOutput,
  type ClassifierAdapter,
} from '../classification-bridge/index.js';
import { MotorHistorico } from '../historico/index.js';
import { projetaCliente } from '../projecao/index.js';
import { MotorReconciliacao } from '../reconciliacao/index.js';
import type {
  Criticidade,
  EventoCaixa,
  HistoricoOperacional,
  OpeningBalanceSnapshot,
  ProjecaoCliente,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
  VendaComercial,
} from '../types/index.js';

const JANELA_DEFAULT = 13;
const CRITICIDADES_DEFAULT: readonly Criticidade[] = [
  'obrigatoria',
  'critica_op',
  'pendente',
];

export interface RunPipelineInput {
  /** Eventos vindos do Stage 1 (parsers + adapters já aplicados). */
  eventos: readonly EventoCaixa[];
  /** Snapshots de saldo de abertura (do CEF PDF, etc). */
  saldos: readonly OpeningBalanceSnapshot[];
  /** Vendas comerciais (FKN Vendas via `fknVendasAdapter`). Opcional. */
  vendas?: readonly VendaComercial[];

  /** Tenant CFOup. */
  cliente_id: string;
  /** Lista de unidades ativas a projetar. Ordenada lex internamente. */
  legal_entity_ids_ativas: readonly string[];
  /** Quando o pipeline está sendo executado (injetável para determinismo). */
  geradoEm: Date;
  /** Quando a reconciliação foi feita; default = `geradoEm`. */
  reconciliadoEm?: Date;
  /** Política de calendário operacional. Default = `BrazilCalendarPolicy`. */
  calendar?: CalendarPolicy;

  /** Adapter de classificação. Quando omitido, Bridge é pulado. */
  classifier?: ClassifierAdapter;

  /** Janela de projeção (Stage 2 + 4). Default 13 semanas. */
  janelaSemanas?: number;
  /** Criticidades consideradas para volatilidade (Stage 2.1). */
  criticidadesVolatilidade?: readonly Criticidade[];
}

export interface RunPipelineOutput {
  /** Saída do Bridge (Stage 4.5). Quando classifier omitido, contém
   *  os eventos do input sem alterações + estatísticas zeradas. */
  bridged: ClassifyEventosOutput;
  /** Saída do MotorHistorico (Stage 2.1 + 2.2). */
  historico: HistoricoOperacional;
  /** Saída da reconciliação banco↔CP/CR + transferência (Stage 3). */
  reconciliacao: ReconciliacaoResult;
  /** Saída da reconciliação Vendas↔AR (Stage 3.2). */
  comercial: ReconciliacaoComercialResult;
  /** Projeção 13 semanas com caixa mínimo (Stage 4). */
  projecao: ProjecaoCliente;
}

/**
 * Executa o pipeline encadeado em ordem fixa. Função pura: mesmo input
 * + mesmos timestamps injetados → mesmo output em todas as estruturas.
 *
 * @throws qualquer erro propagado pelos sub-estágios (`ProjecaoError`,
 *   `ReconciliacaoError`, `ClassificationError`, etc).
 */
export function runPipeline(input: RunPipelineInput): RunPipelineOutput {
  const calendar: CalendarPolicy = input.calendar ?? new BrazilCalendarPolicy();
  const reconciliadoEm = input.reconciliadoEm ?? input.geradoEm;
  const janelaSemanas = input.janelaSemanas ?? JANELA_DEFAULT;
  const criticidadesVol =
    input.criticidadesVolatilidade ?? CRITICIDADES_DEFAULT;

  /* ─── Stage 4.5 — Bridge (entre Stage 1 e Stage 2) ─── */
  const bridged: ClassifyEventosOutput =
    input.classifier !== undefined
      ? classifyEventos({
          eventos: input.eventos,
          classifier: input.classifier,
        })
      : {
          // Bridge pulado: passa eventos como-estão, estatísticas zeradas.
          eventos: [...input.eventos],
          estatisticas: {
            totalEventos: input.eventos.length,
            jaClassificadosNoInput: input.eventos.length,
            classificados: 0,
            naoClassificados: 0,
            porBucket: new Map(),
            porCriticidade: new Map(),
            requiresOwnerConfirmationCount: 0,
            tempoTotalMs: 0,
          },
        };

  /* ─── Stage 2 — Motor de Histórico ─── */
  const motorH = new MotorHistorico({
    geradoEm: input.geradoEm,
    janelaSemanas,
    calendar,
    criticidadesVolatilidade: [...criticidadesVol],
  });
  const historico = motorH.run(bridged.eventos);
  const eventosStage2: EventoCaixa[] = [
    ...bridged.eventos,
    ...historico.eventosEstimados,
  ];

  /* ─── Stage 3 — Reconciliação banco↔CP/CR + Vendas↔AR ─── */
  const motorR = new MotorReconciliacao({ reconciliadoEm });
  const { reconciliacao, comercial } = motorR.run(
    eventosStage2,
    input.vendas ?? [],
  );

  /* ─── Stage 4 — Projeção 13 semanas ─── */
  const projecao = projetaCliente({
    eventos: reconciliacao.eventos,
    saldos: input.saldos,
    cliente_id: input.cliente_id,
    legal_entity_ids_ativas: input.legal_entity_ids_ativas,
    geradoEm: input.geradoEm,
    calendar,
    contraparteHistory: historico.contraparteHistory,
    volatilidades: historico.volatilidades,
  });

  return { bridged, historico, reconciliacao, comercial, projecao };
}
