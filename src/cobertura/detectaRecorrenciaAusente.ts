/**
 * Detecta recorrências esperadas sem evento correspondente alocado
 * na semana esperada (§8.2 do spec, 3.C.2 + 3.C.3).
 *
 * **Critérios de elegibilidade da recorrência:**
 *  - `confianca IN ('alta', 'media')`. `'baixa'` não dispara.
 *  - `ativa === true`.
 *  - **Saídas (3.C.2):** `bucket_id` em `BUCKETS_OBRIGACAO_FIXA`
 *    (folha/deduções/financeiras). Lista hardcoded — refinamento
 *    (motor de classificação emitir flag `obrigacao_fixa: boolean`)
 *    fica pra v0.1.
 *  - **Entradas (3.C.3):** sem filtro de bucket — recebíveis recorrentes
 *    (assinatura, mensalidade, contrato) são "esperados" mesmo sem
 *    bucket fixo. Spec §3.C.3: "Mesma lógica de 3.C.2 mas pra
 *    recorrências de entrada". Interpretado: filtro composto
 *    `direcao=entrada` substitui o filtro de bucket — buckets
 *    típicos de entrada (`receita`, `contas_receber`) não estão na
 *    lista de obrigações.
 *
 * **Trava anti-duplicação:** semana esperada já tem evento
 * `(contraparte_id, bucket_id)` correspondente (em qualquer status —
 * `confirmado`, `realizado`, `estimado`, `pendente`)? Se sim, NÃO
 * dispara. Sintônica com a trava do Stage 2.2.
 *
 * **Projeção das ocorrências futuras:** dado `ultima_data` da
 * recorrência + `periodo`, gera próximas datas dentro da janela das
 * 13 semanas até ultrapassar o fim. Cada data esperada cai em uma
 * `semana_iso` da janela.
 */
import { addUTCDays } from '../utils/date.js';
import type {
  AcaoCobertura,
  EventoCaixa,
  HistoricoOperacional,
  Pendencia,
  Periodo,
  ProjecaoCliente,
  Recorrencia,
} from '../types/index.js';
import { semanaIsoOf } from '../projecao/index.js';

const ACOES: AcaoCobertura[] = [
  'adicionar_evento_manual',
  'verificar_recorrencia',
];

/**
 * Buckets considerados "obrigação fixa" pra disparar
 * `recorrencia_ausente` em saídas. Lista hardcoded mínima — TODO de
 * v0.1: motor de classificação podia emitir flag `obrigacao_fixa`
 * por bucket, evitando essa decisão local.
 */
export const BUCKETS_OBRIGACAO_FIXA: ReadonlySet<string> = new Set<string>([
  'folha',
  'deducoes',
  'despesas_financeiras',
]);

const PERIODO_DIAS: Record<Periodo, number> = {
  semanal: 7,
  quinzenal: 15,
  mensal: 30,
  bimestral: 60,
  trimestral: 90,
};

export interface DetectaRecorrenciaAusenteInput {
  eventos: readonly EventoCaixa[];
  historico: HistoricoOperacional;
  projecao: ProjecaoCliente;
}

export function detectaRecorrenciaAusente(
  input: DetectaRecorrenciaAusenteInput,
): Pendencia[] {
  const pendencias: Pendencia[] = [];
  const janela = input.projecao.consolidado.janela;
  if (janela.length === 0) return pendencias;

  // Index eventos por id pra resolver `(contraparte_id, bucket_id)`
  // a partir de `evento_ids` da semana.
  const eventoPorId = new Map<string, EventoCaixa>();
  for (const ev of input.eventos) {
    eventoPorId.set(ev.id, ev);
  }

  // Index de unidades por legal_entity_id.
  const unidadesPorId = new Map<string, ProjecaoCliente['unidades'][number]>();
  for (const u of input.projecao.unidades) {
    unidadesPorId.set(u.legal_entity_id, u);
  }

  // Janela: índice por `semana_iso` para lookup O(1).
  const janelaIndex = new Map<string, number>();
  for (let i = 0; i < janela.length; i++) {
    janelaIndex.set(janela[i]!, i);
  }
  const fimJanelaIso = janela[janela.length - 1]!;

  // Iteração determinística sobre recorrências.
  const recorrenciasOrdenadas = [...input.historico.recorrencias].sort(
    (a, b) => a.recorrencia_id.localeCompare(b.recorrencia_id),
  );

  for (const r of recorrenciasOrdenadas) {
    if (!isRecorrenciaElegivel(r)) continue;

    // Unidade da recorrência precisa estar ativa (presente em
    // `projecao.unidades`). Se não, pula — não fazemos pendência
    // para unidade fora do universo CF13.
    const unidade = unidadesPorId.get(r.legal_entity_id);
    if (unidade === undefined) continue;

    // Gera próximas ocorrências dentro da janela.
    const ocorrencias = projetaProximasOcorrencias(r, janela, janelaIndex, fimJanelaIso);

    for (const oc of ocorrencias) {
      // Trava anti-duplicação: semana já tem evento correspondente?
      if (
        semanaCobreRecorrencia(unidade, oc.semanaIdx, r, eventoPorId)
      ) {
        continue;
      }

      const id = `pend_recorrencia_ausente_${r.recorrencia_id}_${oc.semana_iso}`;
      const p: Pendencia = {
        id,
        tipo: 'recorrencia_ausente',
        legal_entity_id: r.legal_entity_id,
        semana_iso: oc.semana_iso,
        descricao: descricaoFor(r),
        acoes_sugeridas: ACOES,
        recorrencia_id: r.recorrencia_id,
        bucket_id: r.bucket_id,
        valor_esperado: r.valor_mediano,
      };
      if (r.contraparte_id !== '') p.contraparte_id = r.contraparte_id;
      pendencias.push(p);
    }
  }

  // Ordem final: (legal_entity_id, semana_iso, id).
  pendencias.sort((a, b) => {
    const c1 = a.legal_entity_id.localeCompare(b.legal_entity_id);
    if (c1 !== 0) return c1;
    const c2 = a.semana_iso.localeCompare(b.semana_iso);
    if (c2 !== 0) return c2;
    return a.id.localeCompare(b.id);
  });
  return pendencias;
}

/* ─────────── Helpers internos ─────────── */

function isRecorrenciaElegivel(r: Recorrencia): boolean {
  if (r.confianca === 'baixa') return false;
  if (!r.ativa) return false;
  if (r.direcao === 'entrada') {
    // Entradas: sem filtro de bucket — recebíveis recorrentes valem.
    return true;
  }
  // Saídas: filtra por lista de obrigações fixas.
  return BUCKETS_OBRIGACAO_FIXA.has(r.bucket_id);
}

interface OcorrenciaProjetada {
  semana_iso: string;
  semanaIdx: number;
  data_esperada: Date;
}

/**
 * Projeta próximas ocorrências dentro da janela das 13 semanas, a
 * partir de `ultima_data + período` somando até ultrapassar o fim
 * da janela. Cada ocorrência cai em uma `semana_iso` indexada.
 *
 * Ocorrências FORA da janela (ex: ocorrência que cairia depois da
 * semana 13) são descartadas — só pendências dentro da janela.
 */
function projetaProximasOcorrencias(
  r: Recorrencia,
  janela: readonly string[],
  janelaIndex: ReadonlyMap<string, number>,
  fimJanelaIso: string,
): OcorrenciaProjetada[] {
  const out: OcorrenciaProjetada[] = [];
  const passo = PERIODO_DIAS[r.periodo];
  // Limite duro: não gerar mais de 60 ocorrências (proteção contra
  // recorrências patológicas — janela de 13 semanas comporta no máximo
  // ~13 ocorrências semanais).
  let proxima = addUTCDays(r.ultima_data, passo);
  let safety = 0;
  while (safety < 60) {
    safety += 1;
    const semana_iso = semanaIsoOf(proxima);
    if (semana_iso > fimJanelaIso) break;
    const idx = janelaIndex.get(semana_iso);
    if (idx !== undefined) {
      out.push({ semana_iso, semanaIdx: idx, data_esperada: proxima });
    }
    proxima = addUTCDays(proxima, passo);
  }
  return out;
}

/**
 * Trava anti-duplicação. Verifica se a semana indicada já tem evento
 * com `(contraparte_id, bucket_id)` correspondente à recorrência.
 *
 * Considera todos os status (confirmado, realizado, estimado, pendente)
 * — qualquer evento alocado na semana que bata com a recorrência
 * cobre o esperado.
 *
 * Quando `recorrencia.contraparte_id` é vazio, basta o `bucket_id` bater.
 */
function semanaCobreRecorrencia(
  unidade: ProjecaoCliente['unidades'][number],
  semanaIdx: number,
  r: Recorrencia,
  eventoPorId: ReadonlyMap<string, EventoCaixa>,
): boolean {
  const sem = unidade.semanas[semanaIdx];
  if (sem === undefined) return false;
  const ids = [...sem.evento_ids, ...sem.eventos_pendentes_com_data_ids];
  for (const id of ids) {
    const ev = eventoPorId.get(id);
    if (ev === undefined) continue;
    if (ev.bucket_id !== r.bucket_id) continue;
    if (r.contraparte_id !== '') {
      if (ev.contraparte_id !== r.contraparte_id) continue;
    }
    return true;
  }
  return false;
}

function descricaoFor(r: Recorrencia): string {
  if (r.direcao === 'entrada') {
    return 'Recebível recorrente esperado nesta semana, sem evento correspondente alocado.';
  }
  return 'Obrigação recorrente esperada nesta semana, sem evento correspondente alocado.';
}
