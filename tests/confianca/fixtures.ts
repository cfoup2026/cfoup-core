/**
 * Fixtures helper para testes do Estágio 6 — Motor de Confiança.
 *
 * Constrói `EventoCaixa[]`, `ProjecaoCliente` e `CoberturaResult`
 * mínimos com sobrescrita pontual. Reutiliza `mkEvento` de
 * `tests/reconciliacao/fixtures/mkEvento.ts` (única fonte de
 * `EventoCaixa` factory no repo).
 */
import {
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanasJanela,
  type CaixaInicial,
  type CoberturaResult,
  type Confianca,
  type Direcao,
  type EventoCaixa,
  type MotivoInsuficiencia,
  type Pendencia,
  type ProjecaoCliente,
  type ProjecaoConsolidada,
  type ProjecaoUnidade,
  type SemanaProjecao,
  type Status,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

export const GERADO_EM = utc(2026, 5, 1); // sex, W18

/* ─────────── Helpers para `EventoCaixa` com confiança/criticidade ─────────── */

export interface MkEventoConfArgs {
  id: string;
  cliente_id?: string;
  legal_entity_id?: string;
  status: Status;
  origem?: EventoCaixa['origem'];
  direcao: Direcao;
  valor: number;
  /** `confianca`: 'alta' | 'media' | 'baixa'. */
  confianca: Confianca;
  /** Default `'pendente'`. */
  criticidade?: EventoCaixa['criticidade'];
  bucket_id?: string;
  is_transferencia?: boolean;
  transferencia_par_id?: string;
  /** Para `realizado`. */
  data_realizada?: Date;
  /** Para `confirmado`. */
  data_vencimento?: Date;
  /** `data_esperada`: default coincide com `data_realizada`/`data_vencimento`. */
  data_esperada?: Date;
}

/**
 * Builder de `EventoCaixa` com `confianca` explícita. mkEvento default
 * já produz `confianca='alta'`; aqui sobrescrevemos para os testes que
 * precisam de `'media'`/`'baixa'`. `bucket_id` e `criticidade` também
 * controláveis (default mantém `'pendente_classificacao'`/`'pendente'`).
 */
export function mkEventoConf(args: MkEventoConfArgs): EventoCaixa {
  const data =
    args.data_esperada ??
    args.data_realizada ??
    args.data_vencimento ??
    utc(2026, 5, 5);

  const baseArgs: Parameters<typeof mkEvento>[0] = {
    id: args.id,
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id ?? 'u1',
    status: args.status,
    origem: args.origem ?? 'fkn',
    direcao: args.direcao,
    valor: args.valor,
    data_esperada: data,
  };
  if (args.criticidade !== undefined) baseArgs.criticidade = args.criticidade;
  if (args.data_realizada !== undefined) baseArgs.data_realizada = args.data_realizada;
  if (args.data_vencimento !== undefined) baseArgs.data_vencimento = args.data_vencimento;
  if (args.is_transferencia !== undefined) baseArgs.is_transferencia = args.is_transferencia;
  if (args.transferencia_par_id !== undefined)
    baseArgs.transferencia_par_id = args.transferencia_par_id;

  const ev = mkEvento(baseArgs);
  /* mkEvento default = confianca='alta'. Sobrescrevemos via spread; se
   *  bucket_id custom, idem. Nenhum mutation no objeto retornado de mkEvento
   *  (criamos novo objeto). */
  const overrides: Partial<EventoCaixa> = {
    confianca: args.confianca,
  };
  if (args.bucket_id !== undefined) overrides.bucket_id = args.bucket_id;
  return { ...ev, ...overrides } as EventoCaixa;
}

/* ─────────── Helpers para `SemanaProjecao` ─────────── */

interface MkSemanaArgs {
  semana_iso: string;
  evento_ids?: readonly string[];
  eventos_pendentes_com_data_ids?: readonly string[];
}

export function mkSemana(args: MkSemanaArgs): SemanaProjecao {
  return {
    semana_iso: args.semana_iso,
    inicio: inicioDaSemanaIso(args.semana_iso),
    fim: fimDaSemanaIso(args.semana_iso),
    caixa_inicial: 0,
    entradas_realizadas: 0,
    entradas_confirmadas: 0,
    entradas_estimadas: 0,
    saidas_realizadas: 0,
    saidas_confirmadas: 0,
    saidas_estimadas: 0,
    total_entradas: 0,
    total_saidas: 0,
    variacao_liquida: 0,
    caixa_final: 0,
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

/* ─────────── `ProjecaoUnidade` / `ProjecaoCliente` builders ─────────── */

export interface MkUnidadeConfArgs {
  legal_entity_id: string;
  cliente_id?: string;
  /** Mapa `idx (0..12) → evento_ids[]`. Semanas omitidas ficam vazias. */
  evento_ids_por_semana?: ReadonlyMap<number, readonly string[]>;
  caixaInicial?: Partial<CaixaInicial>;
}

export function mkUnidadeConf(args: MkUnidadeConfArgs): ProjecaoUnidade {
  const janela = semanasJanela(GERADO_EM, 13);
  const semanas = janela.map((semana_iso, idx) => {
    const ids = args.evento_ids_por_semana?.get(idx);
    return mkSemana(ids !== undefined ? { semana_iso, evento_ids: ids } : { semana_iso });
  });
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
  return {
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id,
    geradoEm: GERADO_EM,
    janela,
    caixaInicial,
    semanas,
    allocationDatesByEventoId: new Map(),
    eventosAtrasados: [],
    eventosForaDaJanela: [],
    eventosNaoAlocados: [],
    estatisticas: {
      eventosTotal: 0,
      eventosNaGrade: 0,
      eventosAtrasadosCount: 0,
      eventosForaDaJanelaCount: 0,
      eventosNaoAlocadosCount: 0,
      confirmadosComHookAplicado: 0,
    },
  };
}

export interface MkProjecaoConfArgs {
  cliente_id?: string;
  unidades?: readonly ProjecaoUnidade[];
  /** Mapa `idx (0..12) → evento_ids[]` para o consolidado (já com
   *  transferências neutralizadas pelo Stage 4 — fixture só simula). */
  consolidado_evento_ids_por_semana?: ReadonlyMap<number, readonly string[]>;
}

export function mkProjecaoConf(args: MkProjecaoConfArgs = {}): ProjecaoCliente {
  const cliente_id = args.cliente_id ?? 'c1';
  const unidades = args.unidades ?? [mkUnidadeConf({ legal_entity_id: 'u1' })];
  const janela = semanasJanela(GERADO_EM, 13);
  const consolidadoSemanas = janela.map((semana_iso, idx) => {
    const ids = args.consolidado_evento_ids_por_semana?.get(idx);
    return mkSemana(ids !== undefined ? { semana_iso, evento_ids: ids } : { semana_iso });
  });

  const consolidado: ProjecaoConsolidada = {
    cliente_id,
    legal_entity_ids: unidades.map((u) => u.legal_entity_id),
    geradoEm: GERADO_EM,
    janela,
    caixaInicial: {
      valor: unidades.reduce((s, u) => s + u.caixaInicial.valor, 0),
      por_unidade: new Map(unidades.map((u) => [u.legal_entity_id, u.caixaInicial])),
      alguma_stale: false,
      alguma_ausente: false,
    },
    semanas: consolidadoSemanas,
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

/* ─────────── `CoberturaResult` builder ─────────── */

export interface MkCoberturaArgs {
  pendencias?: readonly Pendencia[];
  motivosInsuficiencia?: readonly MotivoInsuficiencia[];
}

export function mkCobertura(args: MkCoberturaArgs = {}): CoberturaResult {
  const pendencias = args.pendencias ?? [];
  const motivos = args.motivosInsuficiencia ?? [];
  return {
    status:
      motivos.length > 0
        ? 'cobertura_insuficiente'
        : pendencias.length > 0
          ? 'cobertura_com_confianca_reduzida'
          : 'cobertura_completa',
    pendencias: [...pendencias],
    motivosInsuficiencia: [...motivos],
    estatisticas: {
      pendenciasPorTipo: new Map(),
      pendenciasPorUnidade: new Map(),
      semanasComPendencia: 0,
      totalEventosPendentesClassificacao: 0,
      valorTotalPendentesClassificacao: 0,
      motivosInsuficienciaCount: motivos.length,
    },
    detectadoEm: GERADO_EM,
  };
}

export { utc };
