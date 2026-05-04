/**
 * Agrega eventos com classificação não resolvida em pendências
 * por `(legal_entity_id, semana_iso, direcao)` (§8.2 do spec, 3.C.4).
 *
 * **Critério de "pendente":** evento com `bucket_id ===
 * 'pendente_classificacao'` OU `criticidade === 'pendente'`.
 *
 * **Granularidade fixa:** uma pendência por
 * `(legal_entity_id, semana_iso, direcao)`. Refinamento (agregação por
 * bucket dentro da unidade) fica pra v0.1.
 *
 * **Por que agregar:** Gregorutt produz ~12k pendentes-classificação.
 * Listar individualmente vira ruído inutilizável. Agregação por
 * semana/unidade/direção dá visão acionável.
 *
 * **Escopo:** apenas eventos NA GRADE da semana — atrasados e fora
 * da janela ficam de fora (não estão em `evento_ids` nem
 * `eventos_pendentes_com_data_ids`).
 */
import type {
  AcaoCobertura,
  Direcao,
  EventoCaixa,
  Pendencia,
  ProjecaoCliente,
} from '../types/index.js';

const PENDENTE_BUCKET = 'pendente_classificacao';
const ACOES: AcaoCobertura[] = ['reclassificar_eventos_pendentes'];

export interface AgregaPendentesClassificacaoInput {
  eventos: readonly EventoCaixa[];
  projecao: ProjecaoCliente;
}

export function agregaPendentesClassificacao(
  input: AgregaPendentesClassificacaoInput,
): Pendencia[] {
  const eventoPorId = new Map<string, EventoCaixa>();
  for (const ev of input.eventos) eventoPorId.set(ev.id, ev);

  // Bucket de agregação: `${legal_entity_id}|${semana_iso}|${direcao}`.
  type Acumulado = {
    legal_entity_id: string;
    semana_iso: string;
    direcao: Direcao;
    quantidade: number;
    valor_total: number;
  };
  const acums = new Map<string, Acumulado>();

  for (const u of input.projecao.unidades) {
    for (const sem of u.semanas) {
      const ids = [
        ...sem.evento_ids,
        ...sem.eventos_pendentes_com_data_ids,
      ];
      for (const id of ids) {
        const ev = eventoPorId.get(id);
        if (ev === undefined) continue;
        if (
          ev.bucket_id !== PENDENTE_BUCKET &&
          ev.criticidade !== 'pendente'
        ) {
          continue;
        }
        const key = `${u.legal_entity_id}|${sem.semana_iso}|${ev.direcao}`;
        const ac = acums.get(key);
        if (ac === undefined) {
          acums.set(key, {
            legal_entity_id: u.legal_entity_id,
            semana_iso: sem.semana_iso,
            direcao: ev.direcao,
            quantidade: 1,
            valor_total: ev.valor,
          });
        } else {
          ac.quantidade += 1;
          ac.valor_total += ev.valor;
        }
      }
    }
  }

  // Ordem determinística: (legal_entity_id, semana_iso, direcao).
  const ordenado = [...acums.values()].sort((a, b) => {
    const c1 = a.legal_entity_id.localeCompare(b.legal_entity_id);
    if (c1 !== 0) return c1;
    const c2 = a.semana_iso.localeCompare(b.semana_iso);
    if (c2 !== 0) return c2;
    return a.direcao.localeCompare(b.direcao);
  });

  return ordenado.map<Pendencia>((a) => ({
    id: `pend_pendentes_classificacao_${a.legal_entity_id}_${a.semana_iso}_${a.direcao}`,
    tipo: 'pendentes_classificacao_agregados',
    legal_entity_id: a.legal_entity_id,
    semana_iso: a.semana_iso,
    descricao:
      'Eventos sem classificação resolvida nesta semana. Confirme bucket para precisão do caixa mínimo.',
    acoes_sugeridas: ACOES,
    direcao: a.direcao,
    quantidade_eventos: a.quantidade,
    valor_total: a.valor_total,
  }));
}
