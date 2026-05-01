import type {
  Criticidade,
  EventoCaixa,
  VolatilidadeStats,
} from '../types/index.js';
import { HistoricoError } from '../types/index.js';
import { mean, populationStddev } from './stats.js';

const MS_PER_DAY = 86_400_000;
const JANELA_DIAS = 365;

export interface CalcVolatilidadeOptions {
  /** Quando o cálculo está sendo feito. Define a janela (cutoff = geradoEm - 365d). */
  geradoEm: Date;
  /**
   * Conjunto de criticidades consideradas. Default da spec §3.C:
   * `['obrigatoria', 'critica_op']`. Em V0 (antes do motor de classificação
   * rodar — Estágio 3+), todos os eventos chegam com `criticidade='pendente'`
   * do bucket técnico; o caller pode passar um conjunto que inclua
   * `'pendente'` para que volatilidade seja calculada sobre as saídas
   * existentes. Quando classification rolar, a maioria das saídas
   * recorrentes ganha criticidade real e o caller volta ao default.
   */
  criticidades?: ReadonlyArray<Criticidade>;
}

/** Chave estável de competência ou semana ISO. */
type ChaveTemporal = string;

/** ISO week-year + ISO week para datas UTC. Convenção ISO 8601 padrão:
 *  semana começa segunda; semana 1 é a que contém o primeiro quintaire (5/1)
 *  do ano (ou: a primeira semana com ≥4 dias do ano). */
function isoWeekKey(d: Date): ChaveTemporal {
  // Algoritmo padrão: copia, move pra quinta-feira da mesma semana.
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // quinta-feira da semana
  const isoYear = t.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Coeficiente de variação das saídas obrigatórias/críticas dos últimos
 * 12 meses, agrupado por `legal_entity_id` × competência (ou semana ISO
 * como fallback).
 *
 * V0: aqui produz `cv` BRUTO. Aplicação de teto 25% e fallback 10%
 * acontece no Estágio 4 (Projeção) — não toca aqui.
 */
export function calcVolatilidade(
  eventos: readonly EventoCaixa[],
  options: CalcVolatilidadeOptions,
): Map<string, VolatilidadeStats> {
  const criticidades = new Set<Criticidade>(
    options.criticidades ?? ['obrigatoria', 'critica_op'],
  );
  const cutoffMs = options.geradoEm.getTime() - JANELA_DIAS * MS_PER_DAY;

  // 1) Filtro: realizados, saída, criticidade relevante, dentro da janela.
  // 2) Agrupa por legal_entity_id.
  const porLegal = new Map<
    string,
    {
      eventos: EventoCaixa[];
      todosTemCompetencia: boolean;
    }
  >();

  for (const e of eventos) {
    if (e.status !== 'realizado') continue;
    const dr = e.data_realizada;
    if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) {
      throw new HistoricoError(
        `evento ${e.id}: realizado sem data_realizada válida`,
      );
    }
    if (e.direcao !== 'saida') continue;
    if (!criticidades.has(e.criticidade)) continue;
    if (dr.getTime() < cutoffMs) continue;

    const slot = porLegal.get(e.legal_entity_id);
    if (slot === undefined) {
      porLegal.set(e.legal_entity_id, {
        eventos: [e],
        todosTemCompetencia: e.competencia !== undefined,
      });
    } else {
      slot.eventos.push(e);
      if (e.competencia === undefined) slot.todosTemCompetencia = false;
    }
  }

  const result = new Map<string, VolatilidadeStats>();

  for (const [legal_entity_id, { eventos: events, todosTemCompetencia }] of
    porLegal) {
    // 3) Decide base temporal e agrupa.
    const base_temporal: 'competencia' | 'semana_iso' = todosTemCompetencia
      ? 'competencia'
      : 'semana_iso';

    const totaisPorPeriodo = new Map<ChaveTemporal, number>();
    for (const e of events) {
      const key: ChaveTemporal =
        base_temporal === 'competencia'
          ? (e.competencia as string) // garantido pelo flag
          : isoWeekKey(e.data_realizada as Date);
      totaisPorPeriodo.set(key, (totaisPorPeriodo.get(key) ?? 0) + e.valor);
    }

    const totals = [...totaisPorPeriodo.values()];
    const n_periodos = totals.length;

    let media = 0;
    let desvio = 0;
    if (n_periodos > 0) {
      media = mean(totals);
      desvio = populationStddev(totals, media);
    }
    const cv = media === 0 ? 0 : desvio / media;
    const qualidade: 'alta' | 'insuficiente' =
      n_periodos >= 12 ? 'alta' : 'insuficiente';
    const confianca_inferencia: 'alta' | 'baixa' =
      qualidade === 'alta' ? 'alta' : 'baixa';

    result.set(legal_entity_id, {
      legal_entity_id,
      n_periodos,
      media,
      desvio,
      cv,
      qualidade,
      base_temporal,
      inferido_de: 'saidas_obrigatorias_critica_op_12m',
      n_amostras: events.length,
      confianca_inferencia,
    });
  }

  return result;
}
