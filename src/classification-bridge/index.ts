/* Função core */
export { classifyEventos } from './classifyEventos.js';
export type {
  ClassifyEventosInput,
  ClassifyEventosOutput,
} from './classifyEventos.js';

/* Interface de adapter */
export type { ClassifierAdapter } from './ClassifierAdapter.js';

/* Adapter concreto sobre o Motor do Núcleo */
export {
  BUCKET_TO_CRITICIDADE,
  NucleusClassifierAdapter,
} from './NucleusClassifierAdapter.js';
export type { NucleusClassifierAdapterOptions } from './NucleusClassifierAdapter.js';

/* Tipos públicos */
export {
  ClassificationError,
  type ClassificationResult,
  type ClassificationStats,
} from './types.js';
