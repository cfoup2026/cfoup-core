import { describe, it, expect } from 'vitest';
import { extractCSV } from '../../src/csv/extractor.js';

describe('extractCSV', () => {
  it('extrai linhas e campos com delimitador ;', () => {
    const csv = 'a;b;c\nd;e;f';
    expect(extractCSV(csv, ';')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('preserva linhas em branco como [""]', () => {
    const csv = 'a;b\n\nc;d';
    expect(extractCSV(csv, ';')).toEqual([
      ['a', 'b'],
      [''],
      ['c', 'd'],
    ]);
  });

  it('respeita CRLF (Windows)', () => {
    const csv = 'a;b;c\r\nd;e;f\r\n';
    expect(extractCSV(csv, ';')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      [''],
    ]);
  });

  it('respeita aspas duplas e delimitador dentro do campo', () => {
    const csv = '"campo;com;ponto-e-virgula";simples';
    expect(extractCSV(csv, ';')).toEqual([['campo;com;ponto-e-virgula', 'simples']]);
  });

  it('aceita vírgula como delimitador', () => {
    expect(extractCSV('a,b,c', ',')).toEqual([['a', 'b', 'c']]);
  });

  it('lança se delimitador não tiver 1 caractere', () => {
    expect(() => extractCSV('a;b', ';;')).toThrow();
    expect(() => extractCSV('a;b', '')).toThrow();
  });

  it('content vazio resulta em [[""]]', () => {
    expect(extractCSV('', ';')).toEqual([['']]);
  });
});
