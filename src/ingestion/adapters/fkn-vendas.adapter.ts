import type {
  PrazoVenda,
  Sale,
  VendaComercial,
} from '../../types/index.js';
import type { AdapterContext } from '../AdapterContext.js';
import { IngestaoError } from '../IngestaoError.js';

/**
 * Adapter `Sale[] → VendaComercial[]` (FKN Vendas).
 *
 * **Estrutura paralela ao caixa.** NÃO emite `EventoCaixa`. Vendas são
 * dataset comercial auxiliar — CR (Contas a Receber) é fonte primária
 * do recebimento; vendas enriquecem com NF/cliente/prazo. Somar
 * `Σvendas + Σar` no caixa é invariante absoluta de erro (§6 do spec).
 *
 * **Filtragem:** apenas `movementType === 'sale'` entra. `'return'` e
 * `'cancellation'` não são vendas — não devem reconciliar com AR.
 *
 * **Resolução determinística de `origem_ref`** (ordem de prioridade):
 *  1. `documento_ref` (NF emitida via `invoiceNumber`) — chave fiscal
 *     duradoura, identidade estável entre exportações.
 *  2. `id` do parser — fallback quando NF ausente. Equivalente ao
 *     `num_venda` da especificação (sequencial estável do parser).
 *
 * Não há terceiro recurso aqui porque `Sale.id` é sempre presente
 * (campo obrigatório do tipo). Adapters de outras origens com um
 * formato diferente podem precisar do `id_lote_venda`.
 *
 * **ID determinístico:**
 * `${origem}_vendas_${origem_ref}_${cliente_id}_${legal_entity_id}`.
 *
 * **Validação (fail visibly):**
 *  - `amount <= 0` ou não-finito → `IngestaoError`.
 *  - `issuedAt` inválido → `IngestaoError`.
 *  - `Sale.id` vazio E `invoiceNumber` vazio → `IngestaoError`
 *    (os dois fallbacks ausentes ao mesmo tempo).
 */
export function fknVendasAdapter(
  vendas: readonly Sale[],
  ctx: AdapterContext,
): VendaComercial[] {
  const out: VendaComercial[] = [];
  const criadoEm = new Date();
  for (const s of vendas) {
    if (s.movementType !== 'sale') continue;
    out.push(saleToVenda(s, ctx, criadoEm));
  }
  return out;
}

function saleToVenda(
  s: Sale,
  ctx: AdapterContext,
  criadoEm: Date,
): VendaComercial {
  if (
    typeof s.amount !== 'number' ||
    !Number.isFinite(s.amount) ||
    s.amount <= 0
  ) {
    throw new IngestaoError(
      `Sale ${s.id}: amount deve ser positivo, recebido: ${String(s.amount)}`,
    );
  }
  if (!(s.issuedAt instanceof Date) || Number.isNaN(s.issuedAt.getTime())) {
    throw new IngestaoError(`Sale ${s.id}: issuedAt ausente ou inválida`);
  }

  const documentoRef = s.invoiceNumber.trim();
  const parserId = s.id.trim();
  // Resolução: documento_ref > parser id. Se ambos vazios, falha visível.
  const origemRef =
    documentoRef !== '' ? documentoRef : parserId !== '' ? parserId : '';
  if (origemRef === '') {
    throw new IngestaoError(
      `Sale: nenhum identificador estável presente (invoiceNumber e id ambos vazios)`,
    );
  }

  const id = `fkn_vendas_${origemRef}_${ctx.cliente_id}_${ctx.legal_entity_id}`;

  const venda: VendaComercial = {
    id,
    cliente_id: ctx.cliente_id,
    legal_entity_id: ctx.legal_entity_id,
    origem: 'fkn',
    origem_ref: origemRef,
    data_emissao: s.issuedAt,
    valor: s.amount,
    contraparte_tipo: 'cliente',
    prazo: derivePrazo(s.paymentTerm),
    criado_em: criadoEm,
    criado_por: 'sistema',
  };

  if (documentoRef !== '') venda.documento_ref = documentoRef;
  if (s.customerCode > 0) venda.contraparte_id = String(s.customerCode);
  if (ctx.source_company_code !== undefined)
    venda.source_company_code = ctx.source_company_code;

  return venda;
}

/**
 * Inferência de `prazo` a partir de `paymentTerm` raw do FKN.
 *
 * Regra:
 *  - Texto contém "vista" (case/acento-insensitivo) → `'a_vista'`.
 *  - Caso contrário → `'a_prazo'` (default conservador — qualquer
 *    coisa diferente de "vista" é tratada como prazo).
 *
 * Nota: a especificação do prazo é texto livre no FKN — não vale a
 * pena enumerar variantes. "vista" cobre "AVISTA", "À VISTA",
 * "A VISTA", "VISTA", etc. Casos com prazo numérico ("30 DIAS",
 * "30/60/90") caem em `a_prazo` automaticamente.
 */
function derivePrazo(paymentTerm: string): PrazoVenda {
  const norm = paymentTerm
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return norm.includes('vista') ? 'a_vista' : 'a_prazo';
}
