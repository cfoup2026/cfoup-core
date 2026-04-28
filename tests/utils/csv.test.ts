import { describe, it, expect } from 'vitest';
import { parseCSVLine } from '../../src/utils/csv.js';

describe('parseCSVLine', () => {
  it('parseia linha simples sem aspas', () => {
    expect(parseCSVLine('a;b;c', ';')).toEqual(['a', 'b', 'c']);
  });

  it('respeita delimitador dentro de aspas duplas', () => {
    const line = '"COB; COMPE";"5964.52";"C"';
    expect(parseCSVLine(line, ';')).toEqual(['COB; COMPE', '5964.52', 'C']);
  });

  it('trata aspas escapadas dentro de campo', () => {
    const line = '"diz ""ola"" pro joao";"100.00";"C"';
    expect(parseCSVLine(line, ';')).toEqual(['diz "ola" pro joao', '100.00', 'C']);
  });

  it('lida com campo vazio entre delimitadores', () => {
    expect(parseCSVLine('a;;c', ';')).toEqual(['a', '', 'c']);
  });

  it('lida com campo final vazio', () => {
    expect(parseCSVLine('a;b;', ';')).toEqual(['a', 'b', '']);
  });

  it('lida com linha vazia', () => {
    expect(parseCSVLine('', ';')).toEqual(['']);
  });

  it('aceita vírgula como delimitador', () => {
    expect(parseCSVLine('"x,y",z', ',')).toEqual(['x,y', 'z']);
  });

  it('lança se delimitador não tiver 1 caractere', () => {
    expect(() => parseCSVLine('a;b', ';;')).toThrow();
    expect(() => parseCSVLine('a;b', '')).toThrow();
  });
});
