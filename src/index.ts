export * from './types/index.js';
export * from './parsers/index.js';
export * from './csv/index.js';
export * from './classification/index.js';
export * from './calendar/index.js';
export * from './ingestion/index.js';
export * from './historico/index.js';
export * from './reconciliacao/index.js';
export * from './cobertura/index.js';
export * from './confianca/index.js';
/* Stage 4.5 — Classification Bridge. Re-export targetado pra evitar
 * colisão com `ClassificationResult` do Núcleo (já exportado via
 * `./classification/index.js`). Bridge tem seu próprio tipo de mesmo
 * nome — diferente shape, escopo público distinto. */
export { classifyEventos } from './classification-bridge/index.js';
export type {
  ClassifyEventosInput,
  ClassifyEventosOutput,
  ClassifierAdapter,
  ClassificationStats,
  NucleusClassifierAdapterOptions,
} from './classification-bridge/index.js';
export {
  BUCKET_TO_CRITICIDADE,
  ClassificationError,
  NucleusClassifierAdapter,
} from './classification-bridge/index.js';
export type { ClassificationResult as BridgeClassificationResult } from './classification-bridge/index.js';
export * from './projecao/index.js';
export * from './pipeline/index.js';
