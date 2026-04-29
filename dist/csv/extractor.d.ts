/**
 * Extrator CSV genérico — sem regra de negócio. Recebe o conteúdo
 * inteiro de um arquivo CSV e um delimitador de 1 caractere, devolve
 * uma matriz onde cada item é o array de campos da linha correspondente
 * (mesma indexação 0-based do split de linhas; cada `i` corresponde à
 * linha `i+1` do arquivo original).
 *
 * Linhas em branco ficam preservadas como `[""]` — quem chama decide
 * o que fazer com elas. Quebras de linha CRLF e LF são ambas suportadas.
 *
 * Por que existir como camada separada: a parte "como recortar campos"
 * é estável (parseCSVLine, char-by-char, respeita aspas), mas a parte
 * "o que cada coluna significa" muda por origem (FKN AP, FKN AR, etc).
 * Manter as duas separadas evita duplicação e permite reusar o
 * recorte quando aparecer um novo formato.
 */
export declare function extractCSV(content: string, delimiter: string): string[][];
//# sourceMappingURL=extractor.d.ts.map