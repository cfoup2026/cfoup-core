/**
 * Roda o motor de classificação contra dados reais do Gregorutt
 * (3 CSVs FKN parseados pelos parsers existentes do repo) e imprime
 * um relatório de cobertura. Não persiste nada.
 *
 * Uso: `pnpm tsx scripts/classify-gregorutt.ts`
 *
 * Princípios:
 *  - Os 3 fixtures vêm de `tests/fixtures/`, exatamente os caminhos que os
 *    testes integrados de `parseFKNAp`, `parseFKNAr` e `parseFKNVendas` usam
 *    (`tests/parsers/fkn-{ap,ar,vendas}.test.ts`). Nada inventado.
 *  - Os adaptadores `adapt{Payable,Receivable,Sale}ToSourceTransaction` são
 *    estritamente mecânicos: só copiam campos que existem no tipo-fonte.
 *    Nenhum campo é fabricado, sintetizado ou inferido.
 *  - Contagens são medidas. Há um aviso (não erro) quando contagem real
 *    diverge das contagens-referência informadas pelo dono do projeto.
 *  - Se algum fixture estiver ausente, o script reporta path/parser/fonte
 *    e sai com código 1.
 *
 * Critério de aceite: ≥ 80% das transações com `status='classified'`.
 * Abaixo disso, lista os 5 motivos principais que estão puxando pra baixo.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractCSV } from '../src/csv/extractor.js';
import {
  parseFKNAp,
  parseFKNAr,
  parseFKNVendas,
} from '../src/parsers/index.js';
import type {
  ParseFKNApResult,
  ParseFKNArResult,
  ParseFKNVendasResult,
} from '../src/parsers/index.js';
import type { Payable, Receivable, Sale } from '../src/types/index.js';
import {
  BUCKETS,
  BUCKETS_ORDERED,
  classifyTransaction,
  groupClassificationExceptions,
} from '../src/classification/index.js';
import type {
  Bucket,
  ClassificationResult,
  ClassificationStatus,
  ExceptionReason,
  GroupedException,
  PaymentChannel,
  SourceTransaction,
} from '../src/classification/index.js';

const COMPANY_ID = 'gregorutt';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../tests/fixtures');
const FILE_AP = resolve(FIXTURES_DIR, 'gregorutt_cp_2023_ate_20abr2026.csv');
const FILE_AR = resolve(FIXTURES_DIR, 'gregorutt_cr_2023_ate_20abr2026.csv');
const FILE_SALES = resolve(
  FIXTURES_DIR,
  'gregorutt_vendas_2023_ate_20abr2026.csv',
);

/** Contagens-referência informadas pelo dono. Usadas só como aviso (warning). */
const EXPECTED_COUNTS = {
  payables: 6880,
  receivables: 11611,
  sales: 9903,
} as const;

/* ─────────── Carga e parse ─────────── */

function readCsvAsRows(path: string): string[][] {
  const buf = readFileSync(path);
  const decoder = new TextDecoder('windows-1252');
  return extractCSV(decoder.decode(buf), ';');
}

interface MissingSource {
  source: string;
  path: string;
  parser: string;
}

function checkFixturesOrExit(): void {
  const missing: MissingSource[] = [];
  if (!existsSync(FILE_AP))
    missing.push({
      source: 'Payables (FKN AP)',
      path: FILE_AP,
      parser: 'src/parsers/fkn-ap.ts (parseFKNAp)',
    });
  if (!existsSync(FILE_AR))
    missing.push({
      source: 'Receivables (FKN AR)',
      path: FILE_AR,
      parser: 'src/parsers/fkn-ar.ts (parseFKNAr)',
    });
  if (!existsSync(FILE_SALES))
    missing.push({
      source: 'Sales (FKN Vendas)',
      path: FILE_SALES,
      parser: 'src/parsers/fkn-vendas.ts (parseFKNVendas)',
    });
  if (missing.length === 0) return;

  console.error('Fontes ausentes — script aborta sem rodar parcial:');
  for (const m of missing) {
    console.error(`  - fonte:  ${m.source}`);
    console.error(`    path:   ${m.path}`);
    console.error(`    parser: ${m.parser}`);
  }
  process.exit(1);
}

/** Devolve os ParseResult inteiros (não só `.ok`) pra que o relatório
 *  consiga reportar contagens explícitas de erro por fonte. */
function loadAll(): {
  ap: ParseFKNApResult;
  ar: ParseFKNArResult;
  sales: ParseFKNVendasResult;
} {
  return {
    ap: parseFKNAp(readCsvAsRows(FILE_AP)),
    ar: parseFKNAr(readCsvAsRows(FILE_AR)),
    sales: parseFKNVendas(readCsvAsRows(FILE_SALES)),
  };
}

function warnIfCountDiverges(label: string, found: number, expected: number): void {
  if (found === expected) return;
  const delta = found - expected;
  const sign = delta > 0 ? '+' : '';
  console.warn(
    `  aviso: esperado ~${expected} ${label}, encontrado ${found}. Δ = ${sign}${delta}`,
  );
}

/* ─────────── Adapters mecânicos: campo-real → SourceTransaction ─────────── */

const PAYMENT_CHANNEL_MAP: Record<string, PaymentChannel> = {
  BOLETO: 'boleto',
  PIX: 'pix',
  CHEQUE: 'check',
  'DEP. C/C': 'deposit',
  DEPOSITO: 'deposit',
  DEPÓSITO: 'deposit',
  DINHEIRO: 'cash',
  CARTEIRA: 'unknown',
  TED: 'ted',
  DOC: 'doc',
  CARTAO: 'card',
  CARTÃO: 'card',
};

function mapPaymentChannel(raw: string): PaymentChannel | undefined {
  const key = raw.trim().toUpperCase();
  return PAYMENT_CHANNEL_MAP[key];
}

/**
 * Adapter mecânico: só copia campos que existem em `Payable`. Nenhum
 * campo de `SourceTransaction` é sintetizado; o que `Payable` não traz
 * fica omitido (ex: description, originalCategory, originalAccountName).
 */
export function adaptPayableToSourceTransaction(
  p: Payable,
): SourceTransaction {
  const tx: SourceTransaction = {
    id: `ap_${p.id}`,
    companyId: COMPANY_ID,
    sourceSystem: 'accounts_payable',
    // transactionDate: usa paidAt quando o título já liquidou (data do evento
    // financeiro), senão issuedAt. Ambos vêm do parser.
    transactionDate: p.paidAt ?? p.issuedAt,
    direction: 'outflow',
    amount: p.amount,
    currency: 'BRL',
  };
  tx.dueDate = p.dueDate;
  if (p.paidAt !== null) tx.paidDate = p.paidAt;
  if (p.vendorName !== '') tx.counterpartyName = p.vendorName;
  if (p.docNumber !== '') tx.documentNumber = p.docNumber;
  const ch = mapPaymentChannel(p.paymentMethod);
  if (ch !== undefined) tx.paymentChannel = ch;
  return tx;
}

/**
 * Adapter mecânico para `Receivable`. Mesmo princípio: só copia campos
 * que existem no tipo-fonte.
 */
export function adaptReceivableToSourceTransaction(
  r: Receivable,
): SourceTransaction {
  const tx: SourceTransaction = {
    id: `ar_${r.id}`,
    companyId: COMPANY_ID,
    sourceSystem: 'accounts_receivable',
    transactionDate: r.paidAt ?? r.issuedAt,
    direction: 'inflow',
    amount: r.amount,
    currency: 'BRL',
  };
  tx.dueDate = r.dueDate;
  if (r.paidAt !== null) tx.paidDate = r.paidAt;
  if (r.customerName !== '') tx.counterpartyName = r.customerName;
  if (r.docNumber !== '') tx.documentNumber = r.docNumber;
  const ch = mapPaymentChannel(r.paymentMethod);
  if (ch !== undefined) tx.paymentChannel = ch;
  return tx;
}

/**
 * Adapter mecânico para `Sale`. `sourceSystem='sales'` reflete a fonte
 * real. Devoluções (`movementType='return'`) viram `direction='outflow'`;
 * vendas regulares, `direction='inflow'`. Nada além é sintetizado.
 */
export function adaptSaleToSourceTransaction(s: Sale): SourceTransaction {
  const tx: SourceTransaction = {
    id: `sale_${s.id}`,
    companyId: COMPANY_ID,
    sourceSystem: 'sales',
    transactionDate: s.issuedAt,
    direction: s.movementType === 'return' ? 'outflow' : 'inflow',
    amount: s.amount,
    currency: 'BRL',
  };
  if (s.customerName !== '') tx.counterpartyName = s.customerName;
  if (s.invoiceNumber !== '') tx.documentNumber = s.invoiceNumber;
  return tx;
}

/* ─────────── Coleta de estatísticas ─────────── */

interface Stats {
  total: number;
  byStatus: Record<ClassificationStatus, number>;
  byBucket: Map<Bucket | 'sem_bucket', { count: number; amount: number }>;
  byExceptionReason: Map<ExceptionReason, number>;
}

function emptyStats(): Stats {
  return {
    total: 0,
    byStatus: {
      classified: 0,
      translated: 0,
      needs_confirmation: 0,
      pending: 0,
      ignored: 0,
    },
    byBucket: new Map(),
    byExceptionReason: new Map(),
  };
}

function accumulate(
  stats: Stats,
  result: ClassificationResult,
  amount: number,
): void {
  stats.total += 1;
  stats.byStatus[result.status] += 1;

  const key: Bucket | 'sem_bucket' = result.bucket ?? 'sem_bucket';
  const slot = stats.byBucket.get(key) ?? { count: 0, amount: 0 };
  slot.count += 1;
  slot.amount += amount;
  stats.byBucket.set(key, slot);

  stats.byExceptionReason.set(
    result.exceptionReason,
    (stats.byExceptionReason.get(result.exceptionReason) ?? 0) + 1,
  );
}

/* ─────────── Formatação ─────────── */

const fmtPct = (n: number, total: number): string =>
  total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;

const fmtBRL = (n: number): string =>
  n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  });

const fmtInt = (n: number): string => n.toLocaleString('pt-BR');

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function rule(width = 78): string {
  return '─'.repeat(width);
}

function header(title: string): void {
  console.log('');
  console.log(rule());
  console.log(`  ${title}`);
  console.log(rule());
}

/* ─────────── Relatório ─────────── */

function printReport(
  stats: Stats,
  bySegment: ReadonlyArray<{ name: string; stats: Stats }>,
  topGroups: GroupedException[],
): void {
  header('Resumo geral');
  console.log(`  Total de transações:           ${fmtInt(stats.total)}`);
  for (const status of [
    'classified',
    'translated',
    'needs_confirmation',
    'pending',
    'ignored',
  ] as const) {
    const n = stats.byStatus[status];
    console.log(
      `  ${pad(status, 30)} ${padLeft(fmtInt(n), 8)}   ${padLeft(
        fmtPct(n, stats.total),
        7,
      )}`,
    );
  }

  header('Por sistema-fonte');
  console.log(
    `  ${pad('segmento', 14)} ${padLeft('total', 8)}  ${padLeft(
      'classified',
      11,
    )}  ${padLeft('needs_conf', 11)}  ${padLeft('pending', 9)}  ${padLeft(
      '%auto',
      7,
    )}`,
  );
  for (const seg of bySegment) {
    const s = seg.stats;
    const auto = s.byStatus.classified;
    console.log(
      `  ${pad(seg.name, 14)} ${padLeft(fmtInt(s.total), 8)}  ${padLeft(
        fmtInt(s.byStatus.classified),
        11,
      )}  ${padLeft(fmtInt(s.byStatus.needs_confirmation), 11)}  ${padLeft(
        fmtInt(s.byStatus.pending),
        9,
      )}  ${padLeft(fmtPct(auto, s.total), 7)}`,
    );
  }

  header('Distribuição por bucket (12 buckets + sem_bucket)');
  console.log(
    `  ${pad('bucket', 24)} ${padLeft('count', 10)}  ${padLeft('%', 7)}  ${padLeft(
      'total',
      18,
    )}`,
  );
  const bucketKeys: ReadonlyArray<Bucket | 'sem_bucket'> = [
    ...BUCKETS_ORDERED,
    'sem_bucket' as const,
  ];
  for (const key of bucketKeys) {
    const slot = stats.byBucket.get(key) ?? { count: 0, amount: 0 };
    const label =
      key === 'sem_bucket' ? '(pendência sem bucket)' : BUCKETS[key].label;
    console.log(
      `  ${pad(label, 24)} ${padLeft(fmtInt(slot.count), 10)}  ${padLeft(
        fmtPct(slot.count, stats.total),
        7,
      )}  ${padLeft(fmtBRL(slot.amount), 18)}`,
    );
  }

  header('Distribuição por ExceptionReason');
  const reasonsSorted = [...stats.byExceptionReason.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  console.log(
    `  ${pad('reason', 36)} ${padLeft('count', 10)}  ${padLeft('%', 7)}`,
  );
  for (const [reason, count] of reasonsSorted) {
    console.log(
      `  ${pad(reason, 36)} ${padLeft(fmtInt(count), 10)}  ${padLeft(
        fmtPct(count, stats.total),
        7,
      )}`,
    );
  }

  header('Top 10 grupos de pendência (por valor total)');
  if (topGroups.length === 0) {
    console.log('  Nenhuma pendência agrupada — coverage total.');
  } else {
    console.log(
      `  ${pad('reason', 30)}  ${padLeft('count', 7)}  ${padLeft(
        'total',
        15,
      )}  label`,
    );
    for (const g of topGroups) {
      const label =
        g.groupLabel.length > 60
          ? `${g.groupLabel.slice(0, 57)}...`
          : g.groupLabel;
      console.log(
        `  ${pad(g.exceptionReason, 30)}  ${padLeft(
          fmtInt(g.count),
          7,
        )}  ${padLeft(fmtBRL(g.totalAmount), 15)}  ${label}`,
      );
    }
  }
}

/**
 * Simulação aritmética da tela "Pendências de Setup". Não cria regra,
 * não re-classifica, não chama `createRuleFromOwnerConfirmation`, não
 * muta `ClassificationResult`. Apenas projeta o impacto hipotético se o
 * dono confirmasse os top N grupos pendentes:
 *
 *   movimento simulado = count(transações com status='pending' nos grupos)
 *
 * Mostra 4 cenários × 2 critérios de ordenação (count, totalAmount).
 */
function printPendingSetupSimulation(
  stats: Stats,
  allGroups: readonly GroupedException[],
  results: readonly ClassificationResult[],
): void {
  header('Simulação de Pendências de Setup (aritmética, não muta nada)');

  console.log(
    '  Projeção pura sobre os grupos já gerados por groupClassificationExceptions.',
  );
  console.log(
    '  Não cria regra, não re-classifica, não persiste. Apenas calcula o',
  );
  console.log('  delta hipotético se o dono confirmasse top N grupos.');
  console.log('');

  const total = stats.total;
  const currentClassified = stats.byStatus.classified;
  const currentPct = (currentClassified / total) * 100;

  // Mapa id→result para contar quantas transações de cada grupo estão
  // efetivamente em status='pending' (e portanto se moveriam pra classified).
  const resultByTxId = new Map<string, ClassificationResult>();
  for (const r of results) resultByTxId.set(r.sourceTransactionId, r);

  type Annotated = { group: GroupedException; pendingCount: number };
  const annotated: Annotated[] = allGroups.map((group) => {
    let pendingCount = 0;
    for (const txId of group.transactionIds) {
      const r = resultByTxId.get(txId);
      if (r !== undefined && r.status === 'pending') pendingCount += 1;
    }
    return { group, pendingCount };
  });

  console.log(
    `  ${pad('Cenário', 8)}  ${pad('Ordem', 12)}  ${padLeft('Grupos', 7)}  ${padLeft('Tx mov.', 9)}  ${padLeft('Atual', 8)}  ${padLeft('Sim.', 8)}  ${padLeft('% novo', 8)}  ${padLeft('Δ pp', 7)}  Passa 80%?`,
  );
  console.log(`  ${'─'.repeat(95)}`);

  const scenarios: ReadonlyArray<number> = [5, 10, 20, 30];
  const criteria: ReadonlyArray<'count' | 'totalAmount'> = [
    'count',
    'totalAmount',
  ];

  for (const topN of scenarios) {
    for (const criterion of criteria) {
      const sorted = [...annotated].sort((a, b) => {
        if (criterion === 'count') return b.group.count - a.group.count;
        return b.group.totalAmount - a.group.totalAmount;
      });
      const selected = sorted.slice(0, topN);
      const moved = selected.reduce((sum, a) => sum + a.pendingCount, 0);
      const newClassified = currentClassified + moved;
      const newPct = (newClassified / total) * 100;
      const deltaPp = newPct - currentPct;
      const passes = newPct >= 80;

      console.log(
        `  ${pad(`Top ${topN}`, 8)}  ${pad(criterion, 12)}  ${padLeft(
          fmtInt(selected.length),
          7,
        )}  ${padLeft(fmtInt(moved), 9)}  ${padLeft(
          fmtInt(currentClassified),
          8,
        )}  ${padLeft(fmtInt(newClassified), 8)}  ${padLeft(
          `${newPct.toFixed(1)}%`,
          8,
        )}  ${padLeft(`${deltaPp >= 0 ? '+' : ''}${deltaPp.toFixed(1)}`, 7)}  ${passes ? 'sim' : 'não'}`,
      );
    }
  }
  console.log('');
  console.log(
    `  Total de grupos pendentes disponíveis: ${fmtInt(allGroups.length)}`,
  );
}

/**
 * Diagnóstico sempre presente: para cada um dos 5 motivos mais frequentes
 * de não-classificação, mostra breakdown por sourceSystem, originalCategory,
 * counterpartyName (top 3) e contagem de bucket ausente.
 */
function printTopReasonsDiagnostic(
  stats: Stats,
  results: readonly ClassificationResult[],
  transactions: readonly SourceTransaction[],
): void {
  header('Top 5 motivos de transações não classificadas (breakdown)');

  const reasonsSorted = [...stats.byExceptionReason.entries()]
    .filter(([reason]) => reason !== 'none')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (reasonsSorted.length === 0) {
    console.log('  Nenhum motivo de exceção registrado — cobertura total.');
    return;
  }

  for (let i = 0; i < reasonsSorted.length; i++) {
    const entry = reasonsSorted[i];
    if (entry === undefined) continue;
    const [reason, total] = entry;

    // Breakdown
    const bySs = new Map<string, number>();
    const byCp = new Map<string, number>();
    const byOc = new Map<string, number>();
    let bucketNull = 0;

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const tx = transactions[j];
      if (r === undefined || tx === undefined) continue;
      if (r.exceptionReason !== reason) continue;
      bySs.set(tx.sourceSystem, (bySs.get(tx.sourceSystem) ?? 0) + 1);
      if (tx.counterpartyName !== undefined) {
        byCp.set(
          tx.counterpartyName,
          (byCp.get(tx.counterpartyName) ?? 0) + 1,
        );
      }
      if (tx.originalCategory !== undefined) {
        byOc.set(tx.originalCategory, (byOc.get(tx.originalCategory) ?? 0) + 1);
      }
      if (r.bucket === null) bucketNull += 1;
    }

    console.log(
      `  ${i + 1}. ${reason} — ${fmtInt(total)} transações (${fmtPct(total, stats.total)})`,
    );

    const ssLine = [...bySs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${fmtInt(v)}`)
      .join(', ');
    console.log(`       sourceSystem:       ${ssLine || '(nenhum)'}`);

    console.log(
      `       bucket ausente:     ${fmtInt(bucketNull)}/${fmtInt(total)}`,
    );

    const topCp = [...byCp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topCp.length > 0) {
      console.log(
        `       top counterparty:   ${topCp
          .map(([k, v]) => `${k} (${fmtInt(v)})`)
          .join(' · ')}`,
      );
    } else {
      console.log('       top counterparty:   (não disponível na fonte)');
    }

    const topOc = [...byOc.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topOc.length > 0) {
      console.log(
        `       top originalCat.:   ${topOc
          .map(([k, v]) => `${k} (${fmtInt(v)})`)
          .join(' · ')}`,
      );
    } else {
      console.log('       top originalCat.:   (não disponível na fonte)');
    }
  }
}

/* ─────────── Main ─────────── */

function main(): void {
  const t0 = Date.now();
  checkFixturesOrExit();

  console.log('Carregando fixtures Gregorutt…');
  const { ap: apResult, ar: arResult, sales: salesResult } = loadAll();
  const ap = apResult.ok;
  const ar = arResult.ok;
  const sales = salesResult.ok;

  header('Carga e parse');
  console.log(
    `  Payables    (parseFKNAp):     ${fmtInt(ap.length)} linhas OK`,
  );
  console.log(
    `  Receivables (parseFKNAr):     ${fmtInt(ar.length)} linhas OK`,
  );
  console.log(
    `  Sales       (parseFKNVendas): ${fmtInt(sales.length)} linhas OK`,
  );
  console.log('');
  console.log('  Erros de parsing por fonte:');
  console.log(`    Payables:    ${fmtInt(apResult.errors.length)} linhas com erro`);
  console.log(`    Receivables: ${fmtInt(arResult.errors.length)} linhas com erro`);
  console.log(`    Sales:       ${fmtInt(salesResult.errors.length)} linhas com erro`);

  warnIfCountDiverges('payables', ap.length, EXPECTED_COUNTS.payables);
  warnIfCountDiverges('receivables', ar.length, EXPECTED_COUNTS.receivables);
  warnIfCountDiverges('sales', sales.length, EXPECTED_COUNTS.sales);

  const apSources = ap.map(adaptPayableToSourceTransaction);
  const arSources = ar.map(adaptReceivableToSourceTransaction);
  const salesSources = sales.map(adaptSaleToSourceTransaction);
  const all: SourceTransaction[] = [
    ...apSources,
    ...arSources,
    ...salesSources,
  ];

  console.log('');
  console.log(`Classificando ${fmtInt(all.length)} transações…`);
  const results: ClassificationResult[] = all.map((tx) =>
    classifyTransaction(tx),
  );

  const stats = emptyStats();
  const apStats = emptyStats();
  const arStats = emptyStats();
  const salesStats = emptyStats();
  for (let i = 0; i < all.length; i++) {
    const tx = all[i]!;
    const r = results[i]!;
    accumulate(stats, r, tx.amount);
    if (i < apSources.length) accumulate(apStats, r, tx.amount);
    else if (i < apSources.length + arSources.length)
      accumulate(arStats, r, tx.amount);
    else accumulate(salesStats, r, tx.amount);
  }

  const allGroups = groupClassificationExceptions(results, all);
  const topGroups = [...allGroups]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10);

  printReport(
    stats,
    [
      { name: 'AP', stats: apStats },
      { name: 'AR', stats: arStats },
      { name: 'Sales', stats: salesStats },
    ],
    topGroups,
  );

  // Diagnóstico independe do resultado — sempre roda.
  printTopReasonsDiagnostic(stats, results, all);

  // Simulação da tela "Pendências de Setup" — aritmética pura, não muta nada.
  printPendingSetupSimulation(stats, allGroups, results);

  const autoPct = stats.byStatus.classified / Math.max(stats.total, 1);
  console.log('');
  console.log(rule());
  console.log(
    `  Cobertura auto-classificada: ${fmtPct(stats.byStatus.classified, stats.total)} (referência informativa: 80%)`,
  );
  console.log(
    autoPct >= 0.8
      ? '  Status: ACIMA da referência.'
      : '  Status: ABAIXO da referência. (diagnóstico, não aceite formal)',
  );
  console.log(rule());

  console.log('');
  console.log(`Tempo total: ${((Date.now() - t0) / 1000).toFixed(2)}s`);

  // Diagnóstico — exit 0 sempre.
  process.exit(0);
}

main();
