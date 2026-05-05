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
export * from './veredito/index.js';
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

/* CF13 UI Contract — re-export targetado para evitar colisão de nomes
 * com tipos snake_case do core (SemanaProjecao, ProjecaoCliente,
 * CoberturaResult, ConfiancaResult, VereditoResult, etc.). Os tipos do
 * contrato (camelCase) ficam acessíveis via `@cfoup/core/cf13/contract`.
 *
 * A raiz expõe só os símbolos sem colisão — em particular `CF13Output`
 * e `runCF13Pipeline` cobrem o caso de uso comum do consumer
 * (`cfoup-overview-v3`). Tipos internos do contrato resolvidos via
 * type-graph quando o consumer faz `import { CF13Output }`. */
export {
  runCF13Pipeline,
  CF13ContractIntegrityError,
  CF13_ENGINE_VERSION,
  type CF13Meta,
  type CF13Output,
  type CF13PipelineInput,
  type PendenciaCF13,
  type OrigemPendencia,
  type SeveridadePendencia,
  type AcaoSugerida,
} from './cf13/contract/index.js';
