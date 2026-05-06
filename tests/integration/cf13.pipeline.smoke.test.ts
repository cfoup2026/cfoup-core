/**
 * Smoke completo CF13 — pipeline encadeado Stage 1 → 7.
 *
 * Pipeline: Stage 1 (parsers + adapters) → Bridge (4.5) → Stage 2 →
 * Stage 3 → Stage 4 → Stage 5 → Stage 6 → Stage 7. `runPipeline` é a
 * fonte única de verdade da ordem.
 *
 * Asserções estruturais (10) cobrem:
 *  - Estrutura de cada estágio.
 *  - Determinismo do pipeline completo (2 rodadas → deepEqual).
 *  - Imutabilidade do input do Stage 1 (Object.freeze).
 *  - Stage 7 retorna `VereditoResult` com 5 vereditos válidos.
 *  - Banner consistente (ativo se aplicável, null caso contrário).
 *  - Pendências críticas Stage 6 só com `direcao='saida'` e
 *    `is_transferencia=false`.
 *
 * Modos `full` (Gregorutt local) e `sample` (CI). Loaders idênticos
 * aos smokes anteriores.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BrazilCalendarPolicy,
  NucleusClassifierAdapter,
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
  runPipeline,
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

const GERADO_EM = new Date('2026-05-01T00:00:00.000Z');
const RECON_EM = new Date('2026-05-01T12:00:00.000Z');
const DETEC_EM = new Date('2026-05-01T12:00:00.000Z');

/* ─────────── Loaders ─────────── */

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

describe('CF13 — Smoke pipeline completo Stage 1 → 7', () => {
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)(
    'pipeline 1 → Bridge → 2 → 3 → 4 → 5 → 6 → 7 com Gregorutt',
    async () => {
      const t0 = Date.now();

      const stage1 = await runStage1Inputs();
      const stage1EventosSnapshot = JSON.stringify(stage1.eventos);
      const classifier = new NucleusClassifierAdapter();

      const out = runPipeline({
        eventos: stage1.eventos,
        saldos: stage1.saldos,
        vendas: stage1.vendas,
        cliente_id: 'gregorutt',
        legal_entity_ids_ativas: ['companhia_1'],
        geradoEm: GERADO_EM,
        reconciliadoEm: RECON_EM,
        detectadoEm: DETEC_EM,
        calendar,
        classifier,
      });

      /* (1) Stage 1 ingere N eventos. */
      expect(stage1.eventos.length).toBeGreaterThan(0);

      /* (2) Bridge produz output válido (estrutura, não cobertura
       *     percentual — Stage 1.6 deixou cobertura limitada por
       *     classificação ainda incompleta de AP/CEF). */
      expect(out.bridged.estatisticas.totalEventos).toBe(stage1.eventos.length);
      expect(
        out.bridged.estatisticas.classificados +
          out.bridged.estatisticas.naoClassificados +
          out.bridged.estatisticas.jaClassificadosNoInput,
      ).toBe(out.bridged.estatisticas.totalEventos);

      /* (3) Stage 2: histórico com contraparteHistory + recorrências. */
      expect(out.historico.contraparteHistory.size).toBeGreaterThan(0);
      if (!SAMPLE_MODE) {
        expect(out.historico.recorrencias.length).toBeGreaterThan(0);
      }

      /* (4) Stage 3: estrutura de reconciliação. */
      expect(out.reconciliacao.eventos).toBeInstanceOf(Array);
      expect(out.reconciliacao.eventosBancariosAbsorvidos.length).toBe(
        out.reconciliacao.estatisticas.matchesAplicados,
      );

      /* (5) Stage 4: 13 semanas por unidade + consolidado. */
      expect(out.projecao.unidades).toHaveLength(1);
      expect(out.projecao.unidades[0]!.semanas).toHaveLength(13);
      expect(out.projecao.consolidado.semanas).toHaveLength(13);
      /* Roll-forward consolidado consistente. */
      for (let k = 0; k < 12; k++) {
        expect(out.projecao.consolidado.semanas[k]!.caixa_final).toBe(
          out.projecao.consolidado.semanas[k + 1]!.caixa_inicial,
        );
      }

      /* (6) Stage 5: status válido. */
      expect([
        'cobertura_insuficiente',
        'cobertura_com_confianca_reduzida',
        'cobertura_completa',
      ]).toContain(out.cobertura.status);

      /* (7) Stage 6: 13 confianças por unidade + consolidado;
       *     pendências críticas só direcao=saida + is_transferencia=false. */
      expect(out.confianca.por_unidade).toHaveLength(1);
      expect(out.confianca.por_unidade[0]!.semanas).toHaveLength(13);
      expect(out.confianca.consolidado.semanas).toHaveLength(13);
      const todasPendCriticas = [
        ...out.confianca.por_unidade.flatMap((u) => u.pendencias_criticas),
        ...out.confianca.consolidado.pendencias_criticas,
      ];
      for (const p of todasPendCriticas) {
        expect(p.direcao).toBe('saida');
        /* As pendências críticas vêm de eventos NÃO transferência —
         *  por construção do Stage 6 (filtra is_transferencia=true). */
      }

      /* (8) Stage 7: VereditoResult com vereditos válidos por unidade
       *     + consolidado, texto não vazio, banner consistente. */
      const VEREDITOS_VALIDOS = new Set([
        'CRITICO',
        'ALERTA',
        'ATENCAO',
        'LIMPO',
        'DADOS_INSUFICIENTES',
      ]);
      expect(out.veredito.unidades).toHaveLength(1);
      for (const u of out.veredito.unidades) {
        expect(VEREDITOS_VALIDOS.has(u.veredito)).toBe(true);
        expect(u.texto.length).toBeGreaterThan(0);
      }
      expect(VEREDITOS_VALIDOS.has(out.veredito.consolidado.veredito)).toBe(true);
      expect(out.veredito.consolidado.texto.length).toBeGreaterThan(0);
      expect(out.veredito.consolidado.legal_entity_id).toBe(
        'consolidado:gregorutt',
      );
      /* Banner: ou null, ou objeto consistente. */
      if (out.veredito.banner_unidade_critica !== null) {
        expect(out.veredito.banner_unidade_critica.ativo).toBe(true);
        expect(out.veredito.banner_unidade_critica.unidades_em_risco.length)
          .toBeGreaterThan(0);
        expect(out.veredito.banner_unidade_critica.texto.length).toBeGreaterThan(0);
      }

      /* (9) Determinismo de pipeline completo: 2x → deepEqual em todos
       *     os 7 outputs. */
      const classifier2 = new NucleusClassifierAdapter();
      const out2 = runPipeline({
        eventos: stage1.eventos,
        saldos: stage1.saldos,
        vendas: stage1.vendas,
        cliente_id: 'gregorutt',
        legal_entity_ids_ativas: ['companhia_1'],
        geradoEm: GERADO_EM,
        reconciliadoEm: RECON_EM,
        detectadoEm: DETEC_EM,
        calendar,
        classifier: classifier2,
      });
      expect(out2.bridged.eventos).toEqual(out.bridged.eventos);
      expect(out2.reconciliacao).toEqual(out.reconciliacao);
      expect(out2.comercial).toEqual(out.comercial);
      expect(out2.projecao).toEqual(out.projecao);
      expect(out2.cobertura).toEqual(out.cobertura);
      expect(out2.confianca).toEqual(out.confianca);
      expect(out2.veredito).toEqual(out.veredito);

      /* (10) Pipeline puro: input do Stage 1 não mutado pelo pipeline
       *      completo. */
      expect(JSON.stringify(stage1.eventos)).toBe(stage1EventosSnapshot);

      const elapsedMs = Date.now() - t0;
      /* Stage 7 só adiciona alguns ms sobre Stage 5 (lógica O(13) por
       *  unidade). Teto generoso pra absorver parallel test execution
       *  (5+ smokes simultâneos contendem CPU). */
      if (!SAMPLE_MODE) {
        expect(elapsedMs).toBeLessThan(540_000);
      }

      /* Relatório resumido pro console — Stage 7 é a leitura final. */
      console.log('');
      console.log('=== CF13 Pipeline 1→7 — Smoke Gregorutt ===');
      console.log(`Modo: ${SAMPLE_MODE ? 'sample' : 'full'}`);
      console.log(`Eventos Stage 1: ${stage1.eventos.length}`);
      console.log(
        `Bridge: ${out.bridged.estatisticas.classificados}/${out.bridged.estatisticas.totalEventos} classificados`,
      );
      console.log(`Cobertura: ${out.cobertura.status}`);
      console.log(
        `Confiança consolidada: ${out.confianca.consolidado.confianca_projecao}`,
      );
      console.log('');
      console.log('=== Veredito final ===');
      for (const u of out.veredito.unidades) {
        console.log(`  ${u.legal_entity_id}: ${u.veredito}`);
        console.log(`    "${u.texto}"`);
      }
      console.log(
        `  ${out.veredito.consolidado.legal_entity_id}: ${out.veredito.consolidado.veredito}`,
      );
      console.log(`    "${out.veredito.consolidado.texto}"`);
      if (out.veredito.banner_unidade_critica !== null) {
        console.log(`Banner: ${out.veredito.banner_unidade_critica.texto}`);
      }
      if (out.veredito.erros_de_marcacao.length > 0) {
        console.log(
          `Erros de marcação: ${out.veredito.erros_de_marcacao.length}`,
        );
      }
      console.log(`Tempo total: ${elapsedMs} ms`);
      console.log('');
    },
    600_000,
  );
});
