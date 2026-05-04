/**
 * Critério de materialidade da pendência crítica (§9.3 ajustado).
 *
 * Um valor é material quando satisfaz pelo menos uma das condições:
 *  1. **Relativo:** `|valor| >= 10% × saidas_semana(N)` no escopo
 *     correspondente.
 *  2. **Absoluto:** `|valor| >= R$ 5.000` (default v0).
 *
 * Quando ambas casam, o trigger `'pct_10_saidas_semana'` vence (mais
 * informativo — indica que o evento é grande no contexto da semana).
 *
 * `saidasSemana === 0` → relativo é 0 e o critério cai no absoluto.
 */
import {
  LIMITE_MATERIALIDADE_ABS_BRL,
  PCT_MATERIALIDADE_SAIDAS_SEMANA,
  type TriggerMaterialidade,
} from './types.js';

export interface MaterialidadeAvaliacao {
  is_material: boolean;
  /** Trigger que disparou. Indefinido quando `is_material === false`. */
  trigger?: TriggerMaterialidade;
}

/**
 * Avalia se um valor absoluto é material para a semana.
 *
 * @param valor `|valor|` do evento (passar já em valor absoluto).
 * @param saidasSemana Soma de `|valor|` de eventos `saida` &
 *   `is_transferencia=false` da semana, no escopo correspondente.
 * @param limiteAbs Limite absoluto em BRL. Default `LIMITE_MATERIALIDADE_ABS_BRL`.
 */
export function ehMaterial(
  valor: number,
  saidasSemana: number,
  limiteAbs: number = LIMITE_MATERIALIDADE_ABS_BRL,
): MaterialidadeAvaliacao {
  const limiteRelativo = saidasSemana * PCT_MATERIALIDADE_SAIDAS_SEMANA;
  const passaRelativo = saidasSemana > 0 && valor >= limiteRelativo;
  const passaAbsoluto = valor >= limiteAbs;

  if (passaRelativo) {
    return { is_material: true, trigger: 'pct_10_saidas_semana' };
  }
  if (passaAbsoluto) {
    return { is_material: true, trigger: 'limite_absoluto' };
  }
  return { is_material: false };
}
