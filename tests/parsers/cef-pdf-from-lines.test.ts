import { describe, it, expect } from 'vitest';
import { parseCEFPdfFromLines } from '../../src/parsers/cef-pdf.js';
import type { ExtractedLine } from '../../src/utils/pdf.js';

function lines(...texts: string[]): ExtractedLine[] {
  return texts.map((text, i) => ({ page: 1, lineIndex: i + 1, text }));
}

describe('parseCEFPdfFromLines — happy path', () => {
  const r = parseCEFPdfFromLines(
    lines(
      'Extrato por período',
      'Extrato',
      'DATA MOV.',
      'NR.',
      'DOC.',
      'HISTÓRICO',
      'VALOR',
      'SALDO ANTERIOR 0,00',
      'Saldo 34.494,27 C',
      '01/04/2026 310326 COB COMPE 3.046,64 C',
      'Saldo 37.540,91 C',
      '01/04/2026 310326 COB COMPE 14,80 D',
      'Saldo 37.526,11 C',
      '01/04/2026 000000 SALDO DIA 39.271,62 C',
      'Saldo 39.271,62 C',
      '* 661 - Os lançamentos de extrato não estão disponíveis.',
    ),
  );

  it('reconhece 2 transações reais (SALDO DIA não conta)', () => {
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]?.history).toBe('COB COMPE');
    expect(r.ok[0]?.amount).toBe(3046.64);
    expect(r.ok[0]?.direction).toBe('credit');
    expect(r.ok[0]?.docNumber).toBe('310326');
    expect(r.ok[0]?.date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('produz 6 BalanceSnapshots (anterior + opening + 2 intercalados + SALDO DIA + intercalado final)', () => {
    expect(r.balances).toHaveLength(6);
  });

  it('SALDO ANTERIOR datado como dia anterior à 1ª transação', () => {
    const ant = r.balances.find((b) => b.amount === 0);
    expect(ant?.date.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('Saldo de abertura datado como 1ª transação', () => {
    const opening = r.balances.find((b) => b.amount === 34494.27);
    expect(opening?.date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('Saldos intercalados datados com a tx anterior', () => {
    const after1 = r.balances.find((b) => b.amount === 37540.91);
    expect(after1?.date.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('SALDO DIA vira BalanceSnapshot, não Transaction', () => {
    const saldoDia = r.balances.find((b) => b.amount === 39271.62);
    expect(saldoDia).toBeDefined();
    for (const tx of r.ok) {
      expect(tx.history.toUpperCase()).not.toContain('SALDO DIA');
    }
  });

  it('todos os saldos têm source bank-statement', () => {
    for (const b of r.balances) {
      expect(b.source).toBe('bank-statement');
    }
  });

  it('amount sempre positivo nas transações', () => {
    for (const tx of r.ok) {
      expect(tx.amount).toBeGreaterThan(0);
    }
  });

  it('balance opcional nas transações fica undefined', () => {
    for (const tx of r.ok) {
      expect(tx.balance).toBeUndefined();
    }
  });

  it('warning de SALDO ANTERIOR + warning de SALDO DIA + warning de conta vazia', () => {
    const messages = r.warnings.map((w) => w.message);
    expect(messages.some((m) => m.includes('saldo anterior'))).toBe(true);
    expect(messages.some((m) => m.includes('saldo informativo'))).toBe(true);
    expect(messages.some((m) => m.includes('número da conta'))).toBe(true);
  });

  it('zero erros', () => {
    expect(r.errors).toHaveLength(0);
  });
});

describe('parseCEFPdfFromLines — robustez', () => {
  it('valor não-numérico em transação: erro pontual, segue', () => {
    const r = parseCEFPdfFromLines(
      lines(
        '01/04/2026 310326 COB COMPE 3.046,64 C',
        '01/04/2026 310327 BUG abc,XX C',
        '01/04/2026 310328 OK 100,00 D',
      ),
    );
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('linha não reconhecida');
  });

  it('data inválida em transação: erro pontual, segue', () => {
    const r = parseCEFPdfFromLines(
      lines(
        '30/02/2026 310327 OK 100,00 C',
        '01/04/2026 310328 OK 200,00 D',
      ),
    );
    expect(r.ok).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('data inválida');
  });

  it('linha completamente desconhecida: erro pontual, segue', () => {
    const r = parseCEFPdfFromLines(
      lines(
        '01/04/2026 310326 OK 100,00 C',
        'algum texto aleatório que não bate em padrão nenhum',
        '02/04/2026 310327 OK 200,00 D',
      ),
    );
    expect(r.ok).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.reason).toContain('linha não reconhecida');
  });

  it('saldo intercalado sem transação anterior vira opening', () => {
    const r = parseCEFPdfFromLines(
      lines(
        'Saldo 1.000,00 C',
        '01/04/2026 310326 OK 100,00 C',
      ),
    );
    expect(r.balances).toHaveLength(1);
    expect(r.balances[0]?.amount).toBe(1000);
    expect(r.balances[0]?.date.toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('saldo intercalado com sinal D vira amount negativo (cheque especial)', () => {
    const r = parseCEFPdfFromLines(
      lines(
        '01/04/2026 310326 SAQUE 1.500,00 D',
        'Saldo 500,00 D',
      ),
    );
    expect(r.balances).toHaveLength(1);
    expect(r.balances[0]?.amount).toBe(-500);
  });

  it('PDF sem transações: warning de saldos pendentes descartados', () => {
    const r = parseCEFPdfFromLines(
      lines('SALDO ANTERIOR 1.000,00', 'Saldo 1.000,00 C'),
    );
    expect(r.ok).toHaveLength(0);
    expect(r.balances).toHaveLength(0);
    expect(
      r.warnings.some((w) => w.message.includes('descartados')),
    ).toBe(true);
  });

  it('extrai accountId quando linha "Conta:" está presente', () => {
    const r = parseCEFPdfFromLines(
      lines(
        'Conta: 0423.012920005778782426',
        '01/04/2026 310326 OK 100,00 C',
      ),
    );
    expect(r.ok[0]?.accountId).not.toBe('');
    expect(r.ok[0]?.accountId).toContain('0423');
  });
});
