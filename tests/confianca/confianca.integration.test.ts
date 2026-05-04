import { describe, expect, it } from 'vitest';
import {
  calcularConfianca,
  ConfiancaError,
  type EventoCaixa,
  type Pendencia,
} from '../../src/index.js';
import {
  GERADO_EM,
  mkCobertura,
  mkEventoConf,
  mkProjecaoConf,
  mkUnidadeConf,
  utc,
} from './fixtures.js';

/* ─── orquestrador: shape básico ─── */

describe('calcularConfianca — orquestrador', () => {
  it('1 unidade simples + cobertura completa → estrutura mínima', () => {
    const ev = mkEventoConf({
      id: 'e1',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['e1']]]), // W19
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['e1']]]),
    });
    const cobertura = mkCobertura();

    const r = calcularConfianca({
      projecao,
      cobertura,
      eventos: [ev],
    });

    expect(r.por_unidade).toHaveLength(1);
    expect(r.por_unidade[0]!.legal_entity_id).toBe('u1');
    expect(r.por_unidade[0]!.semanas).toHaveLength(13);
    expect(r.consolidado.legal_entity_id).toBe('consolidado:c1');
    expect(r.consolidado.semanas).toHaveLength(13);
    // W19 (idx 1) tem 1 alta → semana 'alta'.
    expect(r.por_unidade[0]!.semanas[1]!.confianca).toBe('alta');
    // Demais 12 semanas zeradas → baixa.
    expect(r.por_unidade[0]!.semanas[0]!.confianca).toBe('baixa');
    // Pior das 13 → baixa (porque tem semanas zeradas).
    expect(r.por_unidade[0]!.confianca_projecao).toBe('baixa');
  });

  it('cobertura_aplicada ecoa status por unidade ativa, ordem lex', () => {
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({ legal_entity_id: 'u_z' }),
        mkUnidadeConf({ legal_entity_id: 'u_a' }),
        mkUnidadeConf({ legal_entity_id: 'u_m' }),
      ],
    });
    const pend: Pendencia = {
      id: 'p1',
      tipo: 'semana_zerada',
      legal_entity_id: 'u_a',
      semana_iso: '2026-W19',
      descricao: 'x',
      acoes_sugeridas: ['confirmar_que_era_esperado'],
    };
    const cobertura = mkCobertura({
      pendencias: [pend],
      motivosInsuficiencia: [
        {
          tipo: 'saldo_abertura_ausente',
          legal_entity_id: 'u_m',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_saldo'],
        },
      ],
    });
    const r = calcularConfianca({ projecao, cobertura, eventos: [] });
    expect(r.cobertura_aplicada.map((c) => c.legal_entity_id)).toEqual([
      'u_a',
      'u_m',
      'u_z',
    ]);
    expect(r.cobertura_aplicada.find((c) => c.legal_entity_id === 'u_a')!.status)
      .toBe('cobertura_com_confianca_reduzida');
    expect(r.cobertura_aplicada.find((c) => c.legal_entity_id === 'u_m')!.status)
      .toBe('cobertura_insuficiente');
    expect(r.cobertura_aplicada.find((c) => c.legal_entity_id === 'u_z')!.status)
      .toBe('cobertura_completa');
  });

  it('evento_id na projecao sem corresponder em eventos[] → ConfiancaError', () => {
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['ghost']]]),
        }),
      ],
    });
    expect(() =>
      calcularConfianca({
        projecao,
        cobertura: mkCobertura(),
        eventos: [],
      }),
    ).toThrow(ConfiancaError);
  });
});

/* ─── stage 5/stage 6: independência ─── */

describe('calcularConfianca — coerência com Stage 5', () => {
  it('cobertura_insuficiente em uma unidade NÃO suprime cálculo de Stage 6', () => {
    const ev = mkEventoConf({
      id: 'e1',
      legal_entity_id: 'u1',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['e1']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['e1']]]),
    });
    const cobertura = mkCobertura({
      motivosInsuficiencia: [
        {
          tipo: 'banco_sem_dado_recente',
          legal_entity_id: 'u1',
          descricao: 'x',
          acoes_sugeridas: ['revisar_conexao'],
        },
      ],
    });
    const r = calcularConfianca({ projecao, cobertura, eventos: [ev] });
    // Stage 6 calcula normalmente (semana com 1 alta = alta).
    expect(r.por_unidade[0]!.semanas[1]!.confianca).toBe('alta');
    // E ecoa cobertura_insuficiente.
    expect(r.cobertura_aplicada[0]!.status).toBe('cobertura_insuficiente');
  });

  it('pendência lateral de Stage 5 (semana zerada) NÃO vira pendência crítica de Stage 6', () => {
    const projecao = mkProjecaoConf({
      unidades: [mkUnidadeConf({ legal_entity_id: 'u1' })], // todas zeradas
    });
    const cobertura = mkCobertura({
      pendencias: [
        {
          id: 'pend',
          tipo: 'semana_zerada',
          legal_entity_id: 'u1',
          semana_iso: '2026-W19',
          descricao: 'x',
          acoes_sugeridas: ['confirmar_que_era_esperado'],
        },
      ],
    });
    const r = calcularConfianca({ projecao, cobertura, eventos: [] });
    // Pendências críticas de Stage 6 ficam vazias — Stage 5 lateral não conta.
    expect(r.por_unidade[0]!.pendencias_criticas).toEqual([]);
    // Mas a semana é 'baixa' por peso_total_zero, não por pendencia_critica.
    expect(r.por_unidade[0]!.semanas[1]!.confianca).toBe('baixa');
    expect(r.por_unidade[0]!.semanas[1]!.motivo_baixa).toBe('peso_total_zero');
  });
});

/* ─── multiunidade ─── */

describe('calcularConfianca — multiunidade e transferência', () => {
  it('2 unidades com transferência interna: unidades veem o evento, consolidado já vem sem', () => {
    /* Premissa do Stage 4: pares válidos de transferência foram
     *  removidos do `evento_ids` do consolidado. Stage 6 consome o que
     *  recebeu. Aqui simulamos isso na fixture: u1 e u2 têm os ids;
     *  consolidado NÃO tem. */
    const evU1 = mkEventoConf({
      id: 'tA',
      legal_entity_id: 'u1',
      status: 'realizado',
      direcao: 'saida',
      valor: 5000,
      confianca: 'alta',
      is_transferencia: true,
      transferencia_par_id: 'tB',
      data_realizada: utc(2026, 5, 5),
    });
    const evU2 = mkEventoConf({
      id: 'tB',
      legal_entity_id: 'u2',
      status: 'realizado',
      direcao: 'entrada',
      valor: 5000,
      confianca: 'alta',
      is_transferencia: true,
      transferencia_par_id: 'tA',
      data_realizada: utc(2026, 5, 5),
    });
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['tA']]]),
        }),
        mkUnidadeConf({
          legal_entity_id: 'u2',
          evento_ids_por_semana: new Map([[1, ['tB']]]),
        }),
      ],
      // Consolidado SEM os ids — Stage 4 já neutralizou.
      consolidado_evento_ids_por_semana: new Map(),
    });

    const r = calcularConfianca({
      projecao,
      cobertura: mkCobertura(),
      eventos: [evU1, evU2],
    });
    // u1 vê o evento na semana 2.
    expect(r.por_unidade[0]!.semanas[1]!.peso_total).toBe(5000);
    expect(r.por_unidade[1]!.semanas[1]!.peso_total).toBe(5000);
    // Consolidado: 0 — Stage 6 não reaplica neutralização.
    expect(r.consolidado.semanas[1]!.peso_total).toBe(0);

    // Pendências críticas: u1 tem saída marcada is_transferencia → NÃO conta
    // (mesmo se material). u2 é entrada → não conta.
    expect(r.por_unidade[0]!.pendencias_criticas).toEqual([]);
    expect(r.por_unidade[1]!.pendencias_criticas).toEqual([]);
    expect(r.consolidado.pendencias_criticas).toEqual([]);
  });

  it('pendências críticas do consolidado NÃO são apenas a união das unidades — denominador diferente', () => {
    /* u1: saída de R$ 4500 com criticidade obrigatoria + saídas totais
     *     da u1 nessa semana = R$ 50.000. Relativo: 4500 / 50_000 = 9%
     *     (NÃO atinge 10%). Absoluto: 4500 < 5000. NÃO é material em u1.
     * u2: 0 saídas.
     * Consolidado: saídas totais = 50.000 (vindas só da u1) + 0 = 50.000.
     *     Mesmo evento R$ 4500 → 9% (mesmo cenário do u1). NÃO é material.
     * Para diferenciar: criar cenário onde u1 tem o evento + outras
     *     saídas grandes (denominador grande), e consolidado vê só esse
     *     evento isolado de saída (denominador pequeno → materializa).
     */
    const evCritico = mkEventoConf({
      id: 'criti',
      legal_entity_id: 'u1',
      status: 'confirmado',
      direcao: 'saida',
      valor: 1000,
      confianca: 'media',
      criticidade: 'obrigatoria',
      data_vencimento: utc(2026, 5, 15),
    });
    const evGrandeU1 = mkEventoConf({
      id: 'grande',
      legal_entity_id: 'u1',
      status: 'realizado',
      direcao: 'saida',
      valor: 100_000,
      confianca: 'alta',
      criticidade: 'discricionaria',
      data_realizada: utc(2026, 5, 5),
    });
    /* Em u1: saidasSemana = 101.000. evCritico R$ 1000 < 10% (10.100) e
     *       < R$ 5000. NÃO material em u1.
     * Consolidado: simulamos que evGrandeU1 NÃO veio (talvez foi
     *       transferência removida, ou outro motivo) — só evCritico.
     *       saidasSemana_consol = 1000. evCritico R$ 1000 = 100%.
     *       Material por relativo. */
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['criti', 'grande']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['criti']]]), // só criti
    });

    const r = calcularConfianca({
      projecao,
      cobertura: mkCobertura(),
      eventos: [evCritico, evGrandeU1],
    });
    // u1: NÃO material → 0 pendências críticas.
    expect(r.por_unidade[0]!.pendencias_criticas).toHaveLength(0);
    // Consolidado: material por relativo → 1 pendência crítica.
    expect(r.consolidado.pendencias_criticas).toHaveLength(1);
    expect(r.consolidado.pendencias_criticas[0]!.evento_id).toBe('criti');
    expect(r.consolidado.pendencias_criticas[0]!.trigger_materialidade).toBe(
      'pct_10_saidas_semana',
    );
  });
});

/* ─── determinismo ─── */

describe('calcularConfianca — determinismo', () => {
  it('3 rodadas consecutivas produzem output deepEqual', () => {
    const ev = mkEventoConf({
      id: 'e',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['e']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['e']]]),
    });
    const cobertura = mkCobertura();

    const r1 = calcularConfianca({ projecao, cobertura, eventos: [ev] });
    const r2 = calcularConfianca({ projecao, cobertura, eventos: [ev] });
    const r3 = calcularConfianca({ projecao, cobertura, eventos: [ev] });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });
});

/* ─── imutabilidade ─── */

describe('calcularConfianca — imutabilidade do input', () => {
  it('Object.freeze nos inputs não causa erro nem mutação', () => {
    const ev = mkEventoConf({
      id: 'e',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const eventos = Object.freeze([ev]);
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['e']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['e']]]),
    });
    Object.freeze(projecao);
    Object.freeze(projecao.unidades);
    const cobertura = mkCobertura();
    Object.freeze(cobertura);
    Object.freeze(cobertura.pendencias);
    Object.freeze(cobertura.motivosInsuficiencia);

    expect(() =>
      calcularConfianca({ projecao, cobertura, eventos: [...eventos] as EventoCaixa[] }),
    ).not.toThrow();
  });

  it('input eventos não é mutado (snapshot JSON antes/depois)', () => {
    const ev = mkEventoConf({
      id: 'e',
      status: 'realizado',
      direcao: 'entrada',
      valor: 1000,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const eventos = [ev];
    const before = JSON.stringify(eventos);
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['e']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['e']]]),
    });
    calcularConfianca({ projecao, cobertura: mkCobertura(), eventos });
    expect(JSON.stringify(eventos)).toBe(before);
  });
});

/* ─── snapshot agregado para auditoria/relatório ─── */

describe('calcularConfianca — snapshot de output documentado', () => {
  it('cenário rico produz output estável', () => {
    const ev1 = mkEventoConf({
      id: 'a',
      status: 'realizado',
      direcao: 'entrada',
      valor: 800,
      confianca: 'alta',
      data_realizada: utc(2026, 5, 5),
    });
    const ev2 = mkEventoConf({
      id: 'b',
      status: 'pendente',
      direcao: 'saida',
      valor: 6000,
      confianca: 'baixa',
      data_esperada: utc(2026, 5, 5),
    });
    const projecao = mkProjecaoConf({
      unidades: [
        mkUnidadeConf({
          legal_entity_id: 'u1',
          evento_ids_por_semana: new Map([[1, ['a', 'b']]]),
        }),
      ],
      consolidado_evento_ids_por_semana: new Map([[1, ['a', 'b']]]),
    });
    const r = calcularConfianca({
      projecao,
      cobertura: mkCobertura(),
      eventos: [ev1, ev2],
    });

    // u1 semana 2 (W19): peso_total = 6800; peso_alta = 800; peso_baixa = 6000.
    const w19 = r.por_unidade[0]!.semanas[1]!;
    expect(w19.peso_total).toBe(6800);
    expect(w19.peso_alta).toBe(800);
    expect(w19.peso_baixa).toBe(6000);
    // pct_baixa = 6000/6800 ≈ 0.882 > 0.25 → baixa por pct_baixa_alta...
    // mas pendência crítica vence (R$ 6000, pendente, saída = material absoluto).
    expect(w19.confianca).toBe('baixa');
    expect(w19.motivo_baixa).toBe('pendencia_critica');
    expect(w19.pendencias_criticas_ids).toEqual(['b']);

    expect(r.por_unidade[0]!.pendencias_criticas).toHaveLength(1);
    expect(r.por_unidade[0]!.pendencias_criticas[0]!.motivo).toBe('status_pendente');
    expect(r.por_unidade[0]!.confianca_projecao).toBe('baixa');
  });
});

/* Suprime warnings de unused */
void GERADO_EM;
