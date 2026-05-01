import type {
  EventoCaixa,
  Periodo,
  Recorrencia,
} from '../types/index.js';
import { HistoricoError } from '../types/index.js';
import { diffDays, median } from './stats.js';

/**
 * Tabela de períodos suportados, cada um com:
 *  - `min`/`max` (em dias): faixa que classifica o gap como pertencente
 *    ao período (mediana dos gaps deve cair aqui).
 *  - `center`: dia-alvo para tolerância "estrita" usada em `confianca='alta'`
 *    (todos os gaps em ±2 do center).
 */
const PERIODO_TABLE: ReadonlyArray<{
  periodo: Periodo;
  min: number;
  max: number;
  center: number;
}> = [
  { periodo: 'semanal', min: 6, max: 8, center: 7 },
  { periodo: 'quinzenal', min: 13, max: 17, center: 14 },
  { periodo: 'mensal', min: 28, max: 32, center: 30 },
  { periodo: 'bimestral', min: 58, max: 64, center: 60 },
  { periodo: 'trimestral', min: 88, max: 94, center: 90 },
];

/** Tolerância de cluster por valor (±10% sobre o mediano da série). */
const VALOR_TOLERANCIA = 0.1;

/**
 * Tolerância em dias para classificação de confiança. A spec diz
 * "todos os gaps batem no período (tolerância ±2 dias)". Interpretação:
 * cada gap deve estar no `[periodo.min - tol, periodo.max + tol]`. Isso
 * absorve a variância natural de meses-calendário (28–31 dias) e
 * ajustes ocasionais de feriado/fim de semana sem mover a recorrência
 * de "alta" para "média".
 */
const PERIODO_TOL_DIAS = 2;

/** Cluster: agrupa eventos por valor com tolerância ±10% sobre a mediana. */
function clusterPorValor(eventos: EventoCaixa[]): EventoCaixa[][] {
  if (eventos.length === 0) return [];
  const sorted = [...eventos].sort((a, b) => a.valor - b.valor);
  const clusters: EventoCaixa[][] = [];
  let current: EventoCaixa[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i]!;
    const refMediana = median(current.map((x) => x.valor));
    if (Math.abs(e.valor - refMediana) <= VALOR_TOLERANCIA * refMediana) {
      current.push(e);
    } else {
      clusters.push(current);
      current = [e];
    }
  }
  clusters.push(current);
  return clusters;
}

/** Mapeia uma mediana de gaps em um Periodo, ou null se fora das faixas. */
function periodoDoGap(medianaGap: number): Periodo | null {
  for (const row of PERIODO_TABLE) {
    if (medianaGap >= row.min && medianaGap <= row.max) return row.periodo;
  }
  return null;
}

/**
 * Detecta séries recorrentes em eventos `realizado`.
 *
 * Algoritmo:
 *  1. Filtra eventos realizado com `data_realizada`, `contraparte_id`,
 *     `bucket_id`, `valor > 0`.
 *  2. Agrupa por `(contraparte_id, bucket_id)`.
 *  3. Dentro de cada grupo, faz cluster por valor (±10% sobre a mediana).
 *  4. Cluster com `n >= 3` vira candidato a recorrência:
 *     - Calcula gaps em dias entre datas consecutivas.
 *     - Mediana dos gaps → `Periodo` provável (ou descarta).
 *     - Verifica `ativa` (última < 1.5 períodos atrás de `geradoEm`).
 *     - Classifica `confianca` (alta/media/baixa).
 *
 * Saída ordenada por `recorrencia_id` (estável). Mesma entrada → mesmo
 * array (provimento de determinismo).
 */
export function detectRecorrencias(
  eventos: readonly EventoCaixa[],
  geradoEm: Date,
): Recorrencia[] {
  // Filtra elegíveis (com defensive check).
  const elegiveis: EventoCaixa[] = [];
  for (const e of eventos) {
    if (e.status !== 'realizado') continue;
    const dr = e.data_realizada;
    if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) {
      throw new HistoricoError(
        `evento ${e.id}: realizado sem data_realizada válida`,
      );
    }
    if (e.contraparte_id === undefined) continue;
    if (e.bucket_id === '') continue;
    if (e.valor <= 0) continue;
    elegiveis.push(e);
  }

  // Agrupa por (contraparte_id, bucket_id).
  const grupos = new Map<string, EventoCaixa[]>();
  for (const e of elegiveis) {
    const key = `${e.contraparte_id ?? ''}::${e.bucket_id}`;
    const arr = grupos.get(key);
    if (arr === undefined) grupos.set(key, [e]);
    else arr.push(e);
  }

  const result: Recorrencia[] = [];

  for (const [key, eventosGrupo] of grupos) {
    const clusters = clusterPorValor(eventosGrupo);
    for (const cluster of clusters) {
      if (cluster.length < 3) continue;

      // Ordena por data_realizada e calcula gaps.
      const sortedByDate = [...cluster].sort((a, b) => {
        const da = (a.data_realizada as Date).getTime();
        const db = (b.data_realizada as Date).getTime();
        return da - db;
      });
      const datas = sortedByDate.map((e) => e.data_realizada as Date);
      const gaps: number[] = [];
      for (let i = 1; i < datas.length; i++) {
        gaps.push(diffDays(datas[i]!, datas[i - 1]!));
      }
      if (gaps.length === 0) continue;

      const medianaGap = median(gaps);
      const periodo = periodoDoGap(medianaGap);
      if (periodo === null) continue; // sem padrão temporal reconhecido

      const periodoRow = PERIODO_TABLE.find((p) => p.periodo === periodo)!;
      const center = periodoRow.center;

      const primeira = datas[0]!;
      const ultima = datas[datas.length - 1]!;

      // Ativa: última < 1.5 períodos atrás de geradoEm.
      const cutoffMs =
        geradoEm.getTime() - 1.5 * center * 86_400_000;
      const ativa = ultima.getTime() >= cutoffMs;

      // Classifica confiança. Gap "no período" = dentro do range
      // [min, max] da tabela, com buffer ±PERIODO_TOL_DIAS. Para mensal
      // (range 28-32), faixa efetiva é 26-34: absorve mês de 31 dias +
      // 1 dia de slip ocasional sem rebaixar para média.
      const tolMin = periodoRow.min - PERIODO_TOL_DIAS;
      const tolMax = periodoRow.max + PERIODO_TOL_DIAS;
      const matches = gaps.filter((g) => g >= tolMin && g <= tolMax);
      const n = cluster.length;
      let confianca: 'alta' | 'media' | 'baixa';
      if (!ativa) {
        confianca = 'baixa';
      } else if (n >= 6 && matches.length === gaps.length) {
        confianca = 'alta';
      } else if (n >= 3 && matches.length > gaps.length / 2) {
        confianca = 'media';
      } else {
        confianca = 'baixa';
      }

      const valores = cluster.map((e) => e.valor).sort((a, b) => a - b);
      const valor_mediano = median(valores, true);
      const valor_classe_min = valores[0]!;
      const valor_classe_max = valores[valores.length - 1]!;

      const [contraparteId, bucketId] = key.split('::') as [string, string];

      const recorrencia_id = `rec_${contraparteId}_${bucketId}_${valor_mediano.toFixed(2)}_${primeira
        .toISOString()
        .slice(0, 10)}`;

      // Campos herdados do cluster — homogêneos por construção (mesmo
      // contraparte + bucket + cluster de valor).
      const sample = sortedByDate[0]!;
      const sourceCodes = new Set<string>();
      let contraparteTipo: typeof sample.contraparte_tipo;
      for (const e of cluster) {
        if (e.source_company_code !== undefined) sourceCodes.add(e.source_company_code);
        if (contraparteTipo === undefined && e.contraparte_tipo !== undefined) {
          contraparteTipo = e.contraparte_tipo;
        }
      }

      const rec: import('../types/historico.js').Recorrencia = {
        recorrencia_id,
        contraparte_id: contraparteId,
        bucket_id: bucketId,
        valor_mediano,
        valor_classe_min,
        valor_classe_max,
        periodo,
        n_ocorrencias: n,
        primeira_data: primeira,
        ultima_data: ultima,
        ativa,
        confianca,
        inferido_de: 'agrupamento_contraparte_bucket_valor',
        n_amostras: n,
        direcao: sample.direcao,
        cliente_id: sample.cliente_id,
        legal_entity_id: sample.legal_entity_id,
        bucket_nome: sample.bucket_nome,
        criticidade: sample.criticidade,
      };
      if (contraparteTipo !== undefined) rec.contraparte_tipo = contraparteTipo;
      if (sourceCodes.size === 1) {
        rec.source_company_code = [...sourceCodes][0]!;
      }
      result.push(rec);
    }
  }

  // Ordenação determinística por recorrencia_id.
  result.sort((a, b) => a.recorrencia_id.localeCompare(b.recorrencia_id));
  return result;
}
