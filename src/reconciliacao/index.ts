/* Função principal — banco ↔ CP/CR (3.1 + 3.1.1) */
export { reconciliaBancoCpCr } from './reconciliaBancoCpCr.js';
export type { ReconciliaBancoCpCrOptions } from './reconciliaBancoCpCr.js';

/* Transferência interna (3.2) */
export { detectaTransferenciaInterna } from './detectaTransferenciaInterna.js';
export type {
  DetectaTransferenciaOptions,
  DetectaTransferenciaResult,
} from './detectaTransferenciaInterna.js';

/* Reconciliação Vendas ↔ AR (3.2) */
export { reconciliaVendasAr } from './reconciliaVendasAr.js';
export type { ReconciliaVendasArOptions } from './reconciliaVendasAr.js';

/* Orquestrador */
export { MotorReconciliacao } from './MotorReconciliacao.js';
export type {
  MotorReconciliacaoOptions,
  MotorReconciliacaoOutput,
} from './MotorReconciliacao.js';
