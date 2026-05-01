/**
 * Smoke CF13 Stage 2 completo (1.x + 2.1 + 2.2): pipeline real Gregorutt
 * culminando em `eventosEstimados` projetados.
 *
 * Modos `full` / `sample` idênticos aos demais smokes — ver
 * `docs/cf13/stage-1-smoke.md`.
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
const JANELA_DIAS = 13 * 7;

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
    cefEventos.push(...cefAdapter(loadCef(f), ctx).eventos);
  }
  return [...ap, ...ar, ...cefEventos];
}

/* ─────────── Smoke ─────────── */

describe('CF13 Stage 2 — Smoke completo (1.x + 2.1 + 2.2)', () => {
  const shouldRun = SAMPLE_MODE || FULL_FIXTURES_AVAILABLE;

  it.skipIf(!shouldRun)('Stage 1 + 2.1 + 2.2 encadeados', () => {
    const eventos = runStage1();
    const motor = new MotorHistorico({
      geradoEm: GERADO_EM,
      janelaSemanas: 13,
      calendar,
      criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente'],
    });
    const historico = motor.run(eventos);

    /* 2.1 — estatísticas */
    expect(historico.contraparteHistory.size).toBeGreaterThan(0);
    expect(historico.recorrencias.length).toBeGreaterThan(0);
    if (!SAMPLE_MODE) {
      expect(
        historico.volatilidades.get('companhia_1')!.qualidade,
      ).toBe('alta');
    }

    /* 2.2 — estimados */
    if (!SAMPLE_MODE) {
      expect(historico.eventosEstimados.length).toBeGreaterThan(0);
    } else {
      // Em sample, pode haver poucas recorrências fortes ativas — mas
      // se houver, devem respeitar todas as invariantes.
      // Não asseramos > 0; apenas que o array existe.
      expect(historico.eventosEstimados).toBeInstanceOf(Array);
    }

    for (const e of historico.eventosEstimados) {
      expect(e.origem).toBe('historico');
      expect(e.status).toBe('estimado');
      expect(e.confianca === 'media' || e.confianca === 'baixa').toBe(true);
      expect(e.is_transferencia).toBe(false);
      expect(e.criado_por).toBe('motor_historico');
      expect(e.origem_ref).toBeDefined();
    }

    /* Cobertura da janela */
    const fim = new Date(GERADO_EM.getTime() + JANELA_DIAS * 86_400_000);
    for (const e of historico.eventosEstimados) {
      expect(e.data_esperada.getTime()).toBeGreaterThanOrEqual(
        GERADO_EM.getTime(),
      );
      expect(e.data_esperada.getTime()).toBeLessThanOrEqual(
        fim.getTime() + 7 * 86_400_000, // tolerância: calendar pode mover
      );
    }

    /* Trava anti-duplicação: nenhum estimado bate com confirmado existente */
    const confirmados = eventos.filter((e) => e.status === 'confirmado');
    for (const est of historico.eventosEstimados) {
      if (est.status !== 'estimado' || est.data_vencimento === undefined) continue;
      const conflito = confirmados.find((c) => {
        if (c.status !== 'confirmado') return false;
        if (c.contraparte_id !== est.contraparte_id) return false;
        if (c.bucket_id !== est.bucket_id) return false;
        if (c.valor < est.valor * 0.9 || c.valor > est.valor * 1.1) return false;
        const diff = Math.abs(
          c.data_vencimento.getTime() - est.data_vencimento!.getTime(),
        );
        return diff <= 5 * 86_400_000;
      });
      expect(conflito).toBeUndefined();
    }

    /* Determinismo */
    const historico2 = motor.run(eventos);
    expect(historico2.eventosEstimados.map((e) => e.id)).toEqual(
      historico.eventosEstimados.map((e) => e.id),
    );

    /* Console report */
    console.log('');
    console.log('=== CF13 Stage 2 — Smoke completo ===');
    console.log(`Modo: ${SAMPLE_MODE ? 'sample' : 'full'}`);
    console.log(
      `Stage 1: ${eventos.length} eventos (confirmados: ${eventos.filter((e) => e.status === 'confirmado').length}, realizados: ${eventos.filter((e) => e.status === 'realizado').length})`,
    );
    console.log(
      `2.1 Stats: ${historico.contraparteHistory.size} contrapartes, ${historico.recorrencias.length} recorrências`,
    );
    const recAlta = historico.recorrencias.filter(
      (r) => r.confianca === 'alta',
    ).length;
    const recAtivas = historico.recorrencias.filter((r) => r.ativa).length;
    console.log(
      `   Recorrências: ${recAlta} alta, ${historico.recorrencias.length - recAlta} demais; ${recAtivas} ativas`,
    );
    console.log(
      `2.2 Estimados: ${historico.eventosEstimados.length} (cobrem ${GERADO_EM.toISOString().slice(0, 10)} → ${new Date(GERADO_EM.getTime() + JANELA_DIAS * 86_400_000).toISOString().slice(0, 10)})`,
    );
    console.log('');
  });
});
