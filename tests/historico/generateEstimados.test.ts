import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  detectRecorrencias,
  generateEstimados,
  type EventoCaixa,
  type Recorrencia,
} from '../../src/index.js';
import { makeConfirmado, makeRealizado, utcDate } from './fixtures/helpers.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utcDate(2026, 5, 1);
const EMPTY_HIST = new Map();

/** Helper: gera 12 ocorrências mensais de um fornecedor terminando em
 *  `lastDate`. Valor consistente. Resulta em recorrência mensal alta. */
function seriesMensal(
  prefix: string,
  contraparteId: string,
  valor: number,
  lastDate: Date,
  n = 12,
): EventoCaixa[] {
  const out: EventoCaixa[] = [];
  for (let i = 0; i < n; i++) {
    const offsetDays = -(n - 1 - i) * 30;
    const date = new Date(lastDate.getTime() + offsetDays * 86_400_000);
    out.push(
      makeRealizado({
        id: `${prefix}_${i}`,
        valor,
        direcao: 'saida',
        contraparte_id: contraparteId,
        data_realizada: date,
      }),
    );
  }
  return out;
}

describe('generateEstimados — projeção e trava anti-duplicação', () => {
  it('1 recorrência mensal forte ativa, sem confirmado futuro → ~3 estimados em 13 semanas', () => {
    const eventos = seriesMensal(
      'aluguel',
      'imobiliaria_X',
      5000,
      utcDate(2026, 4, 15),
    );
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const fortes = recs.filter((r) => r.confianca === 'alta' && r.ativa);
    expect(fortes.length).toBe(1);

    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );

    // 13 semanas = 91 dias. Mensal próxima após 2026-04-15 → 2026-05-15,
    // 2026-06-14, 2026-07-14. Todas dentro da janela [2026-05-01, 2026-07-31].
    expect(estimados.length).toBeGreaterThanOrEqual(2);
    expect(estimados.length).toBeLessThanOrEqual(4);
    for (const e of estimados) {
      expect(e.status).toBe('estimado');
      expect(e.origem).toBe('historico');
      expect(e.origem_ref).toBe(fortes[0]!.recorrencia_id);
      expect(e.confianca).toBe('media'); // 1 nível abaixo de alta
      expect(e.confianca_origem).toBe('sistema');
      expect(e.is_transferencia).toBe(false);
      expect(e.criado_por).toBe('motor_historico');
      expect(e.valor).toBe(5000);
      expect(e.direcao).toBe('saida');
    }
  });

  it('trava anti-duplicação: confirmado existente em ±5 dias → estimado correspondente é omitido', () => {
    const eventos = seriesMensal(
      'aluguel_v2',
      'imobiliaria_Y',
      5000,
      utcDate(2026, 4, 15),
    );
    // Adiciona um CONFIRMADO futuro com mesma contraparte+bucket+valor
    // próximo da próxima projeção (2026-05-15). Janela ±5 dias inclui
    // datas 2026-05-10 a 2026-05-20.
    // Trava usa [valor_classe_min, valor_classe_max] observados na série.
    // Como todos os 12 eventos têm valor=5000, min=max=5000. Confirmado
    // precisa cair nesse range para ser detectado pela trava.
    eventos.push(
      makeConfirmado({
        id: 'cp_titulo_futuro',
        valor: 5000,
        direcao: 'saida',
        contraparte_id: 'imobiliaria_Y',
        data_vencimento: utcDate(2026, 5, 16), // dentro de ±5 dias da projeção
      }),
    );

    const recs = detectRecorrencias(eventos, GERADO_EM);
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );

    // Não deve gerar estimado próximo a 2026-05-15 (coberto pelo confirmado).
    const noConflito = estimados.every(
      (e) =>
        Math.abs(
          (e.status === 'estimado' && e.data_vencimento
            ? e.data_vencimento.getTime()
            : 0) - utcDate(2026, 5, 15).getTime(),
        ) >
        5 * 86_400_000,
    );
    expect(noConflito).toBe(true);
  });

  it('trava anti-duplicação: realizado recente em ±5 dias também bloqueia', () => {
    const eventos = seriesMensal(
      'aluguel_v3',
      'imobiliaria_Z',
      5000,
      utcDate(2026, 4, 15),
    );
    // Adiciona um realizado já cobrindo a próxima projeção (2026-05-15).
    eventos.push(
      makeRealizado({
        id: 'realizado_cobre',
        valor: 5000,
        direcao: 'saida',
        contraparte_id: 'imobiliaria_Z',
        data_realizada: utcDate(2026, 5, 13),
      }),
    );
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    // Nenhum estimado próximo a 2026-05-13 (±5 dias).
    for (const e of estimados) {
      if (e.status !== 'estimado' || e.data_vencimento === undefined) continue;
      const diff = Math.abs(
        e.data_vencimento.getTime() - utcDate(2026, 5, 13).getTime(),
      );
      expect(diff).toBeGreaterThan(5 * 86_400_000);
    }
  });

  it('recorrência inativa → 0 estimados', () => {
    // Last date 2025-08-15: ~9 meses atrás de geradoEm 2026-05-01. Inativa.
    const eventos = seriesMensal(
      'velho',
      'fornecedor_velho',
      1000,
      utcDate(2025, 8, 15),
    );
    const recs = detectRecorrencias(eventos, GERADO_EM);
    // Para inativa, generateEstimados pula.
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    expect(estimados.length).toBe(0);
  });

  it('recorrência confianca=baixa → 0 estimados (mesmo se ativa)', () => {
    // Recorrência ad-hoc com confianca=baixa.
    const recBaixa: Recorrencia = {
      recorrencia_id: 'rec_baixa',
      contraparte_id: 'X',
      bucket_id: 'pendente_classificacao',
      valor_mediano: 1000,
      valor_classe_min: 900,
      valor_classe_max: 1100,
      periodo: 'mensal',
      n_ocorrencias: 3,
      primeira_data: utcDate(2026, 2, 15),
      ultima_data: utcDate(2026, 4, 15),
      ativa: true,
      confianca: 'baixa',
      inferido_de: 'agrupamento_contraparte_bucket_valor',
      n_amostras: 3,
      direcao: 'saida',
      cliente_id: 'cli_test',
      legal_entity_id: 'le_test',
      bucket_nome: 'Pendente',
      criticidade: 'pendente',
    };
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: [recBaixa] },
      [],
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    expect(estimados.length).toBe(0);
  });

  it('recorrência confianca=media → estimados com confianca=baixa', () => {
    const recMedia: Recorrencia = {
      recorrencia_id: 'rec_media',
      contraparte_id: 'X',
      bucket_id: 'pendente_classificacao',
      valor_mediano: 1000,
      valor_classe_min: 900,
      valor_classe_max: 1100,
      periodo: 'mensal',
      n_ocorrencias: 4,
      primeira_data: utcDate(2026, 1, 15),
      ultima_data: utcDate(2026, 4, 15),
      ativa: true,
      confianca: 'media',
      inferido_de: 'agrupamento_contraparte_bucket_valor',
      n_amostras: 4,
      direcao: 'saida',
      cliente_id: 'cli_test',
      legal_entity_id: 'le_test',
      bucket_nome: 'Pendente',
      criticidade: 'pendente',
    };
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: [recMedia] },
      [],
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    expect(estimados.length).toBeGreaterThan(0);
    expect(estimados.every((e) => e.confianca === 'baixa')).toBe(true);
  });

  it('determinismo: 2 chamadas → mesmos IDs e datas', () => {
    const eventos = seriesMensal('det', 'X', 1000, utcDate(2026, 4, 15));
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const a = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    const b = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );
    expect(b.map((e) => e.id)).toEqual(a.map((e) => e.id));
    expect(b.map((e) => e.data_esperada.toISOString())).toEqual(
      a.map((e) => e.data_esperada.toISOString()),
    );
  });

  it('hook contraparteHistory ativo: contraparte estável desloca data_esperada', () => {
    const eventos = seriesMensal('hk', 'forn_atrasado', 1000, utcDate(2026, 4, 15));
    const recs = detectRecorrencias(eventos, GERADO_EM);

    // Sem hook
    const semHook = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );

    // Com hook: contraparte 'forn_atrasado' tem mediana +5 dias.
    const historyEstavel = new Map([
      ['forn_atrasado', { padrao_estavel: true, mediana_dias: 5 }],
    ]);
    const comHook = generateEstimados(
      { contraparteHistory: historyEstavel, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 13 },
    );

    // Cada estimado com hook tem data_esperada deslocada relativamente.
    expect(comHook.length).toBe(semHook.length);
    for (let i = 0; i < comHook.length; i++) {
      const a = semHook[i]!;
      const b = comHook[i]!;
      // data_vencimento idêntica nos dois (projeção é a mesma).
      if (a.status === 'estimado' && b.status === 'estimado') {
        expect(a.data_vencimento?.toISOString()).toBe(
          b.data_vencimento?.toISOString(),
        );
        // data_esperada com hook é >= sem hook (deslocada +5 dias antes
        // do calendário; pode pular pra próximo dia útil também).
        expect(b.data_esperada.getTime()).toBeGreaterThanOrEqual(
          a.data_esperada.getTime(),
        );
      }
    }
  });

  it('janelaSemanas custom (4) gera menos estimados que default (13)', () => {
    const eventos = seriesMensal(
      'win',
      'X',
      1000,
      utcDate(2026, 4, 15),
    );
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const default13 = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar },
    );
    const win4 = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar, janelaSemanas: 4 },
    );
    expect(win4.length).toBeLessThanOrEqual(default13.length);
  });

  it('estimados ordenados deterministicamente por id', () => {
    const eventos = seriesMensal('ord', 'X', 1000, utcDate(2026, 4, 15));
    const recs = detectRecorrencias(eventos, GERADO_EM);
    const estimados = generateEstimados(
      { contraparteHistory: EMPTY_HIST, recorrencias: recs },
      eventos,
      { geradoEm: GERADO_EM, calendar },
    );
    const ids = estimados.map((e) => e.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
