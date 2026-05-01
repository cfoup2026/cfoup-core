import { describe, expect, it } from 'vitest';
import { MotorReconciliacao } from '../../src/index.js';
import { mkEvento, utc } from './fixtures/mkEvento.js';

const RECON_EM = new Date('2026-05-30T12:00:00.000Z');

describe('MotorReconciliacao — orquestrador (3.1 + 3.1.1 + 3.2)', () => {
  it('run delega pra reconciliaBancoCpCr e devolve { reconciliacao, comercial }', () => {
    const conf = mkEvento({
      id: 'c',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const banc = mkEvento({
      id: 'b',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 15),
      data_esperada: utc(2026, 5, 15),
    });
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([conf, banc]);

    expect(out.reconciliacao.estatisticas.matchesAplicados).toBe(1);
    expect(out.reconciliacao.eventos.length).toBe(1);
    expect(out.reconciliacao.eventos[0]!.id).toBe('c');
    // Comercial vem zerado quando não passa vendas.
    expect(out.comercial.estatisticas.vendasOriginais).toBe(0);
    expect(out.comercial.vendas.length).toBe(0);
  });

  it('input vazio → result zerado em ambas as estruturas', () => {
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([]);
    expect(out.reconciliacao.eventos.length).toBe(0);
    expect(out.reconciliacao.estatisticas.confirmadosOriginais).toBe(0);
    expect(out.reconciliacao.estatisticas.matchesAplicados).toBe(0);
    expect(out.comercial.estatisticas.vendasOriginais).toBe(0);
  });

  it('determinismo: 2 chamadas → deepEqual', () => {
    const eventos = [
      mkEvento({
        id: 'c1',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 1500,
        data_vencimento: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
      }),
      mkEvento({
        id: 'b1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 1500,
        data_realizada: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
      }),
    ];
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const a = motor.run(eventos);
    const b = motor.run(eventos);
    expect(b).toEqual(a);
  });
});
