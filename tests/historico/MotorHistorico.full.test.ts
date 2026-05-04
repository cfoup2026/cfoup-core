import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  MotorHistorico,
  type EventoCaixa,
} from '../../src/index.js';
import { makeRealizado, utcDate } from './fixtures/helpers.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utcDate(2026, 5, 1);

function seriesMensal(
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
        id: `${contraparteId}_${i}`,
        valor,
        direcao: 'saida',
        contraparte_id: contraparteId,
        data_realizada: date,
      }),
    );
  }
  return out;
}

describe('MotorHistorico — orquestrador completo (Estágio 2.1 + 2.2)', () => {
  it('com calendar: produz HistoricoOperacional com eventosEstimados', () => {
    const eventos = seriesMensal('imobiliaria', 5000, utcDate(2026, 4, 15));

    const motor = new MotorHistorico({
      geradoEm: GERADO_EM,
      calendar,
      janelaSemanas: 13,
    });
    const result = motor.run(eventos);

    expect(result.contraparteHistory).toBeInstanceOf(Map);
    expect(result.recorrencias.length).toBeGreaterThan(0);
    expect(result.eventosEstimados.length).toBeGreaterThan(0);
    expect(result.geradoEm).toEqual(GERADO_EM);

    // Asserts schema dos estimados.
    for (const e of result.eventosEstimados) {
      expect(e.origem).toBe('historico');
      expect(e.status).toBe('estimado');
    }
  });

  it('sem calendar: eventosEstimados é [] (modo só-estatístico)', () => {
    const eventos = seriesMensal('imo', 5000, utcDate(2026, 4, 15));
    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const result = motor.run(eventos);
    expect(result.eventosEstimados).toEqual([]);
    // Mas estatística existe.
    expect(result.recorrencias.length).toBeGreaterThan(0);
  });

  it('determinismo: 2 chamadas com calendar + geradoEm → estimados deepEqual', () => {
    const eventos = seriesMensal('det', 1000, utcDate(2026, 4, 15));
    const motor = new MotorHistorico({
      geradoEm: GERADO_EM,
      calendar,
      janelaSemanas: 13,
    });
    const a = motor.run(eventos);
    const b = motor.run(eventos);
    expect(b.eventosEstimados).toEqual(a.eventosEstimados);
    expect(b.recorrencias).toEqual(a.recorrencias);
  });

  it('hook contraparteHistory ativo: estimados deslocados quando contraparte estável', () => {
    // Cria uma série + uma contraparte com padrão estável.
    const eventos = seriesMensal(
      'forn_estavel',
      1000,
      utcDate(2026, 4, 15),
    );
    // Cria histórico de delta consistente (todos +5 dias) para
    // 'forn_estavel' usando 6 pares com data_vencimento.
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `delta_${i}`,
          valor: 100,
          direcao: 'saida',
          contraparte_id: 'forn_estavel',
          data_vencimento: utcDate(2025, 6 + i, 10),
          data_realizada: utcDate(2025, 6 + i, 15), // +5 dias consistente
        }),
      );
    }

    const motor = new MotorHistorico({
      geradoEm: GERADO_EM,
      calendar,
      janelaSemanas: 13,
    });
    const result = motor.run(eventos);

    // contraparteHistory deve ter 'forn_estavel' como padrão estável.
    const stats = result.contraparteHistory.get('forn_estavel')!;
    expect(stats.padrao_estavel).toBe(true);
    expect(stats.mediana_dias).toBe(5);

    // Estimados existem para a recorrência mensal de 1000.
    expect(result.eventosEstimados.length).toBeGreaterThan(0);
    // data_esperada = data_vencimento + 5 (ou próximo dia útil se cair em fim de semana/feriado).
    for (const e of result.eventosEstimados) {
      if (e.status !== 'estimado' || e.data_vencimento === undefined) continue;
      const diff =
        (e.data_esperada.getTime() - e.data_vencimento.getTime()) /
        86_400_000;
      // Diff deve ser >= 5 (com possíveis dias adicionais por calendário).
      expect(diff).toBeGreaterThanOrEqual(5);
    }
  });
});
