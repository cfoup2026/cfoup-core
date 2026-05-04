/**
 * Tipos do Estágio 7 — Motor de Veredito.
 *
 * Implementa §6 (gatilhos + templates + banner) e §8.1 (cobertura
 * insuficiente vence) do `CFOup_CF13_Spec_v0.md`. Stage 7 fecha o
 * pipeline — leitura final exibida ao dono.
 *
 * **Não muta inputs.** Saída é estrutura nova `VereditoResult`.
 *
 * Determinismo absoluto: mesmo input + mesmas constantes → mesmo
 * output **byte a byte**, incluindo texto formatado.
 */

/** Cinco vereditos exclusivos. Avaliados em ordem (§6.1) — primeiro
 *  que casa vence. Cobertura insuficiente vence todos (§8.1). */
export type Veredito =
  | 'CRITICO'
  | 'ALERTA'
  | 'ATENCAO'
  | 'LIMPO'
  | 'DADOS_INSUFICIENTES';

/**
 * Detalhes do veredito. Campos opcionais por tipo:
 *  - `CRITICO`: `semana_critica`, `data_critica`, `valor_falta`.
 *  - `ALERTA`: `semana_critica`, `data_critica`, `saldo_projetado`,
 *    `minimo_operacional`.
 *  - `ATENCAO`: `pendencias_relevantes` (count das pendências críticas
 *    do Stage 6 da unidade ou consolidado).
 *  - `LIMPO`/`DADOS_INSUFICIENTES`: vazio (`{}`).
 */
export interface VereditoDetalhes {
  /** 1..13. Presente em CRITICO e ALERTA. */
  semana_critica?: number;
  /** ISO 8601 da `inicio` da semana crítica. Drill-down — o template
   *  exibe DD/MM, mas a data ISO completa fica aqui. */
  data_critica?: string;
  /** `|caixa_final|` da semana crítica em CRITICO. */
  valor_falta?: number;
  /** `caixa_final` da semana crítica em ALERTA. */
  saldo_projetado?: number;
  /** `caixa_minimo_op` da semana crítica em ALERTA. */
  minimo_operacional?: number;
  /** Count das pendências críticas em ATENCAO. */
  pendencias_relevantes?: number;
}

/** Veredito de uma unidade (ou consolidado). */
export interface VereditoUnidade {
  /** Para unidade real: `legal_entity_id`. Para consolidado:
   *  `'consolidado:<cliente_id>'` (segue convenção do Stage 6). */
  legal_entity_id: string;
  veredito: Veredito;
  /** Texto renderizado por `renderTexto()` (§6.2). Determinístico,
   *  sem hedging, formatação BR fixa. */
  texto: string;
  detalhes: VereditoDetalhes;
}

/**
 * Banner agregado quando consolidado é `LIMPO`/`ATENCAO` mas há
 * unidade(s) em `CRITICO`/`ALERTA` (§6.3).
 *
 * `null` quando não se aplica. `DADOS_INSUFICIENTES` em consolidado
 * → banner sempre `null`. Unidades em `DADOS_INSUFICIENTES` não
 * contam como "em risco".
 */
export type BannerUnidadeCritica =
  | {
      ativo: boolean;
      unidades_em_risco: string[];
      texto: string;
    }
  | null;

/**
 * Sintoma de transferência interna mal marcada (§6.3 caso inverso):
 * consolidado pior que todas as unidades.
 *
 * Stage 7 **sinaliza, não corrige**. A correção fica para Stage 3.2
 * (detecção de transferência) numa rodada futura.
 */
export interface ErroDeMarcacao {
  tipo: 'consolidado_pior_que_unidades';
  /** Todas as unidades ativas avaliadas. */
  legal_entity_ids: string[];
  cliente_id: string;
}

/** Saída pública do Estágio 7. */
export interface VereditoResult {
  unidades: VereditoUnidade[];
  consolidado: VereditoUnidade;
  banner_unidade_critica: BannerUnidadeCritica;
  erros_de_marcacao: ErroDeMarcacao[];
}
