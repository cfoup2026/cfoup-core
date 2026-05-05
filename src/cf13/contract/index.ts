/**
 * CF13 UI Contract — barrel público do módulo de adapter.
 *
 * Consumido por front-ends (`cfoup-overview-v3`) e quaisquer outros
 * adaptadores externos. **Não** consumido pelos Stages 1–7 internos.
 *
 * Padrão:
 *  - `runCF13Pipeline` é a função pública principal.
 *  - Tipos camelCase do contrato exportados verbatim.
 *  - Helpers e adapters individuais exportados para tests/consumidores
 *    avançados, mas o caso comum é `runCF13Pipeline`.
 */

export {
  runCF13Pipeline,
  CF13ContractIntegrityError,
  formatarISODate,
  type CF13PipelineInput,
} from './runCF13Pipeline.js';

export {
  CF13_ENGINE_VERSION,
  type AcaoSugerida,
  type BannerUnidadeCritica,
  type CF13Meta,
  type CF13Output,
  type ConfiancaNivel,
  type ConfiancaResult,
  type ConfiancaSemana,
  type CoberturaResult,
  type EscopoNivel,
  type InsuficienciaCritica,
  type OrigemPendencia,
  type PendenciaCF13,
  type PendenciaConfianca,
  type ProjecaoCliente,
  type ProjecaoNivel,
  type SemanaProjecao,
  type SeveridadePendencia,
  type TipoInsuficiencia,
  type TipoPendenciaConfianca,
  type Veredito,
  type VereditoCategoria,
  type VereditoDetalhe,
  type VereditoResult,
} from './types.js';

export { formatarRotuloSemana } from './helpers/formatarRotuloSemana.js';
export { ordenarPendencias } from './helpers/ordenarPendencias.js';
export {
  fonteDeteccao,
  mapearTipoInsuficiencia,
  severidadeMotivoInsuficiencia,
  severidadePorTipoCobertura,
} from './helpers/mapearOrigem.js';

export { adaptarSemana } from './adapters/adaptarSemana.js';
export { adaptarNivel } from './adapters/adaptarNivel.js';
export { adaptarProjecao } from './adapters/adaptarProjecao.js';
export { adaptarCobertura } from './adapters/adaptarCobertura.js';
export { adaptarConfianca } from './adapters/adaptarConfianca.js';
export { adaptarVeredito } from './adapters/adaptarVeredito.js';
export { adaptarPendencias } from './adapters/adaptarPendencias.js';
