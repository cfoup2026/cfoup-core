/**
 * Smoke end-to-end do CF13 UI Contract — `runCF13Pipeline` direto sobre
 * fixture Gregorutt (full ou sample).
 *
 * Reutiliza os loaders Stage 1 do `cf13.pipeline.smoke.test.ts`. A
 * função pública `runCF13Pipeline` chama o orquestrador interno
 * (`runPipeline`) e adapta a saída pro contrato camelCase.
 *
 * Verificações:
 *  - Estrutura `CF13Output` (meta, projecao, cobertura, confianca,
 *    veredito, pendencias).
 *  - Invariantes globais (13 semanas; categoria de veredito ∈ enum;
 *    cobertura insuficiente ⇒ dados_insuficientes).
 *  - JSON-safety (round-trip JSON.parse(JSON.stringify(out))).
 *  - Determinismo: 2 rodadas com mesmo `now` injetado → mesmo JSON.
 *  - Imutabilidade: input do Stage 1 não mutado.
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
  fknVendasAdapter,
  parseCEFPdf,
  parseCEFTxt,
  parseFKNAp,
  parseFKNAr,
  parseFKNVendas,
  runCF13Pipeline,
  type AdapterContext,
  type BalanceSnapshot,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
  type Payable,
  type Receivable,
  type Sale,
  type Transaction,
  type VendaComercial,
} from '../../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', 'fixtures');
const FULL_AP = resolve(FIXTURES_ROOT, 'gregorutt_cp_2023_ate_20abr2026.csv');
const FULL_AR = resolve(FIXTURES_ROOT, 'gregorutt_cr_2023_ate_20abr2026.csv');
const FULL_VENDAS = resolve(
  FIXTURES_ROOT,
  'gregorutt_vendas_2023_ate_20abr2026.csv',
);
const FULL_CEF_DIR = resolve(FIXTURES_ROOT, 'gregorutt', 'Bcos');
const SAMPLE_AP = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'ap-sample.csv');
const SAMPLE_AR = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'ar-sample.csv');
const SAMPLE_VENDAS = resolve(
  FIXTURES_ROOT,
  'gregorutt-sample',
  'vendas-sample.csv',
);
const SAMPLE_CEF = resolve(FIXTURES_ROOT, 'gregorutt-sample', 'cef-sample.txt');
const SAMPLE_CEF_PDF = resolve(
  FIXTURES_ROOT,
  'gregorutt-sample',
  'cef-sample-com-saldo.pdf',
);

const SAMPLE_MODE =
  process.env['CI'] !== undefined ||
  process.env['CFOUP_SMOKE_MODE'] === 'sample';
const FULL_FIXTURES_AVAILABLE =
  existsSync(FULL_AP) &&
  existsSync(FULL_AR) &&
  existsSync(FULL_VENDAS) &&
  existsSync(FULL_CEF_DIR);

const calendar = new BrazilCalendarPolicy();
const ctx: AdapterContext = {
  cliente_id: 'gregorutt',
  legal_entity_id: 'companhia_1',
  source_company_code: 'comp1',
  // Fallback: PDFs Gregorutt não trazem header `Conta:` — parser entrega
  // accountId='' e o adapter exige fallback no ctx (Fix 2).
  conta_bancaria_id: '0423012920005778782426',
  calendar,
};

const BASE_DATE = '2026-05-01';
const NOW_FIXO_DATE = new Date('2026-05-01T12:00:00.000Z');
/** Factory determinística (§4): trava `meta.geradoEm` em testes. */
const NOW_FIXO = (): Date => NOW_FIXO_DATE;

/* ─────────── Loaders (idênticos ao smoke 1→7) ─────────── */

function loadAp(path: string): Payable[] {
  const buf = readFileSync(path);
  return parseFKNAp(
    extractCSV(new TextDecoder('windows-1252').decode(buf), ';'),
  ).ok;
}
function loadAr(path: string): Receivable[] {
  const buf = readFileSync(path);
  return parseFKNAr(
    extractCSV(new TextDecoder('windows-1252').decode(buf), ';'),
  ).ok;
}
function loadVendas(path: string): Sale[] {
  const buf = readFileSync(path);
  return parseFKNVendas(
    extractCSV(new TextDecoder('windows-1252').decode(buf), ';'),
  ).ok;
}
function loadCef(path: string): {
  ok: Transaction[];
  balances: BalanceSnapshot[];
} {
  const content = readFileSync(path, 'utf8');
  const r = parseCEFTxt(content);
  const stem = (path.split(/[/\\]/).pop() ?? path).replace(/\.[^.]+$/, '');
  const safeStem = stem.replace(/\s+/g, '_');
  const ok = r.ok.map((tx) => ({ ...tx, id: `${safeStem}:${tx.id}` }));
  return { ok, balances: r.balances };
}
async function loadCefPdfBalances(path: string): Promise<BalanceSnapshot[]> {
  const buf = readFileSync(path);
  const r = await parseCEFPdf(buf);
  return r.balances;
}
function listCefFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        f.toLowerCase().startsWith('cef') && f.toLowerCase().endsWith('.txt'),
    )
    .map((f) => resolve(dir, f))
    .sort();
}
function listCefPdfFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(
      (f) =>
        f.toLowerCase().startsWith('cef') && f.toLowerCase().endsWith('.pdf'),
    )
    .map((f) => resolve(dir, f))
    .sort();
}

async function runStage1Inputs(): Promise<{
  eventos: EventoCaixa[];
  saldos: OpeningBalanceSnapshot[];
  vendas: VendaComercial[];
}> {
  const apPath = SAMPLE_MODE ? SAMPLE_AP : FULL_AP;
  const arPath = SAMPLE_MODE ? SAMPLE_AR : FULL_AR;
  const apClean = loadAp(apPath).filter((p) => p.amount > 0);
  const arClean = loadAr(arPath).filter((r) => r.amount > 0);
  const ap = fknApAdapter(apClean, ctx);
  const ar = fknArAdapter(arClean, ctx);
  const cefFiles = SAMPLE_MODE ? [SAMPLE_CEF] : listCefFiles(FULL_CEF_DIR);
  const cefEventos: EventoCaixa[] = [];
  for (const f of cefFiles) {
    cefEventos.push(...cefAdapter(loadCef(f), ctx).eventos);
  }
  const pdfFiles = SAMPLE_MODE
    ? [SAMPLE_CEF_PDF]
    : listCefPdfFiles(FULL_CEF_DIR);
  const cefPdfBalances: BalanceSnapshot[] = [];
  for (const pdf of pdfFiles) {
    cefPdfBalances.push(...(await loadCefPdfBalances(pdf)));
  }
  const saldos = cefAdapter({ ok: [], balances: cefPdfBalances }, ctx).saldos;
  const vendasPath = SAMPLE_MODE ? SAMPLE_VENDAS : FULL_VENDAS;
  const sales = loadVendas(vendasPath);
  const vendas = fknVendasAdapter(sales, ctx);
  return {
    eventos: [...ap, ...ar, ...cefEventos],
    saldos,
    vendas,
  };
}

/* ─────────── Smoke ─────────── */

describe('CF13 Contract — Smoke runCF13Pipeline com Gregorutt', () => {
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)(
    'runCF13Pipeline produz CF13Output válido + JSON-safe + determinístico',
    async () => {
      const t0 = Date.now();

      const stage1 = await runStage1Inputs();
      const stage1EventosSnapshot = JSON.stringify(stage1.eventos);

      const out = runCF13Pipeline({
        cliente_id: 'gregorutt',
        base_date: BASE_DATE,
        eventos: stage1.eventos,
        opening_balances: stage1.saldos,
        vendas: stage1.vendas,
        legal_entity_ids_ativas: ['companhia_1'],
        now: NOW_FIXO,
      });

      /* (1) meta. */
      expect(out.meta.clienteId).toBe('gregorutt');
      expect(out.meta.baseDate).toBe(BASE_DATE);
      expect(out.meta.versaoEngine).toBe('cf13.v0');
      expect(out.meta.geradoEm).toBe(NOW_FIXO_DATE.toISOString());
      /* §4: geradoEm é ISO 8601 válido e diferente do baseDate. */
      expect(out.meta.geradoEm).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(out.meta.geradoEm).not.toBe(`${BASE_DATE}T00:00:00.000Z`);
      /* janelaInicio/fim coerentes com semanas[0]/semanas[12]. */
      expect(out.meta.janelaInicio).toBe(
        out.projecao.consolidado.semanas[0]!.inicio,
      );
      expect(out.meta.janelaFim).toBe(
        out.projecao.consolidado.semanas[12]!.fim,
      );

      /* (2) projecao. */
      expect(out.projecao.clienteId).toBe('gregorutt');
      expect(out.projecao.consolidado.semanas).toHaveLength(13);
      expect(out.projecao.consolidado.escopo).toEqual({
        tipo: 'consolidado',
        clienteId: 'gregorutt',
      });
      expect(out.projecao.unidades).toHaveLength(1);
      expect(out.projecao.unidades[0]!.escopo).toEqual({
        tipo: 'unidade',
        legalEntityId: 'companhia_1',
      });
      /* Todas as semanas têm rotulo gerado e shape esperado. */
      for (const sem of out.projecao.consolidado.semanas) {
        expect(sem.rotulo.length).toBeGreaterThan(0);
        expect(sem.indice).toBeGreaterThanOrEqual(1);
        expect(sem.indice).toBeLessThanOrEqual(13);
        expect(sem.eventosEntradaIds).toBeInstanceOf(Array);
        expect(sem.eventosSaidaIds).toBeInstanceOf(Array);
      }

      /* (3) cobertura — status binário. */
      expect(['suficiente', 'insuficiente']).toContain(out.cobertura.status);

      /* (4) confianca. */
      expect(out.confianca.consolidado.semanas).toHaveLength(13);
      expect(out.confianca.unidades).toHaveLength(1);
      expect(['baixa', 'media', 'alta']).toContain(
        out.confianca.consolidado.projecao,
      );

      /* (5) veredito — categoria ∈ 5 valores. */
      const CATEGORIAS = new Set([
        'dados_insuficientes',
        'critico',
        'alerta',
        'atencao',
        'limpo',
      ]);
      expect(CATEGORIAS.has(out.veredito.consolidado.categoria)).toBe(true);
      expect(out.veredito.consolidado.texto.length).toBeGreaterThan(0);
      for (const u of out.veredito.unidades) {
        expect(CATEGORIAS.has(u.categoria)).toBe(true);
        expect(u.legalEntityId).toBe('companhia_1');
      }

      /* (6) Invariante cross-output: cobertura insuficiente
       *     ⇒ veredito.consolidado.categoria === dados_insuficientes. */
      if (out.cobertura.status === 'insuficiente') {
        expect(out.veredito.consolidado.categoria).toBe('dados_insuficientes');
      }

      /* (7) pendencias — array, ordenação determinística. */
      expect(out.pendencias).toBeInstanceOf(Array);
      const sevOrder: Record<string, number> = {
        critica: 0,
        media: 1,
        baixa: 2,
      };
      for (let i = 1; i < out.pendencias.length; i++) {
        const a = sevOrder[out.pendencias[i - 1]!.severidade]!;
        const b = sevOrder[out.pendencias[i]!.severidade]!;
        expect(a).toBeLessThanOrEqual(b);
      }

      /* (8) Integridade referencial — todas pendências com semanaId
       *     definido apontam para uma semana real. */
      const inicios = new Set(
        out.projecao.consolidado.semanas.map((s) => s.inicio),
      );
      for (const p of out.pendencias) {
        if (p.semanaId !== undefined) {
          expect(inicios.has(p.semanaId)).toBe(true);
        }
      }

      /* (9) JSON-safety — round-trip não destrói nada. */
      const json = JSON.stringify(out);
      const parsed = JSON.parse(json) as unknown;
      expect(parsed).toEqual(out);

      /* (10) Determinismo — 2ª rodada com mesmos inputs + same now
       *      → byte equal. */
      const out2 = runCF13Pipeline({
        cliente_id: 'gregorutt',
        base_date: BASE_DATE,
        eventos: stage1.eventos,
        opening_balances: stage1.saldos,
        vendas: stage1.vendas,
        legal_entity_ids_ativas: ['companhia_1'],
        now: NOW_FIXO,
      });
      expect(JSON.stringify(out2)).toBe(json);

      /* (11) Imutabilidade do input. */
      expect(JSON.stringify(stage1.eventos)).toBe(stage1EventosSnapshot);

      const elapsedMs = Date.now() - t0;
      if (!SAMPLE_MODE) {
        /* Adapter é O(N) sobre output do Stage 7. Tempo extra desprezível
         *  (<2s adicional sobre os 50-184s do smoke 1→7); teto 600s
         *  garante margem em parallel test execution. */
        expect(elapsedMs).toBeLessThan(600_000);
      }

      /* Relatório console — leitura final da camada de contrato. */
      console.log('');
      console.log('=== CF13 Contract Smoke — Gregorutt ===');
      console.log(`Modo: ${SAMPLE_MODE ? 'sample' : 'full'}`);
      console.log(
        `Eventos: ${stage1.eventos.length} | Saldos: ${stage1.saldos.length}`,
      );
      console.log(`baseDate: ${out.meta.baseDate}`);
      console.log(
        `Janela: ${out.meta.janelaInicio} → ${out.meta.janelaFim}`,
      );
      console.log(`Cobertura: ${out.cobertura.status}`);
      console.log(`Confiança consol.: ${out.confianca.consolidado.projecao}`);
      console.log('');
      console.log('=== Veredito ===');
      for (const u of out.veredito.unidades) {
        console.log(`  ${u.legalEntityId}: ${u.categoria}`);
        console.log(`    "${u.texto}"`);
      }
      console.log(
        `  consolidado: ${out.veredito.consolidado.categoria}`,
      );
      console.log(`    "${out.veredito.consolidado.texto}"`);
      if (out.veredito.bannerUnidadeCritica.presente) {
        console.log(`Banner: ${out.veredito.bannerUnidadeCritica.mensagem}`);
      }
      console.log(`Pendências: ${out.pendencias.length}`);
      console.log(`Tempo total: ${elapsedMs} ms`);
      console.log('');
    },
    600_000,
  );
});
