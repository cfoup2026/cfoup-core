/**
 * Smoke CF13 Stage 4 completo: pipeline encadeado
 * 1.x → 2.1/2.2 → 3.1/3.1.1 → 3.2 → 4.1/4.2/4.3.
 *
 * Modos `full` / `sample` idênticos aos demais smokes. Valida estrutura
 * + roll-forward + caixa mínimo > 0 em alguma semana + determinismo.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BrazilCalendarPolicy,
  MotorHistorico,
  MotorReconciliacao,
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
  projetaCliente,
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
import { printStageFourReport } from './smoke-cf13-stage4.report.js';

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

async function runStage1(): Promise<{
  eventos: EventoCaixa[];
  saldos: OpeningBalanceSnapshot[];
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
  // PDFs CEF "com Saldo" → BalanceSnapshot[] → OpeningBalanceSnapshot[].
  const pdfFiles = SAMPLE_MODE
    ? [SAMPLE_CEF_PDF]
    : listCefPdfFiles(FULL_CEF_DIR);
  const cefPdfBalances: BalanceSnapshot[] = [];
  for (const pdf of pdfFiles) {
    cefPdfBalances.push(...(await loadCefPdfBalances(pdf)));
  }
  const saldos = cefAdapter({ ok: [], balances: cefPdfBalances }, ctx).saldos;
  return { eventos: [...ap, ...ar, ...cefEventos], saldos };
}

function runVendasAuxiliar(): VendaComercial[] {
  const path = SAMPLE_MODE ? SAMPLE_VENDAS : FULL_VENDAS;
  const sales = loadVendas(path);
  return fknVendasAdapter(sales, ctx);
}

/* ─────────── Smoke ─────────── */

describe('CF13 Stage 4 — Smoke completo', () => {
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)(
    'pipeline Stage 1 → 2 → 3 → 4 com Gregorutt',
    async () => {
      const t0 = Date.now();

      /* Stage 1 */
      const { eventos: stage1Eventos, saldos } = await runStage1();

      /* Stage 2 */
      const motorH = new MotorHistorico({
        geradoEm: GERADO_EM,
        janelaSemanas: 13,
        calendar,
        criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente'],
      });
      const historico = motorH.run(stage1Eventos);
      const eventosStage2 = [
        ...stage1Eventos,
        ...historico.eventosEstimados,
      ];

      /* Stage 3 */
      const vendas = runVendasAuxiliar();
      const motorR = new MotorReconciliacao({ reconciliadoEm: RECON_EM });
      const { reconciliacao, comercial } = motorR.run(
        eventosStage2,
        vendas,
      );

      /* Stage 4 */
      const projecao = projetaCliente({
        eventos: reconciliacao.eventos,
        saldos,
        cliente_id: 'gregorutt',
        legal_entity_ids_ativas: ['companhia_1'],
        geradoEm: GERADO_EM,
        calendar,
        contraparteHistory: historico.contraparteHistory,
        volatilidades: historico.volatilidades,
      });

      /* ─── Asserções estruturais ─── */

      expect(projecao.unidades.length).toBeGreaterThanOrEqual(1);
      expect(projecao.consolidado.semanas.length).toBe(13);
      expect(projecao.consolidado.janela).toHaveLength(13);
      expect(projecao.consolidado.janela[0]).toBe('2026-W18');

      // Roll-forward consolidado: caixa final[k] = caixa inicial[k+1].
      for (let k = 0; k < 12; k++) {
        expect(projecao.consolidado.semanas[k]!.caixa_final).toBe(
          projecao.consolidado.semanas[k + 1]!.caixa_inicial,
        );
      }

      // Caixa inicial consolidado = soma dos caixa inicial das unidades.
      const expectedInicial = projecao.unidades
        .map((u) => u.caixaInicial.valor)
        .reduce((a, b) => a + b, 0);
      expect(projecao.consolidado.caixaInicial.valor).toBe(expectedInicial);

      // Caixa mínimo: real Gregorutt vem 100% `criticidade='pendente'`
      // (classificação de criticidade — folha/imposto/fornecedor crítico —
      // é etapa posterior, ainda não implementada). Sem critérios
      // satisfeitos, todos os mínimos vêm 0. Validamos `>= 0` no real e
      // adicionamos sub-cenário sintético abaixo pra provar a matemática.
      for (const s of projecao.consolidado.semanas) {
        expect(s.caixa_minimo_op).toBeGreaterThanOrEqual(0);
      }
      const semComMinimoReal = projecao.consolidado.semanas.filter(
        (s) => s.caixa_minimo_op > 0,
      );

      /* Sub-cenário sintético: injeta 1 evento confirmado/saida/obrigatoria
       * R$ 5.000 numa semana central e roda projetaCliente novamente.
       * Caixa mínimo das duas semanas anteriores deve refletir o evento
       * com margem fallback 10% (volatilidade Gregorutt do companhia_1
       * é alta, então pode usar CV — verificamos margem_origem). */
      const eventoCriticoSintetico: EventoCaixa = {
        id: 'sintetico-critico',
        valor: 5000,
        direcao: 'saida',
        data_esperada: new Date(Date.UTC(2026, 5, 8)), // dom 2026-06-08 = W24
        bucket_id: 'pendente_classificacao',
        bucket_nome: 'Pendente',
        cliente_id: 'gregorutt',
        legal_entity_id: 'companhia_1',
        origem: 'manual',
        criticidade: 'obrigatoria',
        confianca: 'alta',
        confianca_origem: 'sistema',
        is_transferencia: false,
        criado_em: new Date('2026-05-01T00:00:00.000Z'),
        criado_por: 'smoke-test',
        status: 'confirmado',
        data_realizada: null,
        data_vencimento: new Date(Date.UTC(2026, 5, 8)),
      };
      const projecaoSintetica = projetaCliente({
        eventos: [...reconciliacao.eventos, eventoCriticoSintetico],
        saldos,
        cliente_id: 'gregorutt',
        legal_entity_ids_ativas: ['companhia_1'],
        geradoEm: GERADO_EM,
        calendar,
        contraparteHistory: historico.contraparteHistory,
        volatilidades: historico.volatilidades,
      });
      // 2026-06-08 está em W24 (idx 6). Mínimos de W22 (idx 4) e W23 (idx 5)
      // devem incluir os 5000 do sintético.
      const w22 = projecaoSintetica.consolidado.semanas[4]!;
      const w23 = projecaoSintetica.consolidado.semanas[5]!;
      expect(
        w22.caixa_minimo_op_provenance.eventos_considerados_ids,
      ).toContain('sintetico-critico');
      expect(
        w23.caixa_minimo_op_provenance.eventos_considerados_ids,
      ).toContain('sintetico-critico');
      expect(w22.caixa_minimo_op).toBeGreaterThan(0);
      expect(w23.caixa_minimo_op).toBeGreaterThan(0);
      // 5000 × (1 + margem). Margem é CV da volatilidade alta (clamped a 25%)
      // OU fallback 10% — ambos válidos. Aceitamos faixa [5500, 6250].
      expect(w22.caixa_minimo_op).toBeGreaterThanOrEqual(5500);
      expect(w22.caixa_minimo_op).toBeLessThanOrEqual(6250);

      // Provenance preenchida em todas as semanas.
      for (const sem of projecao.consolidado.semanas) {
        expect(sem.caixa_minimo_op_provenance.margem_origem).toBe(
          'agregado_por_unidade',
        );
        expect(sem.caixa_minimo_op_provenance.por_unidade).toBeDefined();
      }
      for (const u of projecao.unidades) {
        for (const sem of u.semanas) {
          expect([
            'volatilidade_alta',
            'fallback_10pct',
          ]).toContain(sem.caixa_minimo_op_provenance.margem_origem);
        }
      }

      // Stage 4 não compara — sem campo "abaixo_do_minimo".
      expect(
        (projecao.consolidado.semanas[0] as unknown as Record<string, unknown>)[
          'abaixo_do_minimo'
        ],
      ).toBeUndefined();

      // Determinismo: pipeline 4 rodado 2× → mesmo resultado.
      const projecao2 = projetaCliente({
        eventos: reconciliacao.eventos,
        saldos,
        cliente_id: 'gregorutt',
        legal_entity_ids_ativas: ['companhia_1'],
        geradoEm: GERADO_EM,
        calendar,
        contraparteHistory: historico.contraparteHistory,
        volatilidades: historico.volatilidades,
      });
      expect(projecao2).toEqual(projecao);

      const elapsedMs = Date.now() - t0;
      // Spec: < 90s no full local. Sob test parallelism dobra o tempo;
      // mantemos teto generoso (180s) pra absorver contention.
      if (!SAMPLE_MODE) {
        expect(elapsedMs).toBeLessThan(180_000);
      }

      printStageFourReport({
        mode: SAMPLE_MODE ? 'sample' : 'full',
        stage1Eventos,
        historico,
        reconciliacao,
        comercial,
        vendas,
        projecao,
        elapsedMs,
      });
    },
    240_000,
  );
});
