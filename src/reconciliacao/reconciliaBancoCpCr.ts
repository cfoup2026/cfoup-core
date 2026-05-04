import type {
  AbsorcaoBancaria,
  EventoCaixa,
  EventoConfirmado,
  EventoRealizado,
  Origem,
  PendenciaReconciliacao,
  ReconciliacaoEstatisticas,
  ReconciliacaoResult,
  TipoPendenciaReconciliacao,
} from '../types/index.js';
import { ReconciliacaoError } from '../types/index.js';

/* ─────────── Constantes ─────────── */

const DAY_MS = 86_400_000;
/** Janela de match temporal da Passada 1 (±5 dias entre data_realizada
 *  do banco e data_esperada do confirmado). Mais larga porque o
 *  confirmado é uma promessa contratual com folga de pagamento. */
const JANELA_DIAS_P1 = 5;
/** Janela de match temporal da Passada 2 (±2 dias entre data_realizada
 *  do FKN-realizado e data_realizada do CEF). Mais apertada porque
 *  título já baixado tem data efetiva, não estimada. */
const JANELA_DIAS_P2 = 2;
/** Mínimo absoluto de tolerância de valor (R$ 5). */
const TOLERANCIA_MIN_R$ = 5;
/** Tolerância relativa de valor (1% sobre o lado A). */
const TOLERANCIA_REL = 0.01;

/**
 * Origens elegíveis pra "lado A" da reconciliação (confirmado em P1,
 * realizado-título em P2). Excluídos: `'historico'` (estimados não
 * reconciliam), `'cef'` e `'pluggy'` (são bancárias por natureza, não
 * títulos).
 */
const ORIGENS_LADO_A_ELEGIVEL: ReadonlySet<Origem> = new Set<Origem>([
  'fkn',
  'manual',
  'erp',
  'enotas',
  'contabil',
  'csv',
]);

/* ─────────── API pública ─────────── */

export interface ReconciliaBancoCpCrOptions {
  /** Quando o run está sendo feito (injetado em testes para determinismo). */
  reconciliadoEm: Date;
}

/**
 * Reconciliação principal banco ↔ CP/CR (Estágio 3.1 + 3.1.1 do CF13).
 *
 * Duas passadas, ambas 1:1 estritas, sem mover dinheiro automaticamente:
 *
 * **Passada 1 — `confirmado` ↔ CEF (Estágio 3.1):**
 *  Particiona o input em `confirmados` (FKN/manual/erp/etc), `realizadosBanco`
 *  (origem='cef'), `realizadosTitulo` (status='realizado' + origem em
 *  lado-A) e `outros`. Ordena CEFs por data_realizada asc, id lex. Para
 *  cada CEF, busca confirmados elegíveis (mesmo cliente_id+legal_entity_id+
 *  direcao, valor em tolerância `max(R$ 5, 1%)`, data ±5 dias, contraparte
 *  batendo quando ambos têm). Política:
 *   - 0 candidatos → CEF segue para Passada 2.
 *   - 2+ candidatos → pendência `ambiguidade_realizado_para_confirmado`.
 *   - 1 candidato livre → match: confirmado promovido a realizado, CEF
 *     vai pra `eventosBancariosAbsorvidos`.
 *   - 1 candidato já matched → pendência `duplicidade_confirmado`.
 *
 * **Passada 2 — `realizado_titulo` ↔ CEF restante (Estágio 3.1.1):**
 *  Resolve o caso "FKN-baixado mais CEF do mesmo evento", que dobraria
 *  o caixa. Ordena `realizadosTitulo` por data_realizada asc, id lex.
 *  Para cada um, busca CEFs sobrantes elegíveis (mesmo cliente_id+
 *  legal_entity_id+direcao, valor em tolerância `max(R$ 5, 1%)`, data
 *  ±2 dias, contraparte batendo quando ambos têm). Política:
 *   - 0 candidatos → título segue intocado.
 *   - 2+ candidatos → pendência `ambiguidade_realizado_titulo_para_cef`.
 *   - 1 candidato livre → match: título recebe `reconciliado_com`/
 *     `reconciliado_em`, CEF vai pra `eventosBancariosAbsorvidos`.
 *   - 1 candidato já matched (encadeamento P2) → pendência
 *     `duplicidade_cef_titulo`.
 *
 * Imutável em ambas: confirmado P1 é "promovido" via construção; título
 * P2 recebe um clone com auditoria. Nenhum input muta.
 */
export function reconciliaBancoCpCr(
  eventos: readonly EventoCaixa[],
  options: ReconciliaBancoCpCrOptions,
): ReconciliacaoResult {
  /* 1. Particionamento */
  const confirmadosElegiveis: EventoConfirmado[] = [];
  const realizadosBanco: EventoRealizado[] = [];
  const realizadosTitulo: EventoRealizado[] = [];
  const outros: EventoCaixa[] = [];

  for (const e of eventos) {
    // Validação defensiva: realizado tem que ter data_realizada válida.
    if (e.status === 'realizado') {
      const dr = e.data_realizada;
      if (!(dr instanceof Date) || Number.isNaN(dr.getTime())) {
        throw new ReconciliacaoError(
          `evento ${e.id}: realizado sem data_realizada válida`,
        );
      }
    }

    if (e.status === 'confirmado' && ORIGENS_LADO_A_ELEGIVEL.has(e.origem)) {
      confirmadosElegiveis.push(e);
    } else if (e.status === 'realizado' && e.origem === 'cef') {
      realizadosBanco.push(e);
    } else if (
      e.status === 'realizado' &&
      ORIGENS_LADO_A_ELEGIVEL.has(e.origem)
    ) {
      realizadosTitulo.push(e);
    } else {
      outros.push(e);
    }
  }

  /* 2. Ordem determinística dos realizados bancários */
  const sortedBanco = [...realizadosBanco].sort((a, b) => {
    const dateDiff = a.data_realizada.getTime() - b.data_realizada.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.id.localeCompare(b.id);
  });

  /* 3. Estado do matching (compartilhado entre P1 e P2) */
  const matchedConfirmadoIds = new Set<string>();
  const promovidos: EventoRealizado[] = [];
  const absorvidos: AbsorcaoBancaria[] = [];
  /** CEFs ainda disponíveis após P1 (entrada da P2). */
  const cefsSobrantesP1: EventoRealizado[] = [];
  /** CEFs absorvidos por P2 — Set p/ filtragem rápida na composição final. */
  const cefIdsAbsorvidosP2 = new Set<string>();
  /** Map cef.id → titulo.id que o consumiu (detecção de duplicidade P2). */
  const cefToTitulo = new Map<string, string>();
  const pendencias: PendenciaReconciliacao[] = [];
  let matchesP1 = 0;
  let matchesP2 = 0;

  /* 4. Passada 1 — confirmado ↔ CEF (±5 dias) */
  for (const banc of sortedBanco) {
    const candidates = findCandidatesP1(banc, confirmadosElegiveis);

    if (candidates.length === 0) {
      // Nenhum candidato P1 — segue pra P2 (pode bater com FKN-realizado)
      // ou termina como sobrante (tarifa, IOF, avulso).
      cefsSobrantesP1.push(banc);
      continue;
    }

    if (candidates.length >= 2) {
      pendencias.push(
        buildPendencia(
          'ambiguidade_realizado_para_confirmado',
          [banc.id, ...candidates.map((c) => c.id)],
          options.reconciliadoEm,
        ),
      );
      cefsSobrantesP1.push(banc);
      continue;
    }

    // Exatamente 1 candidato.
    const conf = candidates[0]!;
    if (matchedConfirmadoIds.has(conf.id)) {
      pendencias.push(
        buildPendencia(
          'duplicidade_confirmado',
          [banc.id, conf.id],
          options.reconciliadoEm,
        ),
      );
      cefsSobrantesP1.push(banc);
      continue;
    }

    // Match P1.
    const promovido = promoveConfirmadoEmRealizado(
      conf,
      banc,
      options.reconciliadoEm,
    );
    promovidos.push(promovido);
    matchedConfirmadoIds.add(conf.id);
    absorvidos.push({
      evento_bancario_id: banc.id,
      promovido_para_id: promovido.id,
      data_match: options.reconciliadoEm,
    });
    matchesP1 += 1;
  }

  /* 5. Passada 2 — realizado_titulo ↔ CEF restante (±2 dias) */
  const sortedTitulos = [...realizadosTitulo].sort((a, b) => {
    const dateDiff = a.data_realizada.getTime() - b.data_realizada.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.id.localeCompare(b.id);
  });

  /** Map titulo.id → titulo com auditoria adicionada (substitui o input). */
  const titulosReconciliados = new Map<string, EventoRealizado>();

  for (const tit of sortedTitulos) {
    const candidates = findCandidatesP2(tit, cefsSobrantesP1);

    if (candidates.length === 0) {
      // Nenhum CEF candidato — título passa intocado.
      continue;
    }

    if (candidates.length >= 2) {
      pendencias.push(
        buildPendencia(
          'ambiguidade_realizado_titulo_para_cef',
          [tit.id, ...candidates.map((c) => c.id)],
          options.reconciliadoEm,
        ),
      );
      continue;
    }

    // Exatamente 1 candidato.
    const cef = candidates[0]!;
    if (cefIdsAbsorvidosP2.has(cef.id)) {
      // CEF já foi consumido por outro título — duplicidade encadeada.
      pendencias.push(
        buildPendencia(
          'duplicidade_cef_titulo',
          [tit.id, cef.id],
          options.reconciliadoEm,
        ),
      );
      continue;
    }

    // Match P2.
    const tituloComAudit = addReconciliacaoAudit(
      tit,
      cef.id,
      options.reconciliadoEm,
    );
    titulosReconciliados.set(tit.id, tituloComAudit);
    cefIdsAbsorvidosP2.add(cef.id);
    cefToTitulo.set(cef.id, tit.id);
    absorvidos.push({
      evento_bancario_id: cef.id,
      promovido_para_id: tit.id,
      data_match: options.reconciliadoEm,
    });
    matchesP2 += 1;
  }

  /* 6. Compor output */
  // Confirmados não-matched mantêm-se como confirmado.
  const confirmadosFinal: EventoCaixa[] = confirmadosElegiveis.filter(
    (c) => !matchedConfirmadoIds.has(c.id),
  );

  // Títulos: substituídos pela versão reconciliada quando existir.
  const titulosFinal: EventoCaixa[] = realizadosTitulo.map(
    (t) => titulosReconciliados.get(t.id) ?? t,
  );

  // CEFs sobrantes: filtra os absorvidos por P2.
  const cefsFinal: EventoCaixa[] = cefsSobrantesP1.filter(
    (c) => !cefIdsAbsorvidosP2.has(c.id),
  );

  const eventosOut: EventoCaixa[] = [
    ...promovidos,
    ...confirmadosFinal,
    ...titulosFinal,
    ...cefsFinal,
    ...outros,
  ];

  const estatisticas: ReconciliacaoEstatisticas = {
    confirmadosOriginais: confirmadosElegiveis.length,
    realizadosBancariosOriginais: realizadosBanco.length,
    realizadosTituloOriginais: realizadosTitulo.length,
    matchesAplicados: matchesP1 + matchesP2,
    matchesAplicadosPassada1: matchesP1,
    matchesAplicadosPassada2: matchesP2,
    pendenciasGeradas: pendencias.length,
    eventosBancariosNaoAbsorvidos: cefsFinal.length,
  };

  return {
    eventos: eventosOut,
    pendencias,
    eventosBancariosAbsorvidos: absorvidos,
    reconciliadoEm: options.reconciliadoEm,
    estatisticas,
  };
}

/* ─────────── Helpers internos ─────────── */

/**
 * Busca confirmados candidatos pra um realizado bancário (Passada 1).
 * Inclui confirmados já matched — política de duplicidade depende disso
 * para detectar 2 realizados apontando pro mesmo confirmado.
 */
function findCandidatesP1(
  banc: EventoRealizado,
  confirmados: ReadonlyArray<EventoConfirmado>,
): EventoConfirmado[] {
  const out: EventoConfirmado[] = [];
  const bancMs = banc.data_realizada.getTime();
  const tol = (valorRef: number) =>
    Math.max(TOLERANCIA_MIN_R$, valorRef * TOLERANCIA_REL);

  for (const conf of confirmados) {
    if (conf.cliente_id !== banc.cliente_id) continue;
    if (conf.legal_entity_id !== banc.legal_entity_id) continue;
    if (conf.direcao !== banc.direcao) continue;

    // Janela temporal: ±5 dias entre data_realizada do banco e
    // data_esperada do confirmado.
    const diffMs = Math.abs(bancMs - conf.data_esperada.getTime());
    if (diffMs > JANELA_DIAS_P1 * DAY_MS) continue;

    // Tolerância de valor: max(R$ 5, 1% do confirmado).
    if (Math.abs(banc.valor - conf.valor) > tol(conf.valor)) continue;

    // Contraparte: só checada se ambos têm. Spec §3.A item 2.
    if (
      conf.contraparte_id !== undefined &&
      banc.contraparte_id !== undefined &&
      conf.contraparte_id !== banc.contraparte_id
    ) {
      continue;
    }

    out.push(conf);
  }

  return out;
}

/**
 * Busca CEFs candidatos pra um título FKN-realizado (Passada 2).
 *
 * Diferenças vs P1:
 *  - Janela ±2 dias (mais apertada — título já tem data efetiva).
 *  - Compara `data_realizada` ↔ `data_realizada` (não data_esperada).
 *  - Inclui CEFs já absorvidos por P2 (detecção de duplicidade encadeada).
 */
function findCandidatesP2(
  tit: EventoRealizado,
  cefs: ReadonlyArray<EventoRealizado>,
): EventoRealizado[] {
  const out: EventoRealizado[] = [];
  const titMs = tit.data_realizada.getTime();
  const tol = (valorRef: number) =>
    Math.max(TOLERANCIA_MIN_R$, valorRef * TOLERANCIA_REL);

  for (const cef of cefs) {
    if (cef.cliente_id !== tit.cliente_id) continue;
    if (cef.legal_entity_id !== tit.legal_entity_id) continue;
    if (cef.direcao !== tit.direcao) continue;

    // Janela temporal: ±2 dias entre data_realizada do título e do CEF.
    const diffMs = Math.abs(titMs - cef.data_realizada.getTime());
    if (diffMs > JANELA_DIAS_P2 * DAY_MS) continue;

    // Tolerância de valor: max(R$ 5, 1% do título).
    if (Math.abs(cef.valor - tit.valor) > tol(tit.valor)) continue;

    // Contraparte: só checada se ambos têm.
    if (
      tit.contraparte_id !== undefined &&
      cef.contraparte_id !== undefined &&
      tit.contraparte_id !== cef.contraparte_id
    ) {
      continue;
    }

    out.push(cef);
  }

  return out;
}

/**
 * Constrói o `EventoRealizado` promovido a partir do `EventoConfirmado`
 * + dados do realizado bancário. Não muta o input.
 *
 * Regras §3.B:
 *  - status ← 'realizado'
 *  - data_realizada ← banc.data_realizada
 *  - data_esperada ← banc.data_realizada (regra schema realizado)
 *  - valor mantido do confirmado (valor de título é a verdade contratual)
 *  - origem mantida (proveniência primária imutável)
 *  - confianca = 'alta' (continua alta — agora com lastro bancário)
 *  - reconciliado_com / reconciliado_em preenchidos
 */
function promoveConfirmadoEmRealizado(
  conf: EventoConfirmado,
  banc: EventoRealizado,
  reconciliadoEm: Date,
): EventoRealizado {
  const ev: EventoRealizado = {
    id: conf.id,
    valor: conf.valor,
    direcao: conf.direcao,
    data_esperada: banc.data_realizada,
    bucket_id: conf.bucket_id,
    bucket_nome: conf.bucket_nome,
    cliente_id: conf.cliente_id,
    legal_entity_id: conf.legal_entity_id,
    origem: conf.origem,
    criticidade: conf.criticidade,
    confianca: 'alta',
    confianca_origem: 'sistema',
    is_transferencia: conf.is_transferencia,
    criado_em: conf.criado_em,
    criado_por: conf.criado_por,
    status: 'realizado',
    data_realizada: banc.data_realizada,
    data_vencimento: conf.data_vencimento,
    reconciliado_com: banc.id,
    reconciliado_em: reconciliadoEm,
  };

  // Optionals do confirmado preservados (`exactOptionalPropertyTypes` →
  // só atribui quando definido).
  if (conf.contraparte_id !== undefined) ev.contraparte_id = conf.contraparte_id;
  if (conf.contraparte_tipo !== undefined)
    ev.contraparte_tipo = conf.contraparte_tipo;
  if (conf.source_company_code !== undefined)
    ev.source_company_code = conf.source_company_code;
  if (conf.origem_ref !== undefined) ev.origem_ref = conf.origem_ref;
  if (conf.documento_ref !== undefined) ev.documento_ref = conf.documento_ref;
  if (conf.confirmado_por !== undefined)
    ev.confirmado_por = conf.confirmado_por;
  if (conf.confirmado_em !== undefined) ev.confirmado_em = conf.confirmado_em;
  if (conf.competencia !== undefined) ev.competencia = conf.competencia;
  if (conf.cenario_id !== undefined) ev.cenario_id = conf.cenario_id;
  if (conf.observacao !== undefined) ev.observacao = conf.observacao;
  if (conf.descricao_origem !== undefined)
    ev.descricao_origem = conf.descricao_origem;
  if (conf.contraparte_nome_origem !== undefined)
    ev.contraparte_nome_origem = conf.contraparte_nome_origem;
  if (conf.conta_origem_nome !== undefined)
    ev.conta_origem_nome = conf.conta_origem_nome;

  return ev;
}

/**
 * Clona um `EventoRealizado` (título FKN/manual/erp/etc) adicionando os
 * campos de auditoria de reconciliação. Usado na Passada 2 — título já
 * tem `status='realizado'`, só ganha o vínculo com o CEF absorvido.
 *
 * Imutável: NÃO muta o input — `exactOptionalPropertyTypes` exige que
 * preserve o set de optionals presentes no original.
 */
function addReconciliacaoAudit(
  tit: EventoRealizado,
  cefId: string,
  reconciliadoEm: Date,
): EventoRealizado {
  const ev: EventoRealizado = {
    id: tit.id,
    valor: tit.valor,
    direcao: tit.direcao,
    data_esperada: tit.data_esperada,
    bucket_id: tit.bucket_id,
    bucket_nome: tit.bucket_nome,
    cliente_id: tit.cliente_id,
    legal_entity_id: tit.legal_entity_id,
    origem: tit.origem,
    criticidade: tit.criticidade,
    confianca: tit.confianca,
    confianca_origem: tit.confianca_origem,
    is_transferencia: tit.is_transferencia,
    criado_em: tit.criado_em,
    criado_por: tit.criado_por,
    status: 'realizado',
    data_realizada: tit.data_realizada,
    reconciliado_com: cefId,
    reconciliado_em: reconciliadoEm,
  };

  if (tit.data_vencimento !== undefined) ev.data_vencimento = tit.data_vencimento;
  if (tit.contraparte_id !== undefined) ev.contraparte_id = tit.contraparte_id;
  if (tit.contraparte_tipo !== undefined)
    ev.contraparte_tipo = tit.contraparte_tipo;
  if (tit.source_company_code !== undefined)
    ev.source_company_code = tit.source_company_code;
  if (tit.origem_ref !== undefined) ev.origem_ref = tit.origem_ref;
  if (tit.documento_ref !== undefined) ev.documento_ref = tit.documento_ref;
  if (tit.confirmado_por !== undefined) ev.confirmado_por = tit.confirmado_por;
  if (tit.confirmado_em !== undefined) ev.confirmado_em = tit.confirmado_em;
  if (tit.competencia !== undefined) ev.competencia = tit.competencia;
  if (tit.cenario_id !== undefined) ev.cenario_id = tit.cenario_id;
  if (tit.observacao !== undefined) ev.observacao = tit.observacao;
  if (tit.descricao_origem !== undefined)
    ev.descricao_origem = tit.descricao_origem;
  if (tit.contraparte_nome_origem !== undefined)
    ev.contraparte_nome_origem = tit.contraparte_nome_origem;
  if (tit.conta_origem_nome !== undefined)
    ev.conta_origem_nome = tit.conta_origem_nome;

  return ev;
}

/**
 * Constrói uma pendência com `id` determinístico baseado em
 * `(tipo, ids_relacionados_ordenados)`.
 */
function buildPendencia(
  tipo: TipoPendenciaReconciliacao,
  eventos_relacionados: readonly string[],
  detectado_em: Date,
): PendenciaReconciliacao {
  const sortedIds = [...eventos_relacionados].sort();
  const id = `pend_${tipo}_${sortedIds.join('_')}`;
  const descricao = descricaoFor(tipo, sortedIds);
  return {
    id,
    tipo,
    descricao,
    eventos_relacionados: sortedIds,
    detectado_em,
  };
}

/** Descrições determinísticas (sem storytelling). */
function descricaoFor(
  tipo: TipoPendenciaReconciliacao,
  ids: readonly string[],
): string {
  switch (tipo) {
    case 'ambiguidade_realizado_para_confirmado':
      return `Realizado bancário com ${ids.length - 1} confirmados elegíveis`;
    case 'duplicidade_confirmado':
      return `Confirmado já reconciliado recebeu 2º realizado bancário`;
    case 'ambiguidade_realizado_titulo_para_cef':
      return `Título realizado com ${ids.length - 1} CEFs elegíveis`;
    case 'duplicidade_cef_titulo':
      return `CEF já reconciliado recebeu 2º título realizado`;
    case 'transferencia_ambigua':
      // `reconciliaBancoCpCr` nunca constrói esse tipo (sai de
      // `detectaTransferenciaInterna`). Caso defensivo de exaustividade.
      return `Transferência ambígua: 1 perna com ${ids.length - 1} candidatos opostos`;
  }
}
