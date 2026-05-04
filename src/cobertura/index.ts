/* Orquestrador funcional */
export { detectaCobertura } from './detectaCobertura.js';
export type { DetectaCoberturaInput } from './detectaCobertura.js';

/* Motor (wrapper de classe, pra simetria com MotorHistorico/MotorReconciliacao) */
export { MotorCobertura } from './MotorCobertura.js';
export type {
  MotorCoberturaInput,
  MotorCoberturaOptions,
} from './MotorCobertura.js';

/* Detectores individuais (exportados para teste e uso avançado) */
export { detectaSaldoAbertura } from './detectaSaldoAbertura.js';
export {
  detectaBancoSemDado,
  type DetectaBancoSemDadoInput,
} from './detectaBancoSemDado.js';
export { detectaSemanaZerada } from './detectaSemanaZerada.js';
export {
  detectaRecorrenciaAusente,
  type DetectaRecorrenciaAusenteInput,
  BUCKETS_OBRIGACAO_FIXA,
} from './detectaRecorrenciaAusente.js';
export {
  agregaPendentesClassificacao,
  type AgregaPendentesClassificacaoInput,
} from './agregaPendentesClassificacao.js';
