import { describe, expect, it } from 'vitest';
import {
  formatarRotuloSemana,
  ordenarPendencias,
  fonteDeteccao,
  mapearTipoInsuficiencia,
  severidadeMotivoInsuficiencia,
  severidadePorTipoCobertura,
} from '../../../src/cf13/contract/index.js';
import type { PendenciaCF13 } from '../../../src/cf13/contract/index.js';

/* ─── formatarRotuloSemana ─── */

describe('formatarRotuloSemana — mesma faixa de mês', () => {
  it('semana 1 abril 21–27 → "Sem 1 · 21–27 abr"', () => {
    expect(formatarRotuloSemana('2026-04-21', '2026-04-27', 1)).toBe(
      'Sem 1 · 21–27 abr',
    );
  });

  it('semana 13 dezembro 21–27 → "Sem 13 · 21–27 dez"', () => {
    expect(formatarRotuloSemana('2026-12-21', '2026-12-27', 13)).toBe(
      'Sem 13 · 21–27 dez',
    );
  });
});

describe('formatarRotuloSemana — cruzando mês', () => {
  it('semana 2 abril/mai → "Sem 2 · 28 abr – 04 mai"', () => {
    expect(formatarRotuloSemana('2026-04-28', '2026-05-04', 2)).toBe(
      'Sem 2 · 28 abr – 04 mai',
    );
  });

  it('semana 6 dez/jan → "Sem 6 · 28 dez – 03 jan"', () => {
    expect(formatarRotuloSemana('2026-12-28', '2027-01-03', 6)).toBe(
      'Sem 6 · 28 dez – 03 jan',
    );
  });
});

describe('formatarRotuloSemana — entrada inválida', () => {
  it('inicio mal formado → throws', () => {
    expect(() =>
      formatarRotuloSemana('2026/04/21', '2026-04-27', 1),
    ).toThrow();
  });

  it('fim mal formado → throws', () => {
    expect(() => formatarRotuloSemana('2026-04-21', 'abc', 1)).toThrow();
  });

  it('mês 13 → throws', () => {
    expect(() =>
      formatarRotuloSemana('2026-13-01', '2026-13-07', 1),
    ).toThrow();
  });
});

describe('formatarRotuloSemana — determinismo', () => {
  it('100 chamadas com mesmos args → mesma string', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      set.add(formatarRotuloSemana('2026-04-21', '2026-04-27', 1));
    }
    expect(set.size).toBe(1);
  });
});

/* ─── ordenarPendencias ─── */

function mkPend(
  id: string,
  severidade: PendenciaCF13['severidade'],
  semanaId?: string,
): PendenciaCF13 {
  const p: PendenciaCF13 = {
    id,
    origem: 'cobertura',
    severidade,
    titulo: 't',
    detalhe: 'd',
  };
  if (semanaId !== undefined) p.semanaId = semanaId;
  return p;
}

describe('ordenarPendencias — ordem severidade desc', () => {
  it('crítica antes de média antes de baixa', () => {
    const r = ordenarPendencias([
      mkPend('a', 'baixa', '2026-04-21'),
      mkPend('b', 'critica', '2026-04-28'),
      mkPend('c', 'media', '2026-04-21'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('ordenarPendencias — ordem semanaId asc dentro da severidade', () => {
  it('semanas 1, 2, 3 ordenam crescente', () => {
    const r = ordenarPendencias([
      mkPend('z', 'media', '2026-05-05'),
      mkPend('a', 'media', '2026-04-21'),
      mkPend('m', 'media', '2026-04-28'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['a', 'm', 'z']);
  });

  it('mesma severidade mistura crítica e baixa: severidade > semanaId', () => {
    const r = ordenarPendencias([
      mkPend('b', 'baixa', '2026-04-21'),
      mkPend('c', 'critica', '2026-04-28'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['c', 'b']);
  });
});

describe('ordenarPendencias — pendência sem semanaId', () => {
  it('vai ao final dentro da mesma severidade', () => {
    const r = ordenarPendencias([
      mkPend('z', 'media'), // sem semanaId
      mkPend('a', 'media', '2026-04-21'),
      mkPend('m', 'media', '2026-04-28'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['a', 'm', 'z']);
  });

  it('todas sem semanaId → tiebreaker id asc', () => {
    const r = ordenarPendencias([
      mkPend('z', 'media'),
      mkPend('a', 'media'),
      mkPend('m', 'media'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('ordenarPendencias — tiebreaker id asc', () => {
  it('mesma severidade + mesma semana → id lex', () => {
    const r = ordenarPendencias([
      mkPend('z', 'media', '2026-04-21'),
      mkPend('a', 'media', '2026-04-21'),
      mkPend('m', 'media', '2026-04-21'),
    ]);
    expect(r.map((p: PendenciaCF13) => p.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('ordenarPendencias — não muta input', () => {
  it('input array preservado', () => {
    const input: PendenciaCF13[] = [
      mkPend('z', 'baixa'),
      mkPend('a', 'critica'),
    ];
    const snap = JSON.stringify(input);
    ordenarPendencias(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

/* ─── mapearOrigem helpers ─── */

describe('severidadePorTipoCobertura', () => {
  it('semana_zerada → media', () => {
    expect(severidadePorTipoCobertura('semana_zerada')).toBe('media');
  });
  it('recorrencia_ausente → media', () => {
    expect(severidadePorTipoCobertura('recorrencia_ausente')).toBe('media');
  });
  it('pendentes_classificacao_agregados → baixa', () => {
    expect(severidadePorTipoCobertura('pendentes_classificacao_agregados')).toBe(
      'baixa',
    );
  });
});

describe('severidadeMotivoInsuficiencia', () => {
  it('saldo_abertura_ausente → critica', () => {
    expect(severidadeMotivoInsuficiencia('saldo_abertura_ausente')).toBe(
      'critica',
    );
  });
  it('banco_sem_dado_recente → critica', () => {
    expect(severidadeMotivoInsuficiencia('banco_sem_dado_recente')).toBe(
      'critica',
    );
  });
});

describe('mapearTipoInsuficiencia — rename literal banco_*', () => {
  it('saldo_abertura_ausente → mantém', () => {
    expect(mapearTipoInsuficiencia('saldo_abertura_ausente')).toBe(
      'saldo_abertura_ausente',
    );
  });
  it('banco_sem_dado_recente → banco_ATIVO_sem_dado_recente', () => {
    expect(mapearTipoInsuficiencia('banco_sem_dado_recente')).toBe(
      'banco_ativo_sem_dado_recente',
    );
  });
});

describe('fonteDeteccao por tipo de pendência', () => {
  it('semana_zerada → ausencia_total', () => {
    expect(fonteDeteccao('semana_zerada')).toBe('ausencia_total');
  });
  it('recorrencia_ausente → recorrencia_historica', () => {
    expect(fonteDeteccao('recorrencia_ausente')).toBe('recorrencia_historica');
  });
  it('pendentes_classificacao_agregados → padrao_contraparte', () => {
    expect(fonteDeteccao('pendentes_classificacao_agregados')).toBe(
      'padrao_contraparte',
    );
  });
});
