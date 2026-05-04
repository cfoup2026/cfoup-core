import { describe, expect, it } from 'vitest';
import {
  CoberturaError,
  detectaCobertura,
  type DetectaCoberturaInput,
} from '../../src/index.js';
import { mkEvento, utc as utcMk } from '../reconciliacao/fixtures/mkEvento.js';
import {
  GERADO_EM,
  mkHistorico,
  mkProjecao,
  mkRecorrencia,
  mkSaldo,
  mkUnidade,
  utc,
} from './fixtures/index.js';

const baseInput = (
  overrides: Partial<DetectaCoberturaInput>,
): DetectaCoberturaInput => ({
  eventos: [],
  historico: mkHistorico(),
  projecao: mkProjecao(),
  saldos: [],
  cliente_id: 'c1',
  legal_entity_ids_ativas: ['u1'],
  geradoEm: GERADO_EM,
  ...overrides,
});

/* ─── Critério 10: status ─── */

describe('detectaCobertura — status', () => {
  it('cobertura_completa: tudo zerado, sem motivos, sem pendências', () => {
    // Unidade com saldo + 1 evento por semana → sem semana zerada,
    // sem recorrência, sem pendentes.
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) => ({
      evento_ids: [`ok-${i}`],
    }));
    const eventos = Array.from({ length: 13 }, (_, i) => ({
      ...mkEvento({
        id: `ok-${i}`,
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 100,
        data_realizada: utc(2026, 5, 5 + i * 7),
        data_esperada: utc(2026, 5, 5 + i * 7),
      }),
      bucket_id: 'despesas_operacionais',
      criticidade: 'critica_op' as const,
    }));
    const cefRecente = mkEvento({
      id: 'cef-recente',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 4, 28),
      data_esperada: utc(2026, 4, 28),
    });
    const r = detectaCobertura(
      baseInput({
        eventos: [...eventos, cefRecente],
        saldos: [
          mkSaldo({ id: 's1', legal_entity_id: 'u1', data_referencia: utc(2026, 4, 30) }),
        ],
        projecao: mkProjecao({
          unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
        }),
      }),
    );
    expect(r.status).toBe('cobertura_completa');
    expect(r.pendencias).toEqual([]);
    expect(r.motivosInsuficiencia).toEqual([]);
  });

  it('cobertura_com_confianca_reduzida: sem motivos, com pendências', () => {
    // Saldo OK + CEF recente, mas semanas zeradas.
    const cefRecente = mkEvento({
      id: 'cef-r',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 4, 28),
      data_esperada: utc(2026, 4, 28),
    });
    const r = detectaCobertura(
      baseInput({
        eventos: [cefRecente],
        saldos: [mkSaldo({ id: 's', legal_entity_id: 'u1' })],
        projecao: mkProjecao({
          unidades: [mkUnidade({ legal_entity_id: 'u1' })], // semanas vazias
        }),
      }),
    );
    expect(r.status).toBe('cobertura_com_confianca_reduzida');
    expect(r.motivosInsuficiencia).toEqual([]);
    expect(r.pendencias.length).toBeGreaterThan(0);
  });

  it('cobertura_insuficiente: motivo presente', () => {
    const r = detectaCobertura(
      baseInput({
        projecao: mkProjecao({
          unidades: [
            mkUnidade({
              legal_entity_id: 'u1',
              caixaInicial: { ausente: true, valor: 0, stale: false },
            }),
          ],
        }),
      }),
    );
    expect(r.status).toBe('cobertura_insuficiente');
    expect(r.motivosInsuficiencia.length).toBeGreaterThan(0);
  });
});

/* ─── Critério 11: pendências detectadas mesmo em cobertura_insuficiente ─── */

describe('detectaCobertura — pendências coexistem com motivos de insuficiência', () => {
  it('saldo ausente + semana zerada → motivo + pendência', () => {
    const r = detectaCobertura(
      baseInput({
        projecao: mkProjecao({
          unidades: [
            mkUnidade({
              legal_entity_id: 'u1',
              caixaInicial: { ausente: true, valor: 0, stale: false },
            }),
          ],
        }),
      }),
    );
    expect(r.status).toBe('cobertura_insuficiente');
    expect(r.motivosInsuficiencia.some((m) => m.tipo === 'saldo_abertura_ausente')).toBe(true);
    // Semana zerada também detectada.
    expect(r.pendencias.some((p) => p.tipo === 'semana_zerada')).toBe(true);
  });
});

/* ─── Critério 12: determinismo ─── */

describe('detectaCobertura — determinismo', () => {
  it('2 chamadas com mesmo input → output deepEqual', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_folha',
      bucket_id: 'folha',
      contraparte_id: 'fornec-x',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    const input = baseInput({
      historico: mkHistorico({ recorrencias: [rec] }),
    });
    const r1 = detectaCobertura(input);
    const r2 = detectaCobertura(input);
    expect(r2).toEqual(r1);
  });
});

/* ─── Critério 13: imutabilidade ─── */

describe('detectaCobertura — imutabilidade', () => {
  it('input.eventos não mutado; projecao.unidades não mutadas', () => {
    const ev = mkEvento({
      id: 'e1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 4, 28),
      data_esperada: utc(2026, 4, 28),
    });
    const eventos = [ev];
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const eventosBefore = JSON.stringify(eventos);
    const projecaoBefore = JSON.stringify({
      cliente_id: projecao.cliente_id,
      unidades: projecao.unidades.map((u) => ({
        legal_entity_id: u.legal_entity_id,
        caixaInicial: u.caixaInicial,
      })),
    });
    detectaCobertura(
      baseInput({
        eventos,
        projecao,
      }),
    );
    expect(JSON.stringify(eventos)).toBe(eventosBefore);
    expect(
      JSON.stringify({
        cliente_id: projecao.cliente_id,
        unidades: projecao.unidades.map((u) => ({
          legal_entity_id: u.legal_entity_id,
          caixaInicial: u.caixaInicial,
        })),
      }),
    ).toBe(projecaoBefore);
  });
});

/* ─── Critério 14: estatísticas batem ─── */

describe('detectaCobertura — estatísticas', () => {
  it('Σ pendenciasPorTipo = pendencias.length; motivosInsuficienciaCount = motivos.length', () => {
    // Setup: 2 unidades, uma com saldo ausente + várias semanas zeradas.
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { ausente: true, valor: 0, stale: false },
        }),
        mkUnidade({
          legal_entity_id: 'u2',
        }),
      ],
    });
    const r = detectaCobertura(baseInput({ projecao, legal_entity_ids_ativas: ['u1', 'u2'] }));
    const sumByTipo = [...r.estatisticas.pendenciasPorTipo.values()].reduce(
      (s, n) => s + n,
      0,
    );
    expect(sumByTipo).toBe(r.pendencias.length);
    const sumByUnidade = [
      ...r.estatisticas.pendenciasPorUnidade.values(),
    ].reduce((s, n) => s + n, 0);
    expect(sumByUnidade).toBe(r.pendencias.length);
    expect(r.estatisticas.motivosInsuficienciaCount).toBe(
      r.motivosInsuficiencia.length,
    );
  });

  it('valorTotalPendentesClassificacao = Σ valor_total das pendências do tipo', () => {
    const evs = [
      { id: 'e1', valor: 100 },
      { id: 'e2', valor: 200 },
      { id: 'e3', valor: 50 },
    ].map((x) =>
      mkEvento({
        id: x.id,
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: x.valor,
        data_realizada: utc(2026, 5, 13),
        data_esperada: utc(2026, 5, 13),
      }),
    );
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['e1', 'e2', 'e3'] } : {},
    );
    const r = detectaCobertura(
      baseInput({
        eventos: evs,
        projecao: mkProjecao({
          unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
        }),
      }),
    );
    expect(r.estatisticas.totalEventosPendentesClassificacao).toBe(3);
    expect(r.estatisticas.valorTotalPendentesClassificacao).toBe(350);
  });
});

/* ─── Critério 15: linguagem de produto ─── */

describe('detectaCobertura — linguagem de produto', () => {
  it('descricao não contém "bloqueante", "buraco", "input"', () => {
    // Combina várias categorias pra cobrir.
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { ausente: true, valor: 0, stale: false },
        }),
      ],
    });
    const rec = mkRecorrencia({
      recorrencia_id: 'rec',
      bucket_id: 'folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    const evPend = mkEvento({
      id: 'p',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50,
      data_realizada: utc(2026, 5, 13),
      data_esperada: utc(2026, 5, 13),
    });
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['p'] } : {},
    );
    const projecao2 = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { ausente: true, valor: 0, stale: false },
          eventos_por_semana,
        }),
      ],
    });
    const r = detectaCobertura(
      baseInput({
        eventos: [evPend],
        historico: mkHistorico({ recorrencias: [rec] }),
        projecao: projecao2,
      }),
    );
    const todasDescricoes = [
      ...r.pendencias.map((p) => p.descricao),
      ...r.motivosInsuficiencia.map((m) => m.descricao),
    ];
    for (const d of todasDescricoes) {
      const lower = d.toLowerCase();
      expect(lower).not.toContain('bloqueante');
      expect(lower).not.toContain('buraco');
      expect(lower).not.toMatch(/\binput\b/);
      expect(lower).not.toContain('precisa preencher');
      expect(lower).not.toContain('sem isso');
    }
    // Apenas para garantir que o teste exercitou casos:
    expect(todasDescricoes.length).toBeGreaterThan(0);
    // Suprime warning de "projecao não usado".
    expect(projecao.unidades).toHaveLength(1);
  });
});

/* ─── Critério 16: Stage 5 não rebaixa confiança ─── */

describe('detectaCobertura — não rebaixa confiança', () => {
  it('eventos input mantêm confianca; CoberturaResult não tem campo confianca', () => {
    const ev = mkEvento({
      id: 'e',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 4, 28),
      data_esperada: utc(2026, 4, 28),
    });
    const confiancaAntes = ev.confianca;
    const r = detectaCobertura(baseInput({ eventos: [ev] }));
    expect(ev.confianca).toBe(confiancaAntes);
    // CoberturaResult não tem campo `confianca`.
    expect((r as unknown as Record<string, unknown>)['confianca']).toBeUndefined();
  });
});

/* ─── Edge: legal_entity_ids_ativas vazio ─── */

describe('detectaCobertura — edge cases', () => {
  it('legal_entity_ids_ativas vazio → cobertura_completa, listas vazias, sem throw', () => {
    const r = detectaCobertura(
      baseInput({
        legal_entity_ids_ativas: [],
        projecao: mkProjecao({ unidades: [] }),
      }),
    );
    expect(r.status).toBe('cobertura_completa');
    expect(r.pendencias).toEqual([]);
    expect(r.motivosInsuficiencia).toEqual([]);
    expect(r.estatisticas.motivosInsuficienciaCount).toBe(0);
  });

  it('cliente_id divergente entre param e projecao → CoberturaError', () => {
    const projecao = mkProjecao({ cliente_id: 'OUTRO' });
    expect(() =>
      detectaCobertura(baseInput({ projecao })),
    ).toThrow(CoberturaError);
  });

  it('cliente_id vazio → CoberturaError', () => {
    expect(() =>
      detectaCobertura(baseInput({ cliente_id: '' })),
    ).toThrow(CoberturaError);
  });

  it('geradoEm inválido → CoberturaError', () => {
    expect(() =>
      detectaCobertura(baseInput({ geradoEm: new Date(Number.NaN) })),
    ).toThrow(CoberturaError);
  });
});

/* ─── Critério 9: ações sugeridas mapeadas ─── */

describe('detectaCobertura — ações sugeridas por tipo', () => {
  it('saldo_abertura_ausente: [confirmar_saldo, revisar_conexao]', () => {
    const r = detectaCobertura(
      baseInput({
        projecao: mkProjecao({
          unidades: [
            mkUnidade({
              legal_entity_id: 'u1',
              caixaInicial: { ausente: true, valor: 0, stale: false },
            }),
          ],
        }),
      }),
    );
    const m = r.motivosInsuficiencia[0]!;
    expect(m.acoes_sugeridas).toEqual(['confirmar_saldo', 'revisar_conexao']);
  });

  it('todas as pendências têm acoes_sugeridas não-vazias e enumeradas', () => {
    // Setup combinado.
    const rec = mkRecorrencia({
      recorrencia_id: 'rec',
      bucket_id: 'folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    const evPend = mkEvento({
      id: 'p',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50,
      data_realizada: utc(2026, 5, 13),
      data_esperada: utc(2026, 5, 13),
    });
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['p'] } : {},
    );
    const r = detectaCobertura(
      baseInput({
        eventos: [evPend],
        historico: mkHistorico({ recorrencias: [rec] }),
        projecao: mkProjecao({
          unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
        }),
      }),
    );
    const enumValidos = new Set([
      'confirmar_saldo',
      'revisar_conexao',
      'declarar_conta_inativa',
      'adicionar_evento_manual',
      'confirmar_que_era_esperado',
      'reclassificar_eventos_pendentes',
      'verificar_recorrencia',
    ]);
    for (const p of r.pendencias) {
      expect(p.acoes_sugeridas.length).toBeGreaterThan(0);
      for (const a of p.acoes_sugeridas) {
        expect(enumValidos.has(a)).toBe(true);
      }
    }
  });
});

/* ─── Ordenação determinística da saída ─── */

describe('detectaCobertura — ordenação determinística', () => {
  it('pendencias ordenadas por (legal_entity_id, semana_iso, tipo, id)', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({ legal_entity_id: 'u2' }),
        mkUnidade({ legal_entity_id: 'u1' }),
      ],
    });
    const r = detectaCobertura(
      baseInput({
        legal_entity_ids_ativas: ['u1', 'u2'],
        projecao,
      }),
    );
    const ids = r.pendencias.map((p) => p.legal_entity_id);
    // Todos os u1 vêm antes de todos os u2.
    const lastU1 = ids.lastIndexOf('u1');
    const firstU2 = ids.indexOf('u2');
    if (lastU1 >= 0 && firstU2 >= 0) {
      expect(lastU1).toBeLessThan(firstU2);
    }
  });
});

/* ─── Smoke combinado ─── */

describe('detectaCobertura — cenário Gregorutt-like (smoke)', () => {
  it('cobertura completa quando tudo fechado', () => {
    // Setup mínimo viável: saldo OK, CEF recente, sem recorrências, sem
    // semanas zeradas, sem pendentes.
    const cefRecente = mkEvento({
      id: 'cef-r',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 4, 28),
      data_esperada: utc(2026, 4, 28),
    });
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) => ({
      evento_ids: [`ev-${i}`],
    }));
    const eventosOk = Array.from({ length: 13 }, (_, i) => ({
      ...mkEvento({
        id: `ev-${i}`,
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 100,
        data_realizada: utc(2026, 5, 5 + i * 7),
        data_esperada: utc(2026, 5, 5 + i * 7),
      }),
      bucket_id: 'despesas_operacionais',
      criticidade: 'critica_op' as const,
    }));
    const r = detectaCobertura(
      baseInput({
        eventos: [...eventosOk, cefRecente],
        saldos: [mkSaldo({ id: 's', legal_entity_id: 'u1' })],
        projecao: mkProjecao({
          unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
        }),
      }),
    );
    expect(r.status).toBe('cobertura_completa');
  });
});

/* Suppress unused import. */
void utcMk;
