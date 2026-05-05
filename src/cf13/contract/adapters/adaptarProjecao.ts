/**
 * Adapter: `ProjecaoCliente` interno → `ProjecaoCliente` do contrato.
 *
 * Orquestra `adaptarNivel` para consolidado + cada unidade. Monta a
 * janela `{inicio, fim}` a partir do consolidado (semana 1 → semana 13).
 */
import type { ProjecaoCliente as ProjecaoClienteInterna } from '../../../types/projecao.js';
import type { EventoCaixa } from '../../../types/EventoCaixa.js';
import { adaptarNivel } from './adaptarNivel.js';
import { formatarISODate } from './adaptarSemana.js';
import type { ProjecaoCliente as ProjecaoClienteContract } from '../types.js';

export interface AdaptarProjecaoArgs {
  projecao: ProjecaoClienteInterna;
  /** ISO `YYYY-MM-DD` da `base_date` do input — propagada no `meta`
   *  e no campo `baseDate` da projeção. */
  baseDate: string;
  eventoIndex: ReadonlyMap<string, EventoCaixa>;
}

export function adaptarProjecao(
  args: AdaptarProjecaoArgs,
): ProjecaoClienteContract {
  const { projecao, baseDate, eventoIndex } = args;

  const consolidado = adaptarNivel({
    fonte: projecao.consolidado,
    escopo: { tipo: 'consolidado', clienteId: projecao.cliente_id },
    eventoIndex,
  });

  const unidades = projecao.unidades.map((u) =>
    adaptarNivel({
      fonte: u,
      /* TODO: `legalEntityNome` indisponível em v0 — sem fonte de
       *  cadastro de unidades no core. Quando existir, popular aqui. */
      escopo: { tipo: 'unidade', legalEntityId: u.legal_entity_id },
      eventoIndex,
    }),
  );

  /* Janela do cliente = janela do consolidado (semana 1 → semana 13). */
  const inicio = consolidado.semanas[0]!.inicio;
  const fim = consolidado.semanas[consolidado.semanas.length - 1]!.fim;

  return {
    clienteId: projecao.cliente_id,
    baseDate,
    janela: { inicio, fim },
    consolidado,
    unidades,
  };
}

/** Re-export do helper para uso por outros adapters/runCF13Pipeline. */
export { formatarISODate };
