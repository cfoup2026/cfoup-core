import { describe, expect, it } from 'vitest';
import {
  classifyEventos,
  type BridgeClassificationResult,
  type ClassifierAdapter,
  type EventoCaixa,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

/**
 * Mock determinístico: respostas fixas por `evento.id`. Default `null`
 * (não classificado). `lastRequiresConfirmation` apoia o canal lateral
 * que `classifyEventos` lê após cada `classify`.
 */
class MockClassifier implements ClassifierAdapter {
  public lastRequiresConfirmation = false;
  constructor(
    private readonly respostas: ReadonlyMap<
      string,
      BridgeClassificationResult | null
    >,
    private readonly confirmacoes: ReadonlySet<string> = new Set(),
  ) {}
  classify(evento: EventoCaixa): BridgeClassificationResult | null {
    this.lastRequiresConfirmation = this.confirmacoes.has(evento.id);
    return this.respostas.get(evento.id) ?? null;
  }
}

const RESULTADO_FOLHA: BridgeClassificationResult = {
  bucket_id: 'folha',
  bucket_nome: 'Folha Pagamento',
  criticidade: 'obrigatoria',
};

const RESULTADO_OPERACIONAL: BridgeClassificationResult = {
  bucket_id: 'despesas_operacionais',
  bucket_nome: 'Despesas Operacionais',
  criticidade: 'critica_op',
};

/* ─── Critério 5: enriquece eventos classificados ─── */

describe('classifyEventos — eventos classificados', () => {
  it('mock retorna ClassificationResult → evento ganha bucket/criticidade, demais campos preservados', () => {
    const ev = mkEvento({
      id: 'e1',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 5000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'fornecedor-x',
    });
    const classifier = new MockClassifier(
      new Map([['e1', RESULTADO_FOLHA]]),
    );
    const r = classifyEventos({ eventos: [ev], classifier });

    expect(r.eventos).toHaveLength(1);
    const out = r.eventos[0]!;
    expect(out.bucket_id).toBe('folha');
    expect(out.bucket_nome).toBe('Folha Pagamento');
    expect(out.criticidade).toBe('obrigatoria');
    // Demais campos preservados.
    expect(out.id).toBe('e1');
    expect(out.valor).toBe(5000);
    expect(out.contraparte_id).toBe('fornecedor-x');
    expect(out.status).toBe('confirmado');
    if (out.status === 'confirmado') {
      expect(out.data_vencimento).toEqual(utc(2026, 5, 15));
    }
    expect(r.estatisticas.classificados).toBe(1);
    expect(r.estatisticas.naoClassificados).toBe(0);
    expect(r.estatisticas.porBucket.get('folha')).toBe(1);
    expect(r.estatisticas.porCriticidade.get('obrigatoria')).toBe(1);
  });
});

/* ─── Critério 6: eventos não-classificados mantêm pendente ─── */

describe('classifyEventos — eventos não-classificados', () => {
  it('mock retorna null → evento mantém pendente_classificacao + criticidade=pendente', () => {
    const ev = mkEvento({
      id: 'e2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 89.9,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
    });
    const classifier = new MockClassifier(new Map([['e2', null]]));
    const r = classifyEventos({ eventos: [ev], classifier });

    expect(r.eventos[0]!.bucket_id).toBe('pendente_classificacao');
    expect(r.eventos[0]!.criticidade).toBe('pendente');
    expect(r.estatisticas.classificados).toBe(0);
    expect(r.estatisticas.naoClassificados).toBe(1);
  });
});

/* ─── Critério 7: idempotência ─── */

describe('classifyEventos — idempotência', () => {
  it('evento com bucket_id != pendente_classificacao no input passa intacto', () => {
    // mkEvento default produz bucket_id='pendente_classificacao'; injetamos
    // um bucket pré-classificado via spread após mkEvento.
    const baseEv = mkEvento({
      id: 'e3',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const ev: EventoCaixa = {
      ...baseEv,
      bucket_id: 'aluguel',
      bucket_nome: 'Aluguel',
      criticidade: 'obrigatoria',
    };
    // Mock retornaria valor diferente, mas idempotência deve ignorar.
    const classifier = new MockClassifier(
      new Map([
        ['e3', { bucket_id: 'OUTRO', bucket_nome: 'Outro', criticidade: 'discricionaria' }],
      ]),
    );
    const r = classifyEventos({ eventos: [ev], classifier });

    expect(r.eventos[0]!.bucket_id).toBe('aluguel');
    expect(r.eventos[0]!.criticidade).toBe('obrigatoria');
    expect(r.estatisticas.jaClassificadosNoInput).toBe(1);
    expect(r.estatisticas.classificados).toBe(0);
    expect(r.estatisticas.naoClassificados).toBe(0);
  });

  it('re-rodar Bridge sobre output do Bridge não muda nada', () => {
    const ev = mkEvento({
      id: 'e',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const classifier = new MockClassifier(
      new Map([['e', RESULTADO_FOLHA]]),
    );
    const r1 = classifyEventos({ eventos: [ev], classifier });
    const r2 = classifyEventos({ eventos: r1.eventos, classifier });
    expect(r2.eventos).toEqual(r1.eventos);
    expect(r2.estatisticas.jaClassificadosNoInput).toBe(1);
    expect(r2.estatisticas.classificados).toBe(0);
  });
});

/* ─── Critério 4: imutabilidade ─── */

describe('classifyEventos — imutabilidade', () => {
  it('input eventos não é mutado', () => {
    const ev = mkEvento({
      id: 'e',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const eventoSnapshot = JSON.parse(JSON.stringify(ev));
    const classifier = new MockClassifier(
      new Map([['e', RESULTADO_FOLHA]]),
    );
    classifyEventos({ eventos: [ev], classifier });
    expect(JSON.parse(JSON.stringify(ev))).toEqual(eventoSnapshot);
  });

  it('input array não é mutado', () => {
    const eventos = [
      mkEvento({
        id: 'a',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 100,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 200,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
    ];
    const before = JSON.stringify(eventos);
    const classifier = new MockClassifier(
      new Map([
        ['a', RESULTADO_FOLHA],
        ['b', RESULTADO_OPERACIONAL],
      ]),
    );
    classifyEventos({ eventos, classifier });
    expect(JSON.stringify(eventos)).toBe(before);
  });
});

/* ─── Critério 3: determinismo ─── */

describe('classifyEventos — determinismo', () => {
  it('2 chamadas com mesmo input + mesmo mock → output deepEqual', () => {
    const eventos = [
      mkEvento({
        id: 'a',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 100,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 200,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'c',
        status: 'pendente',
        origem: 'manual',
        direcao: 'entrada',
        valor: 50,
        data_esperada: utc(2026, 5, 6),
      }),
    ];
    const classifier1 = new MockClassifier(
      new Map([
        ['a', RESULTADO_FOLHA],
        ['b', null],
        ['c', RESULTADO_OPERACIONAL],
      ]),
    );
    const classifier2 = new MockClassifier(
      new Map([
        ['a', RESULTADO_FOLHA],
        ['b', null],
        ['c', RESULTADO_OPERACIONAL],
      ]),
    );
    const r1 = classifyEventos({ eventos, classifier: classifier1 });
    const r2 = classifyEventos({ eventos, classifier: classifier2 });
    // tempoTotalMs pode variar levemente; comparar resto.
    expect(r2.eventos).toEqual(r1.eventos);
    expect(r2.estatisticas.classificados).toBe(r1.estatisticas.classificados);
    expect(r2.estatisticas.naoClassificados).toBe(
      r1.estatisticas.naoClassificados,
    );
    expect([...r2.estatisticas.porBucket.entries()]).toEqual([
      ...r1.estatisticas.porBucket.entries(),
    ]);
  });
});

/* ─── Critério 8: estatísticas batem ─── */

describe('classifyEventos — estatísticas fechadas', () => {
  it('classificados + naoClassificados + jaClassificadosNoInput = totalEventos', () => {
    const eventos: EventoCaixa[] = [
      // 2 classificados pelo motor
      mkEvento({
        id: 'cl1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'cl2',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      // 1 não-classificado (mock retorna null)
      mkEvento({
        id: 'nc',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
    ];
    // 1 já-classificado (bucket_id != pendente).
    const jaClass: EventoCaixa = {
      ...mkEvento({
        id: 'jc',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      bucket_id: 'aluguel',
      bucket_nome: 'Aluguel',
      criticidade: 'obrigatoria',
    };
    eventos.push(jaClass);
    const classifier = new MockClassifier(
      new Map([
        ['cl1', RESULTADO_FOLHA],
        ['cl2', RESULTADO_OPERACIONAL],
        ['nc', null],
        ['jc', RESULTADO_FOLHA], // ignorado por idempotência
      ]),
    );
    const r = classifyEventos({ eventos, classifier });
    const e = r.estatisticas;
    expect(
      e.classificados + e.naoClassificados + e.jaClassificadosNoInput,
    ).toBe(e.totalEventos);
    expect(e.totalEventos).toBe(4);
    expect(e.classificados).toBe(2);
    expect(e.naoClassificados).toBe(1);
    expect(e.jaClassificadosNoInput).toBe(1);
  });

  it('Σ porBucket = classificados; Σ porCriticidade = classificados', () => {
    const eventos = [
      mkEvento({
        id: 'a',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'b',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'c',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
    ];
    const classifier = new MockClassifier(
      new Map([
        ['a', RESULTADO_FOLHA],
        ['b', RESULTADO_FOLHA],
        ['c', RESULTADO_OPERACIONAL],
      ]),
    );
    const r = classifyEventos({ eventos, classifier });
    const sumBuckets = [...r.estatisticas.porBucket.values()].reduce(
      (a, b) => a + b,
      0,
    );
    const sumCriticidades = [...r.estatisticas.porCriticidade.values()].reduce(
      (a, b) => a + b,
      0,
    );
    expect(sumBuckets).toBe(r.estatisticas.classificados);
    expect(sumCriticidades).toBe(r.estatisticas.classificados);
  });

  it('requiresOwnerConfirmationCount conta apenas classificados que pediram confirmação', () => {
    const eventos = [
      mkEvento({
        id: 'cf',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
      mkEvento({
        id: 'sc',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
    ];
    const classifier = new MockClassifier(
      new Map([
        ['cf', RESULTADO_FOLHA],
        ['sc', RESULTADO_OPERACIONAL],
      ]),
      new Set(['cf']), // só 'cf' pede confirmação
    );
    const r = classifyEventos({ eventos, classifier });
    expect(r.estatisticas.requiresOwnerConfirmationCount).toBe(1);
    expect(r.estatisticas.classificados).toBe(2);
  });
});

/* ─── Edge: input vazio ─── */

describe('classifyEventos — edge cases', () => {
  it('input vazio → estrutura zerada, sem throw', () => {
    const classifier = new MockClassifier(new Map());
    const r = classifyEventos({ eventos: [], classifier });
    expect(r.eventos).toEqual([]);
    expect(r.estatisticas.totalEventos).toBe(0);
    expect(r.estatisticas.classificados).toBe(0);
    expect(r.estatisticas.naoClassificados).toBe(0);
    expect(r.estatisticas.jaClassificadosNoInput).toBe(0);
    expect(r.estatisticas.porBucket.size).toBe(0);
    expect(r.estatisticas.porCriticidade.size).toBe(0);
  });
});
