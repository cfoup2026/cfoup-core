/**
 * Cálculo da confiança de UMA semana (§9.2 do spec).
 *
 * Pesos:
 *   peso_total = soma `|valor|` de TODOS os eventos da semana
 *   peso_alta  = soma `|valor|` onde `confianca === 'alta'`
 *   peso_baixa = soma `|valor|` onde `confianca === 'baixa'`
 *
 * (No repo, `Confianca` é `'alta' | 'media' | 'baixa'` — não há
 *  `'pendente'`. A regra do spec do prompt 6 "se enum existir, peso_baixa
 *  inclui pendente" não se aplica.)
 *
 * Avaliação em ordem (primeiro que casa vence):
 *   1. peso_total = 0           → baixa, motivo='peso_total_zero'
 *   2. tem pendência crítica    → baixa, motivo='pendencia_critica'
 *   3. pct_baixa > 0.25         → baixa, motivo='pct_baixa_alta'
 *   4. pct_alta < 0.50          → baixa, motivo='pct_alta_baixa'
 *   5. pct_alta ≥ 0.75          → alta
 *   6. caso contrário           → media
 *
 * `pct_alta`/`pct_baixa` são `null` quando `peso_total === 0` —
 * matematicamente indefinidos.
 */
import type { Confianca, EventoCaixa, SemanaProjecao } from '../types/index.js';
import { ConfiancaError } from './types.js';
import {
  THRESHOLD_PCT_ALTA,
  THRESHOLD_PCT_ALTA_MIN_MEDIA,
  THRESHOLD_PCT_BAIXA,
  type ConfiancaSemana,
  type MotivoBaixa,
  type PendenciaCritica,
} from './types.js';

export interface CalcularConfiancaSemanaInput {
  /** Número da semana (1..13). */
  semana: number;
  /** Semana da projeção — usada para `data_inicio`/`data_fim`. */
  semanaProjecao: SemanaProjecao;
  /** Eventos da semana já resolvidos a partir de `evento_ids`. */
  eventos: readonly EventoCaixa[];
  /** Pendências críticas da semana (já calculadas no escopo). */
  pendenciasCriticas: readonly PendenciaCritica[];
}

/**
 * @throws `ConfiancaError` se algum evento chegar sem `confianca`
 *   resolvida (`undefined`/`null`/string fora do enum).
 */
export function calcularConfiancaSemana(
  input: CalcularConfiancaSemanaInput,
): ConfiancaSemana {
  const { semana, semanaProjecao, eventos, pendenciasCriticas } = input;

  let peso_total = 0;
  let peso_alta = 0;
  let peso_baixa = 0;

  for (const ev of eventos) {
    if (
      ev.confianca !== 'alta' &&
      ev.confianca !== 'media' &&
      ev.confianca !== 'baixa'
    ) {
      throw new ConfiancaError(
        `evento ${ev.id}: confianca não resolvida (recebido: ${JSON.stringify(ev.confianca)})`,
      );
    }
    const v = Math.abs(ev.valor);
    peso_total += v;
    if (ev.confianca === 'alta') peso_alta += v;
    else if (ev.confianca === 'baixa') peso_baixa += v;
    /* `media` não soma em peso_alta nem peso_baixa — é o intervalo
     *  intermediário que não puxa a semana pra nenhum extremo. */
  }

  const pct_alta = peso_total > 0 ? peso_alta / peso_total : null;
  const pct_baixa = peso_total > 0 ? peso_baixa / peso_total : null;

  /* IDs das pendências críticas (ordem lex) — preserva determinismo
   *  mesmo com pendencias ordenadas de outra forma upstream. */
  const pendencias_criticas_ids = pendenciasCriticas
    .map((p) => p.evento_id)
    .sort((a, b) => a.localeCompare(b));

  const { confianca, motivo_baixa } = avaliaConfianca(
    peso_total,
    pct_alta,
    pct_baixa,
    pendencias_criticas_ids.length > 0,
  );

  const result: ConfiancaSemana = {
    semana,
    data_inicio: semanaProjecao.inicio.toISOString(),
    data_fim: semanaProjecao.fim.toISOString(),
    peso_total,
    peso_alta,
    peso_baixa,
    pct_alta,
    pct_baixa,
    confianca,
    pendencias_criticas_ids,
  };
  if (motivo_baixa !== undefined) result.motivo_baixa = motivo_baixa;
  return result;
}

/* ─────────── Helpers internos ─────────── */

interface AvaliacaoConfianca {
  confianca: Confianca;
  motivo_baixa?: MotivoBaixa;
}

function avaliaConfianca(
  peso_total: number,
  pct_alta: number | null,
  pct_baixa: number | null,
  temPendenciaCritica: boolean,
): AvaliacaoConfianca {
  /* (1) Sem peso → baixa. */
  if (peso_total === 0) {
    return { confianca: 'baixa', motivo_baixa: 'peso_total_zero' };
  }
  /* (2) Pendência crítica → baixa. */
  if (temPendenciaCritica) {
    return { confianca: 'baixa', motivo_baixa: 'pendencia_critica' };
  }
  /* `pct_alta`/`pct_baixa` são not-null aqui (peso_total > 0). */
  /* (3) Muito 'baixa' explícita → baixa. */
  if (pct_baixa !== null && pct_baixa > THRESHOLD_PCT_BAIXA) {
    return { confianca: 'baixa', motivo_baixa: 'pct_baixa_alta' };
  }
  /* (4) Pouca 'alta' — nem dá pra `media` → baixa. */
  if (pct_alta !== null && pct_alta < THRESHOLD_PCT_ALTA_MIN_MEDIA) {
    return { confianca: 'baixa', motivo_baixa: 'pct_alta_baixa' };
  }
  /* (5) Muita 'alta' → alta. */
  if (pct_alta !== null && pct_alta >= THRESHOLD_PCT_ALTA) {
    return { confianca: 'alta' };
  }
  /* (6) Default → media. */
  return { confianca: 'media' };
}
