/**
 * Validação e auditoria de transferências internas (Estágio 4.2 §3.E).
 *
 * Função pura, separada do orquestrador `projetaCliente` por dois
 * motivos:
 *  1. Testabilidade: as regras de validação têm muitos sub-casos
 *     (par_inexistente / mesma_unidade / cliente_diferente / nao_reciproco
 *     / mesma_direcao / fora_janela) que merecem cobertura unitária
 *     dedicada.
 *  2. Single responsibility: orquestrador faz soma+roll-forward;
 *     este módulo decide o que neutralizar.
 *
 * Saída descreve INTENÇÕES (subtrações a aplicar) — quem aplica é o
 * `projetaCliente`. Mantém este módulo livre de side-effect sobre
 * estruturas mutáveis.
 */
import type {
  EventoCaixa,
  ProjecaoUnidade,
  TransferenciaNeutralizada,
} from '../types/index.js';
import { semanaIsoOf } from './semanas.js';

/**
 * Bucket alvo de subtração no consolidado. Combinação determinística
 * de `direcao × status` — cada evento entra em exatamente um.
 */
export type BucketConsolidado =
  | 'entradas_realizadas'
  | 'entradas_confirmadas'
  | 'entradas_estimadas'
  | 'saidas_realizadas'
  | 'saidas_confirmadas'
  | 'saidas_estimadas';

/** Operação de subtração a aplicar pelo orquestrador. */
export interface SubtracaoConsolidado {
  /** Índice da semana no array `janela`/`semanas`. */
  semanaIdx: number;
  /** Campo a subtrair em `SemanaProjecao`. */
  bucket: BucketConsolidado;
  /** ID do evento (para remover de `evento_ids` da semana). */
  evento_id: string;
  /** Valor a subtrair. Sempre positivo (`evento.valor`). */
  valor: number;
}

export interface AvaliacaoTransferenciasInput {
  /** Eventos do cliente (já filtrados por `cliente_id`). */
  eventosCliente: readonly EventoCaixa[];
  /** Eventos do input ORIGINAL — usados para detectar `cliente_diferente`
   *  (par aponta pra evento de outro cliente). */
  eventosTodos: readonly EventoCaixa[];
  /** Map `legal_entity_id → ProjecaoUnidade`, das unidades ATIVAS apenas.
   *  Usado para resolver allocationDate e checagem de in-window. */
  unidadesPorId: ReadonlyMap<string, ProjecaoUnidade>;
  /** Janela das 13 semanas (vinda das unidades; igual em todas). */
  janela: readonly string[];
}

export interface AvaliacaoTransferenciasOutput {
  /** Auditoria por par avaliado, ordenada por `evento_a_id` lex. */
  registros: TransferenciaNeutralizada[];
  /** Subtrações a aplicar no consolidado. Vazio quando não há par válido. */
  subtracoes: SubtracaoConsolidado[];
  /** Total de eventos com `is_transferencia=true` em `eventosCliente`. */
  marcadosCount: number;
}

/**
 * Avalia todos os pares marcados `is_transferencia=true` do cliente.
 * Cada evento é avaliado exatamente uma vez (set `evaluated`); pares
 * recíprocos consomem ambos os lados em uma só avaliação.
 *
 * **Determinismo:**
 *  - Iteração em ordem `id` lex.
 *  - `registros` retornado ordenado por `evento_a_id`.
 */
export function avaliaTransferencias(
  input: AvaliacaoTransferenciasInput,
): AvaliacaoTransferenciasOutput {
  // Index global por id (incl. eventos de outros clientes — pra detectar
  // cliente_diferente quando par aponta pra fora).
  const indexGlobal = new Map<string, EventoCaixa>();
  for (const e of input.eventosTodos) {
    indexGlobal.set(e.id, e);
  }

  // Set de ids marcados como transferência DENTRO do cliente.
  const marcadosCliente: EventoCaixa[] = input.eventosCliente.filter(
    (e) => e.is_transferencia === true,
  );
  const marcadosCount = marcadosCliente.length;

  // Ordem determinística para evitar dependência de input.
  const ordenado = [...marcadosCliente].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const evaluated = new Set<string>();
  const registros: TransferenciaNeutralizada[] = [];
  const subtracoes: SubtracaoConsolidado[] = [];

  for (const a of ordenado) {
    if (evaluated.has(a.id)) continue;

    const par_id = a.transferencia_par_id;

    /* Caso 1: órfão sem `transferencia_par_id`. */
    if (par_id === undefined) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: '',
        valido: false,
        motivo_invalidez: 'par_inexistente',
        valor: a.valor,
      });
      evaluated.add(a.id);
      continue;
    }

    const b = indexGlobal.get(par_id);

    /* Caso 2: par_id aponta pra id que não existe. */
    if (b === undefined) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: par_id,
        valido: false,
        motivo_invalidez: 'par_inexistente',
        valor: a.valor,
      });
      evaluated.add(a.id);
      continue;
    }

    /* Caso 3: cliente_id diferente. */
    if (a.cliente_id !== b.cliente_id) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: b.id,
        valido: false,
        motivo_invalidez: 'cliente_diferente',
        valor: a.valor,
      });
      evaluated.add(a.id);
      // Não marcar B — está em outro cliente, não nos pertence.
      continue;
    }

    /* Caso 4: mesma unidade. */
    if (a.legal_entity_id === b.legal_entity_id) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: b.id,
        valido: false,
        motivo_invalidez: 'mesma_unidade',
        valor: a.valor,
      });
      evaluated.add(a.id);
      evaluated.add(b.id);
      continue;
    }

    /* Caso 5: não recíproco (B aponta pra outro lugar ou pra nada). */
    if (b.transferencia_par_id !== a.id) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: b.id,
        valido: false,
        motivo_invalidez: 'nao_reciproco',
        valor: a.valor,
      });
      evaluated.add(a.id);
      // B será avaliado independentemente quando chegar a vez dele
      // (ele tem seu próprio `transferencia_par_id`).
      continue;
    }

    /* Caso 6: mesma direção (ambas saída ou ambas entrada). */
    if (a.direcao === b.direcao) {
      registros.push({
        evento_a_id: a.id,
        evento_b_id: b.id,
        valido: false,
        motivo_invalidez: 'mesma_direcao',
        valor: a.valor,
      });
      evaluated.add(a.id);
      evaluated.add(b.id);
      continue;
    }

    /* Caso 7: in-window check. Se A ou B está fora da janela
     *         (atrasado / fora_janela / não-alocado), não neutraliza. */
    const locA = localizaNaJanela(a, input);
    const locB = localizaNaJanela(b, input);
    if (locA === null || locB === null) {
      const reg: TransferenciaNeutralizada = {
        evento_a_id: a.id,
        evento_b_id: b.id,
        valido: false,
        motivo_invalidez: 'fora_janela',
        valor: a.valor,
      };
      if (locA !== null) reg.semana_a = locA.semana_iso;
      if (locB !== null) reg.semana_b = locB.semana_iso;
      registros.push(reg);
      evaluated.add(a.id);
      evaluated.add(b.id);
      continue;
    }

    /* Pair válido. Emite subtrações nos respectivos buckets. */
    subtracoes.push({
      semanaIdx: locA.semanaIdx,
      bucket: bucketDe(a),
      evento_id: a.id,
      valor: a.valor,
    });
    subtracoes.push({
      semanaIdx: locB.semanaIdx,
      bucket: bucketDe(b),
      evento_id: b.id,
      valor: b.valor,
    });
    registros.push({
      evento_a_id: a.id,
      evento_b_id: b.id,
      valido: true,
      semana_a: locA.semana_iso,
      semana_b: locB.semana_iso,
      valor: a.valor,
    });
    evaluated.add(a.id);
    evaluated.add(b.id);
  }

  // Ordem final: lex por evento_a_id (já vem assim por construção, mas
  // reordenamos por defesa contra alterações futuras).
  registros.sort((x, y) => x.evento_a_id.localeCompare(y.evento_a_id));

  return { registros, subtracoes, marcadosCount };
}

/* ─────────── Helpers internos ─────────── */

/**
 * Resolve a localização de um evento na janela consolidada. Retorna
 * `null` quando o evento está fora da janela ou não foi alocado pela
 * unidade dele.
 */
function localizaNaJanela(
  ev: EventoCaixa,
  input: AvaliacaoTransferenciasInput,
): { semanaIdx: number; semana_iso: string } | null {
  const unidade = input.unidadesPorId.get(ev.legal_entity_id);
  if (unidade === undefined) return null;
  const allocDate = unidade.allocationDatesByEventoId.get(ev.id);
  if (allocDate === undefined) return null;
  // Atrasados e fora da janela explicitamente excluídos.
  if (
    unidade.eventosAtrasados.includes(ev.id) ||
    unidade.eventosForaDaJanela.includes(ev.id)
  ) {
    return null;
  }
  const semana_iso = semanaIsoOf(allocDate);
  const idx = input.janela.indexOf(semana_iso);
  if (idx < 0) return null;
  return { semanaIdx: idx, semana_iso };
}

/** Bucket consolidado correspondente ao `direcao × status` do evento. */
function bucketDe(ev: EventoCaixa): BucketConsolidado {
  const lado = ev.direcao === 'entrada' ? 'entradas' : 'saidas';
  // Pendentes não entram nos totais nem em `evento_ids` — `bucketDe`
  // não deveria ser chamado pra eles. Como a soma bruta no
  // `projetaCliente` já filtra pendentes, pares marcados pendentes
  // (caso degenerado) terão seu `evento_id` removido das listas mas
  // valor 0 já estava nos totais. Para defesa, mapeamos para
  // `*_realizadas` (não há bucket "pendente"; subtração de 0 em
  // *_realizadas é no-op porque pendentes nunca somaram lá).
  let bucketStatus: 'realizadas' | 'confirmadas' | 'estimadas';
  if (ev.status === 'realizado') bucketStatus = 'realizadas';
  else if (ev.status === 'confirmado') bucketStatus = 'confirmadas';
  else if (ev.status === 'estimado') bucketStatus = 'estimadas';
  else bucketStatus = 'realizadas'; // pendente (nunca ocorre na prática)
  return `${lado}_${bucketStatus}` as BucketConsolidado;
}
