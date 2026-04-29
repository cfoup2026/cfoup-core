import type { SourceTransaction } from '../../../src/classification/index.js';
import { makeTx, utcDate } from './helpers.js';

/**
 * 3 transações de cartão:
 *  - com detalhe (compra específica)
 *  - sem detalhe (vira pendência)
 *  - antecipação (cliente paga via cartão antes da entrega)
 */
export const CARD_FIXTURES: readonly SourceTransaction[] = [
  makeTx({
    id: 'card_001',
    sourceSystem: 'card',
    transactionDate: utcDate(2026, 4, 10),
    direction: 'outflow',
    amount: 1200.0,
    counterpartyName: 'Posto Shell',
    description: 'Combustível frota — manutenção operacional',
    paymentChannel: 'card',
    originalCategory: 'Manutenção e reparos',
    originalAccountName: 'Manutenção preventiva',
  }),
  makeTx({
    id: 'card_002',
    sourceSystem: 'card',
    transactionDate: utcDate(2026, 4, 15),
    direction: 'outflow',
    amount: 8900.0,
    counterpartyName: 'AMERICAN EXPRESS',
    description: 'Pagamento de fatura cartão',
    paymentChannel: 'transfer',
  }),
  makeTx({
    id: 'card_003',
    sourceSystem: 'card',
    transactionDate: utcDate(2026, 4, 18),
    direction: 'inflow',
    amount: 3400.0,
    counterpartyName: 'Cielo',
    description: 'Antecipação de recebíveis - cartão',
    paymentChannel: 'transfer',
    originalCategory: 'Liquidação adquirente',
  }),
];
