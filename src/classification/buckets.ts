import type { Bucket } from './types.js';

/**
 * Definição imutável dos 12 buckets visíveis ao dono.
 *
 *  - `label`: texto que aparece em telas e relatórios.
 *  - `order`: ordem natural pra renderização (1..12).
 *  - `isPosition: true` significa que o bucket representa saldo de títulos
 *    em aberto (não transações classificadas). Buckets com `isPosition: true`
 *    NÃO recebem categorias da `categories.ts` — são alimentados pelos
 *    relatórios de aging (CR/CP) diretamente.
 *
 * Mantenha esta tabela alinhada com a tabela do prompt do motor.
 * Qualquer mudança aqui é mudança de UI pública.
 */
export const BUCKETS: Record<
  Bucket,
  { label: string; order: number; isPosition: boolean }
> = {
  receita: { label: 'Receita', order: 1, isPosition: false },
  deducoes: { label: 'Deduções', order: 2, isPosition: false },
  custos_diretos: { label: 'Custos Diretos', order: 3, isPosition: false },
  folha: { label: 'Folha Pagamento', order: 4, isPosition: false },
  despesas_operacionais: {
    label: 'Despesas Operacionais',
    order: 5,
    isPosition: false,
  },
  caixa: { label: 'Caixa', order: 6, isPosition: false },
  contas_receber: { label: 'Contas a Receber', order: 7, isPosition: true },
  contas_pagar: { label: 'Contas a Pagar', order: 8, isPosition: true },
  despesas_financeiras: {
    label: 'Despesas Financeiras',
    order: 9,
    isPosition: false,
  },
  retiradas_socios: { label: 'Retiradas Sócios', order: 10, isPosition: false },
  investimentos: { label: 'Investimentos', order: 11, isPosition: false },
  estoque: { label: 'Estoque', order: 12, isPosition: false },
};

/** Lista de buckets na ordem de renderização. */
export const BUCKETS_ORDERED: readonly Bucket[] = (
  Object.keys(BUCKETS) as Bucket[]
).sort((a, b) => BUCKETS[a].order - BUCKETS[b].order);
