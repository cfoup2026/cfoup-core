import { deriveDataEsperada } from '../../calendar/deriveDataEsperada.js';
import type { EventoCaixa, Receivable } from '../../types/index.js';
import type { AdapterContext } from '../AdapterContext.js';
import { IngestaoError } from '../IngestaoError.js';
import { buildEventoCaixaBase } from '../buildEventoCaixaBase.js';

/** Campos opcionais derivados de um `Receivable`. */
function receivableOptionals(r: Receivable): {
  contraparte_id?: string;
  documento_ref?: string;
} {
  const out: { contraparte_id?: string; documento_ref?: string } = {};
  if (r.customerCode > 0) out.contraparte_id = String(r.customerCode);
  const doc = r.docNumber.trim();
  if (doc !== '') out.documento_ref = doc;
  return out;
}

/**
 * Adapter `Receivable[] → EventoCaixa[]` (FKN AR).
 *
 * Espelho do FKN AP, mas com `direcao: 'entrada'` e
 * `contraparte_tipo: 'cliente'`.
 *
 * Matriz de status (§4 do 1.2 + §7.1 do 1.3):
 *  - `paidAt === null`  → status `confirmado` / direcao `entrada`.
 *    `data_vencimento = dueDate`.
 *    `data_esperada = deriveDataEsperada(dueDate, ctx.calendar)` —
 *    move pro próximo dia útil se cair em fim de semana/feriado.
 *  - `paidAt !== null`  → status `realizado` / direcao `entrada`.
 *    `data_realizada = paidAt`. `data_esperada = paidAt` (sem calendário).
 *
 * Determinismo: `id = `fkn_${receivable.id}_${cliente_id}_${legal_entity_id}``.
 *
 * Validação: lança `IngestaoError` em `valor <= 0` ou data inválida.
 */
export function fknArAdapter(
  receivables: readonly Receivable[],
  ctx: AdapterContext,
): EventoCaixa[] {
  const eventos: EventoCaixa[] = [];
  for (const r of receivables) {
    eventos.push(receivableToEvento(r, ctx));
  }
  return eventos;
}

function receivableToEvento(
  r: Receivable,
  ctx: AdapterContext,
): EventoCaixa {
  if (!(r.dueDate instanceof Date) || Number.isNaN(r.dueDate.getTime())) {
    throw new IngestaoError(
      `Receivable ${r.id}: dueDate ausente ou inválida`,
    );
  }

  const optionals = receivableOptionals(r);

  if (r.paidAt === null) {
    // Em aberto → confirmado. data_esperada move para o próximo dia útil
    // quando dueDate cai em fim de semana/feriado bancário (§7.1).
    const dataEsperada = deriveDataEsperada(r.dueDate, ctx.calendar);
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: r.id,
        valor: r.amount,
        direcao: 'entrada',
        data_esperada: dataEsperada,
        contraparte_tipo: 'cliente',
        ...optionals,
      },
      ctx,
    );
    const ev: EventoCaixa = {
      ...base,
      status: 'confirmado',
      data_realizada: null,
      data_vencimento: r.dueDate,
    };
    return ev;
  }

  if (Number.isNaN(r.paidAt.getTime())) {
    throw new IngestaoError(
      `Receivable ${r.id}: paidAt inválida (NaN)`,
    );
  }
  const base = buildEventoCaixaBase(
    {
      origem: 'fkn',
      origem_ref: r.id,
      valor: r.amountPaid > 0 ? r.amountPaid : r.amount,
      direcao: 'entrada',
      // Realizado: data_esperada = data_realizada (sem calendário).
      data_esperada: r.paidAt,
      contraparte_tipo: 'cliente',
      ...optionals,
    },
    ctx,
  );
  const ev: EventoCaixa = {
    ...base,
    status: 'realizado',
    data_realizada: r.paidAt,
    data_vencimento: r.dueDate,
  };
  return ev;
}
