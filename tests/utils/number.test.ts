import { describe, it, expect } from 'vitest';
import {
  parseBRLNumber,
  parseSignedBRLNumber,
} from '../../src/utils/number.js';

describe('parseBRLNumber', () => {
  it('decimal simples sem milhar', () => {
    expect(parseBRLNumber('12,34')).toBe(12.34);
    expect(parseBRLNumber('0,00')).toBe(0);
    expect(parseBRLNumber('1234,56')).toBe(1234.56);
  });

  it('com separador de milhar', () => {
    expect(parseBRLNumber('1.234,56')).toBe(1234.56);
    expect(parseBRLNumber('39.271,62')).toBe(39271.62);
    expect(parseBRLNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('aceita 1 dígito decimal', () => {
    expect(parseBRLNumber('1,5')).toBe(1.5);
  });

  it('descarta espaços nas pontas', () => {
    expect(parseBRLNumber('  1.234,56  ')).toBe(1234.56);
  });

  it('rejeita formato inglês (ponto decimal)', () => {
    expect(parseBRLNumber('1234.56')).toBeNull();
    expect(parseBRLNumber('12.34')).toBeNull();
  });

  it('rejeita strings malformadas', () => {
    expect(parseBRLNumber('')).toBeNull();
    expect(parseBRLNumber('abc')).toBeNull();
    expect(parseBRLNumber(',56')).toBeNull();
    expect(parseBRLNumber('12,')).toBeNull();
    expect(parseBRLNumber('12,345')).toBeNull(); // 3 casas decimais não suportado
  });

  it('rejeita milhar mal posicionado', () => {
    expect(parseBRLNumber('12.34,56')).toBeNull();
    expect(parseBRLNumber('1.23.456,78')).toBeNull();
  });
});

describe('parseSignedBRLNumber', () => {
  it('positivo igual ao parseBRLNumber', () => {
    expect(parseSignedBRLNumber('1.234,56')).toBe(1234.56);
  });

  it('negativo simples', () => {
    expect(parseSignedBRLNumber('-12,34')).toBe(-12.34);
    expect(parseSignedBRLNumber('-1.234,56')).toBe(-1234.56);
  });

  it('aceita espaço entre sinal e número', () => {
    expect(parseSignedBRLNumber('- 1.234,56')).toBe(-1234.56);
  });

  it('zero negativo vira -0... mas a igualdade numérica preserva', () => {
    expect(parseSignedBRLNumber('-0,00')).toBe(0);
  });

  it('rejeita formato inválido', () => {
    expect(parseSignedBRLNumber('')).toBeNull();
    expect(parseSignedBRLNumber('-abc')).toBeNull();
    expect(parseSignedBRLNumber('--12,34')).toBeNull();
  });
});
