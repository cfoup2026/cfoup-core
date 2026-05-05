import { describe, expect, it } from 'vitest';
import { adaptarSemana } from '../../../src/cf13/contract/index.js';
import type {
  EventoCaixa,
  SemanaProjecao as SemanaProjecaoInterna,
} from '../../../src/index.js';
import { mkSemana } from '../../confianca/fixtures.js';
import { mkEvento, utc } from '../../reconciliacao/fixtures/mkEvento.js';

/* Semana base de referência: 2026-W18 (segunda 27/abr → domingo 03/mai). */
const SEMANA_W18: SemanaProjecaoInterna = mkSemana({ semana_iso: '2026-W18' });

function semanaCom(
  overrides: Partial<SemanaProjecaoInterna>,
): SemanaProjecaoInterna {
  return { ...SEMANA_W18, ...overrides };
}

function ev(
  id: string,
  direcao: EventoCaixa['direcao'],
  valor = 100,
): EventoCaixa {
  return mkEvento({
    id,
    cliente_id: 'c1',
    legal_entity_id: 'u1',
    status: 'realizado',
    origem: 'fkn',
    direcao,
    valor,
    data_realizada: utc(2026, 4, 28),
    data_esperada: utc(2026, 4, 28),
  });
}

describe('adaptarSemana — datas e rótulo', () => {
  it('inicio/fim em ISO YYYY-MM-DD; rotulo formatado', () => {
    const r = adaptarSemana({
      semana: SEMANA_W18,
      indice: 1,
      eventoIndex: new Map(),
    });
    /* W18 de 2026 = segunda 27/04 → domingo 03/05 → cruza mês. */
    expect(r.inicio).toBe('2026-04-27');
    expect(r.fim).toBe('2026-05-03');
    expect(r.indice).toBe(1);
    expect(r.rotulo).toBe('Sem 1 · 27 abr – 03 mai');
  });
});

describe('adaptarSemana — saldoSemana e gapMinimoOperacional', () => {
  it('saldoSemana = entradas - saidas (entrada > saida → positivo)', () => {
    const sem = semanaCom({
      total_entradas: 1000,
      total_saidas: 300,
      variacao_liquida: 700,
      caixa_inicial: 0,
      caixa_final: 700,
    });
    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: new Map() });
    expect(r.entradas).toBe(1000);
    expect(r.saidas).toBe(300);
    expect(r.saldoSemana).toBe(700);
  });

  it('gapMinimoOperacional positivo → abaixoDoMinimo=false', () => {
    const sem = semanaCom({
      caixa_final: 5000,
      caixa_minimo_op: 3000,
    });
    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: new Map() });
    expect(r.gapMinimoOperacional).toBe(2000);
    expect(r.abaixoDoMinimo).toBe(false);
  });

  it('gapMinimoOperacional negativo → abaixoDoMinimo=true (saldo positivo)', () => {
    const sem = semanaCom({
      caixa_final: 100,
      caixa_minimo_op: 5000,
    });
    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: new Map() });
    expect(r.gapMinimoOperacional).toBe(-4900);
    expect(r.abaixoDoMinimo).toBe(true);
    expect(r.saldoNegativo).toBe(false);
  });

  it('caixa_final negativo → saldoNegativo=true E abaixoDoMinimo=true', () => {
    const sem = semanaCom({
      caixa_final: -500,
      caixa_minimo_op: 0,
    });
    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: new Map() });
    expect(r.saldoNegativo).toBe(true);
    expect(r.abaixoDoMinimo).toBe(true);
  });

  it('gap zero → abaixoDoMinimo=false (estritamente menor)', () => {
    const sem = semanaCom({ caixa_final: 1000, caixa_minimo_op: 1000 });
    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: new Map() });
    expect(r.gapMinimoOperacional).toBe(0);
    expect(r.abaixoDoMinimo).toBe(false);
  });
});

describe('adaptarSemana — eventosEntradaIds / eventosSaidaIds', () => {
  it('split por direção, ordem lex dentro de cada array', () => {
    const e1 = ev('z-entrada', 'entrada');
    const e2 = ev('a-saida', 'saida');
    const e3 = ev('m-entrada', 'entrada');
    const e4 = ev('b-saida', 'saida');

    const sem = semanaCom({
      evento_ids: ['z-entrada', 'a-saida', 'm-entrada', 'b-saida'],
    });
    const idx = new Map<string, EventoCaixa>([
      [e1.id, e1],
      [e2.id, e2],
      [e3.id, e3],
      [e4.id, e4],
    ]);

    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: idx });
    /* Ambos arrays ordenados lex; sem cross-direção. */
    expect(r.eventosEntradaIds).toEqual(['m-entrada', 'z-entrada']);
    expect(r.eventosSaidaIds).toEqual(['a-saida', 'b-saida']);
  });

  it('IDs ausentes do index são silenciosamente ignorados', () => {
    const sem = semanaCom({
      evento_ids: ['existe', 'nao-existe'],
    });
    const e = ev('existe', 'entrada');
    const idx = new Map<string, EventoCaixa>([[e.id, e]]);

    const r = adaptarSemana({ semana: sem, indice: 1, eventoIndex: idx });
    expect(r.eventosEntradaIds).toEqual(['existe']);
    expect(r.eventosSaidaIds).toEqual([]);
  });

  it('semana zerada → arrays vazios', () => {
    const r = adaptarSemana({
      semana: SEMANA_W18,
      indice: 1,
      eventoIndex: new Map(),
    });
    expect(r.eventosEntradaIds).toEqual([]);
    expect(r.eventosSaidaIds).toEqual([]);
    expect(r.entradas).toBe(0);
    expect(r.saidas).toBe(0);
  });
});
