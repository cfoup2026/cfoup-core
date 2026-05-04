/**
 * Detecta semanas sem nenhum evento alocado (§8.2 do spec, 3.C.1).
 *
 * **Regra:** semana com `evento_ids.length === 0` E
 * `eventos_pendentes_com_data_ids.length === 0` → pendência.
 *
 * **Exceção:** semana 1 (idx 0) é a que contém `geradoEm`. Pode ter
 * apenas 1-2 dias úteis até o fim da semana, então estar zerada é
 * legítimo. NÃO dispara nesta semana.
 *
 * **Granularidade:** uma pendência por `(legal_entity_id, semana_iso)`.
 */
import type {
  AcaoCobertura,
  Pendencia,
  ProjecaoCliente,
} from '../types/index.js';

const ACOES: AcaoCobertura[] = [
  'confirmar_que_era_esperado',
  'adicionar_evento_manual',
];

export function detectaSemanaZerada(
  projecao: ProjecaoCliente,
): Pendencia[] {
  const pendencias: Pendencia[] = [];
  for (const u of projecao.unidades) {
    for (let idx = 0; idx < u.semanas.length; idx++) {
      // Semana 1 (idx 0) é a que contém `geradoEm` — pode ter pouco
      // tempo restante. Zerar é legítimo; pular.
      if (idx === 0) continue;
      const sem = u.semanas[idx]!;
      const totalEventos =
        sem.evento_ids.length + sem.eventos_pendentes_com_data_ids.length;
      if (totalEventos > 0) continue;

      pendencias.push({
        id: `pend_semana_zerada_${u.legal_entity_id}_${sem.semana_iso}`,
        tipo: 'semana_zerada',
        legal_entity_id: u.legal_entity_id,
        semana_iso: sem.semana_iso,
        descricao:
          'Semana sem nenhum evento alocado. Pode ser período sem movimento ou falha de ingestão.',
        acoes_sugeridas: ACOES,
      });
    }
  }
  // Ordem determinística: (legal_entity_id, semana_iso).
  pendencias.sort((a, b) => {
    const c = a.legal_entity_id.localeCompare(b.legal_entity_id);
    if (c !== 0) return c;
    return a.semana_iso.localeCompare(b.semana_iso);
  });
  return pendencias;
}
