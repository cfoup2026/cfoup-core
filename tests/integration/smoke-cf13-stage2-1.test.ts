/**
 * Smoke CF13 Estágio 2.1 — Motor de Histórico (estatísticas) sobre dados
 * reais Gregorutt.
 *
 * Pipeline:
 *  Stage 1 (parsers + adapters + calendário) → EventoCaixa[]
 *  Stage 2.1 (MotorHistorico.run) → HistoricoOperacionalParcial
 *
 * Asserções:
 *  - contraparteHistory.size > 0 + pelo menos 1 padrão estável
 *  - recorrencias.length > 0 + pelo menos 1 confiança alta
 *  - volatilidades.get('companhia_1').qualidade='alta' E cv > 0
 *  - 2.1 NÃO produz eventosEstimados
 *  - Determinismo (rodar 2× → deepEqual)
 *
 * Modo full (local) usa fixtures em tests/fixtures/gregorutt/.
 * Modo sample (CI ou CFOUP_SMOKE_MODE=sample) usa tests/fixtures/gregorutt-sample/.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BrazilCalendarPolicy,
  MotorHistorico,
  cefAdapter,
  extractCSV,
  fknApAdapter,
  fknArAdapter,
  parseCEFTxt,
  parseFKNAp,
  parseFKNAr,
  type AdapterContext,
  type EventoCaixa,
  type Payable,
  type Receivable,
  type Transaction,
  type BalanceSnapshot,
} from '../../src/index.js';

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

const calendar = new BrazilCalendarPolicy();
const ctx: AdapterContext = {
  cliente_id: 'gregorutt',
  legal_entity_id: 'companhia_1',
  source_company_code: 'comp1',
  calendar,
};

const GERADO_EM = new Date('2026-05-01T00:00:00.000Z');

/* ─────────── Loaders (replicados do smoke 1.4) ─────────── */

function loadAp(path: string): Payable[] {
  const buf = readFileSync(path);
  const content = new TextDecoder('windows-1252').decode(buf);
  return parseFKNAp(extractCSV(content, ';')).ok;
}
function loadAr(path: string): Receivable[] {
  const buf = readFileSync(path);
  const content = new TextDecoder('windows-1252').decode(buf);
  return parseFKNAr(extractCSV(content, ';')).ok;
}
function loadCef(path: string): {
  ok: Transaction[];
  balances: BalanceSnapshot[];
} {
  const content = readFileSync(path, 'utf8');
  const r = parseCEFTxt(content);
  // Prefixa stem do arquivo no tx.id para garantir unicidade global.
  const stem = (path.split(/[/\\]/).pop() ?? path).replace(/\.[^.]+$/, '');
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

/* ─────────── Pipeline Stage 1 inline ─────────── */

function runStage1(): EventoCaixa[] {
  const apPath = SAMPLE_MODE ? SAMPLE_AP : FULL_AP;
  const arPath = SAMPLE_MODE ? SAMPLE_AR : FULL_AR;
  const apClean = loadAp(apPath).filter((p) => p.amount > 0);
  const arClean = loadAr(arPath).filter((r) => r.amount > 0);
  const ap = fknApAdapter(apClean, ctx);
  const ar = fknArAdapter(arClean, ctx);
  const cefFiles = SAMPLE_MODE ? [SAMPLE_CEF] : listCefFiles(FULL_CEF_DIR);
  const cefEventos: EventoCaixa[] = [];
  for (const f of cefFiles) {
    const out = cefAdapter(loadCef(f), ctx);
    cefEventos.push(...out.eventos);
  }
  return [...ap, ...ar, ...cefEventos];
}

/* ─────────── Smoke ─────────── */

describe('CF13 Stage 2.1 — Smoke Gregorutt (estatísticas)', () => {
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)(
    'motor produz 3 estruturas, sem gerar eventos',
    () => {
      const eventos = runStage1();

      // V0: eventos chegam com criticidade='pendente' (Stage 1 bucket técnico).
      // Filtro estrito da spec (`obrigatoria/critica_op`) capturaria zero.
      // Override para incluir 'pendente' enquanto Stage 3 não classifica.
      const motor = new MotorHistorico({
        geradoEm: GERADO_EM,
        criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente'],
      });
      const historico = motor.run(eventos);

      // Contrapartes
      expect(historico.contraparteHistory.size).toBeGreaterThan(0);
      const estaveis = [...historico.contraparteHistory.values()].filter(
        (c) => c.padrao_estavel,
      );
      if (!SAMPLE_MODE) {
        // Full Gregorutt (3 anos): há padrões estáveis comprovados.
        expect(estaveis.length).toBeGreaterThan(0);
      }

      // Recorrências
      if (!SAMPLE_MODE) {
        expect(historico.recorrencias.length).toBeGreaterThan(0);
        const fortes = historico.recorrencias.filter(
          (r) => r.confianca === 'alta',
        );
        expect(fortes.length).toBeGreaterThan(0);
      }

      // Volatilidade
      const vol = historico.volatilidades.get('companhia_1');
      expect(vol).toBeDefined();
      if (!SAMPLE_MODE) {
        expect(vol!.qualidade).toBe('alta');
        expect(vol!.cv).toBeGreaterThan(0);
      }

      // §3.D — sem `calendar` no MotorHistorico, eventosEstimados é []
      // (modo estatístico). 2.2 roda só quando o caller passa calendar.
      expect(historico.eventosEstimados).toEqual([]);

      // Determinismo
      const historico2 = motor.run(eventos);
      expect(historico2.contraparteHistory).toEqual(historico.contraparteHistory);
      expect(historico2.recorrencias).toEqual(historico.recorrencias);
      expect(historico2.volatilidades).toEqual(historico.volatilidades);
      expect(historico2.baseDe).toEqual(historico.baseDe);

      // Console report compacto
      const totalEstaveis = estaveis.length;
      const totalRecorrencias = historico.recorrencias.length;
      const recorrFortes = historico.recorrencias.filter(
        (r) => r.confianca === 'alta',
      ).length;
      console.log('');
      console.log('=== CF13 Stage 2.1 — Smoke Gregorutt ===');
      console.log(`Modo: ${SAMPLE_MODE ? 'sample' : 'full'}`);
      console.log(
        `Contrapartes: ${historico.contraparteHistory.size} (${totalEstaveis} estáveis)`,
      );
      console.log(
        `Recorrências: ${totalRecorrencias} (${recorrFortes} confiança alta)`,
      );
      console.log(
        `Volatilidade companhia_1: qualidade=${vol?.qualidade}, n_periodos=${vol?.n_periodos}, cv=${vol?.cv.toFixed(4)}`,
      );
      console.log(
        `Base: ${historico.baseDe.totalRealizados} realizados, ${historico.baseDe.primeiroEvento.toISOString().slice(0, 10)} → ${historico.baseDe.ultimoEvento.toISOString().slice(0, 10)}`,
      );
      console.log('');
    },
  );
});
