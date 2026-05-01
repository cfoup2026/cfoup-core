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

  const saldos: OpeningBalanceSnapshot[] = [];
  for (const b of input.balances) {
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

  // Sufixo de data no id usa YYYY-MM-DD (UTC) — datas do parser já vêm
  // em UTC à meia-noite, então slice(0,10) é estável.
  const dateKey = snapshot.date.toISOString().slice(0, 10);
  const id = `obs_cef_${ctx.cliente_id}_${ctx.legal_entity_id}_${snapshot.accountId}_${dateKey}`;

  return {
    id,
    cliente_id: ctx.cliente_id,
    legal_entity_id: ctx.legal_entity_id,
    conta_bancaria_id: snapshot.accountId,
    valor: snapshot.amount,
    data_referencia: snapshot.date,
    origem: 'cef',
    criado_em: new Date(),
    criado_por: 'sistema',
  };
}
