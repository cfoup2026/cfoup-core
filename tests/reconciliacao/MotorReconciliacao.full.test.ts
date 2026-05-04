import { describe, expect, it } from 'vitest';
import { MotorReconciliacao } from '../../src/index.js';
import type { VendaComercial } from '../../src/types/index.js';
import { mkEvento, utc } from './fixtures/mkEvento.js';

const RECON_EM = new Date('2026-05-30T12:00:00.000Z');

describe('MotorReconciliacao — orquestração completa (3.1 + 3.1.1 + transferência + 3.2)', () => {
  it('roda 3.1 + transferência + Vendas↔AR em ordem correta', () => {
    // P1: confirmado FKN AR + CEF correspondente → match
    const arConf = mkEvento({
      id: 'ar-conf',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'entrada',
      contraparte_tipo: 'cliente',
      contraparte_id: 'cli-x',
      documento_ref: 'NF-100',
      valor: 1000,
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
    });
    const cefRecv = mkEvento({
      id: 'cef-recv',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
    });

    // Transferência interna: U1 → U2 mesmo cliente
    const transOut = mkEvento({
      id: 'trans-out',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 5000,
      data_realizada: utc(2026, 5, 12),
      data_esperada: utc(2026, 5, 12),
      cliente_id: 'cli_test',
      legal_entity_id: 'u1',
    });
    const transIn = mkEvento({
      id: 'trans-in',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 5000,
      data_realizada: utc(2026, 5, 12),
      data_esperada: utc(2026, 5, 12),
      cliente_id: 'cli_test',
      legal_entity_id: 'u2',
    });

    // Venda comercial que casa com o AR confirmado (vai virar realizado pós-3.1)
    const venda: VendaComercial = {
      id: 'v-1',
      cliente_id: 'cli_test',
      legal_entity_id: 'le_test',
      origem: 'fkn',
      origem_ref: 'NF-100',
      documento_ref: 'NF-100',
      data_emissao: utc(2026, 4, 1),
      valor: 1000,
      contraparte_id: 'cli-x',
      contraparte_tipo: 'cliente',
      prazo: 'a_prazo',
      criado_em: new Date('2026-04-01T00:00:00.000Z'),
      criado_por: 'sistema',
    };

    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([arConf, cefRecv, transOut, transIn], [venda]);

    // 3.1 — match aplicado, CEF absorvido
    expect(out.reconciliacao.estatisticas.matchesAplicados).toBe(1);
    expect(out.reconciliacao.eventosBancariosAbsorvidos.length).toBe(1);
    expect(out.reconciliacao.eventosBancariosAbsorvidos[0]!.evento_bancario_id).toBe(
      'cef-recv',
    );

    // Transferência marcada nos dois eventos
    const tOut = out.reconciliacao.eventos.find((e) => e.id === 'trans-out')!;
    const tIn = out.reconciliacao.eventos.find((e) => e.id === 'trans-in')!;
    expect(tOut.is_transferencia).toBe(true);
    expect(tIn.is_transferencia).toBe(true);
    expect(tOut.transferencia_par_id).toBe('trans-in');
    expect(tIn.transferencia_par_id).toBe('trans-out');

    // 3.2 — venda casou com AR (que virou realizado promovido — mesmo id 'ar-conf')
    expect(out.comercial.estatisticas.matchesAplicados).toBe(1);
    expect(out.comercial.vendas[0]!.reconciliado_com).toBe('ar-conf');
  });

  it('eventos absorvidos por 3.1 não tentam transferência (já estão fora do output)', () => {
    // Cenário: confirmado FKN AR + CEF.
    // O CEF é ABSORVIDO pela 3.1 — não deve aparecer disponível pra transferência.
    const conf = mkEvento({
      id: 'conf',
      status: 'confirmado',
      origem: 'fkn',
      direcao: 'saida',
      valor: 1000,
      data_vencimento: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const cef = mkEvento({
      id: 'cef',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    // Outro evento que poderia "tentar" transferir com o CEF se ele estivesse no array.
    const fakeEntry = mkEvento({
      id: 'fake-in',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2', // outra unidade
    });

    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([conf, cef, fakeEntry]);

    // CEF foi absorvido pela 3.1 → não está em eventos.
    expect(out.reconciliacao.eventos.find((e) => e.id === 'cef')).toBeUndefined();

    // O confirmado promovido (id 'conf', agora realizado) deve casar com fakeEntry?
    // Ambos são realizado, U1 vs U2, valor 1000, mesma data, direções opostas (saida vs entrada).
    // Sim — agora `conf` (promovido pra realizado) faz par com `fakeEntry`.
    const confPromovido = out.reconciliacao.eventos.find((e) => e.id === 'conf');
    const fakeEntryOut = out.reconciliacao.eventos.find((e) => e.id === 'fake-in');
    expect(confPromovido).toBeDefined();
    expect(fakeEntryOut).toBeDefined();
    // Esses dois batem como transferência (mesmo cliente, U1 vs U2, opostos, mesmo valor/data)
    expect(confPromovido!.is_transferencia).toBe(true);
    expect(fakeEntryOut!.is_transferencia).toBe(true);
  });

  it('estimados intocados — sem is_transferencia, sem aparecer em pendências comerciais', () => {
    const est = mkEvento({
      id: 'est',
      status: 'estimado',
      origem: 'historico',
      direcao: 'entrada',
      valor: 1000,
      data_esperada: utc(2026, 5, 10),
    });

    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([est]);

    expect(out.reconciliacao.eventos.find((e) => e.id === 'est')!.is_transferencia)
      .toBe(false);
    expect(
      out.comercial.pendencias.some((p) => p.ar_relacionados.includes('est')),
    ).toBe(false);
  });

  it('determinismo full: 2 runs → deepEqual em ambas estruturas', () => {
    const eventos = [
      mkEvento({
        id: 'c',
        status: 'confirmado',
        origem: 'fkn',
        direcao: 'entrada',
        contraparte_tipo: 'cliente',
        documento_ref: 'NF-D',
        valor: 1000,
        data_vencimento: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
      }),
      mkEvento({
        id: 'b',
        status: 'realizado',
        origem: 'cef',
        direcao: 'entrada',
        valor: 1000,
        data_realizada: utc(2026, 5, 10),
        data_esperada: utc(2026, 5, 10),
      }),
    ];
    const vendas: VendaComercial[] = [
      {
        id: 'v',
        cliente_id: 'cli_test',
        legal_entity_id: 'le_test',
        origem: 'fkn',
        origem_ref: 'NF-D',
        documento_ref: 'NF-D',
        data_emissao: utc(2026, 4, 15),
        valor: 1000,
        contraparte_tipo: 'cliente',
        prazo: 'a_prazo',
        criado_em: new Date('2026-04-15T00:00:00.000Z'),
        criado_por: 'sistema',
      },
    ];
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const a = motor.run(eventos, vendas);
    const b = motor.run(eventos, vendas);
    expect(b).toEqual(a);
  });

  it('pendência transferencia_ambigua entra em reconciliacao.pendencias', () => {
    const saida = mkEvento({
      id: 's',
      status: 'realizado',
      origem: 'cef',
      direcao: 'saida',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u1',
    });
    const e1 = mkEvento({
      id: 'e1',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 10),
      data_esperada: utc(2026, 5, 10),
      cliente_id: 'c1',
      legal_entity_id: 'u2',
    });
    const e2 = mkEvento({
      id: 'e2',
      status: 'realizado',
      origem: 'cef',
      direcao: 'entrada',
      valor: 1000,
      data_realizada: utc(2026, 5, 11),
      data_esperada: utc(2026, 5, 11),
      cliente_id: 'c1',
      legal_entity_id: 'u3',
    });
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([saida, e1, e2]);
    const transferAmbig = out.reconciliacao.pendencias.find(
      (p) => p.tipo === 'transferencia_ambigua',
    );
    expect(transferAmbig).toBeDefined();
    expect(transferAmbig!.eventos_relacionados).toEqual(['e1', 'e2', 's']);
  });

  it('comercial separado de reconciliacao: pendências comerciais não vazam', () => {
    const venda: VendaComercial = {
      id: 'v-orfa',
      cliente_id: 'cli_test',
      legal_entity_id: 'le_test',
      origem: 'fkn',
      origem_ref: 'NF-X',
      data_emissao: utc(2026, 5, 1),
      valor: 5000,
      contraparte_tipo: 'cliente',
      prazo: 'a_prazo',
      criado_em: new Date('2026-05-01T00:00:00.000Z'),
      criado_por: 'sistema',
    };
    const motor = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
    const out = motor.run([], [venda]);
    expect(out.comercial.pendencias.length).toBe(1);
    expect(out.comercial.pendencias[0]!.tipo).toBe('venda_sem_ar');
    // Reconciliação não tem essa pendência.
    expect(
      out.reconciliacao.pendencias.some((p) =>
        p.eventos_relacionados.includes('v-orfa'),
      ),
    ).toBe(false);
  });
});
