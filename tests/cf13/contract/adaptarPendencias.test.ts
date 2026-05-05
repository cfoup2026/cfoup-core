import { describe, expect, it } from 'vitest';
import { adaptarPendencias } from '../../../src/cf13/contract/index.js';
import type {
  AcaoCobertura,
  CoberturaResult as CoberturaResultInterna,
  ConfiancaResult as ConfiancaResultInterna,
  EventoCaixa,
  MotivoInsuficiencia,
  Pendencia as PendenciaInterna,
  PendenciaCritica,
  VereditoResult as VereditoResultInterna,
} from '../../../src/index.js';
import type { PendenciaCF13 } from '../../../src/cf13/contract/index.js';
import { mkConfiancaUnidade } from '../../veredito/fixtures.js';
import { mkEvento, utc } from '../../reconciliacao/fixtures/mkEvento.js';

/* Janela determinística — 13 entradas para casar com índice 1..13 das
 *  PendenciaCritica. Usamos a janela do mkUnidadeConf default
 *  (`semanasJanela(GERADO_EM=2026-05-01, 13)` = ['2026-W18'..'2026-W30']).
 *  Para os testes só precisamos das datas-início dos buckets. */
const JANELA_SEMANA_ISO = [
  '2026-W18',
  '2026-W19',
  '2026-W20',
  '2026-W21',
  '2026-W22',
  '2026-W23',
  '2026-W24',
  '2026-W25',
  '2026-W26',
  '2026-W27',
  '2026-W28',
  '2026-W29',
  '2026-W30',
];
/* Inícios correspondentes (segundas) — derivados manualmente:
 *  W18 = 27/abr; +7 = 04/mai; +7 = 11/mai; ... */
const JANELA_INICIOS = [
  '2026-04-27',
  '2026-05-04',
  '2026-05-11',
  '2026-05-18',
  '2026-05-25',
  '2026-06-01',
  '2026-06-08',
  '2026-06-15',
  '2026-06-22',
  '2026-06-29',
  '2026-07-06',
  '2026-07-13',
  '2026-07-20',
];

const EMPTY_COBERTURA: CoberturaResultInterna = {
  status: 'cobertura_completa',
  pendencias: [],
  motivosInsuficiencia: [],
  estatisticas: {
    pendenciasPorTipo: new Map(),
    pendenciasPorUnidade: new Map(),
    semanasComPendencia: 0,
    totalEventosPendentesClassificacao: 0,
    valorTotalPendentesClassificacao: 0,
    motivosInsuficienciaCount: 0,
  },
  detectadoEm: utc(2026, 5, 1),
};

const EMPTY_CONFIANCA: ConfiancaResultInterna = {
  por_unidade: [
    mkConfiancaUnidade({
      legal_entity_id: 'u1',
      confianca_projecao: 'media',
    }),
  ],
  consolidado: mkConfiancaUnidade({
    legal_entity_id: 'consolidado:c1',
    confianca_projecao: 'media',
  }),
  cobertura_aplicada: [{ legal_entity_id: 'u1', status: 'cobertura_completa' }],
};

const EMPTY_VEREDITO: VereditoResultInterna = {
  unidades: [],
  consolidado: {
    legal_entity_id: 'consolidado:c1',
    veredito: 'LIMPO',
    texto: 'x',
    detalhes: {},
  },
  banner_unidade_critica: null,
  erros_de_marcacao: [],
};

function pend(args: {
  id: string;
  tipo: PendenciaInterna['tipo'];
  legal_entity_id: string;
  semana_iso: string;
  acoes_sugeridas?: AcaoCobertura[];
  valor_total?: number;
  valor_esperado?: number;
}): PendenciaInterna {
  const p: PendenciaInterna = {
    id: args.id,
    tipo: args.tipo,
    legal_entity_id: args.legal_entity_id,
    semana_iso: args.semana_iso,
    descricao: `descricao ${args.id}`,
    acoes_sugeridas: args.acoes_sugeridas ?? ['confirmar_que_era_esperado'],
  };
  if (args.valor_total !== undefined) p.valor_total = args.valor_total;
  if (args.valor_esperado !== undefined) p.valor_esperado = args.valor_esperado;
  return p;
}

function motivo(args: {
  tipo: MotivoInsuficiencia['tipo'];
  legal_entity_id: string;
  acoes_sugeridas?: AcaoCobertura[];
}): MotivoInsuficiencia {
  return {
    tipo: args.tipo,
    legal_entity_id: args.legal_entity_id,
    descricao: `motivo ${args.tipo}`,
    acoes_sugeridas: args.acoes_sugeridas ?? ['confirmar_saldo'],
  };
}

function pCritica(args: {
  evento_id: string;
  legal_entity_id: string;
  semana: number;
  valor: number;
  motivo?: PendenciaCritica['motivo'];
}): PendenciaCritica {
  return {
    evento_id: args.evento_id,
    legal_entity_id: args.legal_entity_id,
    cliente_id: 'c1',
    semana: args.semana,
    valor: args.valor,
    direcao: 'saida',
    status: 'pendente',
    criticidade: 'pendente',
    bucket_id: 'pendente_classificacao',
    motivo: args.motivo ?? 'status_pendente',
    trigger_materialidade: 'limite_absoluto',
  };
}

function evt(id: string, legal_entity_id: string): EventoCaixa {
  return mkEvento({
    id,
    cliente_id: 'c1',
    legal_entity_id,
    status: 'pendente',
    origem: 'fkn',
    direcao: 'saida',
    valor: 5000,
    data_esperada: utc(2026, 5, 5),
  });
}

/* ─────────── Mapeamento de origem/severidade por tipo ─────────── */

describe('adaptarPendencias — Pendencia de cobertura com status com_confianca_reduzida', () => {
  it('semana_zerada → confianca/media (status reduzida)', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_com_confianca_reduzida',
      pendencias: [
        pend({
          id: 'p1',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W18',
        }),
      ],
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.origem).toBe('confianca');
    expect(r[0]!.severidade).toBe('media');
    expect(r[0]!.semanaId).toBe('2026-04-27');
  });

  it('recorrencia_ausente → confianca/media (status reduzida)', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_com_confianca_reduzida',
      pendencias: [
        pend({
          id: 'p2',
          tipo: 'recorrencia_ausente',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
          valor_esperado: 1000,
        }),
      ],
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r[0]!.origem).toBe('confianca');
    expect(r[0]!.severidade).toBe('media');
    expect(r[0]!.valorImpacto).toBe(1000);
  });

  it('pendentes_classificacao_agregados → confianca/baixa (status reduzida)', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_com_confianca_reduzida',
      pendencias: [
        pend({
          id: 'p3',
          tipo: 'pendentes_classificacao_agregados',
          legal_entity_id: 'u1',
          semana_iso: '2026-W20',
          valor_total: 7500,
        }),
      ],
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r[0]!.origem).toBe('confianca');
    expect(r[0]!.severidade).toBe('baixa');
    expect(r[0]!.valorImpacto).toBe(7500);
  });
});

describe('adaptarPendencias — Pendencia de cobertura com status insuficiente', () => {
  it('semana_zerada coexistente com motivo → origem cobertura/media', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_insuficiente',
      motivosInsuficiencia: [
        motivo({ tipo: 'saldo_abertura_ausente', legal_entity_id: 'u1' }),
      ],
      pendencias: [
        pend({
          id: 'p_co_existe',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W18',
        }),
      ],
      estatisticas: {
        ...EMPTY_COBERTURA.estatisticas,
        motivosInsuficienciaCount: 1,
      },
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    /* 1 motivo + 1 pendência. Pendência herda `'cobertura'` por estar
     *  sob status insuficiente (e não 'reduzida'). */
    expect(r).toHaveLength(2);
    const pendSemanaZerada = r.find((p) => p.id === 'cob:pend:p_co_existe');
    expect(pendSemanaZerada?.origem).toBe('cobertura');
  });

  it('motivo + pendência: ambas com origem cobertura', () => {
    /* Caso forte do §2: status insuficiente promove tudo a `'cobertura'`. */
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_insuficiente',
      motivosInsuficiencia: [
        motivo({ tipo: 'banco_sem_dado_recente', legal_entity_id: 'u1' }),
      ],
      pendencias: [
        pend({
          id: 'p_extra',
          tipo: 'recorrencia_ausente',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
        }),
      ],
      estatisticas: {
        ...EMPTY_COBERTURA.estatisticas,
        motivosInsuficienciaCount: 1,
      },
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r.every((p) => p.origem === 'cobertura')).toBe(true);
  });
});

describe('adaptarPendencias — MotivoInsuficiencia', () => {
  it('saldo_abertura_ausente → cobertura/critica, sem semanaId', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_insuficiente',
      motivosInsuficiencia: [
        motivo({ tipo: 'saldo_abertura_ausente', legal_entity_id: 'u1' }),
      ],
      estatisticas: {
        ...EMPTY_COBERTURA.estatisticas,
        motivosInsuficienciaCount: 1,
      },
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r[0]!.origem).toBe('cobertura');
    expect(r[0]!.severidade).toBe('critica');
    expect(r[0]!.semanaId).toBeUndefined();
    expect(r[0]!.unidadeId).toBe('u1');
  });
});

describe('adaptarPendencias — PendenciaCritica (Stage 6)', () => {
  it('só consolidado (sem versão de unidade) → permanece, unidadeId via lookup do evento', () => {
    const ev1 = evt('ev_x', 'u_real');
    const eventoIndex = new Map<string, EventoCaixa>([[ev1.id, ev1]]);

    const confianca: ConfiancaResultInterna = {
      por_unidade: [],
      consolidado: {
        legal_entity_id: 'consolidado:c1',
        semanas: EMPTY_CONFIANCA.consolidado.semanas,
        confianca_projecao: 'baixa',
        pendencias_criticas: [
          pCritica({
            evento_id: 'ev_x',
            legal_entity_id: 'consolidado:c1',
            semana: 3,
            valor: 9000,
          }),
        ],
      },
      cobertura_aplicada: [],
    };

    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.origem).toBe('confianca');
    expect(r[0]!.severidade).toBe('critica');
    /* unidadeId derivado do evento real, não do escopo do consolidado. */
    expect(r[0]!.unidadeId).toBe('u_real');
    /* semanaId vem da janela: índice 3 → janelaInicios[2]. */
    expect(r[0]!.semanaId).toBe('2026-05-11');
    expect(r[0]!.valorImpacto).toBe(9000);
  });

  it('dedup §3: consolidado + unidade no mesmo evento_id → unidade vence', () => {
    const ev1 = evt('ev_dup', 'u1');
    const eventoIndex = new Map<string, EventoCaixa>([[ev1.id, ev1]]);

    const confianca: ConfiancaResultInterna = {
      por_unidade: [
        {
          legal_entity_id: 'u1',
          semanas: EMPTY_CONFIANCA.consolidado.semanas,
          confianca_projecao: 'baixa',
          pendencias_criticas: [
            pCritica({
              evento_id: 'ev_dup',
              legal_entity_id: 'u1',
              semana: 5,
              valor: 5000,
            }),
          ],
        },
      ],
      consolidado: {
        legal_entity_id: 'consolidado:c1',
        semanas: EMPTY_CONFIANCA.consolidado.semanas,
        confianca_projecao: 'baixa',
        pendencias_criticas: [
          pCritica({
            evento_id: 'ev_dup',
            legal_entity_id: 'consolidado:c1',
            semana: 5,
            valor: 5000,
          }),
        ],
      },
      cobertura_aplicada: [],
    };

    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex,
    });
    /* Apenas 1 pendência (dedup); a sobrevivente é a de unidade. */
    expect(r).toHaveLength(1);
    expect(r[0]!.unidadeId).toBe('u1');
    /* ID da unidade contém o legal_entity_id da unidade ('u1'),
     *  diferenciando da versão consolidada (que teria
     *  'consolidado:c1' no id). */
    expect(r[0]!.id).toContain(':u1:');
    expect(r[0]!.id).not.toContain('consolidado:');
  });

  it('dedup §3: múltiplas unidades para o mesmo evento_id → todas preservadas', () => {
    /* Caso esperado em transferência interna: o mesmo evento_id pode
     *  aparecer em u1 (saída) e u2 (entrada), ou ser referenciado por
     *  ambas em casos degenerados. Todas as versões de unidade ficam. */
    const ev1 = evt('ev_transf', 'u1');
    const eventoIndex = new Map<string, EventoCaixa>([[ev1.id, ev1]]);

    const confianca: ConfiancaResultInterna = {
      por_unidade: [
        {
          legal_entity_id: 'u1',
          semanas: EMPTY_CONFIANCA.consolidado.semanas,
          confianca_projecao: 'baixa',
          pendencias_criticas: [
            pCritica({
              evento_id: 'ev_transf',
              legal_entity_id: 'u1',
              semana: 4,
              valor: 7000,
            }),
          ],
        },
        {
          legal_entity_id: 'u2',
          semanas: EMPTY_CONFIANCA.consolidado.semanas,
          confianca_projecao: 'baixa',
          pendencias_criticas: [
            pCritica({
              evento_id: 'ev_transf',
              legal_entity_id: 'u2',
              semana: 4,
              valor: 7000,
            }),
          ],
        },
      ],
      consolidado: {
        legal_entity_id: 'consolidado:c1',
        semanas: EMPTY_CONFIANCA.consolidado.semanas,
        confianca_projecao: 'baixa',
        pendencias_criticas: [],
      },
      cobertura_aplicada: [],
    };

    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex,
    });
    /* Ambas unidades preservadas — IDs distintos por escopo. */
    expect(r).toHaveLength(2);
    expect(r.map((p) => p.id).sort()).toEqual([
      'conf:critica:u1:ev_transf:s4',
      'conf:critica:u2:ev_transf:s4',
    ]);
  });

  it('pendência só na unidade (não no consolidado) é emitida', () => {
    const ev1 = evt('ev_solo_u', 'u1');
    const eventoIndex = new Map<string, EventoCaixa>([[ev1.id, ev1]]);

    const confianca: ConfiancaResultInterna = {
      por_unidade: [
        {
          legal_entity_id: 'u1',
          semanas: EMPTY_CONFIANCA.consolidado.semanas,
          confianca_projecao: 'baixa',
          pendencias_criticas: [
            pCritica({
              evento_id: 'ev_solo_u',
              legal_entity_id: 'u1',
              semana: 1,
              valor: 6000,
            }),
          ],
        },
      ],
      consolidado: {
        legal_entity_id: 'consolidado:c1',
        semanas: EMPTY_CONFIANCA.consolidado.semanas,
        confianca_projecao: 'media',
        pendencias_criticas: [],
      },
      cobertura_aplicada: [],
    };
    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.unidadeId).toBe('u1');
  });

  it('dedup §3 inverso: pendência só consolidado + outra só unidade (eventos distintos) → ambas saem', () => {
    const evA = evt('ev_a', 'u1');
    const evB = evt('ev_b', 'u2');
    const eventoIndex = new Map<string, EventoCaixa>([
      [evA.id, evA],
      [evB.id, evB],
    ]);

    const confianca: ConfiancaResultInterna = {
      por_unidade: [
        {
          legal_entity_id: 'u1',
          semanas: EMPTY_CONFIANCA.consolidado.semanas,
          confianca_projecao: 'baixa',
          pendencias_criticas: [
            pCritica({
              evento_id: 'ev_a',
              legal_entity_id: 'u1',
              semana: 2,
              valor: 5000,
            }),
          ],
        },
      ],
      consolidado: {
        legal_entity_id: 'consolidado:c1',
        semanas: EMPTY_CONFIANCA.consolidado.semanas,
        confianca_projecao: 'baixa',
        pendencias_criticas: [
          pCritica({
            evento_id: 'ev_b', // só no consolidado
            legal_entity_id: 'consolidado:c1',
            semana: 6,
            valor: 8000,
          }),
        ],
      },
      cobertura_aplicada: [],
    };
    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex,
    });
    expect(r).toHaveLength(2);
    /* Versão de unidade preserva u1; versão consolidado puxa u2 do
     *  lookup do evento. */
    const ids = r.map((p) => p.id);
    expect(ids).toContain('conf:critica:u1:ev_a:s2');
    expect(ids).toContain('conf:critica:consolidado:c1:ev_b:s6');
  });
});

describe('adaptarPendencias — ErroDeMarcacao (Stage 7)', () => {
  it('emite com origem confianca + severidade media (§1)', () => {
    /* §1: erro de marcação é problema de qualidade do dado, não veredito.
     *  `'veredito'` no contrato fica reservado para pendências derivadas
     *  de ALERTA/CRITICO emitidas pelo Stage 7 — fora do escopo v0. */
    const veredito: VereditoResultInterna = {
      ...EMPTY_VEREDITO,
      erros_de_marcacao: [
        {
          tipo: 'consolidado_pior_que_unidades',
          legal_entity_ids: ['u1', 'u2'],
          cliente_id: 'c1',
        },
      ],
    };
    const r = adaptarPendencias({
      cobertura: EMPTY_COBERTURA,
      confianca: EMPTY_CONFIANCA,
      veredito,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.origem).toBe('confianca');
    expect(r[0]!.severidade).toBe('media');
    expect(r[0]!.semanaId).toBeUndefined();
    /* ID prefixado `conf:erro:` (não mais `ver:erro:`). */
    expect(r[0]!.id).toMatch(/^conf:erro:/);
  });
});

describe('adaptarPendencias — acaoSugerida singular', () => {
  it('acoes_sugeridas: [a, b, c] → acaoSugerida = a (primeira)', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_com_confianca_reduzida',
      pendencias: [
        pend({
          id: 'p_acao',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W18',
          acoes_sugeridas: [
            'confirmar_que_era_esperado',
            'adicionar_evento_manual',
            'verificar_recorrencia',
          ],
        }),
      ],
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    expect(r[0]!.acaoSugerida?.id).toBe('confirmar_que_era_esperado');
  });
});

describe('adaptarPendencias — ordenação determinística', () => {
  it('severidade desc → semanaId asc → id asc', () => {
    const cobertura: CoberturaResultInterna = {
      ...EMPTY_COBERTURA,
      status: 'cobertura_insuficiente',
      motivosInsuficiencia: [
        /* severidade crítica, sem semanaId. */
        motivo({ tipo: 'saldo_abertura_ausente', legal_entity_id: 'u1' }),
      ],
      pendencias: [
        /* severidade média, semana 1. */
        pend({
          id: 'a',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
        }),
        /* severidade média, semana 0 (W18). */
        pend({
          id: 'b',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W18',
        }),
        /* severidade baixa. */
        pend({
          id: 'c',
          tipo: 'pendentes_classificacao_agregados',
          legal_entity_id: 'u1',
          semana_iso: '2026-W18',
        }),
      ],
      estatisticas: {
        ...EMPTY_COBERTURA.estatisticas,
        motivosInsuficienciaCount: 1,
      },
    };
    const r = adaptarPendencias({
      cobertura,
      confianca: EMPTY_CONFIANCA,
      veredito: EMPTY_VEREDITO,
      janelaSemanaIso: JANELA_SEMANA_ISO,
      janelaInicios: JANELA_INICIOS,
      eventoIndex: new Map(),
    });
    /* Esperado: crítica (motivo saldo) → média W18 (id 'b') → média W19
     *  (id 'a') → baixa (id 'c'). */
    expect(r.map((p: PendenciaCF13) => p.severidade)).toEqual([
      'critica',
      'media',
      'media',
      'baixa',
    ]);
    /* Dentro da severidade média, ordem por semanaId asc. */
    expect(r[1]!.id).toContain(':b');
    expect(r[2]!.id).toContain(':a');
  });
});
