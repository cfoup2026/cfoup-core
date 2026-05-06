import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Helpers de descoberta de arquivos CEF em um diretório de fixtures.
 *
 * Usado pelo regen (`scripts/regen-gregorutt-fixture.mts`) e pelo smoke
 * Stage 1 (`tests/integration/smoke-cf13-stage1.test.ts`). Convenção
 * de nomeação esperada: `cef_<mes><ano>[.com_saldo].{txt|pdf}` em
 * lowercase + underscore (ex: `cef_apr25.txt`, `cef_mar26_com_saldo.pdf`).
 *
 * Tolera o formato antigo com espaços e Title-case (ex: `CEF Apr25.txt`)
 * que ainda existe em `tests/fixtures/gregorutt/Bcos/` (gitignored,
 * fonte full local-only). O filtro é case-insensitive sobre a extensão
 * e o prefixo `cef`.
 *
 * Exclusões explícitas:
 *   - `cef_synthetic.*` — fixture sintética só pra unit tests, não
 *     deve entrar em pipelines que consomem dados Gregorutt reais.
 */

/** Mapa abreviação-de-mês (PT + EN) → número 1..12. */
const MONTH_MAP: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  fev: 2,
  mar: 3,
  apr: 4,
  abr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  out: 10,
  nov: 11,
  dec: 12,
  dez: 12,
};

/**
 * Tenta extrair `<mes><ano>` do nome do arquivo. Retorna chave numérica
 * `yyyymm` quando possível. Se o nome não bater no padrão, retorna
 * `Number.MAX_SAFE_INTEGER` (vai pro fim da ordenação) — fallback estável.
 */
function chronoKey(name: string): number {
  // Casos suportados:
  //  - "cef_apr25.txt"            → apr + 25
  //  - "cef_mar26_com_saldo.pdf"  → mar + 26
  //  - "CEF Apr25.txt" (legacy)   → apr + 25
  //  - "CEF Mar26 com Saldo.pdf"  → mar + 26
  const m = /cef[ _]([a-z]{3})\s*(\d{2})/i.exec(name);
  if (m === null) return Number.MAX_SAFE_INTEGER;
  const month = MONTH_MAP[m[1]!.toLowerCase()];
  if (month === undefined) return Number.MAX_SAFE_INTEGER;
  const yy = Number.parseInt(m[2]!, 10);
  // Janela observada nos dados Gregorutt: 2023-2030. yy<50 → 20yy.
  const fullYear = yy < 50 ? 2000 + yy : 1900 + yy;
  return fullYear * 100 + month;
}

function listByExtension(dir: string, ext: string): string[] {
  const lowerExt = ext.toLowerCase();
  const entries = readdirSync(dir)
    .filter((f) => {
      const lower = f.toLowerCase();
      if (!lower.startsWith('cef')) return false;
      if (!lower.endsWith(lowerExt)) return false;
      // Sintético é fixture de unit test — não entra em pipelines reais.
      if (lower.startsWith('cef_synthetic')) return false;
      return true;
    })
    .map((f) => ({ name: f, key: chronoKey(f) }))
    .sort((a, b) => {
      // Ordenação cronológica primária; tiebreaker por nome lex pra
      // determinismo total (ex: TXT vs PDF do mesmo mês, etc).
      if (a.key !== b.key) return a.key - b.key;
      return a.name.localeCompare(b.name);
    })
    .map((e) => resolve(dir, e.name));

  return entries;
}

/** Lista TXTs CEF em ordem cronológica (mes/ano extraído do nome). */
export function listCefFiles(dir: string): string[] {
  return listByExtension(dir, '.txt');
}

/** Lista PDFs CEF (geralmente "com Saldo") em ordem cronológica. */
export function listCefPdfFiles(dir: string): string[] {
  return listByExtension(dir, '.pdf');
}
