import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Linha extraída de um PDF nativo, agrupada por coordenada Y. */
export interface ExtractedLine {
  /** Página (1-indexada). */
  page: number;
  /** Índice global da linha no documento (1-indexado). */
  lineIndex: number;
  /** Texto concatenado dos items dessa linha, ordenados por X. */
  text: string;
  /**
   * Posição X do primeiro item textual (não-vazio) da linha. Útil pra
   * detectar nível de indent em layouts hierárquicos (ex: Balanço Kinlex).
   * Opcional pra compatibilidade com fixtures sintéticas que criam
   * ExtractedLine manualmente sem geometria.
   */
  xStart?: number;
}

/**
 * Extrai texto de um PDF nativo (com texto selecionável) usando pdfjs-dist.
 * Items com mesmo Y arredondado viram a mesma linha; items são ordenados
 * por X e concatenados separados por um espaço único. Linhas vazias após
 * trim são descartadas.
 *
 * Lança se o PDF estiver corrompido ou criptografado — chamadores em
 * cfoup-core devem tratar via try/catch e converter pra ParseError.
 */
export async function extractTextLines(
  input: Uint8Array | ArrayBuffer | Buffer,
): Promise<ExtractedLine[]> {
  const data = toUint8Array(input);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: false,
  });
  const pdf = await loadingTask.promise;
  try {
    const out: ExtractedLine[] = [];
    let lineIndex = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      try {
        const tc = await page.getTextContent();
        const rows = new Map<number, { x: number; str: string }[]>();
        for (const item of tc.items) {
          if (!('str' in item)) continue;
          const y = Math.round(item.transform[5]);
          const x = item.transform[4];
          const str = item.str;
          const arr = rows.get(y) ?? [];
          arr.push({ x, str });
          rows.set(y, arr);
        }
        const ys = [...rows.keys()].sort((a, b) => b - a);
        for (const y of ys) {
          const items = rows.get(y);
          if (items === undefined) continue;
          items.sort((a, b) => a.x - b.x);
          const text = items
            .map((c) => c.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text === '') continue;
          const firstNonEmpty = items.find((c) => c.str.trim() !== '');
          const xStart = firstNonEmpty?.x;
          lineIndex++;
          out.push(
            xStart === undefined
              ? { page: p, lineIndex, text }
              : { page: p, lineIndex, text, xStart },
          );
        }
      } finally {
        page.cleanup();
      }
    }
    return out;
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

function toUint8Array(input: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}
