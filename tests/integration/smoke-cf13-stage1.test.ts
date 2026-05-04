/**
 * Smoke integrado CF13 Estágio 1: parser → adapter → calendário → EventoCaixa[].
 *
 * Modo `full` (default local): roda contra fixtures reais Gregorutt.
 *  - AP/AR: tests/fixtures/gregorutt_{cp,cr}_*.csv (já commitados).
 *  - CEF:   tests/fixtures/gregorutt/Bcos/CEF *.txt (gitignored — copiar local).
 *
 * Modo `sample` (CI, set quando CFOUP_SMOKE_MODE=sample ou process.env.CI):
 *  - tests/fixtures/gregorutt-sample/ (commitado, slice de ~1000 linhas).
 *
 * Asserções: ver §4 do prompt 1.4.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BrazilCalendarPolicy,
  cefAdapter,
  extractCSV,
  fknApAdapter,
  fknArAdapter,
  parseCEFPdf,
  parseCEFTxt,
  parseFKNAp,
  parseFKNAr,
  type AdapterContext,
  type CalendarPolicy,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
  type Payable,
  type Receivable,
  type Transaction,
  type BalanceSnapshot,
} from '../../src/index.js';

import { printStageOneReport } from './smoke-cf13-stage1.report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', 'fixtures');
const FULL_AP = resolve(FIXTURES_ROOT, 'gregorutt_cp_2023_ate_20abr2026.csv');
const FULL_AR = resolve(FIXTURES_ROOT, 'gregorutt_cr_2023_ate_20abr2026.csv');
const FULL_CEF_DIR = resolve(FIXTURES_ROOT, 'gregorutt', 'Bcos');
const SAMPLE_AP = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'ap-sample.csv');
const SAMPLE_AR = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'ar-sample.csv');
const SAMPLE_CEF = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'cef-sample.txt');

const SAMPLE_MODE =
  process.env['CI'] !== undefined ||
  process.env['CFOUP_SMOKE_MODE'] === 'sample';

const FULL_FIXTURES_AVAILABLE =
  existsSync(FULL_AP) && existsSync(FULL_AR) && existsSync(FULL_CEF_DIR);

const calendar: CalendarPolicy = new BrazilCalendarPolicy();
const ctx: AdapterContext = {
  cliente_id: 'gregorutt',
  legal_entity_id: 'companhia_1',
  source_company_code: 'comp1',
  calendar,
};

/* ─────────── Loaders (parser + decoder) ─────────── */

/** FKN CSV é windows-1252 (FKN ERP). Tokeniza com `;` e parseia. */
function loadAp(path: string): Payable[] {
  const buf = readFileSync(path);
  const content = new TextDecoder('windows-1252').decode(buf);
  const rows = extractCSV(content, ';');
  const r = parseFKNAp(rows);
  if (r.errors.length > 0) {
    console.warn(`AP parser teve ${r.errors.length} erros — seguindo`);
  }
  return r.ok;
}

function loadAr(path: string): Receivable[] {
  const buf = readFileSync(path);
  const content = new TextDecoder('windows-1252').decode(buf);
  const rows = extractCSV(content, ';');
  const r = parseFKNAr(rows);
  if (r.errors.length > 0) {
    console.warn(`AR parser teve ${r.errors.length} erros — seguindo`);
  }
  return r.ok;
}

/** CEF TXT é UTF-8/ASCII (cabeçalho `"Conta";"Data_Mov";...`).
 *  O parser numera linhas a partir de 1 em CADA arquivo — múltiplos
 *  arquivos colidem em `tx.id`. Aqui prefixamos com o stem do arquivo
 *  (sem extensão) para garantir unicidade global no contexto do smoke. */
function loadCef(path: string): {
  ok: Transaction[];
  balances: BalanceSnapshot[];
} {
  const content = readFileSync(path, 'utf8');
  const r = parseCEFTxt(content);
  if (r.errors.length > 0) {
    console.warn(`CEF parser (${path}) teve ${r.errors.length} erros — seguindo`);
  }
  const stem = (path.split(/[/\\]/).pop() ?? path).replace(/\.[^.]+$/, '');
  // Sanitiza espaços para que o ID resultante não contenha brancos.
  const safeStem = stem.replace(/\s+/g, '_');
  const ok = r.ok.map((tx) => ({ ...tx, id: `${safeStem}:${tx.id}` }));
  return { ok, balances: r.balances };
}

function listCefFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        f.toLowerCase().startsWith('cef') &&
        f.toLowerCase().endsWith('.txt'),
    )
    .map((f) => resolve(dir, f))
    .sort();
}

function listCefPdfFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        f.toLowerCase().startsWith('cef') &&
        f.toLowerCase().endsWith('.pdf'),
    )
    .map((f) => resolve(dir, f))
    .sort();
}

/** PDFs CEF "com Saldo" são a fonte de `BalanceSnapshot`. Os TXTs do CEF
 *  Gregorutt não trazem rows SALDO DIA — só PDFs trazem. Para o smoke,
 *  parseamos os PDFs disponíveis e usamos APENAS `r.balances` (descartamos
 *  `r.ok` para evitar duplicação com transações vindas dos TXTs). */
async function loadCefPdfBalances(path: string): Promise<BalanceSnapshot[]> {
  const buf = readFileSync(path);
  const r = await parseCEFPdf(buf);
  if (r.errors.length > 0) {
    console.warn(
      `CEF PDF parser (${path}) teve ${r.errors.length} erros — seguindo`,
    );
  }
  return r.balances;
}

/* ─────────── Smoke ─────────── */

describe('CF13 Stage 1 — Smoke Gregorutt', () => {
  // No modo full sem fixtures locais (CI sem sample env), pulamos.
  // Em CI: SAMPLE_MODE=true → roda sample.
  // Local: fixtures full disponíveis → roda full.
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)(
    'pipeline completo: 3 adapters + calendário + saldos + determinismo',
    async () => {
      const t0 = Date.now();

      const apPath = SAMPLE_MODE ? SAMPLE_AP : FULL_AP;
      const arPath = SAMPLE_MODE ? SAMPLE_AR : FULL_AR;

      const apRaw = loadAp(apPath);
      const arRaw = loadAr(arPath);

      // Real Gregorutt data has a small number of zero-value rows (titles
      // canceled or zeroed out). O adapter rejeita `valor <= 0` por design
      // (princípio do nucleus). Pré-filtramos aqui no smoke com log explícito
      // — falhar visível significa LOG visível, não derrubar todo o
      // pipeline por 1 linha em 11.611.
      const apClean = apRaw.filter((p) => p.amount > 0);
      const arClean = arRaw.filter((r) => r.amount > 0);
      const apDropped = apRaw.length - apClean.length;
      const arDropped = arRaw.length - arClean.length;
      if (apDropped > 0 || arDropped > 0) {
        console.warn(
          `[smoke] filtered zero-value rows — AP: ${apDropped}, AR: ${arDropped}`,
        );
      }

      const ap = fknApAdapter(apClean, ctx);
      const ar = fknArAdapter(arClean, ctx);

      const cefFiles = SAMPLE_MODE
        ? [SAMPLE_CEF]
        : listCefFiles(FULL_CEF_DIR);
      expect(cefFiles.length).toBeGreaterThan(0);

      // Carrega TXTs uma vez — usados pra eventos e pra extrair o accountId
      // canônico que será injetado nos saldos do PDF (parser PDF do nucleus
      // não captura o cabeçalho `Conta` nos PDFs Gregorutt — formato distinto
      // do fixture de teste do nucleus).
      const cefTxtParsed = cefFiles.map((f) => loadCef(f));
      const cefTxtResults = cefTxtParsed.map((r) => cefAdapter(r, ctx));
      const cefEventos = cefTxtResults.flatMap((r) => r.eventos);

      const canonicalAccountId =
        cefTxtParsed[0]?.ok[0]?.accountId ?? '';
      expect(canonicalAccountId.length).toBeGreaterThan(0);

      // Saldos CEF saem dos PDFs "com Saldo" — TXTs não trazem SALDO DIA.
      const cefPdfFiles = SAMPLE_MODE
        ? [resolve(FIXTURES_ROOT, 'gregorutt-sample', 'cef-sample-com-saldo.pdf')]
        : listCefPdfFiles(FULL_CEF_DIR);
      const cefPdfBalanceArrays = await Promise.all(
        cefPdfFiles.map((f) => loadCefPdfBalances(f)),
      );
      const cefSaldos: OpeningBalanceSnapshot[] = [];
      for (const balances of cefPdfBalanceArrays) {
        // Enriquece accountId vazio com o canônico vindo do TXT.
        const enriched = balances.map((b) =>
          b.accountId === '' ? { ...b, accountId: canonicalAccountId } : b,
        );
        // Reusa o adapter CEF apenas para converter `balances` em
        // `OpeningBalanceSnapshot[]` — passamos `ok: []` pra não gerar eventos.
        const out = cefAdapter({ ok: [], balances: enriched }, ctx);
        cefSaldos.push(...out.saldos);
      }

      const all = [...ap, ...ar, ...cefEventos];

      /* §4.1 — Contagens batem com a fonte (parser produz 6.880 AP / 11.611 AR).
       *  Adapter consome o subset com valor > 0 (filtro acima). */
      if (!SAMPLE_MODE) {
        expect(apRaw.length).toBe(6880);
        expect(arRaw.length).toBe(11611);
        expect(ap.length).toBe(apClean.length);
        expect(ar.length).toBe(arClean.length);
      } else {
        expect(ap.length).toBeGreaterThan(0);
        expect(ar.length).toBeGreaterThan(0);
      }

      /* §4.2 — Schema válido (invariantes universais) */
      expect(all.every((e) => e.valor > 0)).toBe(true);
      expect(all.every((e) => e.confianca === 'alta')).toBe(true);
      expect(all.every((e) => e.confianca_origem === 'sistema')).toBe(true);

      /* §4.8 — Bucket técnico universal no estágio 1 */
      expect(all.every((e) => e.bucket_id === 'pendente_classificacao')).toBe(
        true,
      );
      expect(all.every((e) => e.criticidade === 'pendente')).toBe(true);
      expect(all.every((e) => e.is_transferencia === false)).toBe(true);

      /* §4.9 — Origem correta */
      expect(ap.every((e) => e.origem === 'fkn')).toBe(true);
      expect(ar.every((e) => e.origem === 'fkn')).toBe(true);
      expect(cefEventos.every((e) => e.origem === 'cef')).toBe(true);

      /* §4.10 — Status coerente com fonte.
       *  FKN AP/AR full misturam `confirmado` e `realizado`. No sample, o
       *  slice sequencial pode pegar uma janela só de em-aberto OU só de
       *  pagos — então a mistura é asserida apenas em full. */
      if (!SAMPLE_MODE) {
        expect(
          ap.some((e) => e.status === 'confirmado') &&
            ap.some((e) => e.status === 'realizado'),
        ).toBe(true);
        expect(
          ar.some((e) => e.status === 'confirmado') &&
            ar.some((e) => e.status === 'realizado'),
        ).toBe(true);
      } else {
        // Em sample, basta validar que os status são do enum esperado.
        expect(
          ap.every(
            (e) => e.status === 'confirmado' || e.status === 'realizado',
          ),
        ).toBe(true);
        expect(
          ar.every(
            (e) => e.status === 'confirmado' || e.status === 'realizado',
          ),
        ).toBe(true);
      }
      // CEF: 100% realizado em qualquer modo.
      expect(cefEventos.every((e) => e.status === 'realizado')).toBe(true);

      /* §4.3 — Calendário aplicado em 100% dos não-realizados */
      const naoRealizados = all.filter((e) => e.status !== 'realizado');
      const naoRealizadosForaDoUtil = naoRealizados.filter(
        (e) => !calendar.isBusinessDay(e.data_esperada),
      );
      expect(naoRealizadosForaDoUtil.length).toBe(0);

      /* §4.4 — Realizados têm data_esperada = data_realizada */
      const realizadosTodosOk = all.every((e) => {
        if (e.status !== 'realizado') return true;
        return e.data_esperada.getTime() === e.data_realizada.getTime();
      });
      expect(realizadosTodosOk).toBe(true);

      /* §4.5 — data_vencimento preservada quando deslocado.
       *  Full: Gregorutt 2023-2026 garante movimentos > 0.
       *  Sample: slice pode não conter vencimento em fim-de-semana —
       *  validamos só a invariância (data_esperada > data_vencimento) sobre
       *  o que existir. */
      const movidos = all.filter(
        (e) =>
          e.status === 'confirmado' &&
          !calendar.isBusinessDay(e.data_vencimento),
      );
      if (!SAMPLE_MODE) {
        expect(movidos.length).toBeGreaterThan(0);
      }
      expect(
        movidos.every((e) => {
          if (e.status !== 'confirmado') return false;
          return e.data_esperada.getTime() > e.data_vencimento.getTime();
        }),
      ).toBe(true);

      /* §4.7 — IDs únicos */
      expect(new Set(all.map((e) => e.id)).size).toBe(all.length);

      /* §4.6 — Determinismo (rodar 2× mesmos dados → mesmo array) */
      const apAgain = fknApAdapter(apClean, ctx);
      expect(apAgain.length).toBe(ap.length);
      for (let i = 0; i < ap.length; i++) {
        const a = ap[i]!;
        const b = apAgain[i]!;
        expect(b.id).toBe(a.id);
        expect(b.valor).toBe(a.valor);
        expect(b.direcao).toBe(a.direcao);
        expect(b.status).toBe(a.status);
        expect(b.data_esperada.getTime()).toBe(a.data_esperada.getTime());
      }

      /* §4.11 — Saldos do CEF viram OpeningBalanceSnapshot[] */
      expect(cefSaldos.length).toBeGreaterThan(0);
      expect(
        cefSaldos.every(
          (s) =>
            s.cliente_id === 'gregorutt' &&
            s.legal_entity_id === 'companhia_1' &&
            typeof s.conta_bancaria_id === 'string' &&
            s.conta_bancaria_id.length > 0 &&
            typeof s.valor === 'number' &&
            Number.isFinite(s.valor) &&
            s.data_referencia instanceof Date &&
            s.origem === 'cef',
        ),
      ).toBe(true);

      const elapsedMs = Date.now() - t0;
      // Sanity de tempo: full Gregorutt deve rodar em < 30s.
      if (!SAMPLE_MODE) {
        expect(elapsedMs).toBeLessThan(30_000);
      }

      printStageOneReport({
        mode: SAMPLE_MODE ? 'sample' : 'full',
        ap,
        ar,
        cefEventos,
        cefSaldos,
        movidos,
        elapsedMs,
        calendar,
      });
    },
  );
});
