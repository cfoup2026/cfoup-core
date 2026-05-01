import { deriveDataEsperada } from '../../calendar/deriveDataEsperada.js';
import type { EventoCaixa, Payable } from '../../types/index.js';
import type { AdapterContext } from '../AdapterContext.js';
import { IngestaoError } from '../IngestaoError.js';
import { buildEventoCaixaBase } from '../buildEventoCaixaBase.js';

/** Campos opcionais derivados de um `Payable`, prontos pra `buildEventoCaixaBase`. */
function payableOptionals(p: Payable): {
  contraparte_id?: string;
  documento_ref?: string;
} {
  const out: { contraparte_id?: string; documento_ref?: string } = {};
  if (p.vendorCode > 0) out.contraparte_id = String(p.vendorCode);
  const doc = p.docNumber.trim();
  if (doc !== '') out.documento_ref = doc;
  return out;
}

/**
 * Adapter `Payable[] → EventoCaixa[]` (FKN AP).
 *
 * Matriz de status (§4 do prompt 1.2 + §7.1 do 1.3):
 *  - `paidAt === null`  → status `confirmado` / direcao `saida`.
 *    `data_vencimento = dueDate`.
 *    `data_esperada = deriveDataEsperada(dueDate, ctx.calendar)` —
 *    move pro próximo dia útil se cair em fim de semana/feriado.
 *  - `paidAt !== null`  → status `realizado` / direcao `saida`.
 *    `data_realizada = paidAt`. `data_esperada = paidAt` (sem calendário —
 *    fato consumado é fato consumado).
 *
 * Determinismo: `id = `fkn_${payable.id}_${cliente_id}_${legal_entity_id}``.
 * Mesma entrada produz o mesmo `id` em qualquer ordem.
 *
 * Validação: lança `IngestaoError` em `valor <= 0` ou data inválida.
 * Lançamento direto reflete o princípio do nucleus (falhar visível).
 */
export function fknApAdapter(
  payables: readonly Payable[],
  ctx: AdapterContext,
): EventoCaixa[] {
  const eventos: EventoCaixa[] = [];
  for (const p of payables) {
    eventos.push(payableToEvento(p, ctx));
  }
  return eventos;
}

function payableToEvento(p: Payable, ctx: AdapterContext): EventoCaixa {
  if (!(p.dueDate instanceof Date) || Number.isNaN(p.dueDate.getTime())) {
    throw new IngestaoError(
      `Payable ${p.id}: dueDate ausente ou inválida`,
    );
  }

  const optionals = payableOptionals(p);

  if (p.paidAt === null) {
    // Em aberto → confirmado. data_esperada move para o próximo dia útil
    // quando dueDate cai em fim de semana/feriado bancário (regra §7.1).
    const dataEsperada = deriveDataEsperada(p.dueDate, ctx.calendar);
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: p.id,
        valor: p.amount,
        direcao: 'saida',
        data_esperada: dataEsperada,
        contraparte_tipo: 'fornecedor',
        ...optionals,
      },
      ctx,
    );
    const ev: EventoCaixa = {
      ...base,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: p.dueDate,
    };
    return ev;
  }

  // Liquidado → realizado.
  if (Number.isNaN(p.paidAt.getTime())) {
    throw new IngestaoError(
      `Payable ${p.id}: paidAt inválida (NaN)`,
    );
  }
  const base = buildEventoCaixaBase(
    {
      origem: 'fkn',
      origem_ref: p.id,
      valor: p.amountPaid > 0 ? p.amountPaid : p.amount,
      direcao: 'saida',
      // Realizado: `data_esperada = data_realizada` sempre, sem calendário.
      data_esperada: p.paidAt,
      contraparte_tipo: 'fornecedor',
      ...optionals,
    },
    ctx,
  );
  const ev: EventoCaixa = {
    ...base,
    status: 'realizado',
    data_realizada: p.paidAt,
    data_vencimento: p.dueDate,
  };
  return ev;
}
