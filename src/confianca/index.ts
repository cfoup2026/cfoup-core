/* Função pública principal */
export { calcularConfianca } from './calcularConfianca.js';
export type { CalcularConfiancaInput } from './calcularConfianca.js';

/* Funções intermediárias (exportadas para teste e uso avançado) */
export { calcularConfiancaSemana } from './semana.js';
export type { CalcularConfiancaSemanaInput } from './semana.js';
export { calcularConfiancaProjecao } from './projecao.js';
export {
  calcularSaidasSemana,
  detectarPendenciasCriticasSemana,
} from './pendencia-critica.js';
export type { DetectarPendenciasSemanaInput } from './pendencia-critica.js';
export { ehMaterial } from './materialidade.js';
export type { MaterialidadeAvaliacao } from './materialidade.js';
export { mapearCoberturaParaEcho } from './coerencia-cobertura.js';
export type { MapearCoberturaInput } from './coerencia-cobertura.js';

/* Tipos públicos */
export {
  ConfiancaError,
  LIMITE_MATERIALIDADE_ABS_BRL,
  PCT_MATERIALIDADE_SAIDAS_SEMANA,
  THRESHOLD_PCT_ALTA,
  THRESHOLD_PCT_ALTA_MIN_MEDIA,
  THRESHOLD_PCT_BAIXA,
  type CoberturaAplicadaItem,
  type ConfiancaResult,
  type ConfiancaSemana,
  type ConfiancaUnidade,
  type MotivoBaixa,
  type MotivoPendenciaCritica,
  type PendenciaCritica,
  type TriggerMaterialidade,
} from './types.js';
