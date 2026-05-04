/**
 * Função core do Estágio 4.5 — Classification Bridge.
 *
 * Pura: mesmo input + mesmo `ClassifierAdapter` (com estado fixo) →
 * mesmo output. Iteração em ordem de input (preserva ordem original
 * dos arrays). Imutabilidade absoluta: `EventoCaixa` original NUNCA
 * é mutado; eventos enriquecidos viram NOVAS instâncias.
 *
 * Posição lógica no pipeline: entre Stage 1 (ingestão) e Stage 2
 * (Motor de Histórico). Estimados gerados pelo Stage 2 herdam
 * classificação da recorrência base — que já foi enriquecida aqui.
 *
 * Idempotência: eventos com `bucket_id != "pendente_classificacao"` no
 * input passam INTACTOS — nunca reclassificados.
 */
import type {
  Criticidade,
  EventoCaixa,
  EventoCaixaBase,
  EventoConfirmado,
  EventoEstimado,
  EventoPendente,
  EventoRealizado,
} from '../types/index.js';
import type { ClassifierAdapter } from './ClassifierAdapter.js';
import type {
  ClassificationResult,
  ClassificationStats,
} from './types.js';

const PENDENTE_BUCKET = 'pendente_classificacao';

export interface ClassifyEventosInput {
  eventos: readonly EventoCaixa[];
  classifier: ClassifierAdapter;
}

export interface ClassifyEventosOutput {
  /** Array novo. Eventos enriquecidos são instâncias novas; eventos
   *  passados intactos podem ser referência ou cópia (consumidor não
   *  deve depender de igualdade referencial). */
  eventos: EventoCaixa[];
  estatisticas: ClassificationStats;
}

/**
 * Estatística `requiresOwnerConfirmationCount`: o adapter sinaliza
 * via campo opcional na `ClassificationResult`. Como `ClassificationResult`
 * não carrega esse campo (Bridge só conhece bucket/nome/criticidade),
 * a sinalização vem por canal lateral: o adapter expõe um contador
 * próprio. `classifyEventos` lê `classifier.lastRequiresConfirmation`
 * antes E depois de cada chamada para detectar "esta classificação
 * pediu confirmação".
 *
 * Optar por canal lateral em vez de aumentar `ClassificationResult`
 * mantém o tipo público enxuto — confirmação só importa para
 * observabilidade do Bridge, não para consumidores downstream.
 */
interface ClassifierWithConfirmationFlag {
  /** True se a última chamada de `classify` pediu confirmação. */
  lastRequiresConfirmation?: boolean;
}

/**
 * Bridge core. Itera eventos, delega para o adapter, monta o output.
 */
export function classifyEventos(
  input: ClassifyEventosInput,
): ClassifyEventosOutput {
  const t0 = Date.now();
  const { eventos, classifier } = input;
  const adapterFlag = classifier as unknown as ClassifierWithConfirmationFlag;

  const out: EventoCaixa[] = [];
  const porBucket = new Map<string, number>();
  const porCriticidade = new Map<Criticidade, number>();
  let jaClassificadosNoInput = 0;
  let classificados = 0;
  let naoClassificados = 0;
  let requiresOwnerConfirmationCount = 0;

  for (const ev of eventos) {
    // Idempotência: já classificado → passa intacto, sem chamar o motor.
    if (ev.bucket_id !== PENDENTE_BUCKET) {
      jaClassificadosNoInput += 1;
      out.push(ev);
      continue;
    }

    // Delega ao adapter. Bridge não inventa nada. Adapter é
    // responsável por (re)setar `lastRequiresConfirmation` em cada
    // chamada — Bridge só lê o valor após `classify`.
    const result = classifier.classify(ev);

    if (result === null) {
      naoClassificados += 1;
      out.push(ev);
      continue;
    }

    if (adapterFlag.lastRequiresConfirmation === true) {
      requiresOwnerConfirmationCount += 1;
    }

    classificados += 1;
    porBucket.set(result.bucket_id, (porBucket.get(result.bucket_id) ?? 0) + 1);
    porCriticidade.set(
      result.criticidade,
      (porCriticidade.get(result.criticidade) ?? 0) + 1,
    );

    out.push(comClassificacao(ev, result));
  }

  const estatisticas: ClassificationStats = {
    totalEventos: eventos.length,
    jaClassificadosNoInput,
    classificados,
    naoClassificados,
    porBucket,
    porCriticidade,
    requiresOwnerConfirmationCount,
    tempoTotalMs: Date.now() - t0,
  };

  return { eventos: out, estatisticas };
}

/* ─────────── Helpers internos ─────────── */

/**
 * Constrói uma NOVA instância de `EventoCaixa` com `bucket_id`,
 * `bucket_nome` e `criticidade` substituídos. Demais campos (id, valor,
 * datas, status, origem, etc) preservados.
 *
 * `exactOptionalPropertyTypes: true` exige replicar o set de optionals
 * presentes no original.
 */
function comClassificacao(
  ev: EventoCaixa,
  cls: ClassificationResult,
): EventoCaixa {
  // Base comum a todas as variantes (`EventoCaixaBase`).
  const base: EventoCaixaBase = {
    id: ev.id,
    valor: ev.valor,
    direcao: ev.direcao,
    data_esperada: ev.data_esperada,
    bucket_id: cls.bucket_id,
    bucket_nome: cls.bucket_nome,
    cliente_id: ev.cliente_id,
    legal_entity_id: ev.legal_entity_id,
    origem: ev.origem,
    criticidade: cls.criticidade,
    confianca: ev.confianca,
    confianca_origem: ev.confianca_origem,
    is_transferencia: ev.is_transferencia,
    criado_em: ev.criado_em,
    criado_por: ev.criado_por,
  };
  if (ev.contraparte_id !== undefined) base.contraparte_id = ev.contraparte_id;
  if (ev.contraparte_tipo !== undefined)
    base.contraparte_tipo = ev.contraparte_tipo;
  if (ev.source_company_code !== undefined)
    base.source_company_code = ev.source_company_code;
  if (ev.origem_ref !== undefined) base.origem_ref = ev.origem_ref;
  if (ev.documento_ref !== undefined) base.documento_ref = ev.documento_ref;
  if (ev.confirmado_por !== undefined) base.confirmado_por = ev.confirmado_por;
  if (ev.confirmado_em !== undefined) base.confirmado_em = ev.confirmado_em;
  if (ev.competencia !== undefined) base.competencia = ev.competencia;
  if (ev.cenario_id !== undefined) base.cenario_id = ev.cenario_id;
  if (ev.observacao !== undefined) base.observacao = ev.observacao;
  if (ev.reconciliado_com !== undefined)
    base.reconciliado_com = ev.reconciliado_com;
  if (ev.reconciliado_em !== undefined)
    base.reconciliado_em = ev.reconciliado_em;
  if (ev.transferencia_par_id !== undefined)
    base.transferencia_par_id = ev.transferencia_par_id;
  if (ev.descricao_origem !== undefined)
    base.descricao_origem = ev.descricao_origem;
  if (ev.contraparte_nome_origem !== undefined)
    base.contraparte_nome_origem = ev.contraparte_nome_origem;
  if (ev.conta_origem_nome !== undefined)
    base.conta_origem_nome = ev.conta_origem_nome;

  // Variante por status.
  switch (ev.status) {
    case 'realizado': {
      const rev: EventoRealizado = {
        ...base,
        status: 'realizado',
        data_realizada: ev.data_realizada,
      };
      if (ev.data_vencimento !== undefined) rev.data_vencimento = ev.data_vencimento;
      return rev;
    }
    case 'confirmado': {
      const cev: EventoConfirmado = {
        ...base,
        status: 'confirmado',
        data_realizada: null,
        data_vencimento: ev.data_vencimento,
      };
      return cev;
    }
    case 'estimado': {
      const eev: EventoEstimado = {
        ...base,
        status: 'estimado',
        data_realizada: null,
      };
      if (ev.data_vencimento !== undefined) eev.data_vencimento = ev.data_vencimento;
      return eev;
    }
    case 'pendente': {
      const pev: EventoPendente = {
        ...base,
        status: 'pendente',
        data_realizada: null,
      };
      if (ev.data_vencimento !== undefined) pev.data_vencimento = ev.data_vencimento;
      return pev;
    }
  }
}
