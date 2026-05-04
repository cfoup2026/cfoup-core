import type { CalendarPolicy } from '../calendar/CalendarPolicy.js';
import type {
  BaseDeAmostragem,
  Criticidade,
  EventoCaixa,
  HistoricoOperacional,
} from '../types/index.js';
import { calcContraparteStats } from './calcContraparteStats.js';
import { calcVolatilidade } from './calcVolatilidade.js';
import { detectRecorrencias } from './detectRecorrencias.js';
import { generateEstimados } from './generateEstimados.js';

export interface MotorHistoricoOptions {
  /** Quando o cálculo está sendo feito. Injetado em testes para
   *  determinismo (geradoEm define a janela de volatilidade, o cutoff
   *  de "ativa" para recorrências, e o início da janela de projeção
   *  de estimados). */
  geradoEm: Date;
  /** Tamanho da janela de projeção de `eventosEstimados` em semanas.
   *  Default 13 (CF13). */
  janelaSemanas?: number;
  /** Calendário operacional usado para derivar `data_esperada` dos
   *  estimados. Quando ausente, `eventosEstimados` é vazio (motor opera
   *  só em modo estatístico). Quando presente, o hook `contraparteHistory`
   *  de `deriveDataEsperada` é ativado automaticamente. */
  calendar?: CalendarPolicy;
  /** Override do conjunto de criticidades para volatilidade. Default
   *  spec §3.C: `['obrigatoria', 'critica_op']`. Em V0 o caller pode
   *  passar `['obrigatoria', 'critica_op', 'pendente']` para incluir
   *  saídas ainda não classificadas pelo Estágio 3. */
  criticidadesVolatilidade?: ReadonlyArray<Criticidade>;
}

/**
 * Orquestrador completo do Motor de Histórico (Estágio 2 — combina 2.1 e 2.2).
 *
 * Sequência:
 *  1. **2.1** — `calcContraparteStats`, `detectRecorrencias`, `calcVolatilidade`.
 *  2. **2.2** — `generateEstimados`, projetando recorrências fortes ativas
 *     em `EventoCaixa[]` com `status='estimado'` e `origem='historico'`.
 *     Trava anti-duplicação contra `confirmado`/`realizado` existentes.
 *
 * Compatibilidade: chamadas sem `calendar` retornam `eventosEstimados=[]`
 * (modo estatístico puro, equivalente ao 2.1 isolado).
 *
 * Determinismo: mesma entrada + mesmo `geradoEm` (+ `calendar` quando
 * fornecido) → mesma saída.
 */
export class MotorHistorico {
  constructor(private readonly opts: MotorHistoricoOptions) {}

  run(eventos: readonly EventoCaixa[]): HistoricoOperacional {
    const contraparteHistory = calcContraparteStats(eventos);
    const recorrencias = detectRecorrencias(eventos, this.opts.geradoEm);
    const volatilidades = calcVolatilidade(eventos, {
      geradoEm: this.opts.geradoEm,
      ...(this.opts.criticidadesVolatilidade !== undefined
        ? { criticidades: this.opts.criticidadesVolatilidade }
        : {}),
    });

    const baseDe = computeBaseDe(eventos);

    const eventosEstimados =
      this.opts.calendar !== undefined
        ? generateEstimados(
            { contraparteHistory, recorrencias },
            eventos,
            {
              geradoEm: this.opts.geradoEm,
              calendar: this.opts.calendar,
              ...(this.opts.janelaSemanas !== undefined
                ? { janelaSemanas: this.opts.janelaSemanas }
                : {}),
            },
          )
        : [];

    return {
      contraparteHistory,
      recorrencias,
      volatilidades,
      geradoEm: this.opts.geradoEm,
      baseDe,
      eventosEstimados,
    };
  }
}

function computeBaseDe(eventos: readonly EventoCaixa[]): BaseDeAmostragem {
  let primeiroMs = Number.POSITIVE_INFINITY;
  let ultimoMs = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const e of eventos) {
    if (e.status !== 'realizado') continue;
    const dr = e.data_realizada;
    if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) continue;
    total += 1;
    const ms = dr.getTime();
    if (ms < primeiroMs) primeiroMs = ms;
    if (ms > ultimoMs) ultimoMs = ms;
  }
  // Input vazio (ou sem realizados): retorna janela "zero" determinística
  // — `geradoEm` como ambos os marcadores. Não lança.
  if (total === 0) {
    return {
      primeiroEvento: new Date(0),
      ultimoEvento: new Date(0),
      totalRealizados: 0,
    };
  }
  return {
    primeiroEvento: new Date(primeiroMs),
    ultimoEvento: new Date(ultimoMs),
    totalRealizados: total,
  };
}
