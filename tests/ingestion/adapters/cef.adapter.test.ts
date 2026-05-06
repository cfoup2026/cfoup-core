import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrazilCalendarPolicy } from '../../../src/calendar/index.js';
import type {
  BalanceSnapshot,
  Transaction,
} from '../../../src/types/index.js';
import {
  IngestaoError,
  cefAdapter,
  type AdapterContext,
} from '../../../src/ingestion/index.js';
import {
  CEF_BALANCES_FIXTURE,
  CEF_RESULT_FIXTURE,
  CEF_TRANSACTIONS_FIXTURE,
} from '../fixtures/cef-result.js';

const calendar = new BrazilCalendarPolicy();

const ctx: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  calendar,
};

describe('cefAdapter — eventos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna { eventos, saldos } com tamanhos da fixture', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    expect(out.eventos).toHaveLength(CEF_TRANSACTIONS_FIXTURE.length);
    expect(out.saldos).toHaveLength(CEF_BALANCES_FIXTURE.length);
  });

  it('toda transação CEF vira realizado com data_esperada=data_realizada (sem calendário)', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    for (const e of out.eventos) {
      expect(e.status).toBe('realizado');
      if (e.status === 'realizado') {
        expect(e.data_esperada.toISOString()).toBe(
          e.data_realizada.toISOString(),
        );
      }
    }
  });

  it('Transaction em FIM DE SEMANA mantém data_esperada=data_realizada (calendar NÃO chamado)', () => {
    // Sábado 2026-05-02 é dia não-útil. Para CEF, calendar é ignorado:
    // data_esperada permanece em sábado.
    const sabadoTx: Transaction = {
      id: 'cef-pdf:sat',
      accountId: '0423012920005778782426',
      date: new Date(Date.UTC(2026, 4, 2)),
      docNumber: '',
      history: 'PIX RECEBIDO FORA DE DIA UTIL',
      amount: 1000,
      direction: 'credit',
    };
    const out = cefAdapter({ ok: [sabadoTx], balances: [] }, ctx);
    const e = out.eventos[0]!;
    expect(e.status).toBe('realizado');
    if (e.status === 'realizado') {
      expect(e.data_realizada.getUTCDay()).toBe(6); // sábado
      expect(e.data_esperada.toISOString()).toBe(
        e.data_realizada.toISOString(),
      );
    }
  });

  it('credit → entrada; debit → saida', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    const credito = out.eventos.find((e) => e.origem_ref === 'cef-pdf:10')!;
    const debito = out.eventos.find((e) => e.origem_ref === 'cef-pdf:11')!;
    expect(credito.direcao).toBe('entrada');
    expect(debito.direcao).toBe('saida');
  });

  it('valor sempre positivo (sinal vive em direcao)', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    for (const e of out.eventos) {
      expect(e.valor).toBeGreaterThan(0);
    }
  });

  it('campos comuns aplicados', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    for (const e of out.eventos) {
      expect(e.origem).toBe('cef');
      expect(e.bucket_id).toBe('pendente_classificacao');
      expect(e.bucket_nome).toBe('Pendente de classificação');
      expect(e.criticidade).toBe('pendente');
      expect(e.confianca).toBe('alta');
      expect(e.confianca_origem).toBe('sistema');
      expect(e.is_transferencia).toBe(false);
      expect(e.cliente_id).toBe('c1');
      expect(e.legal_entity_id).toBe('le1');
    }
  });

  it('contraparte_id ausente em todos (extrato CEF não estrutura contraparte)', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    for (const e of out.eventos) {
      expect(e.contraparte_id).toBeUndefined();
      expect(e.contraparte_tipo).toBeUndefined();
    }
  });

  it('documento_ref vem de tx.docNumber quando não vazio', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    const comDoc = out.eventos.find((e) => e.origem_ref === 'cef-pdf:10')!;
    expect(comDoc.documento_ref).toBe('310325');
    const semDoc = out.eventos.find((e) => e.origem_ref === 'cef-pdf:12')!;
    expect(semDoc.documento_ref).toBeUndefined();
  });

  it('id determinístico cef_${tx.id}_${cliente_id}_${legal_entity_id}', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    const ev = out.eventos.find((e) => e.origem_ref === 'cef-pdf:10')!;
    expect(ev.id).toBe('cef_cef-pdf:10_c1_le1');
  });

  it('determinismo: mesmo input → mesmo output (com clock fixo)', () => {
    const a = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    const b = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    expect(a).toEqual(b);
  });
});

describe('cefAdapter — saldos (OpeningBalanceSnapshot)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cada BalanceSnapshot vira OpeningBalanceSnapshot preenchido', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    expect(out.saldos).toHaveLength(2);

    const opening = out.saldos[0]!;
    expect(opening.cliente_id).toBe('c1');
    expect(opening.legal_entity_id).toBe('le1');
    expect(opening.conta_bancaria_id).toBe('0423012920005778782426');
    expect(opening.valor).toBe(12000);
    expect(opening.data_referencia.toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
    expect(opening.origem).toBe('cef');
    expect(opening.criado_por).toBe('sistema');
    expect(opening.criado_em).toBeInstanceOf(Date);
  });

  it('saldo negativo (cheque especial) é preservado com sinal', () => {
    const overdraft: BalanceSnapshot = {
      accountId: '0423012920005778782426',
      date: new Date('2026-03-31T00:00:00.000Z'),
      amount: -2500,
      source: 'bank-statement',
    };
    const out = cefAdapter({ ok: [], balances: [overdraft] }, ctx);
    expect(out.saldos[0]!.valor).toBe(-2500);
  });

  it('id de saldo determinístico no formato obs_cef_<cliente>_<le>_<accountId>_<YYYY-MM-DD>', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    expect(out.saldos[0]!.id).toBe(
      'obs_cef_c1_le1_0423012920005778782426_2026-03-31',
    );
    expect(out.saldos[1]!.id).toBe(
      'obs_cef_c1_le1_0423012920005778782426_2026-04-05',
    );
  });

  it('balances vazios → saldos array vazio (sem fail)', () => {
    const out = cefAdapter(
      { ok: CEF_TRANSACTIONS_FIXTURE, balances: [] },
      ctx,
    );
    expect(out.saldos).toEqual([]);
    expect(out.eventos).toHaveLength(CEF_TRANSACTIONS_FIXTURE.length);
  });
});

describe('cefAdapter — validação visível', () => {
  it('valor zero em transação lança IngestaoError', () => {
    const bad: Transaction = {
      id: 'cef-pdf:bad',
      accountId: '0423012920005778782426',
      date: new Date('2026-04-15T00:00:00.000Z'),
      docNumber: '',
      history: 'foo',
      amount: 0,
      direction: 'credit',
    };
    expect(() => cefAdapter({ ok: [bad], balances: [] }, ctx)).toThrow(
      IngestaoError,
    );
    expect(() => cefAdapter({ ok: [bad], balances: [] }, ctx)).toThrow(
      /valor deve ser positivo/,
    );
  });

  it('date inválida em transação lança IngestaoError', () => {
    const bad: Transaction = {
      id: 'cef-pdf:bad',
      accountId: '0423012920005778782426',
      date: new Date(Number.NaN),
      docNumber: '',
      history: 'foo',
      amount: 100,
      direction: 'credit',
    };
    expect(() => cefAdapter({ ok: [bad], balances: [] }, ctx)).toThrow(
      IngestaoError,
    );
  });

  it('snapshot com date inválida lança IngestaoError', () => {
    const bad: BalanceSnapshot = {
      accountId: '0423012920005778782426',
      date: new Date(Number.NaN),
      amount: 1000,
      source: 'bank-statement',
    };
    expect(() => cefAdapter({ ok: [], balances: [bad] }, ctx)).toThrow(
      IngestaoError,
    );
  });

  /* ─── Estágio 1.6 — texto observado da origem ─── */

  it('preenche descricao_origem com Transaction.history', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    // Fixture tem 'TED RECEBIDA CLIENTE ALPHA', etc.
    const ev = out.eventos.find(
      (e) => e.descricao_origem === 'TED RECEBIDA CLIENTE ALPHA',
    );
    expect(ev).toBeDefined();
    const tarifa = out.eventos.find(
      (e) => e.descricao_origem === 'TARIFA BANCARIA MENSAL',
    );
    expect(tarifa).toBeDefined();
  });

  it('history em branco → descricao_origem undefined', () => {
    const semHistory: Transaction = {
      ...CEF_TRANSACTIONS_FIXTURE[0]!,
      id: 'cef:nohist',
      history: '   ',
    };
    const out = cefAdapter({ ok: [semHistory], balances: [] }, ctx);
    expect(out.eventos[0]!.descricao_origem).toBeUndefined();
  });

  it('CEF não preenche contraparte_nome_origem nem conta_origem_nome', () => {
    const out = cefAdapter(CEF_RESULT_FIXTURE, ctx);
    for (const ev of out.eventos) {
      expect(ev.contraparte_nome_origem).toBeUndefined();
      expect(ev.conta_origem_nome).toBeUndefined();
    }
  });
});

/**
 * Fix 2 — `conta_bancaria_id` no OpeningBalanceSnapshot nunca pode ser "".
 *
 * Regra: parser CEF tenta extrair `accountId` do header do PDF; quando
 * entrega "", `ctx.conta_bancaria_id` é fallback obrigatório. "" nunca
 * propaga pro adapter de saída.
 *
 * Prioridade: parser > ctx. ctx serve apenas como fallback.
 */
describe('cefAdapter — saldos: conta_bancaria_id (Fix 2)', () => {
  const PARSER_ID = '0423012920005778782426';
  const CTX_ID = 'cef:5778-2';
  const baseSnapshot = (accountId: string): BalanceSnapshot => ({
    accountId,
    date: new Date(Date.UTC(2026, 2, 31)),
    amount: 12000,
    source: 'bank-statement',
  });

  it('A — parser preenche, ctx vazio: parser ganha', () => {
    const out = cefAdapter(
      { ok: [], balances: [baseSnapshot(PARSER_ID)] },
      ctx, // ctx sem conta_bancaria_id (definido no topo do arquivo)
    );
    expect(out.saldos[0]!.conta_bancaria_id).toBe(PARSER_ID);
  });

  it('B — parser preenche, ctx tem valor diferente: parser tem prioridade', () => {
    const ctxComConta: AdapterContext = {
      cliente_id: 'c1',
      legal_entity_id: 'le1',
      conta_bancaria_id: CTX_ID,
      calendar,
    };
    const out = cefAdapter(
      { ok: [], balances: [baseSnapshot(PARSER_ID)] },
      ctxComConta,
    );
    expect(out.saldos[0]!.conta_bancaria_id).toBe(PARSER_ID);
  });

  it('C — parser vazio, ctx fornece: fallback aplica + id derivado do valor final', () => {
    const ctxComConta: AdapterContext = {
      cliente_id: 'c1',
      legal_entity_id: 'le1',
      conta_bancaria_id: CTX_ID,
      calendar,
    };
    const out = cefAdapter(
      { ok: [], balances: [baseSnapshot('')] },
      ctxComConta,
    );
    expect(out.saldos[0]!.conta_bancaria_id).toBe(CTX_ID);
    expect(out.saldos[0]!.id).toContain(CTX_ID);
    expect(out.saldos[0]!.id).not.toMatch(/__/); // não tem `__` (que seria `_${""}_`)
  });

  it('D — parser vazio, ctx ausente: throws IngestaoError com mensagem específica', () => {
    expect(() =>
      cefAdapter({ ok: [], balances: [baseSnapshot('')] }, ctx),
    ).toThrow(IngestaoError);
    expect(() =>
      cefAdapter({ ok: [], balances: [baseSnapshot('')] }, ctx),
    ).toThrow(/conta_bancaria_id obrigatório/);
  });

  it('E — parser vazio, ctx vazio explícito: throws IngestaoError (string vazia não vale)', () => {
    const ctxVazio: AdapterContext = {
      cliente_id: 'c1',
      legal_entity_id: 'le1',
      conta_bancaria_id: '',
      calendar,
    };
    expect(() =>
      cefAdapter({ ok: [], balances: [baseSnapshot('')] }, ctxVazio),
    ).toThrow(IngestaoError);
    expect(() =>
      cefAdapter({ ok: [], balances: [baseSnapshot('')] }, ctxVazio),
    ).toThrow(/conta_bancaria_id obrigatório/);
  });
});

/**
 * Fix 1 — Adapter agrega múltiplos BalanceSnapshot por (data, conta_bancaria_id-resolvido).
 *
 * Motivação: o parser CEF PDF emite um BalanceSnapshot por linha "Saldo X,XX C/D"
 * intercalada com transações. N transações no mesmo dia → N snapshots com a
 * mesma data. Cliente real (Gregorutt 2026-04-16) gerou 21 snapshots colapsados
 * em 1 dia; pipeline pegava o errado por sort instável + accountId vazio.
 *
 * Estratégia: agrupar por (date, conta_bancaria_id-resolvido). Pra cada grupo,
 * pegar o ÚLTIMO em ordem de chegada — heurística "running balance: o último
 * é o saldo end-of-day" (parser emite na ordem em que aparecem no extrato).
 *
 * Parser fica intocado. Adapter agrega.
 */
describe('cefAdapter — saldos: agregação por (data, conta_bancaria_id) (Fix 1)', () => {
  const utcDate = (y: number, m: number, d: number): Date =>
    new Date(Date.UTC(y, m - 1, d));
  const mkSnapshot = (
    accountId: string,
    date: Date,
    amount: number,
  ): BalanceSnapshot => ({
    accountId,
    date,
    amount,
    source: 'bank-statement',
  });

  it('F — agregação básica: 3 snapshots no mesmo (data, conta) → 1 saldo, último valor', () => {
    const date = utcDate(2026, 4, 16);
    const acct = 'cef:1234';
    const out = cefAdapter(
      {
        ok: [],
        balances: [
          mkSnapshot(acct, date, 100),
          mkSnapshot(acct, date, 200),
          mkSnapshot(acct, date, 150),
        ],
      },
      ctx,
    );
    expect(out.saldos).toHaveLength(1);
    expect(out.saldos[0]!.valor).toBe(150);
  });

  it('G — preserva datas distintas (mesma conta): 2 saldos', () => {
    const acct = 'cef:1234';
    const out = cefAdapter(
      {
        ok: [],
        balances: [
          mkSnapshot(acct, utcDate(2026, 4, 1), 1000),
          mkSnapshot(acct, utcDate(2026, 4, 2), 2000),
        ],
      },
      ctx,
    );
    expect(out.saldos).toHaveLength(2);
  });

  it('H — preserva contas distintas (mesma data): 2 saldos', () => {
    const date = utcDate(2026, 4, 16);
    const out = cefAdapter(
      {
        ok: [],
        balances: [
          mkSnapshot('cef:1234', date, 1000),
          mkSnapshot('cef:5678', date, 2000),
        ],
      },
      ctx,
    );
    expect(out.saldos).toHaveLength(2);
  });

  it('I — heurística é ORDEM, não MAX por valor', () => {
    const date = utcDate(2026, 4, 16);
    const acct = 'cef:1234';
    // 999 é o MAX, mas 50 é o ÚLTIMO em ordem. O Fix exige último.
    const out = cefAdapter(
      {
        ok: [],
        balances: [
          mkSnapshot(acct, date, 100),
          mkSnapshot(acct, date, 999),
          mkSnapshot(acct, date, 50),
        ],
      },
      ctx,
    );
    expect(out.saldos).toHaveLength(1);
    expect(out.saldos[0]!.valor).toBe(50);
  });

  it('J — cenário Gregorutt 2026-04-16 reproduzido: 21 snapshots → 1 saldo (45.230,51)', () => {
    const date = utcDate(2026, 4, 16);
    const acct = '0423012920005778782426';
    const sequencia = [
      43677.46, 66941.29, 66926.49, 66827.49, 66627.49, 66427.49, 53302.49,
      53067.49, 52347.49, 52242.12, 43677.46, 50286.87, 50771.87, 43683.71,
      43687.41, 45110.41, 43677.46, 47370.59, 47393.07, 49026.87, 45230.51,
    ];
    const balances = sequencia.map((v) => mkSnapshot(acct, date, v));
    const out = cefAdapter({ ok: [], balances }, ctx);
    expect(out.saldos).toHaveLength(1);
    expect(out.saldos[0]!.valor).toBe(45230.51);
  });

  it('K — fallback ctx aplica ANTES de agrupar (2 snapshots accountId="" → 1 saldo via ctx)', () => {
    const date = utcDate(2026, 4, 16);
    const ctxComConta: AdapterContext = {
      cliente_id: 'c1',
      legal_entity_id: 'le1',
      conta_bancaria_id: 'cef:1234',
      calendar,
    };
    const out = cefAdapter(
      {
        ok: [],
        balances: [
          mkSnapshot('', date, 100),
          mkSnapshot('', date, 200),
        ],
      },
      ctxComConta,
    );
    expect(out.saldos).toHaveLength(1);
    expect(out.saldos[0]!.valor).toBe(200);
    expect(out.saldos[0]!.conta_bancaria_id).toBe('cef:1234');
  });
});
