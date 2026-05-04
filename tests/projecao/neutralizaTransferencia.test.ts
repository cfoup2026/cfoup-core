import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  avaliaTransferencias,
  projetaUnidade,
} from '../../src/projecao/index.js';
import type {
  EventoCaixa,
  ProjecaoUnidade,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utc(2026, 5, 1); // sex, W18

/**
 * Helper: roda projetaUnidade pra cada legal_entity_id e devolve um
 * Map idx por id, pra avaliaTransferencias consumir.
 */
function projUnidades(
  eventos: EventoCaixa[],
  ids: string[],
): {
  unidadesPorId: Map<string, ProjecaoUnidade>;
  janela: string[];
} {
  const unidades = ids.map((id) =>
    projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: id,
      geradoEm: GERADO_EM,
      calendar,
    }),
  );
  const unidadesPorId = new Map<string, ProjecaoUnidade>();
  for (const u of unidades) unidadesPorId.set(u.legal_entity_id, u);
  return { unidadesPorId, janela: unidades[0]!.janela };
}

/* ─── Par válido (caso base) ─── */

describe('avaliaTransferencias — par válido', () => {
  it('par recíproco intra-cliente, inter-unidade, direções opostas, dentro da janela → válido + 2 subtrações', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50000,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 50000,
      data_realizada: utc(2026, 5, 6),
      data_esperada: utc(2026, 5, 6),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);

    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });

    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]!.valido).toBe(true);
    expect(r.registros[0]!.evento_a_id).toBe('a');
    expect(r.registros[0]!.evento_b_id).toBe('b');
    expect(r.registros[0]!.valor).toBe(50000);
    // Mesma semana W19 (idx 1).
    expect(r.registros[0]!.semana_a).toBe('2026-W19');
    expect(r.registros[0]!.semana_b).toBe('2026-W19');

    expect(r.subtracoes).toHaveLength(2);
    const subA = r.subtracoes.find((s) => s.evento_id === 'a')!;
    const subB = r.subtracoes.find((s) => s.evento_id === 'b')!;
    expect(subA.bucket).toBe('saidas_realizadas');
    expect(subA.valor).toBe(50000);
    expect(subB.bucket).toBe('entradas_realizadas');
    expect(subB.valor).toBe(50000);
    expect(r.marcadosCount).toBe(2);
  });

  it('par válido em semanas diferentes (saída W19, entrada W20) → cada subtração na sua semana', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 8), // W19 (Fri)
      data_esperada: utc(2026, 5, 8),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 11), // W20 (Mon)
      data_esperada: utc(2026, 5, 11),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r.registros[0]!.valido).toBe(true);
    expect(r.registros[0]!.semana_a).toBe('2026-W19');
    expect(r.registros[0]!.semana_b).toBe('2026-W20');
    const subA = r.subtracoes.find((s) => s.evento_id === 'a')!;
    const subB = r.subtracoes.find((s) => s.evento_id === 'b')!;
    expect(subA.semanaIdx).toBe(1); // W19
    expect(subB.semanaIdx).toBe(2); // W20
  });
});

/* ─── Par inválido (todos os 6 motivos) ─── */

describe('avaliaTransferencias — par inválido (motivos exaustivos)', () => {
  it('par_inexistente: transferencia_par_id ausente', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      // sem transferencia_par_id
    });
    const eventos = [a];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]!.valido).toBe(false);
    expect(r.registros[0]!.motivo_invalidez).toBe('par_inexistente');
    expect(r.registros[0]!.evento_b_id).toBe('');
    expect(r.subtracoes).toHaveLength(0);
  });

  it('par_inexistente: transferencia_par_id aponta pra id que não existe', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'fantasma',
    });
    const eventos = [a];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r.registros[0]!.motivo_invalidez).toBe('par_inexistente');
    expect(r.registros[0]!.evento_b_id).toBe('fantasma');
  });

  it('cliente_diferente: par aponta pra evento de outro cliente', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c2', // OUTRO cliente
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const todos = [a, b];
    const eventosCliente = [a]; // só do cliente C1
    const { unidadesPorId, janela } = projUnidades(eventosCliente, ['u1']);
    const r = avaliaTransferencias({
      eventosCliente,
      eventosTodos: todos,
      unidadesPorId,
      janela,
    });
    expect(r.registros[0]!.motivo_invalidez).toBe('cliente_diferente');
    expect(r.subtracoes).toHaveLength(0);
  });

  it('mesma_unidade: A e B no mesmo legal_entity_id', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u1', // MESMA unidade
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    // Ambos avaliados juntos (1 registro), motivo = mesma_unidade.
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]!.motivo_invalidez).toBe('mesma_unidade');
  });

  it('nao_reciproco: A→B mas B→C', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'c', // não aponta de volta
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    // A será avaliado primeiro (lex). Registro a→b nao_reciproco.
    // B então é avaliado independentemente: aponta pra 'c' que não
    // existe → outro registro par_inexistente.
    expect(r.registros).toHaveLength(2);
    const regA = r.registros.find((x) => x.evento_a_id === 'a')!;
    const regB = r.registros.find((x) => x.evento_a_id === 'b')!;
    expect(regA.motivo_invalidez).toBe('nao_reciproco');
    expect(regB.motivo_invalidez).toBe('par_inexistente');
    expect(r.subtracoes).toHaveLength(0);
  });

  it('mesma_direcao: A e B ambos saída', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida', // ambos saída
      valor: 100,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]!.motivo_invalidez).toBe('mesma_direcao');
  });

  it('fora_janela: A dentro da janela mas B fora', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 100,
      data_realizada: utc(2026, 5, 5), // W19, dentro
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 100,
      data_realizada: utc(2026, 4, 1), // antes da janela (atrasado)
      data_esperada: utc(2026, 4, 1),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);
    const r = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r.registros[0]!.motivo_invalidez).toBe('fora_janela');
    expect(r.registros[0]!.semana_a).toBe('2026-W19');
    expect(r.registros[0]!.semana_b).toBeUndefined();
    expect(r.subtracoes).toHaveLength(0);
  });
});

/* ─── Determinismo + identidade ─── */

describe('avaliaTransferencias — determinismo e identidade', () => {
  it('registros ordenados por evento_a_id lex', () => {
    const events: EventoCaixa[] = [];
    const ids = ['z', 'a', 'm'];
    for (const id of ids) {
      events.push(
        mkEvento({
          id,
          cliente_id: 'c1',
          legal_entity_id: 'u1',
          status: 'realizado',
          origem: 'cef',
          direcao: 'saida',
          valor: 1,
          data_realizada: utc(2026, 5, 5),
          data_esperada: utc(2026, 5, 5),
          is_transferencia: true,
          // sem par
        }),
      );
    }
    const { unidadesPorId, janela } = projUnidades(events, ['u1']);
    const r = avaliaTransferencias({
      eventosCliente: events,
      eventosTodos: events,
      unidadesPorId,
      janela,
    });
    expect(r.registros.map((x) => x.evento_a_id)).toEqual(['a', 'm', 'z']);
  });

  it('determinismo: 2 chamadas → deepEqual', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b',
    });
    const b = mkEvento({
      id: 'b',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const eventos = [a, b];
    const { unidadesPorId, janela } = projUnidades(eventos, ['u1', 'u2']);
    const r1 = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    const r2 = avaliaTransferencias({
      eventosCliente: eventos,
      eventosTodos: eventos,
      unidadesPorId,
      janela,
    });
    expect(r2).toEqual(r1);
  });
});
