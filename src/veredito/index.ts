/* Função pública principal */
export { calcularVeredito } from './calcularVeredito.js';
export type { CalcularVereditoInput } from './calcularVeredito.js';

/* Funções intermediárias (exportadas para teste e uso avançado) */
export { aplicarGatilhos } from './gatilhos.js';
export type {
  AplicarGatilhosInput,
  AplicarGatilhosOutput,
} from './gatilhos.js';
export { renderTexto } from './templates.js';
export { calcularBanner } from './banner.js';
export { detectarErrosMarcacao } from './erros-marcacao.js';
export type { DetectarErrosMarcacaoInput } from './erros-marcacao.js';
export {
  deriveCoberturaConsolidada,
  deriveStatusUnidade,
} from './cobertura-consolidada.js';
export { formatarBRL, formatarDataDDMM } from './format.js';

/* Tipos públicos */
export type {
  BannerUnidadeCritica,
  ErroDeMarcacao,
  Veredito,
  VereditoDetalhes,
  VereditoResult,
  VereditoUnidade,
} from './types.js';
