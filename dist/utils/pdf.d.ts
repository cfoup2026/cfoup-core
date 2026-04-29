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
export declare function extractTextLines(input: Uint8Array | ArrayBuffer | Buffer): Promise<ExtractedLine[]>;
//# sourceMappingURL=pdf.d.ts.map