# CF13 — Stage 2: Motor de Histórico (2.1 + 2.2)

Como funciona, o que está dentro/fora de escopo, decisões registradas.

## TL;DR

Stage 2 produz `HistoricoOperacional`:

```ts
{
  contraparteHistory: Map<contraparte_id, ContraparteStats>;  // 2.1
  recorrencias: Recorrencia[];                                // 2.1
  volatilidades: Map<legal_entity_id, VolatilidadeStats>;     // 2.1
  geradoEm: Date;
  baseDe: { primeiroEvento, ultimoEvento, totalRealizados };
  eventosEstimados: EventoCaixa[];                            // 2.2
}
```

Pipeline: **Stage 1 EventoCaixa[] → MotorHistorico.run() → HistoricoOperacional**.

## Como rodar

```ts
import { BrazilCalendarPolicy, MotorHistorico } from 'cfoup-core';

const calendar = new BrazilCalendarPolicy();
const motor = new MotorHistorico({
  geradoEm: new Date(),
  janelaSemanas: 13,
  calendar,                                          // habilita 2.2
  // V0: classificação ainda não roda; pendente conta como crítica:
  criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente'],
});
const historico = motor.run(stage1Eventos);
```

Sem `calendar`, o motor opera só em modo 2.1 (estatístico) e
`eventosEstimados` é `[]`.

## 2.1 — Estatísticas

### `ContraparteStats` (delta vencimento → realizada)

Para cada contraparte com `n ≥ 1` pares (`data_vencimento`, `data_realizada`)
preenchidos:

- `delta_dias = data_realizada − data_vencimento` (positivo = atraso).
- Agrega `mediana_dias`, `media_dias`, `desvio_dias`, `min_dias`, `max_dias`.
- `padrao_estavel = true` se `n ≥ 6 ∧ desvio ≤ 3 ∧ |mediana| ≥ 1`.
- `confianca_inferencia`: `alta` (estável), `media` (n≥6 mas instável),
  `baixa` (n<6).

Eventos sem `data_vencimento` (extrato CEF puro) ou sem `contraparte_id`
são ignorados.

### `Recorrencia` (séries periódicas)

1. Agrupa `realizado` por `(contraparte_id, bucket_id)`.
2. Cluster por valor com tolerância ±10% sobre a mediana corrente do
   cluster.
3. Cluster com `n ≥ 3` é candidato. Mediana dos gaps em dias →
   `Periodo` (semanal, quinzenal, mensal, bimestral, trimestral).
4. `confianca`:
   - `alta`: `n ≥ 6`, **todos** os gaps no período + buffer ±2 dias,
     ativa.
   - `media`: `n ≥ 3`, **maioria** dos gaps no período + buffer, ativa.
   - `baixa`: senão, ou inativa.
5. `ativa = ultima_data ≥ geradoEm − 1.5 × período`.

**Tolerância ±2 dias acima do range:** mensal usa `[28−2, 32+2] =
[26, 34]`. Absorve variância natural de meses-calendário (28-31 dias) +
ajuste ocasional de fim-de-semana/feriado. Sem esse buffer, dados reais
Gregorutt produziam 0 recorrências `alta`.

### `VolatilidadeStats` (CV das saídas críticas)

- Filtra `realizado + saida + criticidade ∈ {obrigatoria, critica_op}`
  dos últimos 365 dias.
- Agrupa por `competencia` (preferido) ou `semana_iso` (fallback quando
  algum evento do legal_entity não tem competência).
- `cv = desvio / media` sobre os totais por período.
- `qualidade = 'alta'` se `n_periodos ≥ 12`, senão `insuficiente`.

**V0 transition:** Stage 3 ainda não classifica em
`obrigatoria/critica_op` — todos os eventos chegam com
`criticidade='pendente'`. Em V0, passar
`criticidadesVolatilidade: ['obrigatoria', 'critica_op', 'pendente']`
ao `MotorHistorico` para que a métrica seja calculada sobre o que existe.
Quando o motor de classificação do nucleus rodar (estágio 3+), maioria das
saídas recorrentes ganham criticidade real e o caller volta ao default
(`['obrigatoria', 'critica_op']`).

## 2.2 — Geração de Estimados

### `generateEstimados`

Filtra `recorrencias` ativas com `confianca ∈ {alta, media}` e projeta
ocorrências futuras dentro de `[geradoEm, geradoEm + 13 semanas]`:

- `próxima_data = última + período`.
- Itera enquanto `próxima ≤ fim`.

### Trava anti-duplicação

Antes de emitir um estimado em data projetada `d`, verifica se já existe
`confirmado`/`realizado` com:

- mesma `contraparte_id`,
- mesmo `bucket_id`,
- valor em `[recorrencia.valor_classe_min, recorrencia.valor_classe_max]`
  (range observado, **não** ±10%),
- data dentro de `±5 dias` de `d`.

Se sim, omite o estimado — o evento existente já cobre. Reconciliação
fina é responsabilidade do Estágio 3.

### Construção do `EventoEstimado`

| Campo | Origem |
|---|---|
| `id` | template `historico_${recorrencia_id}_${data_vencimento_iso}` |
| `valor` | `recorrencia.valor_mediano` |
| `direcao`, `cliente_id`, `legal_entity_id`, `bucket_id`, `bucket_nome`, `criticidade`, `contraparte_id`, `contraparte_tipo`, `source_company_code` | herdados da `Recorrencia` |
| `data_vencimento` | data projetada |
| `data_esperada` | `deriveDataEsperada(data_vencimento, calendar, contraparteHistory, contraparte_id)` — hook ATIVO |
| `data_realizada` | `null` |
| `origem` | `'historico'` |
| `origem_ref` | `recorrencia.recorrencia_id` |
| `status` | `'estimado'` |
| `confianca` | 1 nível abaixo da recorrência: `alta → media`, `media → baixa` |
| `confianca_origem` | `'sistema'` |
| `is_transferencia` | `false` |
| `criado_em` | `geradoEm` |
| `criado_por` | `'motor_historico'` |

### Hook `contraparteHistory` em `deriveDataEsperada`

A função do Stage 1.3 ganhou parâmetros novos (compat preservada — Stage 1
adapters continuam chamando sem hook):

```ts
deriveDataEsperada(
  dataVencimento: Date,
  calendar: CalendarPolicy,
  contraparteHistory?: ContraparteHistory,  // NEW
  contraparteId?: string,                   // NEW
): Date
```

Quando `contraparteHistory` e `contraparteId` são fornecidos E a contraparte
tem `padrao_estavel = true` E `mediana_dias ≠ 0`, a base é deslocada por
`mediana_dias` antes da regra de calendário operacional.

`ContraparteHistory` é definido em `src/calendar/CalendarPolicy.ts` como
`ReadonlyMap<string, { padrao_estavel: boolean; mediana_dias: number }>` —
shape mínimo. `Map<string, ContraparteStats>` (do 2.1) é estruturalmente
assignável (covariância em ReadonlyMap).

**Adapters do Stage 1 NÃO ativam o hook.** Razão: o histórico só existe
depois do Stage 1 rodar; aplicar retroativamente não faz sentido. Estágio 4
(Projeção) pode reaplicar `deriveDataEsperada` com hook em eventos
`confirmado` antes de alocar nas semanas — fica para o futuro.

### Validação de `origem='historico'`

`buildEventoCaixaBase` (Stage 1) **rejeita** `origem='historico'` com
`IngestaoError`. Único produtor legítimo é `generateEstimados`, que
constrói o `EventoEstimado` diretamente sem passar pelo helper.

## Determinismo

- IDs determinísticos (template estável).
- `geradoEm` injetado pelos testes.
- `Recorrencia[]` ordenado por `recorrencia_id`.
- `eventosEstimados` ordenado por `id`.

Re-rodar o motor com mesmo input + mesmo `geradoEm` produz output
`deepEqual`.

## Resultado real (Gregorutt full, geradoEm 2026-05-01)

```
Stage 1:    24.854 eventos (504 confirmados, 24.350 realizados)
2.1 Stats:  817 contrapartes, 506 recorrências (4 alta, 83 ativas)
2.2 Estim.: 42 EventoCaixa em 13 semanas (2026-05-01 → 2026-07-31)
```

Sample mode (CI, slice ~1k linhas): 0 estimados — slice estreito não tem
recorrências fortes ativas. Asserções relaxam para `>= 0` em sample.

## Decisões de design registradas

1. **`ContraparteHistory` minimal em `calendar/`** — não importa
   `ContraparteStats` do `historico/` para preservar `calendar/` como
   fundação. Compatibilidade estrutural via covariância.
2. **`generateEstimados` não usa `buildEventoCaixaBase`** — esse helper
   rejeita `origem='historico'`. O motor constrói o evento direto, com
   campos herdados da `Recorrencia`.
3. **Confiança do estimado = recorrência − 1 nível** — projetar é menos
   seguro que observar, sempre.
4. **Trava anti-duplicação por range observado** — `[valor_classe_min,
   valor_classe_max]` da série, não ±10% do mediano. Mais conservador.
5. **Calendar opcional no MotorHistorico** — sem ele, motor opera em modo
   2.1-only. Compat de chamadas antigas.

## Limitações conhecidas (TODOs documentados)

1. **Reaplicar hook em confirmado existente** — Estágio 4 (Projeção) pode
   recalcular `data_esperada` de eventos `confirmado` do Stage 1 usando
   o hook agora ativo. Fora do escopo desta etapa.
2. **Splits dentro do mesmo cluster** — se uma série mensal trocou de
   valor entre dois patamares, hoje fica como 2 clusters. Detecção de
   "mesma série, escala mudada" fica para v2.
3. **Períodos não-canônicos** — bimestral/trimestral suportados mas não
   há semestral/anual. Adicionar quando aparecer caso real.
