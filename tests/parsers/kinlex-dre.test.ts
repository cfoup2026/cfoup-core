import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseKinlexDRE,
  parseKinlexDREFromLines,
} from '../../src/parsers/kinlex-dre.js';
import type { ExtractedLine } from '../../src/utils/pdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '../fixtures');
const REAL_DRE_2024 = resolve(fixturesDir, 'gregorutt_dre_2024.pdf');

function lines(...texts: string[]): ExtractedLine[] {
  return texts.map((text, i) => ({ page: 1, lineIndex: i + 1, text }));
}

describe('parseKinlexDREFromLines — happy path', () => {
  const r = parseKinlexDREFromLines(
    lines(
      'Empresa: GREGORUTT INDUSTRIA E COMERCIO LTDA',
      'Folha: 0001',
      'C.N.P.J.: 05.218.914/0001-47',
      'Número livro: 0001',
      'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM 31/12/2024',
      'RECEITA BRUTA',
      'RECEITA BRUTAS DE VENDAS E MERCADORIAS 1.945.626,51 1.945.626,51',
      'DEDUÇÕES DA RECEITA BRUTA',
      '(-) CANCELAMENTO E DEVOLUÇÕES (4.908,71)',
      '(-) IMPOSTOS SOBRE VENDAS E SERVIÇOS (240.423,13) (245.331,84)',
      'RECEITA LÍQUIDA 1.700.294,67',
      'CUSTOS',
      'CUSTOS DE MERCADORIAS ADQUIRIDAS (289,42)',
      'CUSTOS DOS PRODUTOS VENDIDOS (540.223,20) (540.512,62)',
      'LUCRO BRUTO 1.159.782,05',
      'DESPESAS OPERACIONAIS (627.639,43)',
      'DESPESAS COM VENDAS',
      'DESPESAS COM ENTREGA (4.267,93) (4.267,93)',
      'DESPESAS ADMINISTRATIVAS',
      'DESPESAS COM PESSOAL (400.319,55)',
      'IMPOSTOS, TAXAS E CONTRIBUIÇÕES (4.338,49)',
      'DESPESAS GERAIS (218.713,46) (623.371,50)',
      'RESULTADO OPERACIONAL 532.142,62',
      'RESULTADO ANTES DO IR E CSL 532.142,62',
      'LUCRO LÍQUIDO DO EXERCÍCIO 532.142,62',
      '_______________________________________ _______________________________________',
      'KATIA REGINA DIAS JOSÉ MARIO MASSON',
      'Reg. no CRC - SP sob o No. 1SP077221O2',
      'CPF: 126.573.658-84 CPF: 587.277.878-34',
      'Sistema licenciado para CONTABIL KINLEX S/S LTDA.',
    ),
  );

  it('extrai metadata: empresa, CNPJ, título, referenceDate UTC', () => {
    expect(r.metadata.companyName).toBe('GREGORUTT INDUSTRIA E COMERCIO LTDA');
    expect(r.metadata.cnpj).toBe('05.218.914/0001-47');
    expect(r.metadata.title).toContain('DEMONSTRAÇÃO DO RESULTADO');
    expect(r.metadata.referenceDate?.toISOString()).toBe(
      '2024-12-31T00:00:00.000Z',
    );
  });

  it('produz 5 section_headers', () => {
    const headers = r.ok.filter((e) => e.kind === 'section_header');
    expect(headers).toHaveLength(5);
    expect(headers.map((h) => h.label)).toEqual([
      'RECEITA BRUTA',
      'DEDUÇÕES DA RECEITA BRUTA',
      'CUSTOS',
      'DESPESAS COM VENDAS',
      'DESPESAS ADMINISTRATIVAS',
    ]);
  });

  it('produz 6 subtotals (incluindo DESPESAS OPERACIONAIS antecipado)', () => {
    const subs = r.ok.filter((e) => e.kind === 'subtotal');
    expect(subs).toHaveLength(6);
    expect(subs.map((s) => s.label)).toEqual([
      'RECEITA LÍQUIDA',
      'LUCRO BRUTO',
      'DESPESAS OPERACIONAIS',
      'RESULTADO OPERACIONAL',
      'RESULTADO ANTES DO IR E CSL',
      'LUCRO LÍQUIDO DO EXERCÍCIO',
    ]);
  });

  it('produz 9 line_items (todos os detalhes)', () => {
    const items = r.ok.filter((e) => e.kind === 'line_item');
    expect(items).toHaveLength(9);
  });

  it('subtotais Kinlex preservados como vieram (extracted), nunca recalculados', () => {
    const lucroLiq = r.ok.find(
      (e) => e.kind === 'subtotal' && e.label === 'LUCRO LÍQUIDO DO EXERCÍCIO',
    );
    expect(lucroLiq?.kind).toBe('subtotal');
    if (lucroLiq?.kind === 'subtotal') {
      expect(lucroLiq.value).toBe(532142.62);
      expect(lucroLiq.valueSource).toBe('extracted');
      expect(lucroLiq.isNegative).toBe(false);
    }
  });

  it('DESPESAS OPERACIONAIS (subtotal antecipado) com valor parentizado vira negativo', () => {
    const desp = r.ok.find(
      (e) => e.kind === 'subtotal' && e.label === 'DESPESAS OPERACIONAIS',
    );
    expect(desp?.kind).toBe('subtotal');
    if (desp?.kind === 'subtotal') {
      expect(desp.value).toBe(-627639.43);
      expect(desp.isNegative).toBe(true);
    }
  });

  it('line_item com 1 valor: value1 preenchido, value2 null', () => {
    const cancel = r.ok.find(
      (e) =>
        e.kind === 'line_item' && e.label.includes('CANCELAMENTO E DEVOLUÇÕES'),
    );
    expect(cancel?.kind).toBe('line_item');
    if (cancel?.kind === 'line_item') {
      expect(cancel.value1).toBe(-4908.71);
      expect(cancel.value2).toBeNull();
      expect(cancel.isNegative).toBe(true);
      expect(cancel.section).toBe('DEDUÇÕES DA RECEITA BRUTA');
    }
  });

  it('line_item com 2 valores: value1 + value2 brutos, sem nomear', () => {
    const impostos = r.ok.find(
      (e) =>
        e.kind === 'line_item' &&
        e.label.includes('IMPOSTOS SOBRE VENDAS E SERVIÇOS'),
    );
    expect(impostos?.kind).toBe('line_item');
    if (impostos?.kind === 'line_item') {
      expect(impostos.value1).toBe(-240423.13);
      expect(impostos.value2).toBe(-245331.84);
      expect(impostos.isNegative).toBe(true);
    }
  });

  it('warning único na 1ª linha com 2 colunas — não emite a cada linha', () => {
    const twoColWarnings = r.warnings.filter((w) =>
      w.message.includes('2 colunas'),
    );
    expect(twoColWarnings).toHaveLength(1);
  });

  it('section rastreada nos line_items via state machine', () => {
    const items = r.ok.filter((e) => e.kind === 'line_item');
    const itemSection = (label: string): string | null => {
      const it = items.find(
        (i) => i.kind === 'line_item' && i.label.includes(label),
      );
      return it?.kind === 'line_item' ? it.section : null;
    };
    expect(itemSection('RECEITA BRUTAS DE VENDAS')).toBe('RECEITA BRUTA');
    expect(itemSection('CUSTOS DE MERCADORIAS ADQUIRIDAS')).toBe('CUSTOS');
    expect(itemSection('DESPESAS COM ENTREGA')).toBe('DESPESAS COM VENDAS');
    expect(itemSection('DESPESAS COM PESSOAL')).toBe('DESPESAS ADMINISTRATIVAS');
  });

  it('rodapé (assinatura/CRC/CPF/sistema licenciado) ignorado após ruler ____', () => {
    expect(r.errors).toHaveLength(0);
    for (const e of r.ok) {
      const label = e.kind === 'line_item' ? e.label : e.label;
      expect(label).not.toContain('KATIA');
      expect(label).not.toContain('CRC');
      expect(label).not.toContain('CPF');
      expect(label).not.toContain('Sistema');
    }
  });

  it('balances vazio (DRE não usa)', () => {
    expect(r.balances).toHaveLength(0);
  });

  it('todos os entries têm valueSource extracted (quando aplicável)', () => {
    for (const e of r.ok) {
      if (e.kind === 'line_item' || e.kind === 'subtotal') {
        expect(e.valueSource).toBe('extracted');
      }
    }
  });
});

describe('parseKinlexDREFromLines — robustez', () => {
  it('PDF sem entries reconhecíveis: ParseError global', () => {
    const r = parseKinlexDREFromLines(lines('texto qualquer sem padrão'));
    expect(r.ok.filter((e) => e.kind !== 'section_header')).toHaveLength(0);
  });

  it('linha com 3+ valores: ParseError pontual, parser segue', () => {
    const r = parseKinlexDREFromLines(
      lines(
        'Empresa: X',
        'C.N.P.J.: 00.000.000/0001-00',
        'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM 31/12/2024',
        'RECEITA BRUTA',
        'LINHA ESTRANHA 100,00 200,00 300,00',
        'OUTRA OK 50,00',
      ),
    );
    expect(r.errors.some((e) => e.reason.includes('valores numéricos'))).toBe(
      true,
    );
    expect(r.ok.some((e) => e.kind === 'line_item')).toBe(true);
  });

  it('referenceDate null quando título não tem data parseável', () => {
    const r = parseKinlexDREFromLines(
      lines(
        'Empresa: X',
        'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO',
        'RECEITA BRUTA',
        'ALGUMA COISA 100,00',
      ),
    );
    expect(r.metadata.referenceDate).toBeNull();
    expect(r.metadata.title).toContain('DEMONSTRAÇÃO');
  });

  it('label com (-) decorativo é preservado raw', () => {
    const r = parseKinlexDREFromLines(
      lines(
        'Empresa: X',
        'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM 31/12/2024',
        'DEDUÇÕES DA RECEITA BRUTA',
        '(-) IMPOSTOS (100,00)',
      ),
    );
    const item = r.ok.find((e) => e.kind === 'line_item');
    expect(item?.kind).toBe('line_item');
    if (item?.kind === 'line_item') {
      expect(item.label).toContain('(-)');
      expect(item.label).toContain('IMPOSTOS');
    }
  });

  it('subtotal canonical match é case-insensitive e tolera espaços extras', () => {
    const r = parseKinlexDREFromLines(
      lines(
        'Empresa: X',
        'DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM 31/12/2024',
        'lucro líquido do exercício 100,00',
      ),
    );
    const sub = r.ok.find((e) => e.kind === 'subtotal');
    expect(sub?.kind).toBe('subtotal');
  });
});

describe('parseKinlexDRE — fixture real (gregorutt_dre_2024.pdf)', () => {
  const exists = existsSync(REAL_DRE_2024);

  it.skipIf(!exists)('parseia o PDF real sem erros', async () => {
    const buf = readFileSync(REAL_DRE_2024);
    const r = await parseKinlexDRE(buf);

    expect(r.errors).toHaveLength(0);
    expect(r.ok.length).toBeGreaterThan(10);

    expect(r.metadata.companyName).toBe('GREGORUTT INDUSTRIA E COMERCIO LTDA');
    expect(r.metadata.cnpj).toBe('05.218.914/0001-47');
    expect(r.metadata.referenceDate?.toISOString()).toBe(
      '2024-12-31T00:00:00.000Z',
    );

    const subtotals = r.ok.filter((e) => e.kind === 'subtotal');
    const subtotalLabels = subtotals.map((s) => s.label);
    expect(subtotalLabels).toContain('RECEITA LÍQUIDA');
    expect(subtotalLabels).toContain('LUCRO BRUTO');
    expect(subtotalLabels).toContain('LUCRO LÍQUIDO DO EXERCÍCIO');

    const lucroLiq = subtotals.find(
      (s) => s.label === 'LUCRO LÍQUIDO DO EXERCÍCIO',
    );
    expect(lucroLiq?.kind).toBe('subtotal');
    if (lucroLiq?.kind === 'subtotal') {
      expect(lucroLiq.value).toBe(532142.62);
      expect(lucroLiq.valueSource).toBe('extracted');
    }

    const lineItems = r.ok.filter((e) => e.kind === 'line_item');
    expect(lineItems.length).toBeGreaterThan(5);
    const withTwoValues = lineItems.filter(
      (i) => i.kind === 'line_item' && i.value2 !== null,
    );
    expect(withTwoValues.length).toBeGreaterThan(0);
  });
});
