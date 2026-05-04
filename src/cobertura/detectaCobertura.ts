/**
 * Estágio 5.1 — Orquestrador de detecção de cobertura.
 *
 * Roda 5 detectores em ordem fixa e compõe `CoberturaResult`:
 *
 *  1. `detectaSaldoAbertura` → MotivoInsuficiencia[].
 *  2. `detectaBancoSemDado` → MotivoInsuficiencia[].
 *  3. `detectaSemanaZerada` → Pendencia[].
 *  4. `detectaRecorrenciaAusente` → Pendencia[].
 *  5. `agregaPendentesClassificacao` → Pendencia[].
 *
 * Concatena pendências e classifica `status`:
 *  - `'cobertura_insuficiente'` se há motivos.
 *  - `'cobertura_com_confianca_reduzida'` se sem motivos mas com pendências.
 *  - `'cobertura_completa'` se ambos vazios.
 *
 * **Pendências detectadas mesmo em `cobertura_insuficiente`** —
 * Stage 7 que decide se substitui veredito; Stage 5 só prepara dados.
 *
 * **Stage 5 não rebaixa confiança** — saída `CoberturaResult` não tem
 * campo `confianca`, e os inputs (`eventos`, `projecao`) não são mutados.
 */
import type {
  CoberturaEstatisticas,
  CoberturaResult,
  CoberturaStatus,
  EventoCaixa,
  HistoricoOperacional,
  MotivoInsuficiencia,
  OpeningBalanceSnapshot,
  Pendencia,
  ProjecaoCliente,
  TipoPendencia,
} from '../types/index.js';
import { CoberturaError } from '../types/cobertura.js';
import { agregaPendentesClassificacao } from './agregaPendentesClassificacao.js';
import { detectaBancoSemDado } from './detectaBancoSemDado.js';
import { detectaRecorrenciaAusente } from './detectaRecorrenciaAusente.js';
import { detectaSaldoAbertura } from './detectaSaldoAbertura.js';
import { detectaSemanaZerada } from './detectaSemanaZerada.js';

export interface DetectaCoberturaInput {
  eventos: readonly EventoCaixa[];
  historico: HistoricoOperacional;
  projecao: ProjecaoCliente;
  saldos: readonly OpeningBalanceSnapshot[];
  cliente_id: string;
  legal_entity_ids_ativas: readonly string[];
  geradoEm: Date;
}

export function detectaCobertura(
  input: DetectaCoberturaInput,
): CoberturaResult {
  /* Validação de input. */
  if (
    typeof input.cliente_id !== 'string' ||
    input.cliente_id === ''
  ) {
    throw new CoberturaError('detectaCobertura: cliente_id ausente');
  }
  if (
    !(input.geradoEm instanceof Date) ||
    Number.isNaN(input.geradoEm.getTime())
  ) {
    throw new CoberturaError(
      'detectaCobertura: geradoEm ausente ou inválido',
    );
  }
  if (input.projecao.cliente_id !== input.cliente_id) {
    throw new CoberturaError(
      `detectaCobertura: projecao.cliente_id (${input.projecao.cliente_id}) divergente do cliente_id (${input.cliente_id})`,
    );
  }

  /* Caso vazio: nenhuma unidade ativa → cobertura completa, listas vazias. */
  if (input.legal_entity_ids_ativas.length === 0) {
    return {
      status: 'cobertura_completa',
      pendencias: [],
      motivosInsuficiencia: [],
      estatisticas: estatisticasZeradas(),
      detectadoEm: input.geradoEm,
    };
  }

  /* 1+2: Motivos de cobertura insuficiente. */
  const motivosSaldo = detectaSaldoAbertura(input.projecao);
  const motivosBanco = detectaBancoSemDado({
    eventos: input.eventos,
    saldos: input.saldos,
    cliente_id: input.cliente_id,
    legal_entity_ids_ativas: input.legal_entity_ids_ativas,
    geradoEm: input.geradoEm,
  });
  const motivosInsuficiencia = [...motivosSaldo, ...motivosBanco].sort(
    (a, b) => {
      const c = a.tipo.localeCompare(b.tipo);
      if (c !== 0) return c;
      return a.legal_entity_id.localeCompare(b.legal_entity_id);
    },
  );

  /* 3+4+5: Pendências (continuam mesmo se houver motivos). */
  const pendsZerada = detectaSemanaZerada(input.projecao);
  const pendsRecorrencia = detectaRecorrenciaAusente({
    eventos: input.eventos,
    historico: input.historico,
    projecao: input.projecao,
  });
  const pendsClassificacao = agregaPendentesClassificacao({
    eventos: input.eventos,
    projecao: input.projecao,
  });
  const pendencias = [
    ...pendsZerada,
    ...pendsRecorrencia,
    ...pendsClassificacao,
  ].sort(comparaPendencias);

  /* Estatísticas. */
  const estatisticas = montaEstatisticas(pendencias, motivosInsuficiencia);

  /* Status da cobertura. */
  const status: CoberturaStatus =
    motivosInsuficiencia.length > 0
      ? 'cobertura_insuficiente'
      : pendencias.length > 0
        ? 'cobertura_com_confianca_reduzida'
        : 'cobertura_completa';

  return {
    status,
    pendencias,
    motivosInsuficiencia,
    estatisticas,
    detectadoEm: input.geradoEm,
  };
}

/* ─────────── Helpers internos ─────────── */

function comparaPendencias(a: Pendencia, b: Pendencia): number {
  const c1 = a.legal_entity_id.localeCompare(b.legal_entity_id);
  if (c1 !== 0) return c1;
  const c2 = a.semana_iso.localeCompare(b.semana_iso);
  if (c2 !== 0) return c2;
  const c3 = a.tipo.localeCompare(b.tipo);
  if (c3 !== 0) return c3;
  return a.id.localeCompare(b.id);
}

function estatisticasZeradas(): CoberturaEstatisticas {
  return {
    pendenciasPorTipo: new Map(),
    pendenciasPorUnidade: new Map(),
    semanasComPendencia: 0,
    totalEventosPendentesClassificacao: 0,
    valorTotalPendentesClassificacao: 0,
    motivosInsuficienciaCount: 0,
  };
}

function montaEstatisticas(
  pendencias: readonly Pendencia[],
  motivos: readonly MotivoInsuficiencia[],
): CoberturaEstatisticas {
  const porTipo = new Map<TipoPendencia, number>();
  const porUnidade = new Map<string, number>();
  const semanasUnicas = new Set<string>();
  let totalEventosPendentes = 0;
  let valorTotalPendentes = 0;

  for (const p of pendencias) {
    porTipo.set(p.tipo, (porTipo.get(p.tipo) ?? 0) + 1);
    porUnidade.set(
      p.legal_entity_id,
      (porUnidade.get(p.legal_entity_id) ?? 0) + 1,
    );
    semanasUnicas.add(`${p.legal_entity_id}|${p.semana_iso}`);
    if (p.tipo === 'pendentes_classificacao_agregados') {
      totalEventosPendentes += p.quantidade_eventos ?? 0;
      valorTotalPendentes += p.valor_total ?? 0;
    }
  }

  return {
    pendenciasPorTipo: porTipo,
    pendenciasPorUnidade: porUnidade,
    semanasComPendencia: semanasUnicas.size,
    totalEventosPendentesClassificacao: totalEventosPendentes,
    valorTotalPendentesClassificacao: valorTotalPendentes,
    motivosInsuficienciaCount: motivos.length,
  };
}
