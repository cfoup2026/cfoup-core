import { describe, expect, it } from 'vitest';
import { detectaBancoSemDado } from '../../src/index.js';
import { mkEvento, utc as utcMk } from '../reconciliacao/fixtures/mkEvento.js';
import { mkSaldo } from './fixtures/index.js';

const GERADO_EM = utcMk(2026, 5, 1);

const baseInput = {
  cliente_id: 'c1',
  legal_entity_ids_ativas: ['u1'],
  geradoEm: GERADO_EM,
};

describe('detectaBancoSemDado', () => {
  it('CEF realizado 7 dias antes (no limite) → NÃO dispara', () => {
    const ev = mkEvento({
      id: 'cef-7',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 4, 24),
      data_esperada: utcMk(2026, 4, 24),
    });
    const motivos = detectaBancoSemDado({
      ...baseInput,
      eventos: [ev],
      saldos: [],
    });
    expect(motivos).toEqual([]);
  });

  it('CEF realizado 8 dias antes → dispara banco_sem_dado_recente', () => {
    const ev = mkEvento({
      id: 'cef-8',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 4, 23),
      data_esperada: utcMk(2026, 4, 23),
    });
    const motivos = detectaBancoSemDado({
      ...baseInput,
      eventos: [ev],
      saldos: [],
    });
    expect(motivos).toHaveLength(1);
    expect(motivos[0]!.tipo).toBe('banco_sem_dado_recente');
    expect(motivos[0]!.legal_entity_id).toBe('u1');
    expect(motivos[0]!.ultima_data_observada).toEqual(utcMk(2026, 4, 23));
    expect(motivos[0]!.acoes_sugeridas).toEqual([
      'revisar_conexao',
      'declarar_conta_inativa',
      'adicionar_evento_manual',
    ]);
  });

  it('lançamento manual recente (3 dias atrás) cobre exceção → NÃO dispara mesmo sem CEF recente', () => {
    const cefAntigo = mkEvento({
      id: 'cef-antigo',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 1, 1),
      data_esperada: utcMk(2026, 1, 1),
    });
    const manualRecente = mkEvento({
      id: 'man-1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'manual',
      direcao: 'saida',
      valor: 50,
      data_realizada: utcMk(2026, 4, 28),
      data_esperada: utcMk(2026, 4, 28),
    });
    const motivos = detectaBancoSemDado({
      ...baseInput,
      eventos: [cefAntigo, manualRecente],
      saldos: [],
    });
    expect(motivos).toEqual([]);
  });

  it('unidade sem indício de banco (sem CEF, sem snapshot CEF) → NÃO dispara', () => {
    const motivos = detectaBancoSemDado({
      ...baseInput,
      eventos: [],
      saldos: [],
    });
    expect(motivos).toEqual([]);
  });

  it('snapshot CEF presente sem evento CEF recente → dispara, ultima_data=undefined', () => {
    const saldo = mkSaldo({
      id: 's1',
      legal_entity_id: 'u1',
      origem: 'cef',
      data_referencia: utcMk(2026, 4, 30),
    });
    const motivos = detectaBancoSemDado({
      ...baseInput,
      eventos: [],
      saldos: [saldo],
    });
    expect(motivos).toHaveLength(1);
    expect(motivos[0]!.tipo).toBe('banco_sem_dado_recente');
    expect(motivos[0]!.ultima_data_observada).toBeUndefined();
  });

  it('múltiplas unidades — só as ativas são avaliadas, ordenadas lex', () => {
    const cefAntigoU2 = mkEvento({
      id: 'u2-cef',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 1, 1),
      data_esperada: utcMk(2026, 1, 1),
    });
    const cefAntigoU1 = mkEvento({
      id: 'u1-cef',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utcMk(2026, 1, 1),
      data_esperada: utcMk(2026, 1, 1),
    });
    const motivos = detectaBancoSemDado({
      ...baseInput,
      legal_entity_ids_ativas: ['u2', 'u1'],
      eventos: [cefAntigoU2, cefAntigoU1],
      saldos: [],
    });
    expect(motivos).toHaveLength(2);
    expect(motivos.map((m) => m.legal_entity_id)).toEqual(['u1', 'u2']);
  });
});
