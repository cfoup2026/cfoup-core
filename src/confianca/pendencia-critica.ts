/**
 * Detecção de pendências críticas (§9.3 ajustado do prompt 6).
 *
 * Stage 6 só considera SAÍDAS (entradas com `criticidade=pendente` NÃO
 * viram pendência crítica — evita falso problema em receita/AR não
 * classificada). Transferências internas com `is_transferencia=true`
 * são excluídas.
 *
 * Materialidade: `|valor| >= 10% × saidas_semana` OU `|valor| >= R$ 5.000`.
 *
 * Condição de status/criticidade (uma delas basta):
 *  - `status === 'pendente'`, ou
 *  - `criticidade ∈ {'obrigatoria', 'critica_op', 'pendente'}`.
 *
 * Motivo:
 *  - `'status_pendente'` quando `status === 'pendente'` (vence se ambos
 *    casam).
 *  - Caso contrário, `'criticidade_obrigatoria_critica_op_pendente'`.
 *
 * **Recalculado por escopo** (unidade ou consolidado): a materialidade
 * relativa muda quando o denominador muda. Stage 6 NÃO soma pendências
 * das unidades para construir o consolidado — recalcula do zero.
 */
import type { EventoCaixa } from '../types/index.js';
import { ehMaterial } from './materialidade.js';
import {
  type MotivoPendenciaCritica,
  type PendenciaCritica,
} from './types.js';

const CRITICIDADES_GATILHO = new Set<EventoCaixa['criticidade']>([
  'obrigatoria',
  'critica_op',
  'pendente',
]);

export interface DetectarPendenciasSemanaInput {
  /** Eventos da semana N (já resolvidos via `evento_ids` da projeção). */
  eventos: readonly EventoCaixa[];
  /** Soma `|valor|` de eventos `saida` & `is_transferencia=false`
   *  do escopo (unidade OU consolidado), na mesma semana. */
  saidasSemana: number;
  /** Número da semana (1..13). */
  semana: number;
  /** Identificador da unidade ou `'consolidado:<cliente_id>'`. */
  legal_entity_id: string;
  /** Cliente. Carregado para auditoria/drill-down. */
  cliente_id: string;
}

/**
 * Detecta pendências críticas em UMA semana. Determinístico —
 * iteração na ordem dos `eventos` recebidos; ordenação final por
 * `evento_id` lex.
 */
export function detectarPendenciasCriticasSemana(
  input: DetectarPendenciasSemanaInput,
): PendenciaCritica[] {
  const out: PendenciaCritica[] = [];

  for (const ev of input.eventos) {
    /* (1) Direção: só saída. */
    if (ev.direcao !== 'saida') continue;
    /* (2) Transferência interna: excluída. */
    if (ev.is_transferencia === true) continue;

    /* (4) Status/criticidade. */
    const statusPendente = ev.status === 'pendente';
    const criticidadeGatilho = CRITICIDADES_GATILHO.has(ev.criticidade);
    if (!statusPendente && !criticidadeGatilho) continue;

    /* (3) Materialidade. */
    const valorAbs = Math.abs(ev.valor);
    const matAval = ehMaterial(valorAbs, input.saidasSemana);
    if (!matAval.is_material) continue;

    /* `trigger` está definido sempre que `is_material === true`. */
    if (matAval.trigger === undefined) continue;

    const motivo: MotivoPendenciaCritica = statusPendente
      ? 'status_pendente'
      : 'criticidade_obrigatoria_critica_op_pendente';

    out.push({
      evento_id: ev.id,
      legal_entity_id: input.legal_entity_id,
      cliente_id: input.cliente_id,
      semana: input.semana,
      valor: ev.valor,
      direcao: 'saida',
      status: ev.status,
      criticidade: ev.criticidade,
      bucket_id: ev.bucket_id,
      motivo,
      trigger_materialidade: matAval.trigger,
    });
  }

  out.sort((a, b) => a.evento_id.localeCompare(b.evento_id));
  return out;
}

/**
 * Calcula `saidas_semana(N)` no escopo: soma `|valor|` de eventos com
 * `direcao='saida'` E `is_transferencia=false`. No consolidado, eventos
 * de transferência válidos já foram removidos pelo Stage 4 — Stage 6
 * só passa o que recebe.
 */
export function calcularSaidasSemana(
  eventos: readonly EventoCaixa[],
): number {
  let total = 0;
  for (const ev of eventos) {
    if (ev.direcao !== 'saida') continue;
    if (ev.is_transferencia === true) continue;
    total += Math.abs(ev.valor);
  }
  return total;
}
