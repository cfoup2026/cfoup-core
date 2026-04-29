import type { SourceTransaction } from '../../../src/classification/index.js';

/** Empresa-mock fixa pra todos os fixtures. */
export const COMPANY_ID = 'co_test_001';

/** Constrói data UTC à meia-noite (segue convenção do projeto). */
export function utcDate(year: number, month1Indexed: number, day: number): Date {
  return new Date(Date.UTC(year, month1Indexed - 1, day));
}

/**
 * Construtor de `SourceTransaction` — preenche defaults mínimos sensatos.
 * Use sempre que precisar de uma transação ad-hoc num teste.
 */
export function makeTx(
  overrides: Partial<SourceTransaction> & Pick<SourceTransaction, 'id'>,
): SourceTransaction {
  const base: SourceTransaction = {
    id: overrides.id,
    companyId: overrides.companyId ?? COMPANY_ID,
    sourceSystem: overrides.sourceSystem ?? 'manual',
    transactionDate: overrides.transactionDate ?? utcDate(2026, 4, 15),
    direction: overrides.direction ?? 'outflow',
    amount: overrides.amount ?? 100,
    currency: overrides.currency ?? 'BRL',
  };
  // Copiar opcionais respeitando exactOptionalPropertyTypes — só atribui
  // quando o override traz valor real.
  const o = overrides;
  if (o.sourceTransactionId !== undefined)
    base.sourceTransactionId = o.sourceTransactionId;
  if (o.dueDate !== undefined) base.dueDate = o.dueDate;
  if (o.paidDate !== undefined) base.paidDate = o.paidDate;
  if (o.counterpartyName !== undefined)
    base.counterpartyName = o.counterpartyName;
  if (o.documentNumber !== undefined) base.documentNumber = o.documentNumber;
  if (o.description !== undefined) base.description = o.description;
  if (o.paymentChannel !== undefined) base.paymentChannel = o.paymentChannel;
  if (o.originalAccountName !== undefined)
    base.originalAccountName = o.originalAccountName;
  if (o.originalAccountCode !== undefined)
    base.originalAccountCode = o.originalAccountCode;
  if (o.originalGroupName !== undefined)
    base.originalGroupName = o.originalGroupName;
  if (o.originalSubgroupName !== undefined)
    base.originalSubgroupName = o.originalSubgroupName;
  if (o.originalCostCenter !== undefined)
    base.originalCostCenter = o.originalCostCenter;
  if (o.originalCategory !== undefined)
    base.originalCategory = o.originalCategory;
  if (o.originalClassificationRaw !== undefined)
    base.originalClassificationRaw = o.originalClassificationRaw;
  if (o.createdAt !== undefined) base.createdAt = o.createdAt;
  return base;
}
