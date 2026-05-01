/* Tipos */
export type { AdapterContext } from './AdapterContext.js';
export type { BuildEventoCaixaBaseInput } from './buildEventoCaixaBase.js';
export type {
  CefAdapterInput,
  CefAdapterOutput,
} from './adapters/cef.adapter.js';

/* Erros */
export { IngestaoError } from './IngestaoError.js';

/* Helpers */
export { buildEventoCaixaBase } from './buildEventoCaixaBase.js';

/* Adapters */
export { fknApAdapter } from './adapters/fkn-ap.adapter.js';
export { fknArAdapter } from './adapters/fkn-ar.adapter.js';
export { cefAdapter } from './adapters/cef.adapter.js';
