import { describe, expect, it } from 'vitest';
import {
  BUCKETS_OBRIGACAO_FIXA,
  detectaRecorrenciaAusente,
} from '../../src/index.js';
import { mkEvento, utc as utcMk } from '../reconciliacao/fixtures/mkEvento.js';
import {
  mkHistorico,
  mkProjecao,
  mkRecorrencia,
  mkUnidade,
  utc,
} from './fixtures/index.js';

const GERADO_EM = utcMk(2026, 5, 1);

describe('detectaRecorrenciaAusente', () => {
  it('hardcoded BUCKETS_OBRIGACAO_FIXA contém folha, deducoes, despesas_financeiras', () => {
    expect(BUCKETS_OBRIGACAO_FIXA.has('folha')).toBe(true);
    expect(BUCKETS_OBRIGACAO_FIXA.has('deducoes')).toBe(true);
    expect(BUCKETS_OBRIGACAO_FIXA.has('despesas_financeiras')).toBe(true);
    expect(BUCKETS_OBRIGACAO_FIXA.has('despesas_operacionais')).toBe(false);
    expect(BUCKETS_OBRIGACAO_FIXA.size).toBe(3);
  });

  it('recorrência mensal de folha (alta, ativa) → projeta próxima ocorrência → pendência se ausente', () => {
    // Última ocorrência: 2026-04-15 (W16). Mensal (+30d) → 2026-05-15 (W20, idx 2).
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_folha',
      bucket_id: 'folha',
      contraparte_id: 'fornecedor-folha',
      ultima_data: utc(2026, 4, 15),
      valor_mediano: 50_000,
      direcao: 'saida',
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    const pends = detectaRecorrenciaAusente({
      eventos: [],
      historico,
      projecao,
    });
    expect(pends.length).toBeGreaterThanOrEqual(1);
    const w20 = pends.find((p) => p.semana_iso === '2026-W20');
    expect(w20).toBeDefined();
    expect(w20!.tipo).toBe('recorrencia_ausente');
    expect(w20!.recorrencia_id).toBe('rec_folha');
    expect(w20!.bucket_id).toBe('folha');
    expect(w20!.contraparte_id).toBe('fornecedor-folha');
    expect(w20!.valor_esperado).toBe(50_000);
    expect(w20!.acoes_sugeridas).toEqual([
      'adicionar_evento_manual',
      'verificar_recorrencia',
    ]);
  });

  it('TRAVA: semana esperada já tem evento (contraparte_id, bucket_id) correspondente → NÃO dispara', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_folha',
      bucket_id: 'folha',
      contraparte_id: 'fornecedor-folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    // Evento alocado na W20 com bucket=folha + contraparte=fornecedor-folha.
    const evtCobrindo = mkEvento({
      id: 'cobre',
      cliente_id: 'c1',
      legal_entity_id: 'u1',
      status: 'estimado',
      origem: 'historico',
      direcao: 'saida',
      valor: 50_000,
      data_esperada: utc(2026, 5, 15),
      contraparte_id: 'fornecedor-folha',
    });
    // Bucket precisa ser 'folha' — mkEvento default é 'pendente_classificacao'.
    // Spread para sobrescrever.
    const evtCobrindoFolha = { ...evtCobrindo, bucket_id: 'folha' };

    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['cobre'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    const pends = detectaRecorrenciaAusente({
      eventos: [evtCobrindoFolha],
      historico,
      projecao,
    });
    // W20 não dispara — coberta. Mas próximas ocorrências (W24, W28, ...) podem disparar.
    expect(pends.find((p) => p.semana_iso === '2026-W20')).toBeUndefined();
  });

  it('TRAVA: bucket diferente ou contraparte diferente → continua disparando', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_folha',
      bucket_id: 'folha',
      contraparte_id: 'fornecedor-folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    // Evento na semana certa, mas contraparte diferente.
    const evtOutroFornec = {
      ...mkEvento({
        id: 'outro',
        cliente_id: 'c1',
        legal_entity_id: 'u1',
        status: 'estimado',
        origem: 'historico',
        direcao: 'saida',
        valor: 50_000,
        data_esperada: utc(2026, 5, 15),
        contraparte_id: 'OUTRO',
      }),
      bucket_id: 'folha',
    };
    const eventos_por_semana = Array.from({ length: 13 }, (_, i) =>
      i === 2 ? { evento_ids: ['outro'] } : {},
    );
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1', eventos_por_semana })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    const pends = detectaRecorrenciaAusente({
      eventos: [evtOutroFornec],
      historico,
      projecao,
    });
    expect(pends.find((p) => p.semana_iso === '2026-W20')).toBeDefined();
  });

  it('confianca=baixa → NÃO dispara mesmo se ativa+bucket fixo', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_baixa',
      bucket_id: 'folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
      confianca: 'baixa',
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    expect(
      detectaRecorrenciaAusente({ eventos: [], historico, projecao }),
    ).toEqual([]);
  });

  it('ativa=false → NÃO dispara', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_inativa',
      bucket_id: 'folha',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
      ativa: false,
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    expect(
      detectaRecorrenciaAusente({ eventos: [], historico, projecao }),
    ).toEqual([]);
  });

  it('saída fora dos buckets fixos (despesas_operacionais) → NÃO dispara', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_op',
      bucket_id: 'despesas_operacionais',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    expect(
      detectaRecorrenciaAusente({ eventos: [], historico, projecao }),
    ).toEqual([]);
  });

  it('entrada (recebível recorrente) → dispara mesmo fora dos buckets fixos', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_recebivel',
      bucket_id: 'receita',
      ultima_data: utc(2026, 4, 15),
      direcao: 'entrada',
      valor_mediano: 10_000,
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })],
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    const pends = detectaRecorrenciaAusente({
      eventos: [],
      historico,
      projecao,
    });
    expect(pends.length).toBeGreaterThan(0);
    expect(pends[0]!.bucket_id).toBe('receita');
  });

  it('unidade da recorrência fora de projecao.unidades → NÃO dispara', () => {
    const rec = mkRecorrencia({
      recorrencia_id: 'rec_fora',
      bucket_id: 'folha',
      legal_entity_id: 'u_fora',
      ultima_data: utc(2026, 4, 15),
      direcao: 'saida',
    });
    const projecao = mkProjecao({
      unidades: [mkUnidade({ legal_entity_id: 'u1' })], // u_fora não está
    });
    const historico = mkHistorico({ recorrencias: [rec] });
    expect(
      detectaRecorrenciaAusente({ eventos: [], historico, projecao }),
    ).toEqual([]);
  });
});
