import { describe, expect, it } from 'vitest';
import { BrazilCalendarPolicy } from '../../src/calendar/index.js';
import type { AdapterContext } from '../../src/ingestion/index.js';
import {
  IngestaoError,
  buildEventoCaixaBase,
} from '../../src/ingestion/index.js';

const calendar = new BrazilCalendarPolicy();

const ctx: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  calendar,
};

const ctxComCompany: AdapterContext = {
  cliente_id: 'c1',
  legal_entity_id: 'le1',
  source_company_code: 'comp1',
  calendar,
};

const VALID_DATE = new Date('2026-04-15T00:00:00.000Z');

describe('buildEventoCaixaBase — defaults do estágio 1.2', () => {
  it('preenche bucket técnico, criticidade pendente, confiança alta', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: 'fkn-ap:1',
        valor: 1500,
        direcao: 'saida',
        data_esperada: VALID_DATE,
      },
      ctx,
    );
    expect(base.bucket_id).toBe('pendente_classificacao');
    expect(base.bucket_nome).toBe('Pendente de classificação');
    expect(base.criticidade).toBe('pendente');
    expect(base.confianca).toBe('alta');
    expect(base.confianca_origem).toBe('sistema');
    expect(base.is_transferencia).toBe(false);
    expect(base.criado_por).toBe('sistema');
    expect(base.criado_em).toBeInstanceOf(Date);
  });

  it('id determinístico no formato ${origem}_${origem_ref}_${cliente_id}_${legal_entity_id}', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'cef',
        origem_ref: 'cef-pdf:42',
        valor: 100,
        direcao: 'entrada',
        data_esperada: VALID_DATE,
      },
      ctx,
    );
    expect(base.id).toBe('cef_cef-pdf:42_c1_le1');
  });

  it('cliente_id e legal_entity_id vêm do contexto', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: 'x',
        valor: 1,
        direcao: 'saida',
        data_esperada: VALID_DATE,
      },
      ctx,
    );
    expect(base.cliente_id).toBe('c1');
    expect(base.legal_entity_id).toBe('le1');
  });

  it('source_company_code do ctx vai pra base quando informado', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: 'x',
        valor: 1,
        direcao: 'saida',
        data_esperada: VALID_DATE,
      },
      ctxComCompany,
    );
    expect(base.source_company_code).toBe('comp1');
  });

  it('source_company_code não vai pra base quando ctx omite', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: 'x',
        valor: 1,
        direcao: 'saida',
        data_esperada: VALID_DATE,
      },
      ctx,
    );
    expect(base.source_company_code).toBeUndefined();
  });

  it('opcionais (contraparte_id, contraparte_tipo, documento_ref, competencia) passam adiante', () => {
    const base = buildEventoCaixaBase(
      {
        origem: 'fkn',
        origem_ref: 'x',
        valor: 1,
        direcao: 'saida',
        data_esperada: VALID_DATE,
        contraparte_id: '12345',
        contraparte_tipo: 'fornecedor',
        documento_ref: 'NF 999',
        competencia: '2026-04',
      },
      ctx,
    );
    expect(base.contraparte_id).toBe('12345');
    expect(base.contraparte_tipo).toBe('fornecedor');
    expect(base.documento_ref).toBe('NF 999');
    expect(base.competencia).toBe('2026-04');
  });
});

describe('buildEventoCaixaBase — validação visível', () => {
  it('valor zero → IngestaoError', () => {
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'fkn',
          origem_ref: 'x',
          valor: 0,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(IngestaoError);
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'fkn',
          origem_ref: 'x',
          valor: 0,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(/valor deve ser positivo/);
  });

  it('valor negativo → IngestaoError', () => {
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'fkn',
          origem_ref: 'x',
          valor: -100,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(/valor deve ser positivo/);
  });

  it('valor NaN → IngestaoError', () => {
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'fkn',
          origem_ref: 'x',
          valor: Number.NaN,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(IngestaoError);
  });

  it('data_esperada inválida (NaN) → IngestaoError', () => {
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'fkn',
          origem_ref: 'x',
          valor: 100,
          direcao: 'saida',
          data_esperada: new Date(Number.NaN),
        },
        ctx,
      ),
    ).toThrow(/data_esperada/);
  });

  it('origem="historico" via adapter externo → IngestaoError', () => {
    // `origem="historico"` é exclusiva do MotorHistorico (Estágio 2.2).
    // `buildEventoCaixaBase` rejeita pra impedir adapter externo de
    // forjar essa origem.
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'historico',
          origem_ref: 'x',
          valor: 100,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(IngestaoError);
    expect(() =>
      buildEventoCaixaBase(
        {
          origem: 'historico',
          origem_ref: 'x',
          valor: 100,
          direcao: 'saida',
          data_esperada: VALID_DATE,
        },
        ctx,
      ),
    ).toThrow(/exclusiva do Motor de Histórico/);
  });
});
