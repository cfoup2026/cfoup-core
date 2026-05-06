import type {
  BalanceSnapshot,
  EventoCaixa,
  OpeningBalanceSnapshot,
  Transaction,
} from '../../types/index.js';
import type { AdapterContext } from '../AdapterContext.js';
import { IngestaoError } from '../IngestaoError.js';
import { buildEventoCaixaBase } from '../buildEventoCaixaBase.js';

/**
 * Input do adapter CEF — espelha o shape do `ParseResult<Transaction>`
 * dos parsers `parseCEFTxt` / `parseCEFPdf` no que importa para a ingestão.
 */
export interface CefAdapterInput {
  /** Transações reconhecidas pelo parser. */
  ok: readonly Transaction[];
  /** Snapshots de saldo extraídos pelo parser (validados pelo parser PDF). */
  balances: readonly BalanceSnapshot[];
}

/** Saída do adapter CEF — eventos de caixa + snapshots de saldo de abertura. */
export interface CefAdapterOutput {
  eventos: EventoCaixa[];
  saldos: OpeningBalanceSnapshot[];
}

/**
 * Adapter CEF — converte o resultado de parsers `parseCEFTxt`/`parseCEFPdf`
 * em eventos CF13 + snapshots de saldo.
 *
 * Eventos:
 *  - Toda transação CEF é status `realizado` (extrato bancário só registra
 *    fato consumado).
 *  - `direcao` derivada do sinal do extrato: `'credit' → 'entrada'`,
 *    `'debit' → 'saida'`.
 *  - `data_realizada = transaction.date`.
 *  - `data_esperada = data_realizada` (sem passar por calendário operacional —
 *    PIX/TED podem ocorrer fora de dia útil; fato consumado é fato consumado).
 *  - `data_vencimento`: ausente — extrato bancário não traz vencimento.
 *  - `contraparte_id`: ausente em V1 — extrato CEF não estrutura contraparte.
 *  - `documento_ref`: `transaction.docNumber` quando não vazio.
 *
 * Nota sobre `ctx.calendar`: o adapter CEF NÃO chama `deriveDataEsperada`.
 * Todo evento CEF é `realizado` por construção (extrato bancário); a regra
 * §7.1 só age em `confirmado`/`estimado`. O calendar permanece no
 * `AdapterContext` por consistência da interface (todos os adapters do
 * estágio 1 compartilham o mesmo shape de contexto), mas é ignorado aqui.
 *
 * Saldos:
 *  - Cada `BalanceSnapshot` validado pelo parser vira um `OpeningBalanceSnapshot`.
 *    Snapshots inconsistentes já foram descartados pelo parser PDF (validação
 *    interna); o adapter só transforma o que recebe.
 *  - `conta_bancaria_id = snapshot.accountId`.
 *  - `valor = snapshot.amount` (assinado; pode ser negativo em cheque especial).
 *  - `data_referencia = snapshot.date`.
 *  - `origem = 'cef'`.
 *
 * Determinismo:
 *  - `evento.id = `cef_${transaction.id}_${cliente_id}_${legal_entity_id}``.
 *  - `saldo.id = `obs_cef_${cliente_id}_${legal_entity_id}_${accountId}_${YYYY-MM-DD}``.
 */
export function cefAdapter(
  input: CefAdapterInput,
  ctx: AdapterContext,
): CefAdapterOutput {
  const eventos: EventoCaixa[] = [];
  for (const tx of input.ok) {
    eventos.push(transactionToEvento(tx, ctx));
  }

  const aggregated = aggregateBalances(input.balances, ctx);
  const saldos: OpeningBalanceSnapshot[] = [];
  for (const b of aggregated) {
    saldos.push(snapshotToOpening(b, ctx));
  }

  return { eventos, saldos };
}

function transactionToEvento(
  tx: Transaction,
  ctx: AdapterContext,
): EventoCaixa {
  if (!(tx.date instanceof Date) || Number.isNaN(tx.date.getTime())) {
    throw new IngestaoError(`Transaction ${tx.id}: date ausente ou inválida`);
  }

  const docRef = tx.docNumber.trim();
  const historico = tx.history.trim();
  const direcao = tx.direction === 'credit' ? 'entrada' : 'saida';

  const baseInput: Parameters<typeof buildEventoCaixaBase>[0] = {
    origem: 'cef',
    origem_ref: tx.id,
    valor: tx.amount,
    direcao,
    // Realizado: data_esperada = data_realizada, sem calendário.
    data_esperada: tx.date,
  };
  if (docRef !== '') baseInput.documento_ref = docRef;
  // Estágio 1.6: histórico bruto do extrato CEF é a descrição mais
  // rica para o motor de classificação ("PIX RECEBIDO", "TED ENVIADA",
  // "ENERGIA ELETRICA", etc).
  if (historico !== '') baseInput.descricao_origem = historico;

  const base = buildEventoCaixaBase(baseInput, ctx);
  const ev: EventoCaixa = {
    ...base,
    status: 'realizado',
    data_realizada: tx.date,
  };
  return ev;
}

function snapshotToOpening(
  snapshot: BalanceSnapshot,
  ctx: AdapterContext,
): OpeningBalanceSnapshot {
  if (
    !(snapshot.date instanceof Date) ||
    Number.isNaN(snapshot.date.getTime())
  ) {
    throw new IngestaoError(
      `BalanceSnapshot accountId=${snapshot.accountId}: date ausente ou inválida`,
    );
  }
  if (typeof snapshot.amount !== 'number' || !Number.isFinite(snapshot.amount)) {
    throw new IngestaoError(
      `BalanceSnapshot accountId=${snapshot.accountId}: valor inválido`,
    );
  }

  const contaBancariaId = resolveContaBancariaId(snapshot.accountId, ctx);

  // Sufixo de data no id usa YYYY-MM-DD (UTC) — datas do parser já vêm
  // em UTC à meia-noite, então slice(0,10) é estável.
  const dateKey = snapshot.date.toISOString().slice(0, 10);
  const id = `obs_cef_${ctx.cliente_id}_${ctx.legal_entity_id}_${contaBancariaId}_${dateKey}`;

  return {
    id,
    cliente_id: ctx.cliente_id,
    legal_entity_id: ctx.legal_entity_id,
    conta_bancaria_id: contaBancariaId,
    valor: snapshot.amount,
    data_referencia: snapshot.date,
    origem: 'cef',
    criado_em: new Date(),
    criado_por: 'sistema',
  };
}

/**
 * Resolve `conta_bancaria_id` final: parser tem prioridade; ctx é
 * fallback obrigatório quando `accountId === ''`. String vazia nunca
 * propaga. Compartilhado entre `aggregateBalances` (pra construir chave
 * de grupo) e `snapshotToOpening` (pra preencher campo final).
 */
function resolveContaBancariaId(
  accountId: string,
  ctx: AdapterContext,
): string {
  if (accountId !== '') return accountId;
  if (
    ctx.conta_bancaria_id !== undefined &&
    ctx.conta_bancaria_id !== ''
  ) {
    return ctx.conta_bancaria_id;
  }
  throw new IngestaoError(
    `BalanceSnapshot accountId="": conta_bancaria_id obrigatório no contexto quando parser não extrai`,
  );
}

/**
 * Agrega múltiplos `BalanceSnapshot` por chave `(date_iso, conta-resolvida)`.
 *
 * Motivação: o parser CEF PDF emite um snapshot por linha "Saldo X,XX C/D"
 * intercalada — N transações no mesmo dia → N snapshots com mesma data.
 * O caixa inicial precisa do saldo end-of-day, não de um running balance
 * arbitrário no meio do dia.
 *
 * Heurística: dentro de cada grupo (data, conta), o **último em ordem de
 * chegada** vence. Justificativa: o parser emite na ordem em que linhas
 * "Saldo" aparecem no extrato, e a última naquele dia é o saldo
 * end-of-day. `Map.set` sobrescreve a chave; V8 garante ordem de inserção
 * em `Map.values()`, então o resultado é determinístico.
 *
 * Validação de `date` acontece aqui (early throw) — `snapshotToOpening`
 * mantém a checagem como defense em depth, mas o erro estruturado vem
 * dessa camada quando há lote.
 */
function aggregateBalances(
  balances: readonly BalanceSnapshot[],
  ctx: AdapterContext,
): BalanceSnapshot[] {
  const byKey = new Map<string, BalanceSnapshot>();
  for (const b of balances) {
    if (!(b.date instanceof Date) || Number.isNaN(b.date.getTime())) {
      throw new IngestaoError(
        `BalanceSnapshot accountId=${b.accountId}: date ausente ou inválida`,
      );
    }
    const conta = resolveContaBancariaId(b.accountId, ctx);
    const dateKey = b.date.toISOString().slice(0, 10);
    const key = `${dateKey}|${conta}`;
    byKey.set(key, b);
  }
  return [...byKey.values()];
}
