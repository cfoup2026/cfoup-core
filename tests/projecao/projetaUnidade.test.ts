import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  ProjecaoError,
  projetaUnidade,
  type ContraparteStats,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utc(2026, 5, 1); // sexta, semana W18

/* Helpers */

function snapshot(args: {
  id: string;
  cliente_id?: string;
  legal_entity_id?: string;
  conta_bancaria_id?: string;
  valor: number;
  data_referencia: Date;
}): OpeningBalanceSnapshot {
  return {
    id: args.id,
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id ?? 'u1',
    conta_bancaria_id: args.conta_bancaria_id ?? 'b1',
    valor: args.valor,
    data_referencia: args.data_referencia,
    origem: 'cef',
    criado_em: new Date('2026-05-01T00:00:00.000Z'),
    criado_por: 'sistema',
  };
}

function stableContraparteStats(
  contraparte_id: string,
  mediana: number,
): ContraparteStats {
  return {
    contraparte_id,
    n: 6,
    mediana_dias: mediana,
    media_dias: mediana,
    desvio_dias: 1,
    min_dias: mediana - 1,
    max_dias: mediana + 1,
    padrao_estavel: true,
    inferido_de: 'delta_vencimento_realizada',
    n_amostras: 6,
    confianca_inferencia: 'alta',
  };
}

function unstableContraparteStats(
  contraparte_id: string,
  mediana: number,
): ContraparteStats {
  return {
    contraparte_id,
    n: 3,
    mediana_dias: mediana,
    media_dias: mediana,
    desvio_dias: 8,
    min_dias: 0,
    max_dias: 15,
    padrao_estavel: false,
    inferido_de: 'delta_vencimento_realizada',
    n_amostras: 3,
    confianca_inferencia: 'baixa',
  };
}

/* ─────────── Janela e estrutura ─────────── */

describe('projetaUnidade — janela de 13 semanas', () => {
  it('geradoEm 2026-05-01 → janela W18..W30, 13 semanas', () => {
    const r = projetaUnidade({
      eventos: [],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.janela).toHaveLength(13);
    expect(r.janela[0]).toBe('2026-W18');
    expect(r.janela[12]).toBe('2026-W30');
    expect(r.semanas).toHaveLength(13);
    expect(r.semanas[0]!.semana_iso).toBe('2026-W18');
    expect(r.semanas[12]!.semana_iso).toBe('2026-W30');
  });

  it('input vazio → estrutura válida zerada, sem throw, sem snapshot', () => {
    const r = projetaUnidade({
      eventos: [],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.semanas).toHaveLength(13);
    expect(r.caixaInicial.ausente).toBe(true);
    expect(r.caixaInicial.valor).toBe(0);
    expect(r.estatisticas.eventosTotal).toBe(0);
    expect(r.estatisticas.eventosNaGrade).toBe(0);
    for (const s of r.semanas) {
      expect(s.caixa_inicial).toBe(0);
      expect(s.caixa_final).toBe(0);
      expect(s.evento_ids).toEqual([]);
      expect(s.eventos_pendentes_com_data_ids).toEqual([]);
    }
  });
});

/* ─────────── Caixa inicial (snapshot) ─────────── */

describe('projetaUnidade — caixa inicial', () => {
  it('1 snapshot 7 dias antes de geradoEm → usado, stale=false', () => {
    const s = snapshot({
      id: 's1',
      valor: 1000,
      data_referencia: utc(2026, 4, 24), // 7 dias antes
    });
    const r = projetaUnidade({
      eventos: [],
      saldos: [s],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.caixaInicial.valor).toBe(1000);
    expect(r.caixaInicial.stale).toBe(false);
    expect(r.caixaInicial.ausente).toBe(false);
    expect(r.caixaInicial.origem_snapshot_id).toBe('s1');
  });

  it('1 snapshot 8 dias antes → usado, stale=true', () => {
    const s = snapshot({
      id: 's2',
      valor: 500,
      data_referencia: utc(2026, 4, 23), // 8 dias antes
    });
    const r = projetaUnidade({
      eventos: [],
      saldos: [s],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.caixaInicial.valor).toBe(500);
    expect(r.caixaInicial.stale).toBe(true);
    expect(r.caixaInicial.ausente).toBe(false);
  });

  it('múltiplos snapshots → escolhe o mais recente ≤ geradoEm', () => {
    const s1 = snapshot({ id: 'antigo', valor: 100, data_referencia: utc(2026, 3, 1) });
    const s2 = snapshot({ id: 'meio', valor: 500, data_referencia: utc(2026, 4, 15) });
    const s3 = snapshot({ id: 'novo', valor: 9000, data_referencia: utc(2026, 4, 30) });
    const futuro = snapshot({
      id: 'futuro',
      valor: 99999,
      data_referencia: utc(2026, 5, 15),
    });
    const r = projetaUnidade({
      eventos: [],
      saldos: [s1, futuro, s3, s2],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.caixaInicial.valor).toBe(9000);
    expect(r.caixaInicial.origem_snapshot_id).toBe('novo');
    expect(r.caixaInicial.stale).toBe(false);
  });

  it('sem snapshot → valor=0, ausente=true', () => {
    const r = projetaUnidade({
      eventos: [],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.caixaInicial.valor).toBe(0);
    expect(r.caixaInicial.ausente).toBe(true);
    expect(r.caixaInicial.stale).toBe(false);
    expect(r.caixaInicial.origem_snapshot_id).toBeUndefined();
    expect(r.caixaInicial.data_referencia).toBeUndefined();
  });

  /* ─── Fix 3 — invariante de unicidade ───
   * Adapter (Fix 1) já agrega snapshots por (data, conta_bancaria_id),
   * mas `computaCaixaInicial` deve defender a invariante mesmo se
   * snapshots duplicados vierem de outra origem (manual, FKN futuro,
   * ingestão direta). Falha visivelmente em vez de escolher silencioso.
   */

  it('L — duplicata de chave completa (cliente, le, data, conta) lança ProjecaoError', () => {
    const dup1 = snapshot({
      id: 'dup-1',
      valor: 100,
      data_referencia: utc(2026, 4, 30),
    });
    const dup2 = snapshot({
      id: 'dup-2',
      valor: 200,
      data_referencia: utc(2026, 4, 30),
    });
    const run = (): unknown =>
      projetaUnidade({
        eventos: [],
        saldos: [dup1, dup2],
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        geradoEm: GERADO_EM,
        calendar,
      });
    expect(run).toThrow(ProjecaoError);
    expect(run).toThrow(/computaCaixaInicial/);
    expect(run).toThrow(/duplicad/);
  });

  it('M — multi-conta na mesma data NÃO lança (regressão guard)', () => {
    const sA = snapshot({
      id: 'a-conta-snap',
      conta_bancaria_id: 'a-conta',
      valor: 100,
      data_referencia: utc(2026, 4, 30),
    });
    const sB = snapshot({
      id: 'b-conta-snap',
      conta_bancaria_id: 'b-conta',
      valor: 200,
      data_referencia: utc(2026, 4, 30),
    });
    const r = projetaUnidade({
      eventos: [],
      saldos: [sA, sB],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    // Tiebreaker por id asc no sort atual: 'a-conta-snap' < 'b-conta-snap'.
    expect(r.caixaInicial.valor).toBe(100);
  });

  it('snapshots de outras unidades ignorados', () => {
    const outraUnidade = snapshot({
      id: 'x',
      legal_entity_id: 'u2',
      valor: 999,
      data_referencia: utc(2026, 4, 28),
    });
    const r = projetaUnidade({
      eventos: [],
      saldos: [outraUnidade],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.caixaInicial.ausente).toBe(true);
  });
});

/* ─────────── Roll-forward ─────────── */

describe('projetaUnidade — roll-forward determinístico', () => {
  it('caixa final n = caixa inicial n+1', () => {
    const eventos = [
      mkEvento({
        id: 'e1',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 1000,
        data_realizada: utc(2026, 5, 4),
        data_esperada: utc(2026, 5, 4),
      }),
    ];
    const saldo = snapshot({
      id: 's',
      valor: 5000,
      data_referencia: utc(2026, 4, 28),
    });
    const r = projetaUnidade({
      eventos,
      saldos: [saldo],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    // 2026-05-04 (Mon) está em W19 = semanas[1], não W18.
    expect(r.semanas[0]!.semana_iso).toBe('2026-W18');
    expect(r.semanas[0]!.caixa_inicial).toBe(5000);
    expect(r.semanas[0]!.caixa_final).toBe(5000); // nada acontece em W18
    expect(r.semanas[1]!.semana_iso).toBe('2026-W19');
    expect(r.semanas[1]!.caixa_inicial).toBe(5000);
    expect(r.semanas[1]!.entradas_realizadas).toBe(1000);
    expect(r.semanas[1]!.caixa_final).toBe(6000);
    // Roll-forward determinístico do W20 em diante: 6000.
    for (let i = 2; i < 13; i++) {
      expect(r.semanas[i]!.caixa_inicial).toBe(6000);
      expect(r.semanas[i]!.caixa_final).toBe(6000);
    }
  });
});

/* ─────────── Alocação ─────────── */

describe('projetaUnidade — alocação por status × direcao', () => {
  it('realizado data_realizada 2026-05-06 → semana 2 (W19), bucket realizadas', () => {
    const ev = mkEvento({
      id: 'r1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 250,
      data_realizada: utc(2026, 5, 6), // quarta, W19
      data_esperada: utc(2026, 5, 6),
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.semanas[1]!.semana_iso).toBe('2026-W19');
    expect(r.semanas[1]!.saidas_realizadas).toBe(250);
    expect(r.semanas[1]!.evento_ids).toEqual(['r1']);
    // allocationDate registrada
    expect(r.allocationDatesByEventoId.get('r1')!.toISOString()).toBe(
      '2026-05-06T00:00:00.000Z',
    );
  });

  it('confirmado vencimento 2026-05-15 (sexta) → calendário (já é útil), W20', () => {
    const ev = mkEvento({
      id: 'c1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 500,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    // 2026-05-15 está na semana W20 (Mon=2026-05-11, Sun=2026-05-17).
    expect(r.semanas[2]!.semana_iso).toBe('2026-W20');
    expect(r.semanas[2]!.saidas_confirmadas).toBe(500);
  });

  it('estimado origem=historico → allocationDate = data_esperada (sem reaplicar hook)', () => {
    const ev = mkEvento({
      id: 'est1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'estimado',
      origem: 'historico',
      direcao: 'entrada',
      valor: 999,
      data_esperada: utc(2026, 5, 12),
    });
    // Hook que MOVERIA se aplicado — mas estimado não passa por hook aqui.
    const hook = new Map<string, ContraparteStats>([
      ['x', stableContraparteStats('x', 100)],
    ]);
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
      contraparteHistory: hook,
    });
    expect(r.allocationDatesByEventoId.get('est1')!.toISOString()).toBe(
      '2026-05-12T00:00:00.000Z',
    );
    // 2026-05-12 está em W20.
    expect(r.semanas[2]!.entradas_estimadas).toBe(999);
  });

  it('pendente com data_esperada → entra em eventos_pendentes_com_data_ids, NÃO soma', () => {
    const ev = mkEvento({
      id: 'p1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'pendente',
      origem: 'manual',
      direcao: 'entrada',
      valor: 750,
      data_esperada: utc(2026, 5, 6),
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.semanas[1]!.eventos_pendentes_com_data_ids).toEqual(['p1']);
    expect(r.semanas[1]!.evento_ids).toEqual([]);
    expect(r.semanas[1]!.entradas_realizadas).toBe(0);
    expect(r.semanas[1]!.entradas_confirmadas).toBe(0);
    expect(r.semanas[1]!.entradas_estimadas).toBe(0);
    expect(r.semanas[1]!.total_entradas).toBe(0);
    expect(r.semanas[1]!.variacao_liquida).toBe(0);
    expect(r.semanas[1]!.caixa_final).toBe(0);
    // allocationDate registrada normalmente
    expect(r.allocationDatesByEventoId.has('p1')).toBe(true);
    // Conta como naGrade (apesar de não somar nos totais)
    expect(r.estatisticas.eventosNaGrade).toBe(1);
  });

  it('pendente sem data_esperada nem data_vencimento → eventosNaoAlocados', () => {
    // mkEvento exige data_esperada — construção manual via cast.
    const ev = mkEvento({
      id: 'p2',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'pendente',
      origem: 'manual',
      direcao: 'saida',
      valor: 100,
      data_esperada: utc(2026, 5, 6),
    });
    const evRuim = {
      ...ev,
      data_esperada: new Date(Number.NaN),
    } as unknown as EventoCaixa;
    const r = projetaUnidade({
      eventos: [evRuim],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.eventosNaoAlocados).toEqual(['p2']);
    expect(r.allocationDatesByEventoId.has('p2')).toBe(false);
    expect(r.estatisticas.eventosNaoAlocadosCount).toBe(1);
  });

  it('total_entradas = soma das três variantes; pendentes excluídos; caixa_final consistente', () => {
    const eventos = [
      mkEvento({
        id: 'r',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 100,
        data_realizada: utc(2026, 5, 4),
        data_esperada: utc(2026, 5, 4),
      }),
      mkEvento({
        id: 'c',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'entrada',
        valor: 200,
        data_vencimento: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'e',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'estimado',
        origem: 'historico',
        direcao: 'entrada',
        valor: 50,
        data_esperada: utc(2026, 5, 6),
      }),
      mkEvento({
        id: 'p',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'pendente',
        origem: 'manual',
        direcao: 'entrada',
        valor: 9999,
        data_esperada: utc(2026, 5, 6),
      }),
    ];
    const r = projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    // Todos em W19 (semana 2 = 2026-05-04..2026-05-10).
    const w19 = r.semanas[1]!;
    expect(w19.total_entradas).toBe(350);
    expect(w19.total_saidas).toBe(0);
    expect(w19.variacao_liquida).toBe(350);
    expect(w19.caixa_final).toBe(350);
    expect(w19.eventos_pendentes_com_data_ids).toEqual(['p']);
  });
});

/* ─────────── Hook contraparteHistory ─────────── */

describe('projetaUnidade — hook contraparteHistory em confirmado', () => {
  it('sem hook → allocationDate = deriveDataEsperada(data_vencimento, calendar)', () => {
    const ev = mkEvento({
      id: 'c',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 4), // segunda — útil
      data_esperada: utc(2026, 5, 4),
      contraparte_id: 'cliente-x',
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.allocationDatesByEventoId.get('c')!.toISOString()).toBe(
      '2026-05-04T00:00:00.000Z',
    );
    expect(r.estatisticas.confirmadosComHookAplicado).toBe(0);
  });

  it('com hook estável mediana=5 → desloca +5 dias e calendário move para próximo útil', () => {
    const ev = mkEvento({
      id: 'c',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 1000,
      data_vencimento: utc(2026, 5, 4),
      data_esperada: utc(2026, 5, 4),
      contraparte_id: 'cliente-x',
    });
    const hook = new Map<string, ContraparteStats>([
      ['cliente-x', stableContraparteStats('cliente-x', 5)],
    ]);
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
      contraparteHistory: hook,
    });
    // 2026-05-04 + 5 = 2026-05-09 (sábado) → próximo útil = 2026-05-11 (segunda)
    expect(r.allocationDatesByEventoId.get('c')!.toISOString()).toBe(
      '2026-05-11T00:00:00.000Z',
    );
    expect(r.estatisticas.confirmadosComHookAplicado).toBe(1);
    // EventoCaixa não foi mutado
    if (ev.status === 'confirmado') {
      expect(ev.data_esperada.toISOString()).toBe('2026-05-04T00:00:00.000Z');
      expect(ev.data_vencimento.toISOString()).toBe('2026-05-04T00:00:00.000Z');
    }
  });

  it('com hook instável → sem ajuste do hook, só calendário', () => {
    const ev = mkEvento({
      id: 'c',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 100,
      data_vencimento: utc(2026, 5, 4),
      data_esperada: utc(2026, 5, 4),
      contraparte_id: 'inst',
    });
    const hook = new Map<string, ContraparteStats>([
      ['inst', unstableContraparteStats('inst', 5)],
    ]);
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
      contraparteHistory: hook,
    });
    expect(r.allocationDatesByEventoId.get('c')!.toISOString()).toBe(
      '2026-05-04T00:00:00.000Z',
    );
    expect(r.estatisticas.confirmadosComHookAplicado).toBe(0);
  });

  it('hook estável com mediana=0 → não conta como aplicado (deriveDataEsperada não desloca)', () => {
    const ev = mkEvento({
      id: 'c',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 100,
      data_vencimento: utc(2026, 5, 4),
      data_esperada: utc(2026, 5, 4),
      contraparte_id: 'no-shift',
    });
    const hook = new Map<string, ContraparteStats>([
      ['no-shift', stableContraparteStats('no-shift', 0)],
    ]);
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
      contraparteHistory: hook,
    });
    expect(r.estatisticas.confirmadosComHookAplicado).toBe(0);
  });
});

/* ─────────── Transferência interna ─────────── */

describe('projetaUnidade — is_transferencia=true visível na visão por unidade', () => {
  it('saída em U1 entra em saidas_*, entrada em U2 entra em entradas_* (visão por unidade)', () => {
    // Saída em U1 (esta visão) marcada como transferência
    const saidaU1: EventoCaixa = {
      ...(mkEvento({
        id: 's',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 5000,
        data_realizada: utc(2026, 5, 6),
        data_esperada: utc(2026, 5, 6),
      }) as EventoCaixa),
      is_transferencia: true,
      transferencia_par_id: 'e',
    };
    // Entrada em U2 (visão diferente)
    const entradaU2: EventoCaixa = {
      ...(mkEvento({
        id: 'e',
        cliente_id: 'c1',
        legal_entity_id: 'u2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 5000,
        data_realizada: utc(2026, 5, 6),
        data_esperada: utc(2026, 5, 6),
      }) as EventoCaixa),
      is_transferencia: true,
      transferencia_par_id: 's',
    };

    // Visão U1 — vê a saída
    const rU1 = projetaUnidade({
      eventos: [saidaU1, entradaU2],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(rU1.semanas[1]!.saidas_realizadas).toBe(5000);
    expect(rU1.semanas[1]!.evento_ids).toContain('s');
    expect(rU1.semanas[1]!.evento_ids).not.toContain('e');

    // Visão U2 — vê a entrada
    const rU2 = projetaUnidade({
      eventos: [saidaU1, entradaU2],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(rU2.semanas[1]!.entradas_realizadas).toBe(5000);
    expect(rU2.semanas[1]!.evento_ids).toContain('e');
    expect(rU2.semanas[1]!.evento_ids).not.toContain('s');
  });
});

/* ─────────── Atrasados, fora da janela, drill-down ─────────── */

describe('projetaUnidade — atrasados, fora da janela, allocationDates completo', () => {
  it('confirmado com allocationDate < inicio_semana_1 → eventosAtrasados, mas com entrada no map', () => {
    const ev = mkEvento({
      id: 'atr',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 100,
      data_vencimento: utc(2026, 4, 20), // segunda anterior à semana 1
      data_esperada: utc(2026, 4, 20),
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.eventosAtrasados).toEqual(['atr']);
    expect(r.allocationDatesByEventoId.has('atr')).toBe(true);
    // Não entra em nenhuma semana
    for (const s of r.semanas) {
      expect(s.evento_ids).not.toContain('atr');
      expect(s.eventos_pendentes_com_data_ids).not.toContain('atr');
    }
    expect(r.estatisticas.eventosAtrasadosCount).toBe(1);
  });

  it('evento allocationDate > fim_semana_13 → eventosForaDaJanela, mas com entrada no map', () => {
    const ev = mkEvento({
      id: 'fut',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 100,
      data_vencimento: utc(2026, 9, 1), // muito além de W30
      data_esperada: utc(2026, 9, 1),
    });
    const r = projetaUnidade({
      eventos: [ev],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.eventosForaDaJanela).toEqual(['fut']);
    expect(r.allocationDatesByEventoId.has('fut')).toBe(true);
    expect(r.estatisticas.eventosForaDaJanelaCount).toBe(1);
  });

  it('allocationDatesByEventoId cobre 100% dos eventos com data calculável', () => {
    const eventos = [
      mkEvento({
        id: 'na-grade',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 1,
        data_realizada: utc(2026, 5, 6),
        data_esperada: utc(2026, 5, 6),
      }),
      mkEvento({
        id: 'atrasado',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1,
        data_realizada: utc(2026, 4, 1),
        data_esperada: utc(2026, 4, 1),
      }),
      mkEvento({
        id: 'fora',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'entrada',
        valor: 1,
        data_vencimento: utc(2027, 1, 1),
        data_esperada: utc(2027, 1, 1),
      }),
    ];
    const r = projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.allocationDatesByEventoId.size).toBe(3);
    expect(r.estatisticas.eventosNaGrade).toBe(1);
    expect(r.estatisticas.eventosAtrasadosCount).toBe(1);
    expect(r.estatisticas.eventosForaDaJanelaCount).toBe(1);
    expect(r.estatisticas.eventosNaoAlocadosCount).toBe(0);
  });
});

/* ─────────── Determinismo, imutabilidade, estatísticas ─────────── */

describe('projetaUnidade — determinismo, imutabilidade, fechamento de estatísticas', () => {
  it('determinismo: 2 chamadas → deepEqual', () => {
    const eventos = [
      mkEvento({
        id: 'a',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 500,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 200,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
    ];
    const saldos = [
      snapshot({ id: 's', valor: 1000, data_referencia: utc(2026, 4, 28) }),
    ];
    const r1 = projetaUnidade({
      eventos,
      saldos,
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    const r2 = projetaUnidade({
      eventos,
      saldos,
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r2).toEqual(r1);
  });

  it('imutabilidade: array eventos não é mutado, data_esperada original preservada', () => {
    const ev = mkEvento({
      id: 'e',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 500,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'shift',
    });
    const eventosArr = [ev];
    const eventosSnapshot = JSON.stringify(eventosArr);

    const hook = new Map<string, ContraparteStats>([
      ['shift', stableContraparteStats('shift', 7)],
    ]);
    projetaUnidade({
      eventos: eventosArr,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
      contraparteHistory: hook,
    });

    expect(JSON.stringify(eventosArr)).toBe(eventosSnapshot);
    if (ev.status === 'confirmado') {
      expect(ev.data_esperada.toISOString()).toBe(
        '2026-05-15T00:00:00.000Z',
      );
    }
  });

  it('estatísticas batem: naGrade + atrasados + foraDaJanela + naoAlocados = total', () => {
    const ev1 = mkEvento({
      id: 'g',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1,
      data_realizada: utc(2026, 5, 4),
      data_esperada: utc(2026, 5, 4),
    });
    const ev2 = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1,
      data_realizada: utc(2026, 4, 1),
      data_esperada: utc(2026, 4, 1),
    });
    const ev3 = mkEvento({
      id: 'f',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1,
      data_vencimento: utc(2027, 1, 1),
      data_esperada: utc(2027, 1, 1),
    });
    const ev4 = {
      ...mkEvento({
        id: 'n',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'pendente',
        origem: 'manual',
        direcao: 'saida',
        valor: 1,
        data_esperada: utc(2026, 5, 6),
      }),
      data_esperada: new Date(Number.NaN),
    } as unknown as EventoCaixa;
    const r = projetaUnidade({
      eventos: [ev1, ev2, ev3, ev4],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    const e = r.estatisticas;
    expect(
      e.eventosNaGrade +
        e.eventosAtrasadosCount +
        e.eventosForaDaJanelaCount +
        e.eventosNaoAlocadosCount,
    ).toBe(e.eventosTotal);
    expect(e.eventosTotal).toBe(4);
  });
});

/* ─────────── Filtragem por unidade ─────────── */

describe('projetaUnidade — filtro por cliente_id + legal_entity_id', () => {
  it('eventos de outras unidades ignorados silenciosamente', () => {
    const eventos = [
      mkEvento({
        id: 'meu',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 100,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'outra-le',
        cliente_id: 'c1',
        legal_entity_id: 'u2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 9999,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'outro-cli',
        cliente_id: 'c2',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 8888,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
    ];
    const r = projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.estatisticas.eventosTotal).toBe(1);
    expect(r.semanas[1]!.entradas_realizadas).toBe(100);
  });
});

/* ─────────── Fail visibly ─────────── */

describe('projetaUnidade — fail visibly', () => {
  it('realizado sem data_realizada válida → ProjecaoError', () => {
    const ev = mkEvento({
      id: 'bad',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
    });
    const evRuim = {
      ...ev,
      data_realizada: new Date(Number.NaN),
    } as unknown as EventoCaixa;
    expect(() =>
      projetaUnidade({
        eventos: [evRuim],
        saldos: [],
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        geradoEm: GERADO_EM,
        calendar,
      }),
    ).toThrow(ProjecaoError);
  });

  it('geradoEm ausente/inválido → ProjecaoError', () => {
    expect(() =>
      projetaUnidade({
        eventos: [],
        saldos: [],
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        geradoEm: new Date(Number.NaN),
        calendar,
      }),
    ).toThrow(ProjecaoError);
  });

  it('calendar ausente → ProjecaoError', () => {
    expect(() =>
      projetaUnidade({
        eventos: [],
        saldos: [],
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        geradoEm: GERADO_EM,
        // @ts-expect-error — testando defesa runtime
        calendar: undefined,
      }),
    ).toThrow(ProjecaoError);
  });
});
