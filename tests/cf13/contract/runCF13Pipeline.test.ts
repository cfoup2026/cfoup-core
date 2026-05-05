/**
 * Testes estruturais e de invariantes para `runCF13Pipeline`.
 *
 * Smoke end-to-end com fixture Gregorutt vive em
 * `tests/integration/cf13.contract.smoke.test.ts` para casar com o
 * padrão dos demais smokes integrados.
 */
import { describe, expect, it } from 'vitest';
import {
  CF13ContractIntegrityError,
  runCF13Pipeline,
  type CF13PipelineInput,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
} from '../../../src/index.js';
import { mkEvento, utc } from '../../reconciliacao/fixtures/mkEvento.js';

const NOW_FIXO_DATE = new Date('2026-05-01T12:00:00.000Z');
/** Factory determinística — sempre retorna o mesmo `Date`. Smoke/test
 *  injeta isso para travar `meta.geradoEm`. */
const NOW_FIXO = (): Date => NOW_FIXO_DATE;

function mkInputMin(
  override: Partial<CF13PipelineInput> = {},
): CF13PipelineInput {
  /* Input mínimo: 1 evento realizado + 1 saldo de abertura recente.
   *  Suficiente pra rodar o pipeline sem disparar `cobertura_insuficiente`
   *  (saldo presente; banco com dado recente). */
  const evento: EventoCaixa = mkEvento({
    id: 'ev1',
    cliente_id: 'c1',
    legal_entity_id: 'u1',
    status: 'realizado',
    origem: 'cef',
    direcao: 'entrada',
    valor: 1000,
    data_realizada: utc(2026, 4, 28),
    data_esperada: utc(2026, 4, 28),
  });
  const saldo: OpeningBalanceSnapshot = {
    id: 'sn1',
    cliente_id: 'c1',
    legal_entity_id: 'u1',
    conta_bancaria_id: 'cef:5778-2',
    valor: 50_000,
    data_referencia: utc(2026, 4, 30),
    origem: 'cef',
    criado_em: utc(2026, 4, 30),
    criado_por: 'sistema',
  };
  return {
    cliente_id: 'c1',
    base_date: '2026-05-01',
    eventos: [evento],
    opening_balances: [saldo],
    now: NOW_FIXO,
    ...override,
  };
}

describe('runCF13Pipeline — input enxuto + defaults derivados', () => {
  it('deriva legal_entity_ids_ativas dos eventos', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.projecao.unidades).toHaveLength(1);
    expect(out.projecao.unidades[0]!.escopo).toEqual({
      tipo: 'unidade',
      legalEntityId: 'u1',
    });
  });

  it('parse base_date inválido → throws', () => {
    expect(() =>
      runCF13Pipeline(
        mkInputMin({ base_date: '2026/05/01' as unknown as string }),
      ),
    ).toThrow(/base_date.*inválido/);
  });

  it('base_date corretamente populado no meta + projecao', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.meta.baseDate).toBe('2026-05-01');
    expect(out.projecao.baseDate).toBe('2026-05-01');
  });

  it('janela inicio/fim coerente com semanas[0]/semanas[12]', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.meta.janelaInicio).toBe(
      out.projecao.consolidado.semanas[0]!.inicio,
    );
    expect(out.meta.janelaFim).toBe(
      out.projecao.consolidado.semanas[12]!.fim,
    );
  });
});

describe('runCF13Pipeline — meta', () => {
  it('versaoEngine constante', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.meta.versaoEngine).toBe('cf13.v0');
  });

  it('now factory injetável → meta.geradoEm determinístico (§4)', () => {
    const out1 = runCF13Pipeline(mkInputMin());
    const out2 = runCF13Pipeline(mkInputMin());
    expect(out1.meta.geradoEm).toBe(out2.meta.geradoEm);
    expect(out1.meta.geradoEm).toBe(NOW_FIXO_DATE.toISOString());
  });

  it('meta.geradoEm é timestamp REAL (não derivado de baseDate) (§4)', () => {
    /* `geradoEm` reflete `now()`, não `base_date`. Aqui o now=12:00:00Z
     *  difere do baseDate parsed (00:00:00Z); validamos que `geradoEm`
     *  segue o now, não o baseDate. */
    const out = runCF13Pipeline(mkInputMin());
    expect(out.meta.geradoEm).toBe('2026-05-01T12:00:00.000Z');
    expect(out.meta.geradoEm).not.toBe(`${out.meta.baseDate}T00:00:00.000Z`);
  });

  it('now factory chamada por execução (não pré-computada)', () => {
    /* Uma factory pode retornar tempos diferentes em chamadas distintas.
     *  Validamos que a factory é executada — passar uma factory que
     *  retorna timestamps incrementais e ver que cada execução pega
     *  um novo. */
    let i = 0;
    const dynamicNow = (): Date => {
      i += 1;
      return new Date(`2026-05-01T12:00:0${i}.000Z`);
    };
    const out1 = runCF13Pipeline(mkInputMin({ now: dynamicNow }));
    const out2 = runCF13Pipeline(mkInputMin({ now: dynamicNow }));
    expect(out1.meta.geradoEm).toBe('2026-05-01T12:00:01.000Z');
    expect(out2.meta.geradoEm).toBe('2026-05-01T12:00:02.000Z');
  });

  it('default now (sem injeção) produz ISO 8601 válido', () => {
    /* Sem injetar `now`, default usa `() => new Date()`. Valida que
     *  o output ainda é timestamp ISO 8601 parseável.
     *  Monta input sem `now` (omitido) — `exactOptionalPropertyTypes`
     *  não aceita `now: undefined`. */
    const base = mkInputMin();
    const out = runCF13Pipeline({
      cliente_id: base.cliente_id,
      base_date: base.base_date,
      eventos: base.eventos,
      opening_balances: base.opening_balances,
    });
    /* RegExp ISO 8601 com Z UTC. */
    expect(out.meta.geradoEm).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(Number.isNaN(new Date(out.meta.geradoEm).getTime())).toBe(false);
  });
});

describe('runCF13Pipeline — invariantes globais', () => {
  it('consolidado.semanas.length === 13', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.projecao.consolidado.semanas).toHaveLength(13);
  });

  it('cliente unitário ainda traz unidades.length === 1', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(out.projecao.unidades).toHaveLength(1);
  });

  it('cobertura.status binário ∈ {suficiente, insuficiente}', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect(['suficiente', 'insuficiente']).toContain(out.cobertura.status);
  });

  it('veredito.consolidado.categoria ∈ 5 valores', () => {
    const out = runCF13Pipeline(mkInputMin());
    expect([
      'dados_insuficientes',
      'critico',
      'alerta',
      'atencao',
      'limpo',
    ]).toContain(out.veredito.consolidado.categoria);
  });
});

describe('runCF13Pipeline — invariante cross-output', () => {
  it('cobertura insuficiente ⇒ veredito = dados_insuficientes', () => {
    /* Sem saldo de abertura → motivo saldo_abertura_ausente → cobertura
     *  insuficiente. */
    const out = runCF13Pipeline(mkInputMin({ opening_balances: [] }));
    expect(out.cobertura.status).toBe('insuficiente');
    expect(out.veredito.consolidado.categoria).toBe('dados_insuficientes');
  });
});

describe('runCF13Pipeline — determinismo', () => {
  it('2 rodadas com mesmo now → mesmo output JSON', () => {
    const a = runCF13Pipeline(mkInputMin());
    const b = runCF13Pipeline(mkInputMin());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('runCF13Pipeline — JSON-safety do output', () => {
  it('output é serializável sem perda (round-trip JSON.parse)', () => {
    const out = runCF13Pipeline(mkInputMin());
    /* Round-trip — não deve lançar nem produzir [object Map]. */
    const parsed = JSON.parse(JSON.stringify(out)) as unknown;
    expect(parsed).toEqual(out);
  });
});

describe('CF13ContractIntegrityError', () => {
  it('expõe pendenciaId e semanaIdInvalido', () => {
    const e = new CF13ContractIntegrityError('p1', '9999-12-31');
    expect(e.pendenciaId).toBe('p1');
    expect(e.semanaIdInvalido).toBe('9999-12-31');
    expect(e.name).toBe('CF13ContractIntegrityError');
    expect(e.message).toContain('p1');
    expect(e.message).toContain('9999-12-31');
  });
});

describe('runCF13Pipeline — pendências ordenadas no output', () => {
  it('lista vazia ou ordenada por severidade desc', () => {
    const out = runCF13Pipeline(mkInputMin());
    /* Severidade decrescente: critica → media → baixa. */
    const sevOrder: Record<string, number> = {
      critica: 0,
      media: 1,
      baixa: 2,
    };
    for (let i = 1; i < out.pendencias.length; i++) {
      const a = sevOrder[out.pendencias[i - 1]!.severidade]!;
      const b = sevOrder[out.pendencias[i]!.severidade]!;
      expect(a).toBeLessThanOrEqual(b);
    }
  });
});
