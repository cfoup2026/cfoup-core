import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseKinlexBalanco,
  parseKinlexBalancoFromLines,
} from '../../src/parsers/kinlex-balanco.js';
import type { ExtractedLine } from '../../src/utils/pdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_2023 = resolve(fixturesDir, 'gregorutt_balanco_2023.pdf');
const REAL_2024 = resolve(fixturesDir, 'gregorutt_balanco_2024.pdf');
const REAL_2025 = resolve(fixturesDir, 'gregorutt_balanco_2025.pdf');

interface SyntheticLine {
  text: string;
  xStart?: number;
}

function lines(...rows: SyntheticLine[]): ExtractedLine[] {
  return rows.map((r, i) =>
    r.xStart === undefined
      ? { page: 1, lineIndex: i + 1, text: r.text }
      : { page: 1, lineIndex: i + 1, text: r.text, xStart: r.xStart },
  );
}

describe('parseKinlexBalancoFromLines — happy path', () => {
  const r = parseKinlexBalancoFromLines(
    lines(
      { text: 'Empresa: GREGORUTT INDUSTRIA E COMERCIO LTDA Folha: 0001' },
      { text: 'C.N.P.J.: 05.218.914/0001-47 Emissão: 20/04/2026' },
      { text: 'Período: 01/01/2024 a 31/12/2024 Hora: 14:51:57' },
      { text: 'Balanço encerrado em: 31/12/2024' },
      { text: 'BALANÇO PATRIMONIAL' },
      { text: 'Descrição Saldo Atual' },
      { text: 'ATIVO 1.033.417,31D', xStart: 48.0 },
      { text: 'ATIVO CIRCULANTE 998.869,50D', xStart: 55.2 },
      { text: 'DISPONÍVEL 955.145,50D', xStart: 62.4 },
      { text: 'BANCOS CONTA MOVIMENTO 955.145,50D', xStart: 69.6 },
      { text: 'BANCOS CONTA MOVIMENTO 955.145,50D', xStart: 76.8 },
      { text: 'ESTOQUE 43.724,00D', xStart: 62.4 },
      { text: 'MERCADORIAS, PRODUTOS E INSUMOS 43.724,00D', xStart: 69.6 },
      { text: 'MATÉRIA-PRIMA 43.724,00D', xStart: 76.8 },
      { text: 'PASSIVO 1.033.417,31C', xStart: 48.0 },
      { text: 'PASSIVO CIRCULANTE 39.378,80C', xStart: 55.2 },
      { text: 'FORNECEDORES 6.179,08C', xStart: 62.4 },
      { text: 'FORNECEDORES 6.179,08C', xStart: 69.6 },
      { text: 'FORNECEDORES 6.179,08C', xStart: 76.8 },
      {
        text: '_______________________________________ _______________________________________',
      },
      { text: 'KATIA REGINA DIAS JOSÉ MARIO MASSON' },
      { text: 'CPF: 126.573.658-84 CPF: 587.277.878-34' },
    ),
  );

  it('extrai metadata: empresa, CNPJ, period, referenceDate UTC, title', () => {
    expect(r.metadata.companyName).toBe('GREGORUTT INDUSTRIA E COMERCIO LTDA');
    expect(r.metadata.cnpj).toBe('05.218.914/0001-47');
    expect(r.metadata.referenceDate?.toISOString()).toBe(
      '2024-12-31T00:00:00.000Z',
    );
    expect(r.metadata.period?.start.toISOString()).toBe(
      '2024-01-01T00:00:00.000Z',
    );
    expect(r.metadata.period?.end.toISOString()).toBe(
      '2024-12-31T00:00:00.000Z',
    );
    expect(r.metadata.title).toContain('BALANÇO PATRIMONIAL');
  });

  it('zero erros + entries esperadas (13 = 7 ATIVO + 6 PASSIVO)', () => {
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(13);
  });

  it('level mapeado dinamicamente: 5 níveis (0-4)', () => {
    const levels = new Set(r.ok.map((e) => e.level));
    expect([...levels].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('ATIVO/PASSIVO raízes no level 0 são subtotais (têm filhos)', () => {
    const ativo = r.ok.find((e) => e.label === 'ATIVO');
    const passivo = r.ok.find((e) => e.label === 'PASSIVO');
    expect(ativo?.kind).toBe('subtotal');
    expect(passivo?.kind).toBe('subtotal');
    if (ativo?.kind === 'subtotal') {
      expect(ativo.amount).toBe(1033417.31);
      expect(ativo.balanceType).toBe('D');
      expect(ativo.level).toBe(0);
      expect(ativo.sectionPath).toEqual([]);
    }
    if (passivo?.kind === 'subtotal') {
      expect(passivo.amount).toBe(1033417.31);
      expect(passivo.balanceType).toBe('C');
    }
  });

  it('nós-folha no level mais profundo viram line_items', () => {
    const folhas = r.ok.filter((e) => e.kind === 'line_item');
    const folhaLabels = folhas.map((f) => f.label);
    expect(folhaLabels).toContain('BANCOS CONTA MOVIMENTO');
    expect(folhaLabels).toContain('MATÉRIA-PRIMA');
    expect(folhaLabels).toContain('FORNECEDORES');
  });

  it('sectionPath rastreia hierarquia completa até o pai', () => {
    const materiaPrima = r.ok.find((e) => e.label === 'MATÉRIA-PRIMA');
    expect(materiaPrima?.sectionPath).toEqual([
      'ATIVO',
      'ATIVO CIRCULANTE',
      'ESTOQUE',
      'MERCADORIAS, PRODUTOS E INSUMOS',
    ]);

    const folhasFornecedores = r.ok.filter(
      (e) => e.label === 'FORNECEDORES' && e.kind === 'line_item',
    );
    expect(folhasFornecedores).toHaveLength(1);
    expect(folhasFornecedores[0]?.sectionPath).toEqual([
      'PASSIVO',
      'PASSIVO CIRCULANTE',
      'FORNECEDORES',
      'FORNECEDORES',
    ]);
  });

  it('balanceType D/C preservado SEM virar sinal aritmético', () => {
    for (const e of r.ok) {
      if (e.kind === 'line_item' || e.kind === 'subtotal') {
        expect(e.amount).toBeGreaterThanOrEqual(0);
        expect(['D', 'C']).toContain(e.balanceType);
      }
    }
  });

  it('rodapé (assinaturas, CRC, CPF) ignorado após ruler ___', () => {
    for (const e of r.ok) {
      const label = e.kind === 'line_item' ? e.label : e.label;
      expect(label).not.toContain('KATIA');
      expect(label).not.toContain('CPF');
    }
  });

  it('todos os entries com valor têm valueSource extracted', () => {
    for (const e of r.ok) {
      if (e.kind === 'line_item' || e.kind === 'subtotal') {
        expect(e.valueSource).toBe('extracted');
      }
    }
  });

  it('balances vazio (Balanço não usa BalanceSnapshot)', () => {
    expect(r.balances).toHaveLength(0);
  });
});

describe('parseKinlexBalancoFromLines — strict xStart requirement', () => {
  it('xStart ausente em linha do body: ParseError fatal, não degrada', () => {
    const r = parseKinlexBalancoFromLines(
      lines(
        { text: 'Empresa: X' },
        { text: 'BALANÇO PATRIMONIAL' },
        { text: 'Descrição Saldo Atual' },
        { text: 'ATIVO 100,00D', xStart: 48.0 },
        { text: 'ATIVO CIRCULANTE 100,00D' },
      ),
    );
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0]?.reason).toContain('xStart');
    expect(r.errors[0]?.reason).toContain('extractTextLines');
  });

  it('body inteiro com xStart: parseia normalmente', () => {
    const r = parseKinlexBalancoFromLines(
      lines(
        { text: 'BALANÇO PATRIMONIAL' },
        { text: 'Descrição Saldo Atual' },
        { text: 'ATIVO 100,00D', xStart: 48.0 },
        { text: 'CAIXA 100,00D', xStart: 55.2 },
      ),
    );
    expect(r.errors).toHaveLength(0);
    expect(r.ok).toHaveLength(2);
  });
});

describe('parseKinlexBalancoFromLines — robustez', () => {
  it('valor não-numérico no body: ParseError pontual, parser segue', () => {
    const r = parseKinlexBalancoFromLines(
      lines(
        { text: 'BALANÇO PATRIMONIAL' },
        { text: 'Descrição Saldo Atual' },
        { text: 'ATIVO 100,00D', xStart: 48.0 },
        { text: 'CAIXA 100,00D', xStart: 55.2 },
      ),
    );
    expect(r.ok).toHaveLength(2);
  });

  it('PDF sem body reconhecido: ParseError global', () => {
    const r = parseKinlexBalancoFromLines(
      lines(
        { text: 'Empresa: X' },
        { text: 'BALANÇO PATRIMONIAL' },
        { text: 'Descrição Saldo Atual' },
      ),
    );
    expect(r.ok).toHaveLength(0);
    expect(r.errors[0]?.reason).toContain('body vazio');
  });

  it('xStart com pequena variação (48.0 vs 48.05) é mapeado pro mesmo level', () => {
    const r = parseKinlexBalancoFromLines(
      lines(
        { text: 'BALANÇO PATRIMONIAL' },
        { text: 'Descrição Saldo Atual' },
        { text: 'ATIVO 100,00D', xStart: 48.0 },
        { text: 'PASSIVO 100,00C', xStart: 48.05 },
        { text: 'FORN 100,00C', xStart: 55.2 },
      ),
    );
    expect(r.errors).toHaveLength(0);
    const ativo = r.ok.find((e) => e.label === 'ATIVO');
    const passivo = r.ok.find((e) => e.label === 'PASSIVO');
    expect(ativo?.level).toBe(passivo?.level);
  });
});

describe('parseKinlexBalanco — fixtures reais (3 PDFs Gregorutt)', () => {
  const realFixtures: Array<{
    path: string;
    year: number;
    expectedAtivo: number;
  }> = [
    { path: REAL_2023, year: 2023, expectedAtivo: 760051.42 },
    { path: REAL_2024, year: 2024, expectedAtivo: 1033417.31 },
    { path: REAL_2025, year: 2025, expectedAtivo: 1551939.0 },
  ];

  for (const { path, year, expectedAtivo } of realFixtures) {
    const exists = existsSync(path);
    it.skipIf(!exists)(
      `parseia Balanço ${year} sem erros, ATIVO bate com extracted`,
      async () => {
        const buf = readFileSync(path);
        const r = await parseKinlexBalanco(buf);

        expect(r.errors).toHaveLength(0);
        expect(r.ok.length).toBeGreaterThan(10);

        expect(r.metadata.companyName).toBe(
          'GREGORUTT INDUSTRIA E COMERCIO LTDA',
        );
        expect(r.metadata.cnpj).toBe('05.218.914/0001-47');
        expect(r.metadata.referenceDate?.toISOString()).toBe(
          `${year}-12-31T00:00:00.000Z`,
        );
        expect(r.metadata.period?.start.toISOString()).toBe(
          `${year}-01-01T00:00:00.000Z`,
        );

        const ativo = r.ok.find((e) => e.label === 'ATIVO');
        const passivo = r.ok.find((e) => e.label === 'PASSIVO');
        expect(ativo?.kind).toBe('subtotal');
        if (ativo?.kind === 'subtotal') {
          expect(ativo.amount).toBe(expectedAtivo);
          expect(ativo.balanceType).toBe('D');
          expect(ativo.level).toBe(0);
        }
        if (passivo?.kind === 'subtotal') {
          expect(passivo.amount).toBe(expectedAtivo);
          expect(passivo.balanceType).toBe('C');
          expect(passivo.level).toBe(0);
        }

        const lineItems = r.ok.filter((e) => e.kind === 'line_item');
        expect(lineItems.length).toBeGreaterThan(0);

        for (const e of r.ok) {
          if (e.kind === 'line_item' || e.kind === 'subtotal') {
            expect(e.valueSource).toBe('extracted');
            expect(e.amount).toBeGreaterThanOrEqual(0);
          }
        }

        const maxLevel = Math.max(...r.ok.map((e) => e.level));
        expect(maxLevel).toBeGreaterThanOrEqual(3);
      },
    );
  }
});
