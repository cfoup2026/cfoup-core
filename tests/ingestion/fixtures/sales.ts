import type { Sale } from '../../../src/types/index.js';

const utcDate = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));

/**
 * 5 Sales representativas para teste do `fknVendasAdapter`:
 *  1) Venda à vista, NF presente.
 *  2) Venda a prazo, NF presente, cliente diferente.
 *  3) Venda a prazo sem NF (invoiceNumber vazio) — usa parser id.
 *  4) Devolução — adapter deve filtrar (não vira VendaComercial).
 *  5) Venda a prazo com cliente sem código (customerCode = 0).
 */
export const SALES_FIXTURE: Sale[] = [
  {
    id: 'fkn-sale:1',
    issuedAt: utcDate(2026, 5, 1),
    customerCode: 1001,
    customerName: 'Cliente Alpha LTDA',
    invoiceNumber: 'NF-555',
    salesperson: 'DIRETA',
    paymentTerm: 'À VISTA',
    amount: 1200,
    cost: 800,
    marginPercent: 33.33,
    marginPercentSource: 'from_csv',
    movementType: 'sale',
    movementTypeSource: 'explicit',
    rawColumns: [],
  },
  {
    id: 'fkn-sale:2',
    issuedAt: utcDate(2026, 5, 5),
    customerCode: 1002,
    customerName: 'Cliente Beta SA',
    invoiceNumber: 'NF-556',
    salesperson: 'SITE',
    paymentTerm: '30/60/90',
    amount: 4500,
    cost: 3000,
    marginPercent: 33.33,
    marginPercentSource: 'from_csv',
    movementType: 'sale',
    movementTypeSource: 'explicit',
    rawColumns: [],
  },
  {
    id: 'fkn-sale:3',
    issuedAt: utcDate(2026, 5, 10),
    customerCode: 1003,
    customerName: 'Cliente Gamma',
    invoiceNumber: '', // sem NF — adapter deve usar parser id
    salesperson: 'DIRETA',
    paymentTerm: '30 DIAS',
    amount: 800,
    cost: 500,
    marginPercent: 37.5,
    marginPercentSource: 'from_csv',
    movementType: 'sale',
    movementTypeSource: 'explicit',
    rawColumns: [],
  },
  {
    id: 'fkn-sale:4',
    issuedAt: utcDate(2026, 5, 12),
    customerCode: 1001,
    customerName: 'Cliente Alpha LTDA',
    invoiceNumber: 'NF-557',
    salesperson: 'DIRETA',
    paymentTerm: 'À VISTA',
    amount: 200,
    cost: 130,
    marginPercent: 35,
    marginPercentSource: 'from_csv',
    movementType: 'return', // devolução — adapter deve filtrar
    movementTypeSource: 'explicit',
    rawColumns: [],
  },
  {
    id: 'fkn-sale:5',
    issuedAt: utcDate(2026, 5, 15),
    customerCode: 0, // cliente sem código — VendaComercial sem contraparte_id
    customerName: 'CONSUMIDOR FINAL',
    invoiceNumber: 'NF-558',
    salesperson: 'SITE',
    paymentTerm: '60 DIAS',
    amount: 350,
    cost: 200,
    marginPercent: 42.86,
    marginPercentSource: 'from_csv',
    movementType: 'sale',
    movementTypeSource: 'explicit',
    rawColumns: [],
  },
];
