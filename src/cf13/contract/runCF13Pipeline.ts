/**
 * Função pública do CF13 UI Contract.
 *
 * Chama o orquestrador interno `runPipeline` (Stages 1→7, snake_case) e
 * adapta a saída para `CF13Output` (camelCase, JSON-safe).
 *
 * **Não duplica lógica.** Apenas adapter técnico:
 *  - rename de campos (snake → camel),
 *  - serialização de `Date` para ISO,
 *  - colapso de pendências de 3 fontes em uma lista,
 *  - validação de integridade referencial (`semanaId` ∈ janela).
 *
 * Determinismo:
 *  - Pipeline interno é determinístico dado `geradoEm` injetado.
 *  - `geradoEm` interno do pipeline é derivado de `base_date` (parse UTC
 *    midnight), garantindo que rodar com mesmo `base_date` produza
 *    a mesma janela e os mesmos cálculos.
 *  - `meta.geradoEm` é o **timestamp real** do cálculo (não da janela),
 *    via factory `now` injetável. Default = `() => new Date()` em
 *    runtime — não-determinístico mas correto para auditoria. Em testes,
 *    injete `now: () => new Date('YYYY-MM-DDTHH:MM:SSZ')` para travar.
 *  - `meta.geradoEm` é campo de auditoria; nunca afeta cálculo de
 *    `projecao`/`cobertura`/`confianca`/`veredito`/`pendencias`.
 *
 * Defaults para campos não-presentes na input enxuta:
 *  - `legal_entity_ids_ativas` = derivado dos eventos (set lex sort).
 *  - `geradoEm` interno = `new Date(base_date + 'T00:00:00.000Z')`.
 *  - `now` = `() => new Date()`.
 *  - `calendar` = `BrazilCalendarPolicy`.
 *  - `classifier` = omitido (Bridge passa eventos como-estão).
 */
import { runPipeline } from '../../pipeline/runPipeline.js';
import type { EventoCaixa } from '../../types/EventoCaixa.js';
import type { OpeningBalanceSnapshot } from '../../types/OpeningBalanceSnapshot.js';
import type { VendaComercial } from '../../types/comercial.js';
import { adaptarCobertura } from './adapters/adaptarCobertura.js';
import { adaptarConfianca } from './adapters/adaptarConfianca.js';
import { adaptarPendencias } from './adapters/adaptarPendencias.js';
import {
  adaptarProjecao,
  formatarISODate,
} from './adapters/adaptarProjecao.js';
import { adaptarVeredito } from './adapters/adaptarVeredito.js';
import {
  CF13_ENGINE_VERSION,
  type CF13Output,
  type PendenciaCF13,
} from './types.js';

/** Input do `runCF13Pipeline`. snake_case mantido para coincidir com
 *  o input nativo do orquestrador interno; isso evita conversão dupla
 *  na borda. */
export interface CF13PipelineInput {
  cliente_id: string;
  /** ISO `YYYY-MM-DD` — data de corte da janela 13 semanas. */
  base_date: string;
  eventos: readonly EventoCaixa[];
  opening_balances: readonly OpeningBalanceSnapshot[];
  /** Vendas comerciais (FKN Vendas via adapter). Opcional. */
  vendas?: readonly VendaComercial[];
  /** Override opcional. Default = derivado de `eventos[].legal_entity_id`. */
  legal_entity_ids_ativas?: readonly string[];
  /** Factory de timestamp para `meta.geradoEm`. Default em runtime =
   *  `() => new Date()` (não-determinístico, mas correto para auditoria).
   *  Em testes, injete `now: () => new Date('2026-05-01T12:00:00Z')`
   *  para travar o valor.
   *
   *  Não afeta cálculo do pipeline — só `meta.geradoEm`. A janela e
   *  todos os estágios derivam de `base_date`, que é determinístico. */
  now?: () => Date;
}

/**
 * Erro lançado quando integridade referencial falha (uma `PendenciaCF13`
 * carrega `semanaId` que não existe em `output.projecao.consolidado.semanas[]`).
 * Não filtramos a pendência — bug do emissor deve ficar visível.
 */
export class CF13ContractIntegrityError extends Error {
  override readonly name = 'CF13ContractIntegrityError' as const;
  readonly pendenciaId: string;
  readonly semanaIdInvalido: string;

  constructor(pendenciaId: string, semanaIdInvalido: string) {
    super(
      `CF13ContractIntegrityError: pendência '${pendenciaId}' carrega semanaId='${semanaIdInvalido}' que não está em projecao.consolidado.semanas[].inicio`,
    );
    this.pendenciaId = pendenciaId;
    this.semanaIdInvalido = semanaIdInvalido;
    Object.setPrototypeOf(this, CF13ContractIntegrityError.prototype);
  }
}

export function runCF13Pipeline(input: CF13PipelineInput): CF13Output {
  /* ─── (1) Defaults derivados. ─── */
  const geradoEmInterno = parseBaseDate(input.base_date);
  const legalEntityIds =
    input.legal_entity_ids_ativas !== undefined
      ? [...input.legal_entity_ids_ativas]
      : derivarLegalEntityIds(input.eventos);

  /* ─── (2) Roda o orquestrador interno. ─── */
  const interno = runPipeline({
    eventos: input.eventos,
    saldos: input.opening_balances,
    ...(input.vendas !== undefined ? { vendas: input.vendas } : {}),
    cliente_id: input.cliente_id,
    legal_entity_ids_ativas: legalEntityIds,
    geradoEm: geradoEmInterno,
  });

  /* ─── (3) Index de eventos pós-reconciliação para split direcional
   *        em `SemanaProjecao` e lookup em `PendenciaCritica`. ─── */
  const eventoIndex = new Map<string, EventoCaixa>();
  for (const ev of interno.reconciliacao.eventos) {
    eventoIndex.set(ev.id, ev);
  }

  /* ─── (4) Adapters individuais. ─── */
  const projecao = adaptarProjecao({
    projecao: interno.projecao,
    baseDate: input.base_date,
    eventoIndex,
  });

  const janelaSemanaIso = interno.projecao.consolidado.semanas.map(
    (s) => s.semana_iso,
  );
  const janelaInicios = projecao.consolidado.semanas.map((s) => s.inicio);

  const cobertura = adaptarCobertura({
    cobertura: interno.cobertura,
    janelaSemanaIso,
  });

  const confianca = adaptarConfianca(interno.confianca);
  const veredito = adaptarVeredito(interno.veredito);

  const pendencias = adaptarPendencias({
    cobertura: interno.cobertura,
    confianca: interno.confianca,
    veredito: interno.veredito,
    janelaSemanaIso,
    janelaInicios,
    eventoIndex,
  });

  /* ─── (5) Validação de integridade referencial. ─── */
  validarIntegridadeReferencial(pendencias, janelaInicios);

  /* ─── (6) Meta. `geradoEm` é timestamp REAL do cálculo (campo de
   *        auditoria), via factory `now`. NÃO é derivado de `base_date`
   *        — `base_date` é a data de corte da janela, semântica diferente.
   *        Default `() => new Date()` em runtime; testes injetam factory
   *        determinística. ─── */
  const nowFactory = input.now ?? (() => new Date());
  const meta = {
    clienteId: input.cliente_id,
    baseDate: input.base_date,
    janelaInicio: projecao.janela.inicio,
    janelaFim: projecao.janela.fim,
    geradoEm: nowFactory().toISOString(),
    versaoEngine: CF13_ENGINE_VERSION,
  };

  return {
    meta,
    projecao,
    cobertura,
    confianca,
    veredito,
    pendencias,
  };
}

/* ─────────── Helpers internos ─────────── */

/** Parse estrito `YYYY-MM-DD` → `Date` UTC midnight. Lança `Error` em
 *  formato inválido — adapter é responsável por validar input cedo. */
function parseBaseDate(baseDate: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDate);
  if (m === null) {
    throw new Error(
      `runCF13Pipeline: 'base_date' inválido (esperado YYYY-MM-DD, recebido ${JSON.stringify(baseDate)})`,
    );
  }
  const ano = Number.parseInt(m[1]!, 10);
  const mes = Number.parseInt(m[2]!, 10);
  const dia = Number.parseInt(m[3]!, 10);
  const d = new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0, 0));
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `runCF13Pipeline: 'base_date' não parseou para Date válido (${JSON.stringify(baseDate)})`,
    );
  }
  return d;
}

/** Deriva `legal_entity_ids_ativas` a partir dos eventos (set + sort lex).
 *  Retorna `[]` quando não há eventos — orquestrador interno trata. */
function derivarLegalEntityIds(
  eventos: readonly EventoCaixa[],
): string[] {
  const set = new Set<string>();
  for (const ev of eventos) set.add(ev.legal_entity_id);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function validarIntegridadeReferencial(
  pendencias: readonly PendenciaCF13[],
  janelaInicios: readonly string[],
): void {
  const janela = new Set(janelaInicios);
  for (const p of pendencias) {
    if (p.semanaId !== undefined && !janela.has(p.semanaId)) {
      throw new CF13ContractIntegrityError(p.id, p.semanaId);
    }
  }
}

/** Re-export para tests/consumidores. */
export { formatarISODate };
