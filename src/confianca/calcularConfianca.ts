/**
 * Estágio 6 — Motor de Confiança (orquestrador).
 *
 * Lê `ProjecaoCliente` (Stage 4) + `CoberturaResult` (Stage 5) +
 * `EventoCaixa[]` indexados por id, e produz `ConfiancaResult`.
 *
 * **Não muta input.** Stage 7 (Veredito) que decide se suprime veredito
 * quando há `cobertura_insuficiente` — Stage 6 calcula normalmente.
 *
 * Determinismo: mesmo input → mesmo output (`deepEqual`). Iteração na
 * ordem das unidades vinda da projeção (já é lex pelo Stage 4.2).
 */
import type {
  EventoCaixa,
  ProjecaoCliente,
  ProjecaoUnidade,
  CoberturaResult,
  SemanaProjecao,
} from '../types/index.js';
import { mapearCoberturaParaEcho } from './coerencia-cobertura.js';
import {
  calcularSaidasSemana,
  detectarPendenciasCriticasSemana,
} from './pendencia-critica.js';
import { calcularConfiancaProjecao } from './projecao.js';
import { calcularConfiancaSemana } from './semana.js';
import {
  ConfiancaError,
  type ConfiancaResult,
  type ConfiancaSemana,
  type ConfiancaUnidade,
  type PendenciaCritica,
} from './types.js';

export interface CalcularConfiancaInput {
  projecao: ProjecaoCliente;
  cobertura: CoberturaResult;
  eventos: readonly EventoCaixa[];
}

/**
 * Função pública principal. Retorna nova estrutura `ConfiancaResult`.
 *
 * @throws `ConfiancaError` quando algum `evento_id` referenciado pela
 *   `ProjecaoCliente` não existe em `eventos[]`, ou quando algum evento
 *   chega sem `confianca` resolvida.
 */
export function calcularConfianca(
  input: CalcularConfiancaInput,
): ConfiancaResult {
  const { projecao, cobertura, eventos } = input;

  /* (1) Index eventos por id para lookup O(1). */
  const eventoIndex = new Map<string, EventoCaixa>();
  for (const ev of eventos) eventoIndex.set(ev.id, ev);

  /* (2) Pré-validação: todo `evento_id` da projeção deve resolver. */
  validarReferenciasResolviveis(projecao, eventoIndex);

  /* (3) Por unidade. */
  const por_unidade = projecao.unidades.map((u) =>
    calcularUnidade({
      legal_entity_id: u.legal_entity_id,
      cliente_id: projecao.cliente_id,
      semanas: u.semanas,
      eventoIndex,
    }),
  );

  /* (4) Consolidado. ProjecaoConsolidada não tem `legal_entity_id`
   *     único — convenção: `'consolidado:<cliente_id>'`. */
  const consolidado = calcularUnidade({
    legal_entity_id: `consolidado:${projecao.cliente_id}`,
    cliente_id: projecao.cliente_id,
    semanas: projecao.consolidado.semanas,
    eventoIndex,
  });

  /* (5) Eco da cobertura por unidade ativa. */
  const cobertura_aplicada = mapearCoberturaParaEcho({
    cobertura,
    legal_entity_ids: projecao.unidades.map((u) => u.legal_entity_id),
  });

  return { por_unidade, consolidado, cobertura_aplicada };
}

/* ─────────── Helpers internos ─────────── */

interface CalcularUnidadeArgs {
  legal_entity_id: string;
  cliente_id: string;
  /** length = 13. */
  semanas: readonly SemanaProjecao[];
  eventoIndex: ReadonlyMap<string, EventoCaixa>;
}

/**
 * Calcula `ConfiancaUnidade` para um escopo (unidade real OU consolidado).
 * Itera as 13 semanas em ordem, calcula pendências críticas por semana
 * (denominador local), depois faz `pior das 13`.
 *
 * Pendências críticas do consolidado são RECALCULADAS — não somadas das
 * unidades — porque a materialidade depende do denominador local
 * (saídas da semana no escopo), e o consolidado já vem com transferências
 * neutralizadas pelo Stage 4.
 */
function calcularUnidade(args: CalcularUnidadeArgs): ConfiancaUnidade {
  const { legal_entity_id, cliente_id, semanas, eventoIndex } = args;

  const confSemanas: ConfiancaSemana[] = [];
  const pendenciasGerais: PendenciaCritica[] = [];

  for (let idx = 0; idx < semanas.length; idx++) {
    const sem = semanas[idx]!;
    const semanaN = idx + 1;
    const eventosSemana = resolverEventosSemana(sem, eventoIndex);
    const saidasSemana = calcularSaidasSemana(eventosSemana);
    const pendenciasSemana = detectarPendenciasCriticasSemana({
      eventos: eventosSemana,
      saidasSemana,
      semana: semanaN,
      legal_entity_id,
      cliente_id,
    });
    confSemanas.push(
      calcularConfiancaSemana({
        semana: semanaN,
        semanaProjecao: sem,
        eventos: eventosSemana,
        pendenciasCriticas: pendenciasSemana,
      }),
    );
    pendenciasGerais.push(...pendenciasSemana);
  }

  /* Ordem final das pendências: por (semana, evento_id). */
  pendenciasGerais.sort((a, b) => {
    if (a.semana !== b.semana) return a.semana - b.semana;
    return a.evento_id.localeCompare(b.evento_id);
  });

  return {
    legal_entity_id,
    semanas: confSemanas,
    confianca_projecao: calcularConfiancaProjecao(confSemanas),
    pendencias_criticas: pendenciasGerais,
  };
}

/**
 * Resolve os eventos da semana via `evento_ids`. Pendentes (lista
 * separada `eventos_pendentes_com_data_ids`) NÃO entram na contagem
 * de confiança da semana — pendentes ficaram fora dos totais
 * financeiros do Stage 4 por design (status='pendente' indica dado
 * incompleto). Stage 6 honra essa separação para não duplicar
 * tratamento (Stage 5 já agregou pendentes em `pendentes_classificacao_agregados`).
 */
function resolverEventosSemana(
  sem: SemanaProjecao,
  eventoIndex: ReadonlyMap<string, EventoCaixa>,
): EventoCaixa[] {
  const out: EventoCaixa[] = [];
  for (const id of sem.evento_ids) {
    const ev = eventoIndex.get(id);
    if (ev !== undefined) out.push(ev);
  }
  return out;
}

/**
 * Verifica que todo `evento_id` referenciado pela projeção (unidades +
 * consolidado) existe em `eventos[]`. Falha visivelmente.
 */
function validarReferenciasResolviveis(
  projecao: ProjecaoCliente,
  eventoIndex: ReadonlyMap<string, EventoCaixa>,
): void {
  const todasUnidades: { legal_entity_id: string; semanas: readonly SemanaProjecao[] }[] = [
    ...projecao.unidades.map((u: ProjecaoUnidade) => ({
      legal_entity_id: u.legal_entity_id,
      semanas: u.semanas,
    })),
    {
      legal_entity_id: `consolidado:${projecao.cliente_id}`,
      semanas: projecao.consolidado.semanas,
    },
  ];

  for (const u of todasUnidades) {
    for (let idx = 0; idx < u.semanas.length; idx++) {
      const sem = u.semanas[idx]!;
      for (const id of sem.evento_ids) {
        if (!eventoIndex.has(id)) {
          throw new ConfiancaError(
            `evento_id '${id}' referenciado por ${u.legal_entity_id} semana ${idx + 1} (${sem.semana_iso}) não existe em eventos[]`,
          );
        }
      }
    }
  }
}
