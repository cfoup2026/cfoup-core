import type {
  EventoCaixa,
  ReconciliacaoComercialResult,
  ReconciliacaoResult,
  VendaComercial,
} from '../types/index.js';
import { detectaTransferenciaInterna } from './detectaTransferenciaInterna.js';
import {
  reconciliaBancoCpCr,
  type ReconciliaBancoCpCrOptions,
} from './reconciliaBancoCpCr.js';
import { reconciliaVendasAr } from './reconciliaVendasAr.js';

/**
 * Orquestrador completo do estágio 3 — versão 3.2.
 *
 * Encadeia, em ordem fixa:
 *
 *  1. **Reconciliação banco↔CP/CR** (`reconciliaBancoCpCr`, §3.1 + 3.1.1):
 *     promove confirmados, absorve CEFs casados, encadeia FKN-realizado
 *     ↔ CEF restante. Eventos absorvidos saem do array — passada de
 *     transferência opera apenas sobre o reconciliado, evitando casar
 *     transferência com perna que já foi absorvida.
 *
 *  2. **Detecção de transferência interna** (`detectaTransferenciaInterna`,
 *     §3.2 §3.A): marca pares opostos entre `legal_entity_id`s do mesmo
 *     `cliente_id` com `is_transferencia=true` + `transferencia_par_id`
 *     cruzado. Não cria nem absorve eventos.
 *
 *  3. **Reconciliação Vendas↔AR** (`reconciliaVendasAr`, §3.2 §3.D):
 *     enrichment unilateral — vendas ganham `reconciliado_com`. AR
 *     não muda. Pendências comerciais (`venda_sem_ar`, `ar_sem_venda`,
 *     `venda_ambigua`) ficam separadas das pendências de reconciliação
 *     bancária.
 *
 * Determinismo: mesma entrada + `reconciliadoEm` injetado → mesma saída
 * em ambas as estruturas.
 */
export interface MotorReconciliacaoOptions extends ReconciliaBancoCpCrOptions {}

export interface MotorReconciliacaoOutput {
  /** Resultado da reconciliação banco↔CP/CR (3.1 + 3.1.1), com
   *  transferências internas marcadas em `eventos`. Pendências de
   *  transferência ambígua entram em `pendencias`. */
  reconciliacao: ReconciliacaoResult;
  /** Resultado da reconciliação Vendas↔AR (3.2). */
  comercial: ReconciliacaoComercialResult;
}

export class MotorReconciliacao {
  constructor(private readonly opts: MotorReconciliacaoOptions) {}

  /**
   * Executa as três etapas em ordem.
   *
   * @param eventos Conjunto inicial de `EventoCaixa` (todos os status).
   * @param vendas  `VendaComercial[]` opcional. Default `[]` — clientes
   *                 sem FKN Vendas integrado simplesmente não passam
   *                 vendas, e o resultado comercial vem zerado.
   */
  run(
    eventos: readonly EventoCaixa[],
    vendas: readonly VendaComercial[] = [],
  ): MotorReconciliacaoOutput {
    /* 1. Reconciliação banco↔CP/CR */
    const reconBase = reconciliaBancoCpCr(eventos, this.opts);

    /* 2. Transferência interna sobre os eventos pós-reconciliação */
    const transfer = detectaTransferenciaInterna(reconBase.eventos, {
      detectadoEm: this.opts.reconciliadoEm,
    });

    /* 3. Reconciliação Vendas↔AR usa os eventos com transferência marcada */
    const comercial = reconciliaVendasAr(vendas, transfer.eventos, this.opts);

    /* Compor resultado: junta pendências de reconciliação + transferência. */
    const reconciliacao: ReconciliacaoResult = {
      eventos: transfer.eventos,
      pendencias: [...reconBase.pendencias, ...transfer.pendencias],
      eventosBancariosAbsorvidos: reconBase.eventosBancariosAbsorvidos,
      reconciliadoEm: reconBase.reconciliadoEm,
      estatisticas: {
        ...reconBase.estatisticas,
        // pendenciasGeradas reflete o total final, somando transferências.
        pendenciasGeradas:
          reconBase.estatisticas.pendenciasGeradas +
          transfer.pendencias.length,
      },
    };

    return { reconciliacao, comercial };
  }
}
