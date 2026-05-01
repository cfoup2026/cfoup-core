import { describe, expect, it } from 'vitest';
import {
  ReconciliacaoError,
  reconciliaBancoCpCr,
  type EventoCaixa,
} from '../../src/index.js';
import { mkEvento, utc } from './fixtures/mkEvento.js';

const RECON_EM = new Date('2026-05-30T12:00:00.000Z');

describe('reconciliaBancoCpCr — match único', () => {
  it('1 confirmado FKN + 1 realizado CEF mesma data/valor → 1 evento promovido', () => {
    const conf = mkEvento({
      id: 'fkn-001',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'cnpj-X',
    });
    const banc = mkEvento({
      id: 'cef-099',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'cnpj-X',
    });

    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });

    expect(r.eventos.length).toBe(1);
    const promovido = r.eventos[0]!;
    expect(promovido.id).toBe('fkn-001');
    expect(promovido.status).toBe('realizado');
    expect(promovido.origem).toBe('fkn');
    if (promovido.status === 'realizado') {
      expect(promovido.data_realizada.toISOString()).toBe(
        utc(2026, 5, 15).toISOString(),
      );
      expect(promovido.data_esperada.toISOString()).toBe(
        promovido.data_realizada.toISOString(),
      );
    }
    expect(promovido.reconciliado_com).toBe('cef-099');
    expect(promovido.reconciliado_em).toEqual(RECON_EM);
    expect(r.eventosBancariosAbsorvidos.length).toBe(1);
    expect(r.estatisticas.matchesAplicados).toBe(1);
    expect(r.estatisticas.eventosBancariosNaoAbsorvidos).toBe(0);
  });

  it('valor original do confirmado é mantido (banco diferente dentro de tolerância)', () => {
    const conf = mkEvento({
      id: 'fkn-002',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'cef-200',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 990, // 1% diferença
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.eventos.length).toBe(1);
    expect(r.eventos[0]!.valor).toBe(1000); // confirmado vence
  });

  it('origem mantida do confirmado (fkn), não vira "cef"', () => {
    const conf = mkEvento({
      id: 'fkn-003',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'cef-300',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.eventos[0]!.origem).toBe('fkn');
  });
});

describe('reconciliaBancoCpCr — tolerância de valor', () => {
  function caso(valorConf: number, valorBanc: number): boolean {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: valorConf,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: valorBanc,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    return r.estatisticas.matchesAplicados === 1;
  }

  it('R$ 1000 vs R$ 999 (R$ 1, dentro de R$ 5 absoluto) → match', () => {
    expect(caso(1000, 999)).toBe(true);
  });

  it('R$ 1000 vs R$ 990 (1%, no limite relativo) → match', () => {
    expect(caso(1000, 990)).toBe(true);
  });

  it('R$ 1000 vs R$ 989 (>1%) → não match', () => {
    expect(caso(1000, 989)).toBe(false);
  });

  it('R$ 100 vs R$ 95 (R$ 5 absoluto, mas 5% relativo) → match (limite absoluto vence)', () => {
    // tolerância = max(R$ 5, 1% * 100) = max(5, 1) = 5. 5 ≤ 5 → match.
    expect(caso(100, 95)).toBe(true);
  });

  it('R$ 100 vs R$ 94 (R$ 6, fora do absoluto) → não match', () => {
    expect(caso(100, 94)).toBe(false);
  });
});

describe('reconciliaBancoCpCr — janela temporal', () => {
  function casoData(diffDias: number): boolean {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: new Date(utc(2026, 5, 15).getTime() + diffDias * 86_400_000),
      data_esperada: new Date(utc(2026, 5, 15).getTime() + diffDias * 86_400_000),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    return r.estatisticas.matchesAplicados === 1;
  }

  it('+5 dias → match (exatamente no limite)', () => {
    expect(casoData(5)).toBe(true);
  });

  it('-5 dias → match (limite negativo)', () => {
    expect(casoData(-5)).toBe(true);
  });

  it('+6 dias → não match', () => {
    expect(casoData(6)).toBe(false);
  });

  it('mesmo dia → match', () => {
    expect(casoData(0)).toBe(true);
  });
});

describe('reconciliaBancoCpCr — direção', () => {
  it('saída + entrada → não match', () => {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });
});

describe('reconciliaBancoCpCr — contraparte', () => {
  it('ambos têm contraparte_id e divergem → não match', () => {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'A',
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'B',
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });

  it('apenas confirmado tem contraparte → match (critério ignorado)', () => {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'A',
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(1);
  });
});

describe('reconciliaBancoCpCr — ambiguidade e duplicidade', () => {
  it('2 confirmados elegíveis pra 1 realizado → 0 matches, 1 pendência', () => {
    const c1 = mkEvento({
      id: 'c1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const c2 = mkEvento({
      id: 'c2',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const b = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });

    const r = reconciliaBancoCpCr([c1, c2, b], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('ambiguidade_realizado_para_confirmado');
    expect(r.pendencias[0]!.eventos_relacionados).toEqual(['b', 'c1', 'c2']);
    // Eventos preservados.
    expect(r.eventos.length).toBe(3);
  });

  it('1 confirmado + 2 realizados elegíveis → 1 match (ordem por data asc), 2º vira pendência', () => {
    const c = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const b1 = mkEvento({
      id: 'b1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 14), // dia anterior — será o 1º na ordem
      data_esperada: utc(2026, 5, 14),
    });
    const b2 = mkEvento({
      id: 'b2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 16),
      data_esperada: utc(2026, 5, 16),
    });
    const r = reconciliaBancoCpCr([c, b1, b2], { reconciliadoEm: RECON_EM });

    expect(r.estatisticas.matchesAplicados).toBe(1);
    expect(r.eventosBancariosAbsorvidos[0]!.evento_bancario_id).toBe('b1');

    // 2º realizado vira pendência tipo duplicidade.
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('duplicidade_confirmado');
    expect(r.pendencias[0]!.eventos_relacionados).toEqual(['b2', 'c']);

    // b2 fica no output como evento bancário sobrante.
    const b2Out = r.eventos.find((e) => e.id === 'b2');
    expect(b2Out).toBeDefined();
    expect(b2Out!.status).toBe('realizado');
  });
});

describe('reconciliaBancoCpCr — sem candidato (banco solto)', () => {
  it('1 realizado CEF sem confirmado correspondente → não vira pendência, fica no output', () => {
    const b = mkEvento({
      id: 'cef-tarifa',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 89.9,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([b], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
    expect(r.pendencias.length).toBe(0);
    expect(r.estatisticas.eventosBancariosNaoAbsorvidos).toBe(1);
    expect(r.eventos.length).toBe(1);
    expect(r.eventos[0]!.id).toBe('cef-tarifa');
  });
});

describe('reconciliaBancoCpCr — eventos passam intactos', () => {
  it('estimado (origem=historico) NÃO participa', () => {
    const est = mkEvento({
      id: 'est-1',
      status: 'estimado',
      origem: 'historico',
      direcao: 'saida',
      valor: 1000,
      data_esperada: utc(2026, 5, 15),
      data_vencimento: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'b1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([est, banc], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(0);
    // Estimado preservado (em outros), banco fica como sobrante.
    expect(r.eventos.length).toBe(2);
    expect(r.eventos.find((e) => e.id === 'est-1')).toBeDefined();
  });

  it('eventos pendente passam intactos', () => {
    const pend = mkEvento({
      id: 'pend-1',
      status: 'pendente',
      origem: 'manual',
      direcao: 'saida',
      valor: 100,
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([pend], { reconciliadoEm: RECON_EM });
    expect(r.eventos.length).toBe(1);
    expect(r.eventos[0]!.id).toBe('pend-1');
    expect(r.eventos[0]!.status).toBe('pendente');
  });
});

describe('reconciliaBancoCpCr — auditoria e estatísticas', () => {
  it('eventosBancariosAbsorvidos.length === matchesAplicados', () => {
    const eventos = [
      mkEvento({
        id: 'c1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1000,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'c2',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'entrada',
        valor: 5000,
        data_vencimento: utc(2026, 5, 20),
        data_esperada: utc(2026, 5, 20),
      }),
      mkEvento({
        id: 'b1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 5000,
        data_realizada: utc(2026, 5, 20),
        data_esperada: utc(2026, 5, 20),
      }),
    ];
    const r = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicados).toBe(2);
    expect(r.eventosBancariosAbsorvidos.length).toBe(2);
    for (const ab of r.eventosBancariosAbsorvidos) {
      // promovido_para_id deve apontar pra evento no output.
      const found = r.eventos.find((e) => e.id === ab.promovido_para_id);
      expect(found).toBeDefined();
      expect(found!.reconciliado_com).toBe(ab.evento_bancario_id);
    }
  });

  it('output.length + absorvidos.length === input.length', () => {
    const eventos: EventoCaixa[] = [
      mkEvento({
        id: 'c',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1000,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'avulso',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 89.9,
        data_realizada: utc(2026, 5, 16),
        data_esperada: utc(2026, 5, 16),
      }),
    ];
    const r = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    expect(r.eventos.length + r.eventosBancariosAbsorvidos.length).toBe(
      eventos.length,
    );
  });
});

describe('reconciliaBancoCpCr — determinismo e provenance', () => {
  it('mesma entrada + reconciliadoEm → output deepEqual', () => {
    const eventos = [
      mkEvento({
        id: 'c1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1000,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
    ];
    const a = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    const b = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    expect(b).toEqual(a);
  });

  it('IDs de pendências determinísticos (mesmos ids → mesmos pendencia.id)', () => {
    const c1 = mkEvento({
      id: 'c1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const c2 = mkEvento({
      id: 'c2',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const b = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r1 = reconciliaBancoCpCr([c1, c2, b], { reconciliadoEm: RECON_EM });
    const r2 = reconciliaBancoCpCr([b, c2, c1], { reconciliadoEm: RECON_EM });
    expect(r1.pendencias[0]!.id).toBe(r2.pendencias[0]!.id);
    expect(r1.pendencias[0]!.id).toBe(
      'pend_ambiguidade_realizado_para_confirmado_b_c1_c2',
    );
  });

  it('eventos_relacionados sempre ordenados', () => {
    const c1 = mkEvento({
      id: 'zzz',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const c2 = mkEvento({
      id: 'aaa',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const b = mkEvento({
      id: 'mmm',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([c1, c2, b], { reconciliadoEm: RECON_EM });
    expect(r.pendencias[0]!.eventos_relacionados).toEqual(['aaa', 'mmm', 'zzz']);
  });
});

describe('reconciliaBancoCpCr — inputs especiais', () => {
  it('input vazio → result com estatísticas zeradas', () => {
    const r = reconciliaBancoCpCr([], { reconciliadoEm: RECON_EM });
    expect(r.eventos.length).toBe(0);
    expect(r.pendencias.length).toBe(0);
    expect(r.eventosBancariosAbsorvidos.length).toBe(0);
    expect(r.estatisticas.confirmadosOriginais).toBe(0);
    expect(r.estatisticas.realizadosBancariosOriginais).toBe(0);
    expect(r.estatisticas.matchesAplicados).toBe(0);
  });

  it('realizado com data_realizada NaN → ReconciliacaoError', () => {
    const base = mkEvento({
      id: 'bad',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    // Cast via unknown — discriminated union + spread/override torna
    // o tipo intermediário ambíguo. Aqui simulamos input quebrado.
    const eventoRuim = {
      ...base,
      data_realizada: new Date(Number.NaN),
    } as unknown as EventoCaixa;
    expect(() =>
      reconciliaBancoCpCr([eventoRuim], { reconciliadoEm: RECON_EM }),
    ).toThrow(ReconciliacaoError);
  });

  it('confirmado com origem inelegível (pluggy) → não entra em matching', () => {
    const conf = mkEvento({
      id: 'plg-1',
      status: 'confirmado',
      origem: 'pluggy', // pluggy não é elegível em v0
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'cef-1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, banc], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.confirmadosOriginais).toBe(0);
    expect(r.estatisticas.matchesAplicados).toBe(0);
    expect(r.eventos.length).toBe(2);
  });
});

/* ───────────────────────────────────────────────────────────────────
 * Passada 2 — `realizado_titulo` ↔ CEF restante (Estágio 3.1.1)
 * ─────────────────────────────────────────────────────────────────── */

describe('reconciliaBancoCpCr — Passada 2: match único FKN-realizado ↔ CEF', () => {
  it('1 FKN realizado + 1 CEF mesma data/valor → 1 match P2, CEF absorvido', () => {
    const fknPaid = mkEvento({
      id: 'fkn-pago',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef-equiv',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([fknPaid, cef], { reconciliadoEm: RECON_EM });

    expect(r.estatisticas.matchesAplicados).toBe(1);
    expect(r.estatisticas.matchesAplicadosPassada1).toBe(0);
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(1);
    expect(r.estatisticas.realizadosTituloOriginais).toBe(1);
    expect(r.estatisticas.realizadosBancariosOriginais).toBe(1);
    expect(r.estatisticas.eventosBancariosNaoAbsorvidos).toBe(0);

    // FKN preservado com auditoria; CEF some do output (absorvido).
    expect(r.eventos.length).toBe(1);
    const fknOut = r.eventos[0]!;
    expect(fknOut.id).toBe('fkn-pago');
    expect(fknOut.origem).toBe('fkn');
    expect(fknOut.reconciliado_com).toBe('cef-equiv');
    expect(fknOut.reconciliado_em).toEqual(RECON_EM);

    expect(r.eventosBancariosAbsorvidos.length).toBe(1);
    expect(r.eventosBancariosAbsorvidos[0]!.evento_bancario_id).toBe('cef-equiv');
    expect(r.eventosBancariosAbsorvidos[0]!.promovido_para_id).toBe('fkn-pago');
  });

  it('FKN realizado preserva valor, direcao e origem (não vira CEF)', () => {
    const fknPaid = mkEvento({
      id: 'fkn-pago',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 2500,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
    });
    const cef = mkEvento({
      id: 'cef-1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 2495, // dentro de tolerância R$ 5
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
    });
    const r = reconciliaBancoCpCr([fknPaid, cef], { reconciliadoEm: RECON_EM });
    expect(r.eventos.length).toBe(1);
    const out = r.eventos[0]!;
    expect(out.origem).toBe('fkn');
    expect(out.valor).toBe(2500); // valor do título vence
    expect(out.direcao).toBe('entrada');
  });
});

describe('reconciliaBancoCpCr — Passada 2: janela ±2 dias', () => {
  function casoDataP2(diffDias: number): boolean {
    const fknPaid = mkEvento({
      id: 'fkn-pago',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef-1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: new Date(utc(2026, 5, 15).getTime() + diffDias * 86_400_000),
      data_esperada: new Date(utc(2026, 5, 15).getTime() + diffDias * 86_400_000),
    });
    const r = reconciliaBancoCpCr([fknPaid, cef], { reconciliadoEm: RECON_EM });
    return r.estatisticas.matchesAplicadosPassada2 === 1;
  }

  it('+2 dias → match (limite)', () => {
    expect(casoDataP2(2)).toBe(true);
  });

  it('-2 dias → match (limite negativo)', () => {
    expect(casoDataP2(-2)).toBe(true);
  });

  it('+3 dias → não match (fora P2 mas dentro de P1 — comprova janela mais apertada)', () => {
    expect(casoDataP2(3)).toBe(false);
  });
});

describe('reconciliaBancoCpCr — Passada 2: tolerância de valor', () => {
  function casoValorP2(valorTit: number, valorCef: number): boolean {
    const fknPaid = mkEvento({
      id: 'fkn-pago',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: valorTit,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef-1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: valorCef,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([fknPaid, cef], { reconciliadoEm: RECON_EM });
    return r.estatisticas.matchesAplicadosPassada2 === 1;
  }

  it('R$ 1000 vs R$ 990 (1% relativo no limite) → match', () => {
    expect(casoValorP2(1000, 990)).toBe(true);
  });

  it('R$ 1000 vs R$ 989 (>1%) → não match', () => {
    expect(casoValorP2(1000, 989)).toBe(false);
  });

  it('R$ 100 vs R$ 95 (R$ 5 absoluto vence) → match', () => {
    expect(casoValorP2(100, 95)).toBe(true);
  });
});

describe('reconciliaBancoCpCr — Passada 2: direção e contraparte', () => {
  it('saída + entrada → não match P2', () => {
    const fkn = mkEvento({
      id: 't',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'c',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([fkn, cef], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(0);
    expect(r.eventos.length).toBe(2);
  });

  it('contraparte_id divergente em ambos → não match P2', () => {
    const fkn = mkEvento({
      id: 't',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'A',
    });
    const cef = mkEvento({
      id: 'c',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'B',
    });
    const r = reconciliaBancoCpCr([fkn, cef], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(0);
  });
});

describe('reconciliaBancoCpCr — Passada 2: ambiguidade e duplicidade', () => {
  it('1 FKN-realizado + 2 CEFs elegíveis → ambiguidade P2, sem match', () => {
    const fkn = mkEvento({
      id: 'fkn-1',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const c1 = mkEvento({
      id: 'cef-a',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 14),
      data_esperada: utc(2026, 5, 14),
    });
    const c2 = mkEvento({
      id: 'cef-b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 16),
      data_esperada: utc(2026, 5, 16),
    });
    const r = reconciliaBancoCpCr([fkn, c1, c2], { reconciliadoEm: RECON_EM });

    expect(r.estatisticas.matchesAplicadosPassada2).toBe(0);
    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('ambiguidade_realizado_titulo_para_cef');
    expect(r.pendencias[0]!.eventos_relacionados).toEqual([
      'cef-a',
      'cef-b',
      'fkn-1',
    ]);
    // Tudo preservado.
    expect(r.eventos.length).toBe(3);
    expect(r.eventosBancariosAbsorvidos.length).toBe(0);
  });

  it('2 FKN-realizado + 1 CEF (encadeamento P2) → 1º match, 2º vira duplicidade_cef_titulo', () => {
    // Os dois títulos são elegíveis pro mesmo CEF; 1º na ordem (data asc, id lex)
    // consome o CEF; 2º tenta apontar pro mesmo CEF e vira pendência.
    const t1 = mkEvento({
      id: 't-aaa',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 14), // mais antigo → vence
      data_esperada: utc(2026, 5, 14),
    });
    const t2 = mkEvento({
      id: 't-bbb',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 16),
      data_esperada: utc(2026, 5, 16),
    });
    const cef = mkEvento({
      id: 'cef-x',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15), // dentro de ±2 dias dos dois
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([t1, t2, cef], { reconciliadoEm: RECON_EM });

    expect(r.estatisticas.matchesAplicadosPassada2).toBe(1);
    expect(r.eventosBancariosAbsorvidos.length).toBe(1);
    expect(r.eventosBancariosAbsorvidos[0]!.promovido_para_id).toBe('t-aaa');
    expect(r.eventosBancariosAbsorvidos[0]!.evento_bancario_id).toBe('cef-x');

    expect(r.pendencias.length).toBe(1);
    expect(r.pendencias[0]!.tipo).toBe('duplicidade_cef_titulo');
    expect(r.pendencias[0]!.eventos_relacionados).toEqual(['cef-x', 't-bbb']);

    // Output: t1 (com audit), t2 (intocado), CEF some.
    expect(r.eventos.length).toBe(2);
    const t1Out = r.eventos.find((e) => e.id === 't-aaa');
    expect(t1Out!.reconciliado_com).toBe('cef-x');
    const t2Out = r.eventos.find((e) => e.id === 't-bbb');
    expect(t2Out!.reconciliado_com).toBeUndefined();
  });
});

describe('reconciliaBancoCpCr — Passada 2: encadeamento com Passada 1', () => {
  it('CEF consumido por P1 não fica disponível pra P2', () => {
    const conf = mkEvento({
      id: 'conf',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    // FKN-realizado que poderia ser candidato pro CEF se P1 não tivesse consumido.
    const titSemCef = mkEvento({
      id: 'tit-orfao',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([conf, cef, titSemCef], {
      reconciliadoEm: RECON_EM,
    });

    expect(r.estatisticas.matchesAplicadosPassada1).toBe(1);
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(0);
    expect(r.estatisticas.matchesAplicados).toBe(1);
    // Título órfão fica intocado, sem reconciliado_com.
    const tOut = r.eventos.find((e) => e.id === 'tit-orfao');
    expect(tOut!.reconciliado_com).toBeUndefined();
  });

  it('cenário completo: P1 + P2 simultâneos (3 grupos isolados)', () => {
    // Grupo 1 — P1: confirmado A + CEF A (mesmo dia)
    const confA = mkEvento({
      id: 'confA',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'cli-A',
    });
    const cefA = mkEvento({
      id: 'cefA',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'cli-A',
    });
    // Grupo 2 — P2: FKN realizado B + CEF B
    const titB = mkEvento({
      id: 'titB',
      status: 'realizado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'cli-B',
    });
    const cefB = mkEvento({
      id: 'cefB',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 20),
      data_esperada: utc(2026, 5, 20),
      cliente_id: 'cli-B',
    });
    // Grupo 3 — sobrante: CEF avulso (tarifa)
    const cefAvulso = mkEvento({
      id: 'cef-tarifa',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 19.9,
      data_realizada: utc(2026, 5, 25),
      data_esperada: utc(2026, 5, 25),
      cliente_id: 'cli-X',
    });

    const r = reconciliaBancoCpCr(
      [confA, cefA, titB, cefB, cefAvulso],
      { reconciliadoEm: RECON_EM },
    );

    expect(r.estatisticas.matchesAplicadosPassada1).toBe(1);
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(1);
    expect(r.estatisticas.matchesAplicados).toBe(2);
    expect(r.estatisticas.eventosBancariosNaoAbsorvidos).toBe(1);
    expect(r.eventosBancariosAbsorvidos.length).toBe(2);

    // 5 input - 2 absorvidos = 3 no output (promovido A, título B com audit, avulso).
    expect(r.eventos.length).toBe(3);
    expect(r.pendencias.length).toBe(0);
  });
});

describe('reconciliaBancoCpCr — Passada 2: estatísticas e invariantes', () => {
  it('estatísticas: P1 + P2 batendo, output.length + absorvidos = input.length', () => {
    const eventos = [
      mkEvento({
        id: 'titX',
        status: 'realizado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'cefX',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'cef-avulso',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 50,
        data_realizada: utc(2026, 5, 18),
        data_esperada: utc(2026, 5, 18),
      }),
    ];
    const r = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });

    expect(r.estatisticas.realizadosTituloOriginais).toBe(1);
    expect(r.estatisticas.realizadosBancariosOriginais).toBe(2);
    expect(r.estatisticas.matchesAplicadosPassada1).toBe(0);
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(1);
    expect(r.estatisticas.matchesAplicados).toBe(1);
    expect(r.eventos.length + r.eventosBancariosAbsorvidos.length).toBe(
      eventos.length,
    );
  });

  it('determinismo: mesmo input + reconciliadoEm → deepEqual incluindo P2', () => {
    const eventos = [
      mkEvento({
        id: 'titA',
        status: 'realizado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'cefA',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1000,
        data_realizada: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
    ];
    const r1 = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    const r2 = reconciliaBancoCpCr(eventos, { reconciliadoEm: RECON_EM });
    expect(r2).toEqual(r1);
  });

  it('manual e erp como origens lado-A também participam de P2', () => {
    const titManual = mkEvento({
      id: 'man-1',
      status: 'realizado',
      origem: 'manual',
      direcao: 'saida',
      valor: 500,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef-m',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 500,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([titManual, cef], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(1);
  });

  it('estimado historico NÃO entra como título P2 (filtro de elegibilidade)', () => {
    const est = mkEvento({
      id: 'est',
      status: 'realizado',
      origem: 'historico',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const cef = mkEvento({
      id: 'cef',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const r = reconciliaBancoCpCr([est, cef], { reconciliadoEm: RECON_EM });
    expect(r.estatisticas.realizadosTituloOriginais).toBe(0);
    expect(r.estatisticas.matchesAplicadosPassada2).toBe(0);
    // Tudo preservado.
    expect(r.eventos.length).toBe(2);
  });
});
