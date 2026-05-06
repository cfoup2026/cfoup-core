/**
 * Gerador de fixture CF13 a partir das fontes Gregorutt commitadas.
 *
 * Output: scripts/output/gregorutt.json — formato consumido por
 * cfoup-overview-v3/lib/cf13/loadInputs.ts:
 *   { eventos_caixa: EventoCaixa[], opening_balance_snapshots: OpeningBalanceSnapshot[] }
 *
 * Snake_case, datas como ISO strings (JSON.stringify de Date faz isso). Sem
 * vendas (loader não consome). Sem base_date/cliente_id/meta no top-level.
 *
 * Fontes:
 *   tests/fixtures/cef_apr25.txt              → eventos CEF (TXT)
 *   tests/fixtures/cef_apr26_com_saldo.pdf    → saldos CEF (PDF, via cefAdapter consolidado)
 *   tests/fixtures/gregorutt_cp_2023_ate_20abr2026.csv → eventos AP (FKN)
 *   tests/fixtures/gregorutt_cr_2023_ate_20abr2026.csv → eventos AR (FKN)
 *
 * Invariantes validados antes de escrever (falha = aborta sem output parcial):
 *   - Nenhum saldo com conta_bancaria_id vazia/undefined.
 *   - Nenhuma duplicata por (cliente_id, legal_entity_id, data_referencia ISO,
 *     conta_bancaria_id) — preempt da regra do Fix 3.
 *
 * Run: pnpm exec tsx scripts/regen-gregorutt-fixture.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { listCefFiles, listCefPdfFiles } from './_helpers/list-cef-files.js';

import {
  BrazilCalendarPolicy,
  cefAdapter,
  classifyTransaction,
  extractCSV,
  fknApAdapter,
  fknArAdapter,
  parseCEFPdf,
  parseCEFTxt,
  parseFKNAp,
  parseFKNAr,
  type AccountCodeHintMap,
  type AdapterContext,
  type BalanceSnapshot,
  type ClassificationResult,
  type Direction,
  type EventoCaixa,
  type OpeningBalanceSnapshot,
  type Origem,
  type SourceSystem,
  type SourceTransaction,
  type Transaction,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const FIXTURES = resolve(REPO_ROOT, 'tests', 'fixtures');
const OUTPUT_DIR = resolve(REPO_ROOT, 'scripts', 'output');
const OUTPUT_PATH = resolve(OUTPUT_DIR, 'gregorutt.json');

const FKN_AP = resolve(FIXTURES, 'gregorutt_cp_2023_ate_20abr2026.csv');
const FKN_AR = resolve(FIXTURES, 'gregorutt_cr_2023_ate_20abr2026.csv');

/** Default: cópia local do hints map FKN (mesmo conteúdo do overview-v3). */
const DEFAULT_HINTS_PATH = resolve(
  REPO_ROOT,
  'test-data',
  'gregorutt',
  'account-hints.ts',
);

/* ─────────── CLI parsing ─────────── */

const { values: cliFlags } = parseArgs({
  options: {
    'account-hints': { type: 'string' },
  },
  // Permite flags desconhecidas pra futuro sem quebrar.
  strict: true,
});
const HINTS_PATH = resolve(
  REPO_ROOT,
  cliFlags['account-hints'] ?? DEFAULT_HINTS_PATH,
);

const ctx: AdapterContext = {
  cliente_id: 'gregorutt',
  legal_entity_id: 'companhia_1',
  source_company_code: 'comp1',
  // Fallback: PDFs Gregorutt não trazem header `Conta:` — parser entrega
  // accountId='' e o adapter exige fallback no ctx (Fix 2).
  conta_bancaria_id: '0423012920005778782426',
  calendar: new BrazilCalendarPolicy(),
};

/* ─────────── Loaders (mesmo padrão dos smokes) ─────────── */

function decodeWin1252(buf: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(buf);
}

function loadCefTxt(path: string): { ok: Transaction[]; balances: BalanceSnapshot[] } {
  const content = readFileSync(path, 'utf8');
  const r = parseCEFTxt(content);
  if (r.errors.length > 0) {
    console.warn(`[CEF TXT ${path}] ${r.errors.length} erros — seguindo`);
  }
  // Prefixa stem do filename em tx.id pra evitar colisão entre arquivos
  // (mesmo padrão de smoke-cf13-stage1 L105-108).
  const stem = (path.split(/[/\\]/).pop() ?? path).replace(/\.[^.]+$/, '');
  const safeStem = stem.replace(/\s+/g, '_');
  const ok = r.ok.map((tx) => ({ ...tx, id: `${safeStem}:${tx.id}` }));
  return { ok, balances: r.balances };
}

async function loadCefPdfBalances(path: string): Promise<BalanceSnapshot[]> {
  const buf = readFileSync(path);
  const r = await parseCEFPdf(buf);
  if (r.errors.length > 0) {
    console.warn(`[CEF PDF ${path}] ${r.errors.length} erros — seguindo`);
  }
  return r.balances;
}

/* ─────────── Classificação ─────────── */

/**
 * Carrega o hints map dinamicamente (CLI flag ou default). Espera export
 * named `fknAccountCodeHints` — convenção do arquivo em test-data e do
 * original em overview-v3. Falha visível se o file não existir ou o
 * shape estiver errado.
 */
async function loadHints(absPath: string): Promise<AccountCodeHintMap> {
  const url = pathToFileURL(absPath).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const hints = mod['fknAccountCodeHints'];
  if (
    hints === undefined ||
    typeof hints !== 'object' ||
    hints === null
  ) {
    throw new Error(
      `regen-gregorutt-fixture: hints inválidos em ${absPath} ` +
        `(esperava export named 'fknAccountCodeHints' do tipo AccountCodeHintMap)`,
    );
  }
  return hints as AccountCodeHintMap;
}

/** Mapeia `Origem` (CF13) → `SourceSystem` (motor de classificação). */
function mapOrigemToSourceSystem(origem: Origem): SourceSystem {
  switch (origem) {
    case 'cef':
    case 'pluggy':
      return 'bank';
    case 'enotas':
      return 'invoice';
    case 'contabil':
      return 'accounting';
    case 'fkn':
    case 'erp':
    case 'manual':
    case 'csv':
    case 'historico':
      return 'erp';
  }
}

/**
 * Mapeia `EventoCaixa` (CF13) → `SourceTransaction` (input do motor).
 *
 * Campos chave:
 *  - `originalAccountCode` ← `contraparte_id` (FKN vendor/customer code,
 *    onde os hints exact/prefix casam).
 *  - `transactionDate` ← `data_realizada` em `realizado`; senão `data_esperada`.
 *  - `paidDate` só preenchido em `realizado`.
 *  - `dueDate` quando `data_vencimento` presente (obrigatório em
 *    `confirmado`, opcional nos demais).
 */
function eventoToSourceTransaction(ev: EventoCaixa): SourceTransaction {
  const direction: Direction =
    ev.direcao === 'entrada' ? 'inflow' : 'outflow';
  const transactionDate =
    ev.status === 'realizado' ? ev.data_realizada : ev.data_esperada;

  const st: SourceTransaction = {
    id: ev.id,
    companyId: ev.cliente_id,
    sourceSystem: mapOrigemToSourceSystem(ev.origem),
    transactionDate,
    direction,
    amount: ev.valor,
    currency: 'BRL',
  };
  if (ev.descricao_origem !== undefined) st.description = ev.descricao_origem;
  if (ev.contraparte_nome_origem !== undefined)
    st.counterpartyName = ev.contraparte_nome_origem;
  if (ev.documento_ref !== undefined) st.documentNumber = ev.documento_ref;
  if (ev.contraparte_id !== undefined)
    st.originalAccountCode = ev.contraparte_id;
  if (ev.conta_origem_nome !== undefined)
    st.originalAccountName = ev.conta_origem_nome;
  if (ev.status === 'realizado') st.paidDate = ev.data_realizada;
  if (ev.data_vencimento !== undefined) st.dueDate = ev.data_vencimento;
  if (ev.criado_em !== undefined) st.createdAt = ev.criado_em;
  return st;
}

/**
 * Anexa `classification: ClassificationResult` a cada evento. Não muta os
 * tipos do core — só o shape do JSON output. Determinístico: mesmo input
 * + hints → mesma classification em qualquer rodada.
 */
function classifyEventos(
  eventos: readonly EventoCaixa[],
  hints: AccountCodeHintMap,
): Array<EventoCaixa & { classification: ClassificationResult }> {
  return eventos.map((ev) => {
    const st = eventoToSourceTransaction(ev);
    const classification = classifyTransaction(st, {
      accountCodeHints: hints,
    });
    return { ...ev, classification };
  });
}

/* ─────────── Pipeline ─────────── */

async function main(): Promise<void> {
  console.log('[regen] iniciando geração da fixture Gregorutt CF13');
  const t0 = Date.now();

  /* CEF TXT → eventos (varredura cronológica em tests/fixtures/) */
  const cefTxtPaths = listCefFiles(FIXTURES);
  console.log(`[CEF TXT] ${cefTxtPaths.length} arquivos descobertos`);
  const cefEventos: EventoCaixa[] = [];
  for (const p of cefTxtPaths) {
    const parsed = loadCefTxt(p);
    cefEventos.push(...cefAdapter(parsed, ctx).eventos);
  }
  console.log(`[CEF TXT] ${cefEventos.length} eventos totais`);

  /* CEF PDF → saldos (consolidado, padrão Fix 3 passo 4: 1 call único) */
  const cefPdfPaths = listCefPdfFiles(FIXTURES);
  console.log(`[CEF PDF] ${cefPdfPaths.length} arquivos descobertos`);
  const cefPdfBalances: BalanceSnapshot[] = [];
  for (const p of cefPdfPaths) {
    cefPdfBalances.push(...(await loadCefPdfBalances(p)));
  }
  const saldos = cefAdapter({ ok: [], balances: cefPdfBalances }, ctx).saldos;
  console.log(`[CEF PDF] ${cefPdfBalances.length} balances brutos → ${saldos.length} saldos agregados`);

  /* FKN AP → eventos */
  const apResult = parseFKNAp(extractCSV(decodeWin1252(readFileSync(FKN_AP)), ';'));
  if (apResult.errors.length > 0) {
    console.warn(`[FKN AP] ${apResult.errors.length} erros de parse — seguindo`);
  }
  const apClean = apResult.ok.filter((p) => p.amount > 0);
  const apDropped = apResult.ok.length - apClean.length;
  if (apDropped > 0) console.warn(`[FKN AP] filtered ${apDropped} rows com amount<=0`);
  const apEventos = fknApAdapter(apClean, ctx);
  console.log(`[FKN AP] ${apEventos.length} eventos`);

  /* FKN AR → eventos */
  const arResult = parseFKNAr(extractCSV(decodeWin1252(readFileSync(FKN_AR)), ';'));
  if (arResult.errors.length > 0) {
    console.warn(`[FKN AR] ${arResult.errors.length} erros de parse — seguindo`);
  }
  const arClean = arResult.ok.filter((r) => r.amount > 0);
  const arDropped = arResult.ok.length - arClean.length;
  if (arDropped > 0) console.warn(`[FKN AR] filtered ${arDropped} rows com amount<=0`);
  const arEventos = fknArAdapter(arClean, ctx);
  console.log(`[FKN AR] ${arEventos.length} eventos`);

  /* Concat eventos */
  const eventos: EventoCaixa[] = [...apEventos, ...arEventos, ...cefEventos];

  /* ─────────── Classificação ─────────── */

  console.log(`[hints] carregando ${HINTS_PATH}`);
  const hints = await loadHints(HINTS_PATH);
  const exactCount = Object.keys(hints.exact ?? {}).length;
  const prefixCount = (hints.prefix ?? []).length;
  console.log(
    `[hints] ${exactCount} exact + ${prefixCount} prefix carregados`,
  );

  console.log(`[classify] classificando ${eventos.length} eventos`);
  const eventosClassificados = classifyEventos(eventos, hints);

  /* ─────────── Validação de invariantes ─────────── */

  validateNoEmptyContaBancariaId(saldos);
  validateNoDuplicateKeys(saldos);

  /* ─────────── Output ─────────── */

  const output = {
    eventos_caixa: eventosClassificados,
    opening_balance_snapshots: saldos,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const elapsedMs = Date.now() - t0;

  /* ─────────── Metadata ─────────── */

  const datasSaldos = saldos
    .map((s) => s.data_referencia.toISOString().slice(0, 10))
    .sort();
  const contas = [...new Set(saldos.map((s) => s.conta_bancaria_id))].sort();

  /* ─── Distribuição de classificação (Decisão B) ─── */
  const byConfLevel: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const byStatus: Record<string, number> = {
    classified: 0,
    translated: 0,
    needs_confirmation: 0,
    pending: 0,
    ignored: 0,
  };
  let bucketResolved = 0;
  let bucketNull = 0;
  for (const e of eventosClassificados) {
    byConfLevel[e.classification.confidenceLevel] =
      (byConfLevel[e.classification.confidenceLevel] ?? 0) + 1;
    byStatus[e.classification.status] =
      (byStatus[e.classification.status] ?? 0) + 1;
    if (e.classification.bucket !== null) bucketResolved++;
    else bucketNull++;
  }

  console.log('\n=== fixture gerada ===');
  console.log(`output:               ${OUTPUT_PATH}`);
  console.log(`eventos_caixa:        ${eventos.length}`);
  console.log(`  AP:                 ${apEventos.length}`);
  console.log(`  AR:                 ${arEventos.length}`);
  console.log(`  CEF:                ${cefEventos.length}`);
  console.log(`opening_balances:     ${saldos.length}`);
  console.log(`  data range:         ${datasSaldos[0]} → ${datasSaldos[datasSaldos.length - 1]}`);
  console.log(`  contas distintas:   ${contas.length} (${contas.join(', ')})`);
  console.log('\n=== classificação ===');
  console.log(`hints aplicados:      ${exactCount} exact + ${prefixCount} prefix`);
  console.log(`confidenceLevel:      high=${byConfLevel['high']} medium=${byConfLevel['medium']} low=${byConfLevel['low']}`);
  console.log(
    `status:               classified=${byStatus['classified']} translated=${byStatus['translated']} needs_confirmation=${byStatus['needs_confirmation']} pending=${byStatus['pending']} ignored=${byStatus['ignored']}`,
  );
  console.log(`bucket resolvido:     ${bucketResolved} (${((bucketResolved / eventos.length) * 100).toFixed(1)}%)`);
  console.log(`bucket null:          ${bucketNull} (${((bucketNull / eventos.length) * 100).toFixed(1)}%)`);
  console.log(`\nelapsed:              ${elapsedMs}ms`);
}

/* ─────────── Validações (preempt das regras do Fix 2/Fix 3) ─────────── */

function validateNoEmptyContaBancariaId(
  saldos: readonly OpeningBalanceSnapshot[],
): void {
  const offenders = saldos.filter(
    (s) => s.conta_bancaria_id === undefined || s.conta_bancaria_id === '',
  );
  if (offenders.length > 0) {
    throw new Error(
      `regen-gregorutt-fixture: ${offenders.length} saldo(s) com conta_bancaria_id vazia ` +
        `(violação da invariante do Fix 2). ids: ${offenders.map((s) => s.id).join(', ')}`,
    );
  }
}

function validateNoDuplicateKeys(
  saldos: readonly OpeningBalanceSnapshot[],
): void {
  const seen = new Map<string, OpeningBalanceSnapshot>();
  for (const s of saldos) {
    const dateKey = s.data_referencia.toISOString().slice(0, 10);
    const key = `${s.cliente_id}|${s.legal_entity_id}|${dateKey}|${s.conta_bancaria_id}`;
    const prev = seen.get(key);
    if (prev !== undefined) {
      throw new Error(
        `regen-gregorutt-fixture: snapshots duplicados com mesma chave ` +
          `(cliente=${s.cliente_id}, le=${s.legal_entity_id}, ` +
          `data=${dateKey}, conta=${s.conta_bancaria_id}); ` +
          `ids conflitantes: '${prev.id}' e '${s.id}' ` +
          `(violação da invariante do Fix 3).`,
      );
    }
    seen.set(key, s);
  }
}

main().catch((err: unknown) => {
  console.error('[regen] FALHOU:', err);
  process.exit(1);
});
