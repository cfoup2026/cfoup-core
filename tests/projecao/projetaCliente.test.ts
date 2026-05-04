import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import {
  ProjecaoError,
  projetaCliente,
  projetaUnidade,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
} from '../../src/index.js';
import { mkEvento, utc } from '../reconciliacao/fixtures/mkEvento.js';

const calendar = new BrazilCalendarPolicy();
const GERADO_EM = utc(2026, 5, 1); // sex, W18

function snapshot(args: {
  id: string;
  cliente_id?: string;
  legal_entity_id: string;
  valor: number;
  data_referencia: Date;
}): OpeningBalanceSnapshot {
  return {
    id: args.id,
    cliente_id: args.cliente_id ?? 'c1',
    legal_entity_id: args.legal_entity_id,
    conta_bancaria_id: 'b1',
    valor: args.valor,
    data_referencia: args.data_referencia,
    origem: 'cef',
    criado_em: new Date('2026-05-01T00:00:00.000Z'),
    criado_por: 'sistema',
  };
}

/* ─── Critério 2: ProjecaoUnidade do 4.1 vai intacta ─── */

describe('projetaCliente — unidades vêm intactas do 4.1', () => {
  it('cada unidade retornada é byte-for-byte igual ao output direto de projetaUnidade', () => {
    const eventos = [
      mkEvento({
        id: 'e1',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 1000,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'e2',
        cliente_id: 'c1',
        legal_entity_id: 'u2',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'saida',
        valor: 500,
        data_vencimento: utc(2026, 5, 15),
        data_esperada: utc(2026, 5, 15),
      }),
    ];
    const r = projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });

    const u1Direct = projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      geradoEm: GERADO_EM,
      calendar,
    });
    const u2Direct = projetaUnidade({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      geradoEm: GERADO_EM,
      calendar,
    });

    expect(r.unidades.find((u) => u.legal_entity_id === 'u1')).toEqual(u1Direct);
    expect(r.unidades.find((u) => u.legal_entity_id === 'u2')).toEqual(u2Direct);
  });
});

/* ─── Critério 3: Caixa inicial consolidado ─── */

describe('projetaCliente — caixa inicial consolidado', () => {
  it('soma vetorial: U1=1000 + U2=500 → 1500', () => {
    const saldos = [
      snapshot({ id: 's1', legal_entity_id: 'u1', valor: 1000, data_referencia: utc(2026, 4, 30) }),
      snapshot({ id: 's2', legal_entity_id: 'u2', valor: 500, data_referencia: utc(2026, 4, 30) }),
    ];
    const r = projetaCliente({
      eventos: [],
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.caixaInicial.valor).toBe(1500);
    expect(r.consolidado.caixaInicial.alguma_ausente).toBe(false);
    expect(r.consolidado.caixaInicial.alguma_stale).toBe(false);
    expect(r.consolidado.caixaInicial.por_unidade.size).toBe(2);
  });

  it('1 unidade sem snapshot → consolidado parcial + alguma_ausente=true', () => {
    const saldos = [
      snapshot({ id: 's1', legal_entity_id: 'u1', valor: 1000, data_referencia: utc(2026, 4, 30) }),
      // u2 sem snapshot
    ];
    const r = projetaCliente({
      eventos: [],
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.caixaInicial.valor).toBe(1000);
    expect(r.consolidado.caixaInicial.alguma_ausente).toBe(true);
    expect(r.consolidado.caixaInicial.por_unidade.get('u2')!.ausente).toBe(true);
  });

  it('alguma stale propaga', () => {
    const saldos = [
      snapshot({ id: 's1', legal_entity_id: 'u1', valor: 1000, data_referencia: utc(2026, 4, 30) }),
      snapshot({ id: 's2', legal_entity_id: 'u2', valor: 500, data_referencia: utc(2026, 4, 1) }), // stale
    ];
    const r = projetaCliente({
      eventos: [],
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.caixaInicial.alguma_stale).toBe(true);
  });
});

/* ─── Critérios 4, 5, 6: Soma → neutralização → totais → roll-forward ─── */

describe('projetaCliente — ordem soma → neutraliza → totais → roll-forward', () => {
  it('Critério 4: soma bruta de fluxos por semana antes da neutralização', () => {
    const eU1 = mkEvento({
      id: 'eU1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 100,
      data_realizada: utc(2026, 5, 5), // W19
      data_esperada: utc(2026, 5, 5),
    });
    const eU2 = mkEvento({
      id: 'eU2',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 50,
      data_realizada: utc(2026, 5, 6), // W19
      data_esperada: utc(2026, 5, 6),
    });
    const r = projetaCliente({
      eventos: [eU1, eU2],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    // W19 = idx 1.
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(150);
    expect(r.consolidado.semanas[1]!.total_entradas).toBe(150);
  });

  it('Critério 5: par válido — antes neutraliza 50k saída/entrada, depois zero, totais e roll-forward consistentes', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 50000,
      data_realizada: utc(2026, 5, 5), // W19
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
      data_realizada: utc(2026, 5, 6), // W19
      data_esperada: utc(2026, 5, 6),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });

    // Visão por unidade: aparece (não muda).
    const u1 = r.unidades.find((u) => u.legal_entity_id === 'u1')!;
    const u2 = r.unidades.find((u) => u.legal_entity_id === 'u2')!;
    expect(u1.semanas[1]!.saidas_realizadas).toBe(50000);
    expect(u2.semanas[1]!.entradas_realizadas).toBe(50000);

    // Consolidado: zerado em W19.
    const w19 = r.consolidado.semanas[1]!;
    expect(w19.saidas_realizadas).toBe(0);
    expect(w19.entradas_realizadas).toBe(0);
    expect(w19.total_entradas).toBe(0);
    expect(w19.total_saidas).toBe(0);
    expect(w19.variacao_liquida).toBe(0);
    expect(w19.evento_ids).toEqual([]);

    // Roll-forward consolidado: caixa_final[1] = caixa_inicial[2].
    expect(r.consolidado.semanas[1]!.caixa_final).toBe(
      r.consolidado.semanas[2]!.caixa_inicial,
    );

    // Auditoria.
    expect(r.consolidado.transferenciasNeutralizadas).toHaveLength(1);
    expect(r.consolidado.transferenciasNeutralizadas[0]!.valido).toBe(true);
    expect(r.consolidado.transferenciasNeutralizadas[0]!.valor).toBe(50000);
  });

  it('Critério 6: roll-forward consistente em fixture com 2 transferências em semanas diferentes', () => {
    // Snapshot inicial 10k em U1 + 5k em U2 = 15k consolidado.
    const saldos = [
      snapshot({ id: 's1', legal_entity_id: 'u1', valor: 10000, data_referencia: utc(2026, 4, 30) }),
      snapshot({ id: 's2', legal_entity_id: 'u2', valor: 5000, data_referencia: utc(2026, 4, 30) }),
    ];
    // Transferência 1 em W19 (R$ 1k).
    const a1 = mkEvento({
      id: 'a1',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 5),
      data_esperada: utc(2026, 5, 5),
      is_transferencia: true,
      transferencia_par_id: 'b1',
    });
    const b1 = mkEvento({
      id: 'b1',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 6),
      data_esperada: utc(2026, 5, 6),
      is_transferencia: true,
      transferencia_par_id: 'a1',
    });
    // Transferência 2 em W22 (R$ 2k).
    const a2 = mkEvento({
      id: 'a2',
      cliente_id: 'c1',
      legal_entity_id: 'u2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 2000,
      data_realizada: utc(2026, 5, 26),
      data_esperada: utc(2026, 5, 26),
      is_transferencia: true,
      transferencia_par_id: 'b2',
    });
    const b2 = mkEvento({
      id: 'b2',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 2000,
      data_realizada: utc(2026, 5, 27),
      data_esperada: utc(2026, 5, 27),
      is_transferencia: true,
      transferencia_par_id: 'a2',
    });
    // Mais um evento real não-transferência: saída 800 em W20.
    const real = mkEvento({
      id: 'real',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 800,
      data_realizada: utc(2026, 5, 13),
      data_esperada: utc(2026, 5, 13),
    });
    const r = projetaCliente({
      eventos: [a1, b1, a2, b2, real],
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });

    // Roll-forward consolidado: invariante caixa_final[k] = caixa_inicial[k+1].
    for (let k = 0; k < 12; k++) {
      expect(r.consolidado.semanas[k]!.caixa_final).toBe(
        r.consolidado.semanas[k + 1]!.caixa_inicial,
      );
    }

    // Início = 15k.
    expect(r.consolidado.semanas[0]!.caixa_inicial).toBe(15000);
    // W19 (idx 1): tudo zerado por neutralização.
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(0);
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(0);
    // W20 (idx 2): saída 800.
    expect(r.consolidado.semanas[2]!.saidas_realizadas).toBe(800);
    // W22 (idx 4): tudo zerado por neutralização.
    expect(r.consolidado.semanas[4]!.saidas_realizadas).toBe(0);
    expect(r.consolidado.semanas[4]!.entradas_realizadas).toBe(0);

    // Caixa final consolidado = 15000 - 800 = 14200 (transferências net=0).
    expect(r.consolidado.semanas[12]!.caixa_final).toBe(14200);

    // 2 pares válidos.
    expect(
      r.consolidado.estatisticas.transferenciasNeutralizadasValidas,
    ).toBe(2);
  });
});

/* ─── Critérios 7-12: Casos individuais ─── */

describe('projetaCliente — neutralização válida (cenário canônico)', () => {
  it('par válido: subtração no consolidado, visão unidade preservada, auditoria correta', () => {
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
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(0);
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(0);
    const u1 = r.unidades.find((u) => u.legal_entity_id === 'u1')!;
    expect(u1.semanas[1]!.saidas_realizadas).toBe(50000);
  });
});

describe('projetaCliente — neutralização inválida', () => {
  it('par_inexistente: par_id aponta pra id que não existe → não neutraliza', () => {
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
      transferencia_par_id: 'fantasma',
    });
    const r = projetaCliente({
      eventos: [a],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(1000);
    expect(r.consolidado.transferenciasNeutralizadas[0]!.valido).toBe(false);
    expect(
      r.consolidado.transferenciasNeutralizadas[0]!.motivo_invalidez,
    ).toBe('par_inexistente');
    // Conta como par avaliado (1×).
    expect(
      r.consolidado.estatisticas.transferenciasParesAvaliados,
    ).toBe(1);
  });

  it('nao_reciproco: A→B mas B→C → ambos aparecem no consolidado', () => {
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
      transferencia_par_id: 'c',
    });
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(1000);
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(1000);
    const regA = r.consolidado.transferenciasNeutralizadas.find(
      (x) => x.evento_a_id === 'a',
    )!;
    expect(regA.motivo_invalidez).toBe('nao_reciproco');
  });

  it('mesma_unidade: A e B na mesma U1 → não neutraliza', () => {
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
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.transferenciasNeutralizadas[0]!.motivo_invalidez).toBe(
      'mesma_unidade',
    );
    // Eventos não-neutralizados aparecem no consolidado.
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(100);
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(100);
  });

  it('cliente_diferente: A em c1, B em c2 → não neutraliza', () => {
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
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.transferenciasNeutralizadas[0]!.motivo_invalidez).toBe(
      'cliente_diferente',
    );
    // A aparece (B é de outro cliente, fora deste consolidado).
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(100);
  });

  it('fora_janela: par_a dentro, par_b atrasado → não neutraliza nenhum', () => {
    const a = mkEvento({
      id: 'a',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
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
      valor: 1000,
      data_realizada: utc(2026, 4, 1), // antes da janela
      data_esperada: utc(2026, 4, 1),
      is_transferencia: true,
      transferencia_par_id: 'a',
    });
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.consolidado.transferenciasNeutralizadas[0]!.motivo_invalidez).toBe(
      'fora_janela',
    );
    // A (em W19) aparece no consolidado.
    expect(r.consolidado.semanas[1]!.saidas_realizadas).toBe(1000);
    // B (atrasado) não entra na janela em U2 → não está em nenhuma semana.
    const u2 = r.unidades.find((u) => u.legal_entity_id === 'u2')!;
    expect(u2.eventosAtrasados).toContain('b');
  });
});

/* ─── Critério 13: Filtro por legal_entity_ids_ativas ─── */

describe('projetaCliente — filtro por legal_entity_ids_ativas', () => {
  it('U3 presente em eventos mas fora da lista ativa → ignorada', () => {
    const eventos = [
      mkEvento({
        id: 'eU1',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 100,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
      mkEvento({
        id: 'eU3',
        cliente_id: 'c1',
        legal_entity_id: 'u3', // não ativa
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 9999,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
      }),
    ];
    const r = projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.unidades).toHaveLength(1);
    expect(r.unidades[0]!.legal_entity_id).toBe('u1');
    // Consolidado só vê 100, não 9999.
    expect(r.consolidado.semanas[1]!.entradas_realizadas).toBe(100);
  });

  it('legal_entity_ids_ativas vazio → unidades=[], consolidado todo zero', () => {
    const r = projetaCliente({
      eventos: [
        mkEvento({
          id: 'e',
          cliente_id: 'c1',
          legal_entity_id: 'u1',
          status: 'realizado',
          origem: 'cef',
          direcao: 'entrada',
          valor: 1000,
          data_realizada: utc(2026, 5, 5),
          data_esperada: utc(2026, 5, 5),
        }),
      ],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: [],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r.unidades).toEqual([]);
    expect(r.consolidado.semanas).toHaveLength(13);
    expect(r.consolidado.caixaInicial.valor).toBe(0);
    for (const s of r.consolidado.semanas) {
      expect(s.entradas_realizadas).toBe(0);
      expect(s.caixa_inicial).toBe(0);
      expect(s.caixa_final).toBe(0);
    }
  });
});

/* ─── Critério 14: Determinismo ─── */

describe('projetaCliente — determinismo', () => {
  it('2 chamadas → deepEqual', () => {
    const eventos = [
      mkEvento({
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
      }),
      mkEvento({
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
      }),
    ];
    const saldos = [
      snapshot({ id: 's', legal_entity_id: 'u1', valor: 5000, data_referencia: utc(2026, 4, 30) }),
    ];
    const r1 = projetaCliente({
      eventos,
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    const r2 = projetaCliente({
      eventos,
      saldos,
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r2).toEqual(r1);
  });

  it('ordem de legal_entity_ids_ativas no input não muda output (lex internamente)', () => {
    const eventos: EventoCaixa[] = [];
    const r1 = projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u3', 'u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    const r2 = projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2', 'u3'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(r2).toEqual(r1);
    expect(r1.unidades.map((u) => u.legal_entity_id)).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(r1.consolidado.legal_entity_ids).toEqual(['u1', 'u2', 'u3']);
  });
});

/* ─── Critério 15: Imutabilidade ─── */

describe('projetaCliente — imutabilidade', () => {
  it('input eventos não é mutado', () => {
    const eventos = [
      mkEvento({
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
      }),
      mkEvento({
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
        transferencia_par_id: 'a',
      }),
    ];
    const before = JSON.stringify(eventos);
    projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    expect(JSON.stringify(eventos)).toBe(before);
  });
});

/* ─── Critério 16: Estatísticas ─── */

describe('projetaCliente — estatísticas', () => {
  it('identidade: validas + invalidas = paresAvaliados', () => {
    const eventos = [
      // Par válido
      mkEvento({
        id: 'va',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 100,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
        is_transferencia: true,
        transferencia_par_id: 'vb',
      }),
      mkEvento({
        id: 'vb',
        cliente_id: 'c1',
        legal_entity_id: 'u2',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 100,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
        is_transferencia: true,
        transferencia_par_id: 'va',
      }),
      // Órfão
      mkEvento({
        id: 'orfa',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'realizado',
        origem: 'cef',
        direcao: 'saida',
        valor: 50,
        data_realizada: utc(2026, 5, 5),
        data_esperada: utc(2026, 5, 5),
        is_transferencia: true,
        transferencia_par_id: 'fantasma',
      }),
    ];
    const r = projetaCliente({
      eventos,
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    const e = r.consolidado.estatisticas;
    expect(e.unidadesAtivas).toBe(2);
    expect(e.transferenciasMarcadasEventos).toBe(3); // va + vb + orfa
    expect(e.transferenciasParesAvaliados).toBe(2); // par (va,vb) + órfão
    expect(e.transferenciasNeutralizadasValidas).toBe(1);
    expect(e.transferenciasNeutralizadasInvalidas).toBe(1);
    expect(
      e.transferenciasNeutralizadasValidas +
        e.transferenciasNeutralizadasInvalidas,
    ).toBe(e.transferenciasParesAvaliados);
  });
});

/* ─── Critério 17: Auditoria + drill-down ─── */

describe('projetaCliente — auditoria estável', () => {
  it('transferenciasNeutralizadas referencia eventos válidos do input', () => {
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
      transferencia_par_id: 'a',
    });
    const r = projetaCliente({
      eventos: [a, b],
      saldos: [],
      cliente_id: 'c1',
      legal_entity_ids_ativas: ['u1', 'u2'],
      geradoEm: GERADO_EM,
      calendar,
    });
    const reg = r.consolidado.transferenciasNeutralizadas[0]!;
    const inputIds = new Set(['a', 'b']);
    expect(inputIds.has(reg.evento_a_id)).toBe(true);
    expect(inputIds.has(reg.evento_b_id)).toBe(true);
  });
});

/* ─── Fail visibly ─── */

describe('projetaCliente — fail visibly', () => {
  it('cliente_id ausente → ProjecaoError', () => {
    expect(() =>
      projetaCliente({
        eventos: [],
        saldos: [],
        cliente_id: '',
        legal_entity_ids_ativas: [],
        geradoEm: GERADO_EM,
        calendar,
      }),
    ).toThrow(ProjecaoError);
  });

  it('geradoEm inválido → ProjecaoError', () => {
    expect(() =>
      projetaCliente({
        eventos: [],
        saldos: [],
        cliente_id: 'c1',
        legal_entity_ids_ativas: [],
        geradoEm: new Date(Number.NaN),
        calendar,
      }),
    ).toThrow(ProjecaoError);
  });

  it('calendar ausente → ProjecaoError', () => {
    expect(() =>
      projetaCliente({
        eventos: [],
        saldos: [],
        cliente_id: 'c1',
        legal_entity_ids_ativas: [],
        geradoEm: GERADO_EM,
        // @ts-expect-error — testando defesa runtime
        calendar: undefined,
      }),
    ).toThrow(ProjecaoError);
  });
});
