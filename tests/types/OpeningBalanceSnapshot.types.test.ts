/**
 * Type tests do `OpeningBalanceSnapshot` — validados pelo `tsc --noEmit`.
 * Mesmo padrão do EventoCaixa: positivos compilam, negativos usam
 * `@ts-expect-error` para garantir bloqueio em campo ausente ou enum inválido.
 */
import { describe, it } from 'vitest';
import type { OpeningBalanceSnapshot } from '../../src/types/index.js';

const validOpening: OpeningBalanceSnapshot = {
  id: 'obs_001',
  cliente_id: 'cli_alpha',
  legal_entity_id: 'le_alpha_main',
  conta_bancaria_id: 'cb_cef_main',
  valor: 152340.55,
  data_referencia: new Date('2026-04-01T00:00:00.000Z'),
  origem: 'cef',
  criado_em: new Date('2026-04-15T12:00:00.000Z'),
  criado_por: 'sistema',
};

describe('OpeningBalanceSnapshot — válidos compilam', () => {
  it('saldo positivo', () => {
    void validOpening;
  });

  it('saldo negativo (cheque especial) é permitido', () => {
    const ob: OpeningBalanceSnapshot = {
      ...validOpening,
      id: 'obs_002',
      valor: -2500,
    };
    void ob;
  });
});

describe('OpeningBalanceSnapshot — bloqueios de compilação', () => {
  it('SEM cliente_id → não compila', () => {
    const { cliente_id: _omit, ...rest } = validOpening;
    void _omit;
    // @ts-expect-error cliente_id é obrigatório
    const ob: OpeningBalanceSnapshot = { ...rest, id: 'obs_a' };
    void ob;
  });

  it('SEM conta_bancaria_id → não compila', () => {
    const { conta_bancaria_id: _omit, ...rest } = validOpening;
    void _omit;
    // @ts-expect-error conta_bancaria_id é obrigatório
    const ob: OpeningBalanceSnapshot = { ...rest, id: 'obs_b' };
    void ob;
  });

  it('SEM data_referencia → não compila', () => {
    const { data_referencia: _omit, ...rest } = validOpening;
    void _omit;
    // @ts-expect-error data_referencia é obrigatório
    const ob: OpeningBalanceSnapshot = { ...rest, id: 'obs_c' };
    void ob;
  });

  it('SEM valor → não compila', () => {
    const { valor: _omit, ...rest } = validOpening;
    void _omit;
    // @ts-expect-error valor é obrigatório
    const ob: OpeningBalanceSnapshot = { ...rest, id: 'obs_d' };
    void ob;
  });

  it('origem fora do enum → não compila', () => {
    const ob: OpeningBalanceSnapshot = {
      ...validOpening,
      id: 'obs_e',
      // @ts-expect-error 'banco' não pertence ao enum Origem
      origem: 'banco',
    };
    void ob;
  });
});

describe('OpeningBalanceSnapshot — não reusa campos do EventoCaixa', () => {
  it('shape distinto: tem conta_bancaria_id que EventoCaixa não tem', () => {
    // Validação estrutural: o campo conta_bancaria_id é específico de OBS;
    // EventoCaixa não tem campo equivalente. Ler o campo aqui prova que
    // ele existe no tipo OBS.
    const cb: string = validOpening.conta_bancaria_id;
    void cb;
  });

  it('OBS não aceita campos exclusivos de EventoCaixa (ex: bucket_id)', () => {
    const ob: OpeningBalanceSnapshot = {
      ...validOpening,
      id: 'obs_f',
      // @ts-expect-error bucket_id pertence a EventoCaixa, não a OpeningBalanceSnapshot
      bucket_id: 'pendente_classificacao',
    };
    void ob;
  });
});
