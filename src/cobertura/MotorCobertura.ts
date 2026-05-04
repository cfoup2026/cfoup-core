/**
 * Motor de Cobertura — wrapper fino sobre `detectaCobertura` da 5.1.
 *
 * Razão arquitetural: simetria com `MotorHistorico`, `MotorReconciliacao`.
 * Permite injeção de timestamp determinístico (`detectadoEm`) via opts
 * em testes; expõe shape de classe pra que callers do CF13 não troquem
 * imports quando integrações futuras (ex: cache, telemetria) entrarem.
 *
 * **Sem lógica duplicada.** Toda detecção mora em 5.1; aqui só roteia.
 */
import {
  detectaCobertura,
  type DetectaCoberturaInput,
} from './detectaCobertura.js';
import type {
  CoberturaResult,
  EventoCaixa,
  HistoricoOperacional,
  OpeningBalanceSnapshot,
  ProjecaoCliente,
} from '../types/index.js';

export interface MotorCoberturaOptions {
  /** Timestamp injetado em `CoberturaResult.detectadoEm`. Quando
   *  ausente, usa `geradoEm` do input. */
  detectadoEm?: Date;
}

export interface MotorCoberturaInput {
  eventos: readonly EventoCaixa[];
  historico: HistoricoOperacional;
  projecao: ProjecaoCliente;
  saldos: readonly OpeningBalanceSnapshot[];
  cliente_id: string;
  legal_entity_ids_ativas: readonly string[];
  geradoEm: Date;
}

export class MotorCobertura {
  constructor(private readonly opts: MotorCoberturaOptions = {}) {}

  /**
   * Roda a detecção de cobertura sobre o pipeline.
   *
   * Determinismo: o método é puro (delega 100% a `detectaCobertura`).
   * Mesmo input + `detectadoEm` injetado → output `deepEqual`.
   *
   * `detectadoEm` no resultado: vem de `opts.detectadoEm` quando
   * presente; caso contrário, `input.geradoEm` (mantém compatibilidade
   * com testes que não injetam timestamp separado).
   */
  run(input: MotorCoberturaInput): CoberturaResult {
    const detInput: DetectaCoberturaInput = {
      eventos: input.eventos,
      historico: input.historico,
      projecao: input.projecao,
      saldos: input.saldos,
      cliente_id: input.cliente_id,
      legal_entity_ids_ativas: input.legal_entity_ids_ativas,
      geradoEm: input.geradoEm,
    };
    const result = detectaCobertura(detInput);
    if (this.opts.detectadoEm !== undefined) {
      return { ...result, detectadoEm: this.opts.detectadoEm };
    }
    return result;
  }
}
