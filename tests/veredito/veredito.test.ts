import { describe, expect, it } from 'vitest';
import {
  calcularVeredito,
  type CoberturaResult,
  type ProjecaoCliente,
  type ConfiancaResult,
} from '../../src/index.js';
import {
  mkCobertura,
  mkConfianca,
  mkConfiancaUnidade,
  mkProjecaoConf,
  mkUnidadeConf,
  unidadeComSaldos,
  comSaldosNaSemana,
} from './fixtures.js';

/* ─── Cenários básicos: cada veredito ─── */

describe('calcularVeredito — DADOS_INSUFICIENTES vence', () => {
  it('cobertura insuficiente em uma unidade → DADOS_INSUFICIENTES, mesmo com projeção limpa', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })],
    });
    const cobertura = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u1',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
    });
    const confianca = mkConfianca({
      por_unidade: [
        mkConfiancaUnidade({
          legal_entity_id: 'u1',
          confianca_projecao: 'alta',
        }),
      ],
      consolidado: mkConfiancaUnidade({
        legal_entity_id: 'consolidado:c1',
        confianca_projecao: 'alta',
      }),
    });
    const r = calcularVeredito({ projecao, cobertura, confianca });
    expect(r.unidades[0]!.veredito).toBe('DADOS_INSUFICIENTES');
    expect(r.unidades[0]!.texto).toBe(
      'Dados insuficientes para calcular o veredito com segurança.',
    );
    expect(r.unidades[0]!.detalhes).toEqual({});
    /* Consolidado também é insuficiente (deriva). */
    expect(r.consolidado.veredito).toBe('DADOS_INSUFICIENTES');
  });
});

describe('calcularVeredito — cenários básicos', () => {
  it('CRITICO em unidade isolada', () => {
    const projecao = mkProjecaoConf({
      unidades: [
        unidadeComSaldos(
          mkUnidadeConf({ legal_entity_id: 'u1' }),
          new Map([[4, { caixa_final: -2000, caixa_minimo_op: 0 }]]),
        ),
      ],
    });
    const r = calcularVeredito({
      projecao,
      cobertura: mkCobertura(),
      confianca: mkConfianca({
        por_unidade: [
          mkConfiancaUnidade({
            legal_entity_id: 'u1',
            confianca_projecao: 'alta',
          }),
        ],
        consolidado: mkConfiancaUnidade({
          legal_entity_id: 'consolidado:c1',
          confianca_projecao: 'alta',
        }),
      }),
    });
    expect(r.unidades[0]!.veredito).toBe('CRITICO');
    expect(r.unidades[0]!.detalhes.semana_critica).toBe(5);
    expect(r.unidades[0]!.detalhes.valor_falta).toBe(2000);
    expect(r.unidades[0]!.texto).toContain('semana 5');
    expect(r.unidades[0]!.texto).toContain('R$ 2.000,00');
  });

  it('LIMPO em todas + nenhum erro de marcação', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })],
    });
    const r = calcularVeredito({
      projecao,
      cobertura: mkCobertura(),
      confianca: mkConfianca({
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
      }),
    });
    expect(r.unidades[0]!.veredito).toBe('LIMPO');
    expect(r.consolidado.veredito).toBe('LIMPO');
    expect(r.banner_unidade_critica).toBeNull();
    expect(r.erros_de_marcacao).toEqual([]);
  });

  it('ATENCAO quando confianca baixa + saldos OK', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })],
    });
    const r = calcularVeredito({
      projecao,
      cobertura: mkCobertura(),
      confianca: mkConfianca({
        por_unidade: [
          mkConfiancaUnidade({
            legal_entity_id: 'u1',
            confianca_projecao: 'baixa',
            pendencias_criticas: [
              {
                evento_id: 'p1',
                legal_entity_id: 'u1',
                cliente_id: 'c1',
                semana: 5,
                valor: 5000,
                direcao: 'saida',
                status: 'pendente',
                criticidade: 'pendente',
                bucket_id: 'pendente_classificacao',
                motivo: 'status_pendente',
                trigger_materialidade: 'limite_absoluto',
              },
            ],
          }),
        ],
        consolidado: mkConfiancaUnidade({
          legal_entity_id: 'consolidado:c1',
          confianca_projecao: 'baixa',
          pendencias_criticas: [],
        }),
      }),
    });
    expect(r.unidades[0]!.veredito).toBe('ATENCAO');
    expect(r.unidades[0]!.detalhes.pendencias_relevantes).toBe(1);
  });
});

/* ─── Multiunidade ─── */

describe('calcularVeredito — multiunidade + banner', () => {
  it('consolidado LIMPO + 1 unidade ALERTA → banner ativo', () => {
    const projecao = mkProjecaoConf({
      unidades: [
        unidadeComSaldos(
          mkUnidadeConf({ legal_entity_id: 'u_alerta' }),
          new Map([[4, { caixa_final: 100, caixa_minimo_op: 5000 }]]),
        ),
        mkUnidadeConf({ legal_entity_id: 'u_limpa' }),
      ],
    });
    const r = calcularVeredito({
      projecao,
      cobertura: mkCobertura(),
      confianca: mkConfianca({
        por_unidade: [
          mkConfiancaUnidade({
            legal_entity_id: 'u_alerta',
            confianca_projecao: 'alta',
          }),
          mkConfiancaUnidade({
            legal_entity_id: 'u_limpa',
            confianca_projecao: 'alta',
          }),
        ],
        consolidado: mkConfiancaUnidade({
          legal_entity_id: 'consolidado:c1',
          confianca_projecao: 'alta',
        }),
      }),
    });
    expect(r.unidades.find((u) => u.legal_entity_id === 'u_alerta')!.veredito)
      .toBe('ALERTA');
    expect(r.unidades.find((u) => u.legal_entity_id === 'u_limpa')!.veredito)
      .toBe('LIMPO');
    expect(r.consolidado.veredito).toBe('LIMPO');
    expect(r.banner_unidade_critica).not.toBeNull();
    expect(r.banner_unidade_critica!.texto).toBe('1 unidade em risco');
    expect(r.banner_unidade_critica!.unidades_em_risco).toEqual(['u_alerta']);
    expect(r.erros_de_marcacao).toEqual([]);
  });

  it('consolidado pior que unidades → erros_de_marcacao emitido', () => {
    /* Forçamos consolidado CRITICO (caixa_final negativo no consolidado)
     *  mas unidades LIMPAS. Em fluxo real isso é sintoma de transferência
     *  mal marcada. */
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({ legal_entity_id: 'u1' }),
        mkUnidadeConf({ legal_entity_id: 'u2' }),
      ],
    });
    /* Sobrescreve só o consolidado pra ficar CRITICO. */
    const projecaoMod: ProjecaoCliente = {
      ...projecao,
      consolidado: comSaldosNaSemana(
        projecao.consolidado,
        new Map([[3, { caixa_final: -10000, caixa_minimo_op: 0 }]]),
      ) as typeof projecao.consolidado,
    };
    const r = calcularVeredito({
      projecao: projecaoMod,
      cobertura: mkCobertura(),
      confianca: mkConfianca({
        por_unidade: [
          mkConfiancaUnidade({
            legal_entity_id: 'u1',
            confianca_projecao: 'media',
          }),
          mkConfiancaUnidade({
            legal_entity_id: 'u2',
            confianca_projecao: 'media',
          }),
        ],
        consolidado: mkConfiancaUnidade({
          legal_entity_id: 'consolidado:c1',
          confianca_projecao: 'media',
        }),
      }),
    });
    expect(r.consolidado.veredito).toBe('CRITICO');
    expect(r.unidades[0]!.veredito).toBe('LIMPO');
    expect(r.unidades[1]!.veredito).toBe('LIMPO');
    expect(r.banner_unidade_critica).toBeNull(); // consolidado em risco
    expect(r.erros_de_marcacao).toHaveLength(1);
    expect(r.erros_de_marcacao[0]!.tipo).toBe('consolidado_pior_que_unidades');
  });
});

/* ─── Determinismo + imutabilidade ─── */

describe('calcularVeredito — determinismo', () => {
  it('3 rodadas consecutivas → output deepEqual byte a byte', () => {
    const projecao = mkProjecaoConf({
      unidades: [
        unidadeComSaldos(
          mkUnidadeConf({ legal_entity_id: 'u1' }),
          new Map([[5, { caixa_final: -1234.56, caixa_minimo_op: 0 }]]),
        ),
      ],
    });
    const cobertura = mkCobertura();
    const confianca = mkConfianca({
      por_unidade: [
        mkConfiancaUnidade({
          legal_entity_id: 'u1',
          confianca_projecao: 'alta',
        }),
      ],
      consolidado: mkConfiancaUnidade({
        legal_entity_id: 'consolidado:c1',
        confianca_projecao: 'alta',
      }),
    });
    const r1 = calcularVeredito({ projecao, cobertura, confianca });
    const r2 = calcularVeredito({ projecao, cobertura, confianca });
    const r3 = calcularVeredito({ projecao, cobertura, confianca });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    /* Texto formatado byte-a-byte. */
    expect(r1.unidades[0]!.texto).toBe(r2.unidades[0]!.texto);
  });
});

describe('calcularVeredito — imutabilidade', () => {
  it('Object.freeze nos inputs não causa erro nem mutação', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })],
    });
    const cobertura = mkCobertura();
    const confianca = mkConfianca({
      por_unidade: [
        mkConfiancaUnidade({
          legal_entity_id: 'u1',
          confianca_projecao: 'alta',
        }),
      ],
      consolidado: mkConfiancaUnidade({
        legal_entity_id: 'consolidado:c1',
        confianca_projecao: 'alta',
      }),
    });
    Object.freeze(projecao);
    Object.freeze(projecao.unidades);
    Object.freeze(cobertura);
    Object.freeze(cobertura.pendencias);
    Object.freeze(cobertura.motivosInsuficiencia);
    Object.freeze(confianca);
    Object.freeze(confianca.por_unidade);

    expect(() =>
      calcularVeredito({
        projecao: projecao as ProjecaoCliente,
        cobertura: cobertura as CoberturaResult,
        confianca: confianca as ConfiancaResult,
      }),
    ).not.toThrow();
  });

  it('snapshot JSON antes/depois bate', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })],
    });
    const cobertura = mkCobertura();
    const confianca = mkConfianca({
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
    });
    const snap = JSON.stringify({ projecao, cobertura, confianca });
    calcularVeredito({ projecao, cobertura, confianca });
    expect(JSON.stringify({ projecao, cobertura, confianca })).toBe(snap);
  });
});
