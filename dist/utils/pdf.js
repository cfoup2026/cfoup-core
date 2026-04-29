import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
/**
 * Extrai texto de um PDF nativo (com texto selecionável) usando pdfjs-dist.
 * Items com mesmo Y arredondado viram a mesma linha; items são ordenados
 * por X e concatenados separados por um espaço único. Linhas vazias após
 * trim são descartadas.
 *
 * Lança se o PDF estiver corrompido ou criptografado — chamadores em
 * cfoup-core devem tratar via try/catch e converter pra ParseError.
 */
export async function extractTextLines(input) {
    const data = toUint8Array(input);
    const loadingTask = pdfjs.getDocument({
        data,
        useSystemFonts: false,
    });
    const pdf = await loadingTask.promise;
    try {
        const out = [];
        let lineIndex = 0;
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            try {
                const tc = await page.getTextContent();
                const rows = new Map();
                for (const item of tc.items) {
                    if (!('str' in item))
                        continue;
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
                    if (items === undefined)
                        continue;
                    items.sort((a, b) => a.x - b.x);
                    const text = items
                        .map((c) => c.str)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (text === '')
                        continue;
                    const firstNonEmpty = items.find((c) => c.str.trim() !== '');
                    const xStart = firstNonEmpty?.x;
                    lineIndex++;
                    out.push(xStart === undefined
                        ? { page: p, lineIndex, text }
                        : { page: p, lineIndex, text, xStart });
                }
            }
            finally {
                page.cleanup();
            }
        }
        return out;
    }
    finally {
        await pdf.cleanup();
        await pdf.destroy();
    }
}
function toUint8Array(input) {
    if (input instanceof ArrayBuffer)
        return new Uint8Array(input);
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}
//# sourceMappingURL=pdf.js.map