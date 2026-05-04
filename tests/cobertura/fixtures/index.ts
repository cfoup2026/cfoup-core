/**
 * Fixtures helper para testes do Estágio 5.1 — Detecção de cobertura.
 * Constrói `ProjecaoCliente`, `Recorrencia`, `OpeningBalanceSnapshot`
 * e `HistoricoOperacional` mínimos com sobrescrita pontual.
 */
import {
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanasJanela,
  type CaixaInicial,
  type ContraparteStats,
  type EventoCaixa,
  type HistoricoOperacional,
  type OpeningBalanceSnapshot,
  type Periodo,
  type ProjecaoCliente,
  type ProjecaoConsolidada,
  type ProjecaoUnidade,
  type ProjecaoUnidadeEstatisticas,
  type Recorrencia,
  type SemanaProjecao,
  type VolatilidadeStats,
} from '../../../src/index.js';

const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

export const GERADO_EM = utc(2026, 5, 1); // sex, W18

interface MkSemanaArgs {
  semana_iso: string;
  evento_ids?: readonly string[];
  eventos_pendentes_com_data_ids?: readonly string[];
  caixa_inicial?: number;
}

function mkSemanaProjecao(args: MkSemanaArgs): SemanaProjecao {
  return {
    semana_iso: args.semana_iso,
    inicio: inicioDaSemanaIso(args.semana_iso),
    fim: fimDaSemanaIso(args.semana_iso),
    caixa_inicial: args.caixa_inicial ?? 0,
    entradas_realizadas: 0,
    entradas_confirmadas: 0,
    entradas_estimadas: 0,
    saidas_realizadas: 0,
    saidas_confirmadas: 0,
    saidas_estimadas: 0,
    total_entradas: 0,
    total_saidas: 0,
    variacao_liquida: 0,
    caixa_final: args.caixa_inicial ?? 0,
    evento_ids: [...(args.evento_ids ?? [])],
    eventos_pendentes_com_data_ids: [
      ...(args.eventos_pendentes_com_data_ids ?? []),
    ],
    caixa_minimo_op: 0,
    caixa_minimo_op_provenance: {
      margem_aplicada: 0.1,
      margem_origem: 'fallback_10pct',
      base_pre_margem: 0,
      eventos_considerados_ids: [],
    },
  };
}

export interface MkUnidadeArgs {
  legal_entity_id: string;
  /** `caixaInicial` da unidade. Default: snapshot disponível. */
  caixaInicial?: Partial<CaixaInicial>;
  /** Eventos por semana (idx 0..12). Default: todas vazias. */
  eventos_por_semana?: readonly { evento_ids?: string[]; eventos_pendentes_com_data_ids?: string[] }[];
  /** Mapa allocationDate por evento. Default: vazio. */
  allocationDates?: ReadonlyMap<string, Date>;
}

export function mkUnidade(args: MkUnidadeArgs): ProjecaoUnidade {
  const janela = semanasJanela(GERADO_EM, 13);
  const caixaInicial: CaixaInicial = {
    valor: args.caixaInicial?.valor ?? 1000,
    stale: args.caixaInicial?.stale ?? false,
    ausente: args.caixaInicial?.ausente ?? false,
    ...(args.caixaInicial?.data_referencia !== undefined && {
      data_referencia: args.caixaInicial.data_referencia,
    }),
    ...(args.caixaInicial?.origem_snapshot_id !== undefined && {
      origem_snapshot_id: args.caixaInicial.origem_snapshot_id,
    }),
  };

  const semanas = janela.map((semana_iso, idx) => {
    const semConfig = args.eventos_por_semana?.[idx];
    return mkSemanaProjecao({
      semana_iso,
      ...(semConfig?.evento_ids !== undefined && {
        evento_ids: semConfig.evento_ids,
      }),
      ...(semConfig?.eventos_pendentes_com_data_ids !== undefined && {
        eventos_pendentes_com_data_ids: semConfig.eventos_pendentes_com_data_ids,
      }),
    });
  });

  const estatisticas: ProjecaoUnidadeEstatisticas = {
    eventosTotal: 0,
    eventosNaGrade: 0,
    eventosAtrasadosCount: 0,
    eventosForaDaJanelaCount: 0,
    eventosNaoAlocadosCount: 0,
    confirmadosComHookAplicado: 0,
  };

  return {
    cliente_id: 'c1',
    legal_entity_id: args.legal_entity_id,
    geradoEm: GERADO_EM,
    janela,
    caixaInicial,
    semanas,
    allocationDatesByEventoId: args.allocationDates
      ? new Map(args.allocationDates)
      : new Map(),
    eventosAtrasados: [],
    eventosForaDaJanela: [],
    eventosNaoAlocados: [],
    estatisticas,
  };
}

export interface MkProjecaoArgs {
  cliente_id?: string;
  unidades?: readonly ProjecaoUnidade[];
}

export function mkProjecao(args: MkProjecaoArgs = {}): ProjecaoCliente {
  const cliente_id = args.cliente_id ?? 'c1';
  const unidades = args.unidades ?? [mkUnidade({ legal_entity_id: 'u1' })];
  const janela = semanasJanela(GERADO_EM, 13);

  const consolidado: ProjecaoConsolidada = {
    cliente_id,
    legal_entity_ids: unidades.map((u) => u.legal_entity_id),
    geradoEm: GERADO_EM,
    janela,
    caixaInicial: {
      valor: unidades.reduce((s, u) => s + u.caixaInicial.valor, 0),
      por_unidade: new Map(unidades.map((u) => [u.legal_entity_id, u.caixaInicial])),
      alguma_stale: unidades.some((u) => u.caixaInicial.stale),
      alguma_ausente: unidades.some((u) => u.caixaInicial.ausente),
    },
    semanas: janela.map((semana_iso) =>
      mkSemanaProjecao({ semana_iso }),
    ),
    transferenciasNeutralizadas: [],
    estatisticas: {
      unidadesAtivas: unidades.length,
      eventosTotalConsolidado: 0,
      transferenciasMarcadasEventos: 0,
      transferenciasParesAvaliados: 0,
      transferenciasNeutralizadasValidas: 0,
      transferenciasNeutralizadasInvalidas: 0,
    },
  };

  return {
    cliente_id,
    geradoEm: GERADO_EM,
    unidades: [...unidades],
    consolidado,
  };
}

export interface MkSaldoArgs {
  id: string;
  legal_entity_id: string;
  cliente_id?: string;
  valor?: number;
  data_referencia?: Date;
  origem?: OpeningBalanceSnapshot['origem'];
}

export function mkSaldo(args: MkSaldoArgs): OpeningBalanceSnapshot {
  return {
    id: args.id,
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id,
    conta_bancaria_id: 'b1',
    valor: args.valor ?? 1000,
    data_referencia: args.data_referencia ?? utc(2026, 4, 30),
    origem: args.origem ?? 'cef',
    criado_em: utc(2026, 5, 1),
    criado_por: 'sistema',
  };
}

export interface MkRecorrenciaArgs {
  recorrencia_id: string;
  legal_entity_id?: string;
  cliente_id?: string;
  bucket_id: string;
  contraparte_id?: string;
  direcao?: Recorrencia['direcao'];
  valor_mediano?: number;
  periodo?: Periodo;
  ultima_data: Date;
  ativa?: boolean;
  confianca?: Recorrencia['confianca'];
}

export function mkRecorrencia(args: MkRecorrenciaArgs): Recorrencia {
  const valor = args.valor_mediano ?? 1000;
  return {
    recorrencia_id: args.recorrencia_id,
    contraparte_id: args.contraparte_id ?? '',
    bucket_id: args.bucket_id,
    valor_mediano: valor,
    valor_classe_min: valor * 0.9,
    valor_classe_max: valor * 1.1,
    periodo: args.periodo ?? 'mensal',
    n_ocorrencias: 6,
    primeira_data: new Date(args.ultima_data.getTime() - 5 * 30 * 86_400_000),
    ultima_data: args.ultima_data,
    ativa: args.ativa ?? true,
    confianca: args.confianca ?? 'alta',
    inferido_de: 'agrupamento_contraparte_bucket_valor',
    n_amostras: 6,
    direcao: args.direcao ?? 'saida',
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id ?? 'u1',
    bucket_nome: args.bucket_id,
    criticidade: 'pendente',
  };
}

export interface MkHistoricoArgs {
  recorrencias?: readonly Recorrencia[];
  contraparteHistory?: ReadonlyMap<string, ContraparteStats>;
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>;
  eventosEstimados?: readonly EventoCaixa[];
}

export function mkHistorico(args: MkHistoricoArgs = {}): HistoricoOperacional {
  return {
    contraparteHistory: args.contraparteHistory
      ? new Map(args.contraparteHistory)
      : new Map(),
    recorrencias: [...(args.recorrencias ?? [])],
    volatilidades: args.volatilidades
      ? new Map(args.volatilidades)
      : new Map(),
    geradoEm: GERADO_EM,
    baseDe: {
      primeiroEvento: utc(2023, 1, 1),
      ultimoEvento: utc(2026, 4, 30),
      totalRealizados: 0,
    },
    eventosEstimados: [...(args.eventosEstimados ?? [])],
  };
}

export { utc };
