import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  addUTCDays,
  parseDDMMYYYYtoUTC,
  parseYYYYMMDDtoUTC,
} from '../../src/utils/date.js';

describe('parseYYYYMMDDtoUTC', () => {
  it('converte data válida pra UTC 00:00:00.000Z', () => {
    const d = parseYYYYMMDDtoUTC('20250401');
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe('2025-04-01T00:00:00.000Z');
  });

  it('retorna null pra data inexistente (30 de fevereiro)', () => {
    expect(parseYYYYMMDDtoUTC('20250230')).toBeNull();
  });

  it('retorna null pra mês inválido', () => {
    expect(parseYYYYMMDDtoUTC('20251301')).toBeNull();
  });

  it('retorna null pra dia inválido', () => {
    expect(parseYYYYMMDDtoUTC('20250100')).toBeNull();
    expect(parseYYYYMMDDtoUTC('20250132')).toBeNull();
  });

  it('retorna null pra ano fora de [1900, 2100]', () => {
    expect(parseYYYYMMDDtoUTC('18991231')).toBeNull();
    expect(parseYYYYMMDDtoUTC('21010101')).toBeNull();
  });

  it('retorna null pra string com tamanho errado ou não-numérica', () => {
    expect(parseYYYYMMDDtoUTC('2025040')).toBeNull();
    expect(parseYYYYMMDDtoUTC('202504011')).toBeNull();
    expect(parseYYYYMMDDtoUTC('2025-04-01')).toBeNull();
    expect(parseYYYYMMDDtoUTC('abcdefgh')).toBeNull();
    expect(parseYYYYMMDDtoUTC('')).toBeNull();
  });

  it('aceita ano bissexto', () => {
    const d = parseYYYYMMDDtoUTC('20240229');
    expect(d?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseYYYYMMDDtoUTC('20250229')).toBeNull();
  });
});

describe('parseYYYYMMDDtoUTC sob TZ=America/Sao_Paulo', () => {
  const ORIGINAL_TZ = process.env['TZ'];

  beforeAll(() => {
    process.env['TZ'] = 'America/Sao_Paulo';
  });

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
    else process.env['TZ'] = ORIGINAL_TZ;
  });

  it('não pula um dia em fuso UTC-3 (regressão off-by-one)', () => {
    const d = parseYYYYMMDDtoUTC('20250401');
    expect(d).not.toBeNull();
    expect(d?.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(d?.getUTCFullYear()).toBe(2025);
    expect(d?.getUTCMonth()).toBe(3);
    expect(d?.getUTCDate()).toBe(1);
  });

  it('virada do mês: 1 de abril UTC não vira 31 de março', () => {
    const d = parseYYYYMMDDtoUTC('20250401');
    expect(d?.getUTCDate()).toBe(1);
    expect(d?.getUTCMonth()).toBe(3);
  });
});

describe('parseDDMMYYYYtoUTC', () => {
  it('converte DD/MM/YYYY pra UTC', () => {
    const d = parseDDMMYYYYtoUTC('01/04/2026');
    expect(d?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('descarta espaços nas pontas', () => {
    expect(parseDDMMYYYYtoUTC('  15/04/2026  ')?.toISOString()).toBe(
      '2026-04-15T00:00:00.000Z',
    );
  });

  it('retorna null pra formato inválido', () => {
    expect(parseDDMMYYYYtoUTC('2026-04-01')).toBeNull();
    expect(parseDDMMYYYYtoUTC('1/4/2026')).toBeNull();
    expect(parseDDMMYYYYtoUTC('01/04/26')).toBeNull();
    expect(parseDDMMYYYYtoUTC('')).toBeNull();
  });

  it('retorna null pra data inexistente', () => {
    expect(parseDDMMYYYYtoUTC('30/02/2026')).toBeNull();
    expect(parseDDMMYYYYtoUTC('32/01/2026')).toBeNull();
    expect(parseDDMMYYYYtoUTC('01/13/2026')).toBeNull();
  });
});

describe('addUTCDays', () => {
  it('subtrai 1 dia em virada de mês sem off-by-one', () => {
    const d = parseDDMMYYYYtoUTC('01/04/2026');
    expect(d).not.toBeNull();
    const yesterday = addUTCDays(d as Date, -1);
    expect(yesterday.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('soma dias preservando UTC', () => {
    const d = parseDDMMYYYYtoUTC('28/02/2024');
    const plus1 = addUTCDays(d as Date, 1);
    expect(plus1.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});
