/**
 * Mapeamento das fontes internas de pendência → enum macro do contrato.
 *
 * **Mapeamento de origem (Item 3 §5 + ajustes pós-revisão):**
 *  - `MotivoInsuficiencia` (Stage 5) → `'cobertura'` + severidade `'critica'`.
 *  - `Pendencia` (Stage 5) — origem depende do `cobertura.status` global:
 *      • `cobertura_insuficiente`            → `'cobertura'`
 *      • `cobertura_com_confianca_reduzida`  → `'confianca'`
 *      • `cobertura_completa`                → `'confianca'` (defensivo)
 *    Severidade por tipo (constante):
 *      • `semana_zerada`                    → `'media'`
 *      • `recorrencia_ausente`              → `'media'`
 *      • `pendentes_classificacao_agregados`→ `'baixa'`
 *  - `PendenciaCritica` (Stage 6) → `'confianca'` + `'critica'`.
 *  - `ErroDeMarcacao` (Stage 7) → `'confianca'` + `'media'`.
 *      `'veredito'` no contrato fica reservado para pendências
 *      derivadas das categorias ALERTA/CRITICO do próprio Stage 7
 *      (fora do escopo v0).
 *  - `'manual'` reservado para lançamento manual via UI (sem caminho
 *    ativo em v0).
 *
 * A escolha entre `'cobertura'` e `'confianca'` para `Pendencia` é
 * tomada no adapter (`adaptarPendencias.ts`) com base em
 * `cobertura.status` — não há helper aqui porque depende de estado
 * global, não só do tipo individual da pendência.
 *
 * Fonte de detecção emitida em `PendenciaConfianca.contexto.fonteDeteccao`:
 *  - `'recorrencia_historica'` → `recorrencia_ausente`.
 *  - `'ausencia_total'`        → `semana_zerada`.
 *  - `'padrao_contraparte'`    → `pendentes_classificacao_agregados`.
 *
 * Helpers puros — sem efeitos colaterais.
 */
import type {
  TipoMotivoInsuficiencia,
  TipoPendencia,
} from '../../../types/cobertura.js';
import type {
  PendenciaConfianca,
  SeveridadePendencia,
} from '../types.js';

/** Severidade da pendência de cobertura por tipo interno. */
export function severidadePorTipoCobertura(
  tipo: TipoPendencia,
): SeveridadePendencia {
  switch (tipo) {
    case 'semana_zerada':
      return 'media';
    case 'recorrencia_ausente':
      return 'media';
    case 'pendentes_classificacao_agregados':
      return 'baixa';
  }
}

/** Motivos de insuficiência sempre vêm como `'cobertura'`/`'critica'`. */
export function severidadeMotivoInsuficiencia(
  _tipo: TipoMotivoInsuficiencia,
): SeveridadePendencia {
  return 'critica';
}

/** Mapeia `TipoMotivoInsuficiencia` interno → tipo do contrato.
 *  Renomeia `banco_sem_dado_recente` → `banco_ativo_sem_dado_recente`
 *  para casar com o literal do spec. */
export function mapearTipoInsuficiencia(
  interno: TipoMotivoInsuficiencia,
): 'saldo_abertura_ausente' | 'banco_ativo_sem_dado_recente' {
  switch (interno) {
    case 'saldo_abertura_ausente':
      return 'saldo_abertura_ausente';
    case 'banco_sem_dado_recente':
      return 'banco_ativo_sem_dado_recente';
  }
}

/** Fonte de detecção emitida no `contexto` de uma `PendenciaConfianca`. */
export function fonteDeteccao(
  tipo: TipoPendencia,
): NonNullable<PendenciaConfianca['contexto']>['fonteDeteccao'] {
  switch (tipo) {
    case 'semana_zerada':
      return 'ausencia_total';
    case 'recorrencia_ausente':
      return 'recorrencia_historica';
    case 'pendentes_classificacao_agregados':
      return 'padrao_contraparte';
  }
}
