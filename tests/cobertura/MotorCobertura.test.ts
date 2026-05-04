import { describe, expect, it } from 'vitest';
import { MotorCobertura, detectaCobertura } from '../../src/index.js';
import {
  GERADO_EM,
  mkHistorico,
  mkProjecao,
  mkUnidade,
} from './fixtures/index.js';

describe('MotorCobertura — wrapper fino sobre detectaCobertura', () => {
  it('run() delega para detectaCobertura sem mudar o resultado', () => {
    const projecao = mkProjecao({
      unidades: [
        mkUnidade({
          legal_entity_id: 'u1',
          caixaInicial: { ausente: true, valor: 0, stale: false },
        }),
      ],
    });
    const historico = mkHistorico();
    const input = {
      eventos: [],
      historico,
      projecao,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
    };
    const motor = new MotorCobertura();
    const viaMotor = motor.run(input);
    const viaDetectaDireto = detectaCobertura(input);
    // Ambos devem produzir o mesmo resultado (motor é wrapper).
    expect(viaMotor).toEqual(viaDetectaDireto);
  });

  it('detectadoEm injetado em opts substitui o do output', () => {
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const customDate = new Date('2026-06-15T10:00:00.000Z');
    const motor = new MotorCobertura({ detectadoEm: customDate });
    const r = motor.run({
      eventos: [],
      historico: mkHistorico(),
      projecao,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
    });
    expect(r.detectadoEm).toEqual(customDate);
    expect(r.detectadoEm).not.toEqual(GERADO_EM);
  });

  it('sem detectadoEm em opts, usa geradoEm do input', () => {
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const motor = new MotorCobertura();
    const r = motor.run({
      eventos: [],
      historico: mkHistorico(),
      projecao,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
    });
    expect(r.detectadoEm).toEqual(GERADO_EM);
  });

  it('determinismo: 2 chamadas com mesmo input e mesmas opts → deepEqual', () => {
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const opts = { detectadoEm: new Date('2026-05-01T12:00:00.000Z') };
    const motor1 = new MotorCobertura(opts);
    const motor2 = new MotorCobertura(opts);
    const input = {
      eventos: [],
      historico: mkHistorico(),
      projecao,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
    };
    expect(motor1.run(input)).toEqual(motor2.run(input));
  });
});
