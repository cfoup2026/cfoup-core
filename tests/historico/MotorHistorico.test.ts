import { describe, expect, it } from 'vitest';
import {
  MotorHistorico,
  type EventoCaixa,
} from '../../src/index.js';
import { makeRealizado, utcDate } from './fixtures/helpers.js';

const GERADO_EM = utcDate(2026, 5, 1);

describe('MotorHistorico — orquestrador parcial (Estágio 2.1)', () => {
  it('produz 3 estruturas (contraparteHistory, recorrencias, volatilidades)', () => {
    const eventos: EventoCaixa[] = [];
    // Padrão estável de contraparte + série mensal recorrente.
    for (let i = 0; i < 8; i++) {
      eventos.push(
        makeRealizado({
          id: `mensal_${i}`,
          valor: 5000,
          direcao: 'saida',
          criticidade: 'obrigatoria',
          contraparte_id: 'aluguel_imobiliaria',
          bucket_id: 'pendente_classificacao',
          data_vencimento: utcDate(2025, 9 + (i > 3 ? 0 : 0), 1 + i * 30 - i),
          // simplificando: vencimento + 5 dias = realizada
          data_realizada: new Date(
            utcDate(2025, 9, 5).getTime() + i * 30 * 86_400_000,
          ),
          competencia: `2025-${String(9 + i > 12 ? (9 + i) - 12 : 9 + i).padStart(2, '0')}`,
        }),
      );
    }

    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const result = motor.run(eventos);

    expect(result.contraparteHistory).toBeInstanceOf(Map);
    expect(result.recorrencias).toBeInstanceOf(Array);
    expect(result.volatilidades).toBeInstanceOf(Map);
    expect(result.geradoEm).toEqual(GERADO_EM);
    expect(result.baseDe.totalRealizados).toBe(8);
  });

  it('input vazio → estrutura zerada, sem throw', () => {
    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const result = motor.run([]);
    expect(result.contraparteHistory.size).toBe(0);
    expect(result.recorrencias).toEqual([]);
    expect(result.volatilidades.size).toBe(0);
    expect(result.baseDe.totalRealizados).toBe(0);
  });

  it('eventosEstimados é [] quando calendar não é passado (modo estatístico)', () => {
    // Sem `calendar` no construtor, MotorHistorico opera só em 2.1
    // (estatísticas) e devolve `eventosEstimados=[]`. Geração de
    // estimados (2.2) só roda quando o caller passa um calendário.
    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const result = motor.run([]);
    expect(result.eventosEstimados).toEqual([]);
  });

  it('determinismo: chamar run 2× retorna deepEqual', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 6; i++) {
      eventos.push(
        makeRealizado({
          id: `det_${i}`,
          valor: 1000,
          direcao: 'saida',
          contraparte_id: 'X',
          data_vencimento: utcDate(2026, 1, 10 + i * 5),
          data_realizada: utcDate(2026, 1, 13 + i * 5),
        }),
      );
    }
    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const a = motor.run(eventos);
    const b = motor.run(eventos);
    // Map equality em vitest funciona via toEqual.
    expect(b.contraparteHistory).toEqual(a.contraparteHistory);
    expect(b.recorrencias).toEqual(a.recorrencias);
    expect(b.volatilidades).toEqual(a.volatilidades);
    expect(b.baseDe).toEqual(a.baseDe);
  });

  it('respeita override criticidadesVolatilidade', () => {
    const eventos: EventoCaixa[] = [];
    for (let i = 0; i < 12; i++) {
      const baseMonth = 5 + i;
      const year = 2025 + Math.floor((baseMonth - 1) / 12);
      const month = ((baseMonth - 1) % 12) + 1;
      eventos.push(
        makeRealizado({
          id: `vol_${i}`,
          valor: 1000,
          direcao: 'saida',
          criticidade: 'pendente', // só pendente — default não captura
          competencia: `${year}-${String(month).padStart(2, '0')}`,
          data_realizada: utcDate(year, month, 15),
        }),
      );
    }

    // Default (estrito): captura zero.
    const motorDefault = new MotorHistorico({ geradoEm: GERADO_EM });
    expect(motorDefault.run(eventos).volatilidades.size).toBe(0);

    // V0 override: captura todos.
    const motorV0 = new MotorHistorico({
      geradoEm: GERADO_EM,
      criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente'],
    });
    expect(motorV0.run(eventos).volatilidades.size).toBe(1);
  });

  it('baseDe captura janela [primeiro, último] dos realizados', () => {
    const eventos: EventoCaixa[] = [
      makeRealizado({
        id: 'a',
        valor: 100,
        direcao: 'saida',
        data_realizada: utcDate(2025, 6, 15),
      }),
      makeRealizado({
        id: 'b',
        valor: 200,
        direcao: 'saida',
        data_realizada: utcDate(2026, 4, 20),
      }),
      makeRealizado({
        id: 'c',
        valor: 50,
        direcao: 'saida',
        data_realizada: utcDate(2025, 12, 1),
      }),
    ];
    const motor = new MotorHistorico({ geradoEm: GERADO_EM });
    const result = motor.run(eventos);
    expect(result.baseDe.primeiroEvento.toISOString()).toBe(
      utcDate(2025, 6, 15).toISOString(),
    );
    expect(result.baseDe.ultimoEvento.toISOString()).toBe(
      utcDate(2026, 4, 20).toISOString(),
    );
    expect(result.baseDe.totalRealizados).toBe(3);
  });
});
