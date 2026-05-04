import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  ProjecaoError,
  calculaCaixaMinimoOp,
  projetaCliente,
  projetaUnidade,
  type Criticidade,
  type EventoCaixa,
  type Status,
  type VolatilidadeStats,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utc(2026, 5, 1); // sexta, W18

/* ─────────── Helpers ─────────── */

function vol(
  legal_entity_id: string,
  qualidade: 'alta' | 'insuficiente',
  cv: number,
): VolatilidadeStats {
  return {
    legal_entity_id,
    n_periodos: qualidade === 'alta' ? 12 : 5,
    media: 1000,
    desvio: cv * 1000,
    cv,
    qualidade,
    base_temporal: 'competencia',
    inferido_de: 'saidas_obrigatorias_critica_op_12m',
    n_amostras: 100,
    confianca_inferencia: qualidade === 'alta' ? 'alta' : 'baixa',
  };
}

interface SaidaArgs {
  id: string;
  cliente_id?: string;
  legal_entity_id?: string;
  status: Extract<Status, 'confirmado' | 'estimado' | 'realizado' | 'pendente'>;
  criticidade: Criticidade;
  valor: number;
  data: Date;
  is_transferencia?: boolean;
  transferencia_par_id?: string;
}

function saida(args: SaidaArgs): EventoCaixa {
  const base: Parameters<typeof mkEvento>[0] = {
    id: args.id,
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id ?? 'u1',
    status: args.status,
    origem: args.status === 'estimado' ? 'historico' : 'fkn',
    direcao: 'saida',
    valor: args.valor,
    criticidade: args.criticidade,
    data_esperada: args.data,
  };
  if (args.status === 'realizado') base.data_realizada = args.data;
  if (args.status === 'confirmado') base.data_vencimento = args.data;
  if (args.is_transferencia !== undefined) base.is_transferencia = args.is_transferencia;
  if (args.transferencia_par_id !== undefined)
    base.transferencia_par_id = args.transferencia_par_id;
  return mkEvento(base);
}

function projecaoComMinimo(
  eventos: EventoCaixa[],
  legal_entity_ids_ativas: string[] = ['u1'],
  volatilidades?: ReadonlyMap<string, VolatilidadeStats>,
) {
  const opts: Parameters<typeof projetaCliente>[0] = {
    eventos,
    saldos: [],
    cliente_id: 'c1',
    legal_entity_ids_ativas,
    geradoEm: GERADO_EM,
    calendar,
  };
  if (volatilidades !== undefined) opts.volatilidades = volatilidades;
  return projetaCliente(opts);
}

/* ─────────── Filtro de elegibilidade (critério 2) ─────────── */

describe('calculaCaixaMinimoOp — filtro de elegibilidade', () => {
  it('confirmado/saida/obrigatoria conta', () => {
    // Evento na semana 5 (W22), conta para mínimo das semanas 3 (W20) e 4 (W21).
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 25), // W22 (Mon)
    });
    const r = projecaoComMinimo([ev]);
    const u = r.unidades[0]!;
    // semanas[3] (W21) e semanas[2] (W20) devem ver o evento (n+1=4, n+2=5).
    expect(u.semanas[3]!.caixa_minimo_op_provenance.eventos_considerados_ids).toContain('e');
    expect(u.semanas[2]!.caixa_minimo_op_provenance.eventos_considerados_ids).toContain('e');
  });

  it('confirmado/saida/negociavel NÃO conta', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'negociavel',
      valor: 1000,
      data: utc(2026, 5, 25),
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[2]!.caixa_minimo_op).toBe(0);
    expect(r.unidades[0]!.semanas[3]!.caixa_minimo_op).toBe(0);
  });

  it('estimado/saida/critica_op conta', () => {
    const ev = saida({
      id: 'e',
      status: 'estimado',
      criticidade: 'critica_op',
      valor: 500,
      data: utc(2026, 5, 25),
    });
    const r = projecaoComMinimo([ev]);
    const u = r.unidades[0]!;
    expect(u.semanas[3]!.caixa_minimo_op_provenance.base_pre_margem).toBe(500);
  });

  it('realizado/saida/obrigatoria NÃO conta (fato consumado)', () => {
    const ev = saida({
      id: 'e',
      status: 'realizado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 25),
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[2]!.caixa_minimo_op).toBe(0);
  });

  it('confirmado/entrada NÃO conta', () => {
    const ev = mkEvento({
      id: 'e',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      valor: 1000,
      criticidade: 'obrigatoria',
      data_vencimento: utc(2026, 5, 25),
      data_esperada: utc(2026, 5, 25),
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[2]!.caixa_minimo_op).toBe(0);
  });

  it('pendente/saida/pendente NÃO conta (ambas as dimensões fora)', () => {
    const ev = saida({
      id: 'e',
      status: 'pendente',
      criticidade: 'pendente',
      valor: 1000,
      data: utc(2026, 5, 25),
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[2]!.caixa_minimo_op).toBe(0);
  });

  it('confirmado/saida/critica_op/is_transferencia=true NÃO conta (transferência fora)', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'critica_op',
      valor: 1000,
      data: utc(2026, 5, 25),
      is_transferencia: true,
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[2]!.caixa_minimo_op).toBe(0);
  });
});

/* ─────────── Horizonte H=2 (critério 3) ─────────── */

describe('calculaCaixaMinimoOp — horizonte H=2', () => {
  it('mínimo da semana 1 (W18) considera eventos de W19 e W20', () => {
    const evW19 = saida({
      id: 'w19',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 100,
      data: utc(2026, 5, 5), // W19
    });
    const evW20 = saida({
      id: 'w20',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 200,
      data: utc(2026, 5, 12), // W20
    });
    const r = projecaoComMinimo([evW19, evW20]);
    const u = r.unidades[0]!;
    // W18 (idx 0) olha W19 e W20.
    expect(u.semanas[0]!.caixa_minimo_op_provenance.base_pre_margem).toBe(300);
    expect(u.semanas[0]!.caixa_minimo_op_provenance.eventos_considerados_ids).toEqual([
      'w19',
      'w20',
    ]);
  });

  it('mínimo da semana 5 (W22) considera eventos de W23 e W24', () => {
    const evW23 = saida({
      id: 'w23',
      status: 'confirmado',
      criticidade: 'critica_op',
      valor: 50,
      data: utc(2026, 6, 1), // W23
    });
    const evW24 = saida({
      id: 'w24',
      status: 'estimado',
      criticidade: 'obrigatoria',
      valor: 70,
      data: utc(2026, 6, 8), // W24
    });
    const r = projecaoComMinimo([evW23, evW24]);
    // W22 = idx 4.
    expect(
      r.unidades[0]!.semanas[4]!.caixa_minimo_op_provenance.base_pre_margem,
    ).toBe(120);
  });

  it('evento de W19 não conta para mínimo de W19, W20, W21 (fora do horizonte n+1/n+2)', () => {
    // W19 só conta para W17 (não na janela) e W18 (idx 0).
    const ev = saida({
      id: 'w19',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 5), // W19
    });
    const r = projecaoComMinimo([ev]);
    const u = r.unidades[0]!;
    expect(
      u.semanas[1]!.caixa_minimo_op_provenance.eventos_considerados_ids,
    ).not.toContain('w19'); // W19 não conta pra mínimo de si mesmo
    expect(
      u.semanas[0]!.caixa_minimo_op_provenance.eventos_considerados_ids,
    ).toContain('w19'); // W18 olha pra W19 ✓
  });
});

/* ─────────── Margem (critérios 4-6) ─────────── */

describe('calculaCaixaMinimoOp — margem com volatilidade alta', () => {
  it('cv=0.15 → margem=15%, origem=volatilidade_alta', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12), // W20 → conta para W18, W19
    });
    const volMap = new Map([['u1', vol('u1', 'alta', 0.15)]]);
    const r = projecaoComMinimo([ev], ['u1'], volMap);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op_provenance.margem_aplicada).toBe(0.15);
    expect(w18.caixa_minimo_op_provenance.margem_origem).toBe('volatilidade_alta');
    expect(w18.caixa_minimo_op_provenance.volatilidade_cv).toBe(0.15);
    // 1000 × 1.15 = 1150
    expect(w18.caixa_minimo_op).toBeCloseTo(1150, 6);
  });

  it('cv=0.30 → margem=25% (teto duro)', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const volMap = new Map([['u1', vol('u1', 'alta', 0.3)]]);
    const r = projecaoComMinimo([ev], ['u1'], volMap);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op_provenance.margem_aplicada).toBe(0.25);
    expect(w18.caixa_minimo_op_provenance.volatilidade_cv).toBe(0.3); // CV original preservado
    expect(w18.caixa_minimo_op).toBeCloseTo(1250, 6);
  });

  it('cv=0.05 → margem=5%', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const volMap = new Map([['u1', vol('u1', 'alta', 0.05)]]);
    const r = projecaoComMinimo([ev], ['u1'], volMap);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op_provenance.margem_aplicada).toBe(0.05);
    expect(w18.caixa_minimo_op).toBeCloseTo(1050, 6);
  });
});

describe('calculaCaixaMinimoOp — margem fallback', () => {
  it('qualidade=insuficiente → margem=10%', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const volMap = new Map([['u1', vol('u1', 'insuficiente', 0.5)]]);
    const r = projecaoComMinimo([ev], ['u1'], volMap);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op_provenance.margem_aplicada).toBe(0.1);
    expect(w18.caixa_minimo_op_provenance.margem_origem).toBe('fallback_10pct');
    expect(w18.caixa_minimo_op_provenance.volatilidade_cv).toBeUndefined();
    expect(w18.caixa_minimo_op).toBeCloseTo(1100, 6);
  });

  it('unidade sem entrada na Map → fallback 10%', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const volMap = new Map<string, VolatilidadeStats>([
      ['u_outra', vol('u_outra', 'alta', 0.05)],
    ]);
    const r = projecaoComMinimo([ev], ['u1'], volMap);
    expect(r.unidades[0]!.semanas[0]!.caixa_minimo_op_provenance.margem_origem).toBe(
      'fallback_10pct',
    );
  });

  it('volatilidades parameter ausente → todas unidades fallback 10%', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const r = projecaoComMinimo([ev], ['u1']);
    expect(r.unidades[0]!.semanas[0]!.caixa_minimo_op_provenance.margem_origem).toBe(
      'fallback_10pct',
    );
    expect(r.unidades[0]!.semanas[0]!.caixa_minimo_op).toBeCloseTo(1100, 6);
  });
});

describe('calculaCaixaMinimoOp — cálculo correto (critério 6)', () => {
  it('base R$ 100.000 + margem 10% → mínimo R$ 110.000', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 100_000,
      data: utc(2026, 5, 12),
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.semanas[0]!.caixa_minimo_op).toBeCloseTo(110_000, 6);
  });
});

/* ─────────── Consolidado (critério 7) ─────────── */

describe('calculaCaixaMinimoOp — consolidado é soma das unidades', () => {
  it('U1 mínimo W18 = 50k, U2 mínimo W18 = 30k → consolidado = 80k', () => {
    const evU1 = saida({
      id: 'u1-ev',
      legal_entity_id: 'u1',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 50_000 / 1.1, // base que dá 50k com fallback 10%
      data: utc(2026, 5, 12),
    });
    const evU2 = saida({
      id: 'u2-ev',
      legal_entity_id: 'u2',
      status: 'confirmado',
      criticidade: 'critica_op',
      valor: 30_000 / 1.1,
      data: utc(2026, 5, 12),
    });
    const r = projecaoComMinimo([evU1, evU2], ['u1', 'u2']);
    const u1Min = r.unidades.find((u) => u.legal_entity_id === 'u1')!.semanas[0]!
      .caixa_minimo_op;
    const u2Min = r.unidades.find((u) => u.legal_entity_id === 'u2')!.semanas[0]!
      .caixa_minimo_op;
    expect(u1Min).toBeCloseTo(50_000, 6);
    expect(u2Min).toBeCloseTo(30_000, 6);
    expect(r.consolidado.semanas[0]!.caixa_minimo_op).toBeCloseTo(80_000, 6);
  });

  it('cada unidade tem seu CV próprio; consolidado preserva por_unidade', () => {
    const evU1 = saida({
      id: 'eU1',
      legal_entity_id: 'u1',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const evU2 = saida({
      id: 'eU2',
      legal_entity_id: 'u2',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 2000,
      data: utc(2026, 5, 12),
    });
    const volMap = new Map([
      ['u1', vol('u1', 'alta', 0.2)],
      ['u2', vol('u2', 'insuficiente', 0)],
    ]);
    const r = projecaoComMinimo([evU1, evU2], ['u1', 'u2'], volMap);

    const consolW18 = r.consolidado.semanas[0]!;
    expect(consolW18.caixa_minimo_op_provenance.margem_origem).toBe(
      'agregado_por_unidade',
    );
    const u1Detail = consolW18.caixa_minimo_op_provenance.por_unidade!.get('u1')!;
    const u2Detail = consolW18.caixa_minimo_op_provenance.por_unidade!.get('u2')!;
    expect(u1Detail.margem_origem).toBe('volatilidade_alta');
    expect(u1Detail.margem_aplicada).toBe(0.2);
    expect(u2Detail.margem_origem).toBe('fallback_10pct');
    expect(u2Detail.margem_aplicada).toBe(0.1);

    // Sanity: consolidado = u1 (1000*1.2) + u2 (2000*1.1) = 1200 + 2200 = 3400.
    expect(consolW18.caixa_minimo_op).toBeCloseTo(3400, 6);
    expect(consolW18.caixa_minimo_op_provenance.base_pre_margem).toBe(3000);
    // Margem efetiva agregada: (3400 - 3000) / 3000 ≈ 0.1333.
    expect(consolW18.caixa_minimo_op_provenance.margem_aplicada).toBeCloseTo(
      400 / 3000,
      6,
    );
  });
});

/* ─────────── Provenance (critério 8) ─────────── */

describe('calculaCaixaMinimoOp — provenance completa', () => {
  it('eventos_considerados_ids lista os ids elegíveis ordenados', () => {
    const ev1 = saida({
      id: 'z',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 100,
      data: utc(2026, 5, 12),
    });
    const ev2 = saida({
      id: 'a',
      status: 'estimado',
      criticidade: 'critica_op',
      valor: 200,
      data: utc(2026, 5, 12),
    });
    const r = projecaoComMinimo([ev1, ev2]);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op_provenance.eventos_considerados_ids).toEqual([
      'a',
      'z',
    ]);
    expect(w18.caixa_minimo_op_provenance.base_pre_margem).toBe(300);
  });

  it('semana sem eventos elegíveis: base=0, mínimo=0, eventos_considerados_ids=[]', () => {
    const r = projecaoComMinimo([], ['u1']);
    const w18 = r.unidades[0]!.semanas[0]!;
    expect(w18.caixa_minimo_op).toBe(0);
    expect(w18.caixa_minimo_op_provenance.base_pre_margem).toBe(0);
    expect(w18.caixa_minimo_op_provenance.eventos_considerados_ids).toEqual([]);
    expect(w18.caixa_minimo_op_provenance.margem_origem).toBe('fallback_10pct');
  });
});

/* ─────────── Limitação semanas 12-13 (critério 9) ─────────── */

describe('calculaCaixaMinimoOp — limitação semanas 12-13', () => {
  it('evento na semana 14 (fora da janela) NÃO entra no mínimo da semana 12', () => {
    // W30 (idx 12) é a última. n+1 = W31, n+2 = W32 — não na janela.
    // Evento alocado em W31 (fora da janela) não é alocado pelo 4.1,
    // então não tem allocationDate → não aparece em minimo de nenhuma semana.
    const ev = saida({
      id: 'fora',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 5000,
      data: utc(2026, 8, 5), // bem além de W30 (W30 termina em 2026-07-26)
    });
    const r = projecaoComMinimo([ev]);
    expect(r.unidades[0]!.eventosForaDaJanela).toContain('fora');
    expect(r.unidades[0]!.semanas[12]!.caixa_minimo_op).toBe(0);
    // E não entra em outras semanas tampouco.
    for (const sem of r.unidades[0]!.semanas) {
      expect(sem.caixa_minimo_op_provenance.eventos_considerados_ids).not.toContain(
        'fora',
      );
    }
  });
});

/* ─────────── Imutabilidade (critério 10) ─────────── */

describe('calculaCaixaMinimoOp — imutabilidade', () => {
  it('input eventos não é mutado', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const eventos = [ev];
    const before = JSON.stringify(eventos);
    projecaoComMinimo(eventos);
    expect(JSON.stringify(eventos)).toBe(before);
  });

  it('chamar calculaCaixaMinimoOp diretamente não muta input.unidades', () => {
    const u1 = projetaUnidade({
      eventos: [
        saida({
          id: 'e',
          status: 'confirmado',
          criticidade: 'obrigatoria',
          valor: 1000,
          data: utc(2026, 5, 12),
        }),
      ],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    // Snapshot direto dos valores que devem permanecer os defaults
    // produzidos por projetaUnidade (caixa_minimo_op=0, fallback).
    const semanasOriginal = u1.semanas.map((s) => ({
      caixa_minimo_op: s.caixa_minimo_op,
      base: s.caixa_minimo_op_provenance.base_pre_margem,
    }));

    const consolidado = {
      cliente_id: 'c1',
      legal_entity_ids: ['u1'],
      geradoEm: GERADO_EM,
      janela: u1.janela,
      caixaInicial: {
        valor: 0,
        por_unidade: new Map([['u1', u1.caixaInicial]]),
        alguma_stale: false,
        alguma_ausente: false,
      },
      semanas: u1.semanas,
      transferenciasNeutralizadas: [],
      estatisticas: {
        unidadesAtivas: 1,
        eventosTotalConsolidado: 1,
        transferenciasMarcadasEventos: 0,
        transferenciasParesAvaliados: 0,
        transferenciasNeutralizadasValidas: 0,
        transferenciasNeutralizadasInvalidas: 0,
      },
    };
    calculaCaixaMinimoOp({
      unidades: [u1],
      consolidado,
      eventosOriginais: [
        saida({
          id: 'e',
          status: 'confirmado',
          criticidade: 'obrigatoria',
          valor: 1000,
          data: utc(2026, 5, 12),
        }),
      ],
    });
    // u1 original permaneceu com defaults.
    for (let k = 0; k < u1.semanas.length; k++) {
      expect(u1.semanas[k]!.caixa_minimo_op).toBe(semanasOriginal[k]!.caixa_minimo_op);
      expect(u1.semanas[k]!.caixa_minimo_op_provenance.base_pre_margem).toBe(
        semanasOriginal[k]!.base,
      );
    }
  });
});

/* ─────────── Determinismo (critério 11) ─────────── */

describe('calculaCaixaMinimoOp — determinismo', () => {
  it('2 chamadas → deepEqual', () => {
    const eventos = [
      saida({
        id: 'a',
        status: 'confirmado',
        criticidade: 'obrigatoria',
        valor: 100,
        data: utc(2026, 5, 12),
      }),
      saida({
        id: 'b',
        status: 'estimado',
        criticidade: 'critica_op',
        valor: 200,
        data: utc(2026, 5, 19),
      }),
    ];
    const volMap = new Map([['u1', vol('u1', 'alta', 0.12)]]);
    const r1 = projecaoComMinimo(eventos, ['u1'], volMap);
    const r2 = projecaoComMinimo(eventos, ['u1'], volMap);
    expect(r2).toEqual(r1);
  });
});

/* ─────────── Stage 4 não compara (critério 12) ─────────── */

describe('calculaCaixaMinimoOp — Stage 4 não decide nada', () => {
  it('SemanaProjecao não tem campo de veredito/alerta/abaixo_do_minimo', () => {
    const r = projecaoComMinimo([
      saida({
        id: 'e',
        status: 'confirmado',
        criticidade: 'obrigatoria',
        valor: 999_999_999,
        data: utc(2026, 5, 12),
      }),
    ]);
    const w18 = r.unidades[0]!.semanas[0]! as unknown as Record<string, unknown>;
    expect(w18['abaixo_do_minimo']).toBeUndefined();
    expect(w18['alerta']).toBeUndefined();
    expect(w18['veredito']).toBeUndefined();
    expect(w18['status_caixa']).toBeUndefined();
  });
});

/* ─────────── Fail visibly: cv negativo ─────────── */

describe('calculaCaixaMinimoOp — fail visibly', () => {
  it('volatilidade com cv negativo → ProjecaoError', () => {
    const ev = saida({
      id: 'e',
      status: 'confirmado',
      criticidade: 'obrigatoria',
      valor: 1000,
      data: utc(2026, 5, 12),
    });
    const volRuim = new Map([['u1', vol('u1', 'alta', -0.05)]]);
    expect(() =>
      projecaoComMinimo([ev], ['u1'], volRuim),
    ).toThrow(ProjecaoError);
  });
});
