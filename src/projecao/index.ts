/* Projeção por unidade (4.1) */
export { projetaUnidade } from './projetaUnidade.js';

/* Consolidado por cliente + transferência interna (4.2) */
export { projetaCliente } from './projetaCliente.js';
export {
  avaliaTransferencias,
  type AvaliacaoTransferenciasInput,
  type AvaliacaoTransferenciasOutput,
  type BucketConsolidado,
  type SubtracaoConsolidado,
} from './neutralizaTransferencia.js';

/* Caixa mínimo operacional (4.3) */
export {
  aplicaCaixaMinimoOpEm,
  calculaCaixaMinimoOp,
  type CalculaCaixaMinimoOpInput,
  type CalculaCaixaMinimoOpOutput,
} from './calculaCaixaMinimoOp.js';

/* Utilidades de semana ISO */
export {
  fimDaSemanaIso,
  inicioDaSemanaIso,
  semanaIsoOf,
  semanasJanela,
} from './semanas.js';
