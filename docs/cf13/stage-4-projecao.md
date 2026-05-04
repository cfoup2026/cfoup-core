# CF13 — Stage 4: Projeção 13 semanas (4.1 + 4.2 + 4.3)

Motor completo do estágio 4 — alocação semanal por unidade, consolidação
por cliente com neutralização de transferência interna, e cálculo de
caixa mínimo operacional.

## TL;DR

Stage 4 ingere `EventoCaixa[]` (saída do Stage 3 reconciliado +
estimados do Stage 2) + `OpeningBalanceSnapshot[]` + opcionalmente
`contraparteHistory` e `volatilidades` (Stage 2.1) e produz:

```ts
{
  cliente_id: string;
  geradoEm: Date;
  unidades: ProjecaoUnidade[];     // 1 por legal_entity_id ativa, com 13 semanas + caixa_minimo_op
  consolidado: ProjecaoConsolidada; // soma das unidades + transferência neutralizada + caixa_minimo_op consolidado
}
```

Pipeline encadeado (orquestrado por `projetaCliente`):

```
Stage 3.eventos[] + saldos[] + contraparteHistory? + volatilidades?
  ↓
4.1 projetaUnidade × N (uma por LE ativa)
  ↓
4.2 sumar buckets → avaliar transferências → subtrair pares válidos
   → recalcular totais → roll-forward consolidado
  ↓
4.3 calculaCaixaMinimoOp por unidade (margem CV ou fallback) +
    consolidado (soma direta, por_unidade preservado)
  ↓
ProjecaoCliente
```

## Como rodar

```ts
import {
  BrazilCalendarPolicy,
  MotorHistorico,
  MotorReconciliacao,
  projetaCliente,
} from 'cfoup-core';

const calendar = new BrazilCalendarPolicy();

// Stage 1+2+3 produzem `eventosReconciliados`, `saldos`,
// `contraparteHistory`, `volatilidades` (do MotorHistorico).
const projecao = projetaCliente({
  eventos: eventosReconciliados,
  saldos,
  cliente_id: 'gregorutt',
  legal_entity_ids_ativas: ['companhia_1', 'companhia_2'],
  geradoEm: new Date(),
  calendar,
  contraparteHistory: historico.contraparteHistory,
  volatilidades: historico.volatilidades,
});
```

## 4.1 — Alocação semanal por unidade

### Janela de 13 semanas

ISO 8601 strict, segunda-domingo. Semana 1 = a que contém `geradoEm`;
semanas 2-13 são as 12 seguintes.

Identificador `YYYY-Www` (`"2026-W18"`). Casos de virada de ano:
2025-12-29 → `"2026-W01"`; 2027-01-01 → `"2026-W53"`.

### Caixa inicial

Snapshot mais recente com `data_referencia ≤ geradoEm`, do mesmo
`(cliente_id, legal_entity_id)`. Tiebreak por `id` lex.

Flags:
- `stale`: `(geradoEm − data_referencia) > 7 dias`. Não bloqueia 4.1;
  Stage 5 (Cobertura) decide.
- `ausente`: nenhum snapshot elegível → `valor=0`.

### `allocationDate` por evento

| Status | `allocationDate` |
| --- | --- |
| `realizado` | `data_realizada` (sem hook) |
| `confirmado` | `deriveDataEsperada(data_vencimento, calendar, contraparteHistory?, contraparte_id?)` |
| `estimado` (origem `historico`) | `data_esperada` (já passou pelo hook na 2.2) |
| `pendente` com `data_esperada` | `data_esperada` |
| `pendente` sem data | `null` → `eventosNaoAlocados` |

**Imutabilidade absoluta**: `EventoCaixa.data_esperada` original NÃO é
mutado. `allocationDate` vive em `ProjecaoUnidade.allocationDatesByEventoId`.

### Bucketização

`status × direcao` → 6 buckets (`entradas_realizadas`,
`entradas_confirmadas`, `entradas_estimadas`, `saidas_realizadas`,
`saidas_confirmadas`, `saidas_estimadas`).

**Pendentes excluídos dos totais.** Aparecem em
`eventos_pendentes_com_data_ids` para drill-down. Razão: `status='pendente'`
indica dado incompleto; somar mente confiança.

### Roll-forward determinístico

`caixa_inicial[k+1] = caixa_final[k]`. Semana 1 inicia com
`CaixaInicial.valor` (0 se ausente).

### Atrasados / fora da janela

Eventos com `allocationDate` antes do início da semana 1 vão para
`eventosAtrasados`. Após o fim da semana 13 vão para `eventosForaDaJanela`.
Ambos têm entrada em `allocationDatesByEventoId` (drill-down completo).

## 4.2 — Consolidado por cliente + transferência interna

### Algoritmo em 6 passos

1. Validação de input (cliente_id, geradoEm, calendar).
2. Para cada `legal_entity_id` ativa (ordenadas lex), chamar
   `projetaUnidade` (4.1). Saída intacta em `unidades[]`.
3. Caixa inicial consolidado: soma vetorial das `CaixaInicial.valor`,
   flags em "OR" (`alguma_stale`, `alguma_ausente`).
4. Soma bruta de buckets por semana — todas unidades acumuladas.
5. Avaliação de transferências (`avaliaTransferencias`) → pares
   recíprocos válidos → subtrações nos buckets do consolidado.
6. Recálculo de totais + roll-forward consolidado.

### Validação de par

| Critério | Falha → motivo |
| --- | --- |
| `transferencia_par_id` presente | `par_inexistente` |
| Par existe no input | `par_inexistente` |
| Mesmo `cliente_id` | `cliente_diferente` |
| Diferentes `legal_entity_id` | `mesma_unidade` |
| Recíproco (B aponta de volta para A) | `nao_reciproco` |
| Direções opostas | `mesma_direcao` |
| Ambos dentro da janela das 13 semanas | `fora_janela` |

Cada `is_transferencia=true` é avaliado UMA vez. Pares válidos consomem
ambos os lados; não-recíprocos só consomem o evento de origem (B será
avaliado independentemente como seu próprio par).

### Por que a ordem soma → neutraliza → totais → roll-forward?

Soma das `caixa_final[k]` das unidades **NÃO** é igual a
`consolidado.caixa_final[k]` quando há transferência interna. Só fica
consistente depois que a neutralização tira o "dinheiro andando de bolso"
e o roll-forward refaz a cadeia.

## 4.3 — Caixa mínimo operacional

### Fórmula §5 do spec

```
caixa_minimo_op(semana_n) = soma(eventos onde:
    direcao = saida
    AND status IN (confirmado, estimado)
    AND criticidade IN (obrigatoria, critica_op)
    AND is_transferencia = false
    AND allocationDate ENTRE inicio(semana_n+1) E fim(semana_n+2)
) × (1 + margem_seguranca)
```

### Filtro de elegibilidade

**Inclusos:** `direcao='saida'` + `status ∈ (confirmado, estimado)` +
`criticidade ∈ (obrigatoria, critica_op)` + `is_transferencia=false`.

**Exclusos:** `realizado` (fato consumado), `pendente` (dado incompleto),
entradas, transferência interna (não é obrigação real do cliente),
`negociavel`/`discricionaria`/`pendente` (criticidade).

### Margem com teto 25% / fallback 10%

| Cenário | Margem | `margem_origem` |
| --- | --- | --- |
| `qualidade='alta'` E `cv ≥ 0` | `min(cv, 0.25)` | `volatilidade_alta` |
| `qualidade='insuficiente'` | `0.10` | `fallback_10pct` |
| Unidade sem entrada na Map | `0.10` | `fallback_10pct` |
| `volatilidades` ausente | `0.10` | `fallback_10pct` |

CV negativo → `ProjecaoError` (fail visibly).

### Consolidado: soma direta

Caixa mínimo do consolidado = `Σ unit caixa_minimo_op[n]`. **Não
recalcula CV global** — agregar CVs exigiria covariância entre unidades,
fora do v0. Cada unidade protege seu próprio mínimo; consolidado protege
a soma.

`por_unidade` na provenance preserva o detalhe (margem + origem + base
por unidade) para drill-down.

### Stage 4 não decide nada além do número

`caixa_minimo_op` calculado, ponto. **Não compara** com `caixa_final`,
**não emite alerta**, **não rebaixa confiança**. Tudo isso é Cobertura
(Stage 5), Confiança (Stage 6) e Veredito (Stage 7).

### Limitação aceita: semanas 12-13

Mínimo das semanas 12 e 13 olha pra n+1 e n+2 = semanas 13/14/15.
Eventos da semana 14-15 não foram alocados pelo 4.1 (janela=13), então
**não entram** na soma. Mínimo das duas últimas semanas é **subestimado
por construção**. Refinamento (alocar 15 semanas, expor 13, usar 14-15
só pro mínimo) é v0.1.

## Decisões e invariantes

### Imutabilidade absoluta

- `EventoCaixa[]` que entra é o mesmo que sai.
- `data_esperada` original NUNCA mutada — `allocationDate` vive em Map
  separado.
- `ProjecaoUnidade` retornado pelo 4.1 é byte-for-byte igual quando
  chamado direto (assertion explícita em test).
- `calculaCaixaMinimoOp` retorna NOVAS instâncias de `ProjecaoUnidade`
  e `ProjecaoConsolidada`.

### Determinismo

- Sort estável (data asc → id lex) em todos os loops.
- `legal_entity_ids_ativas` ordenado lex internamente.
- `transferenciasNeutralizadas` ordenado por `evento_a_id`.
- IDs de pendência via sort de eventos relacionados.

### Provenance

- `caixaInicial.origem_snapshot_id` rastreável.
- `evento_ids` por semana = drill-down dos somados nos totais.
- `eventos_pendentes_com_data_ids` = drill-down dos pendentes alocados.
- `allocationDatesByEventoId` cobre TODOS eventos com data calculável
  (na grade + atrasados + fora da janela).
- `caixa_minimo_op_provenance.eventos_considerados_ids` = drill-down
  dos elegíveis ao mínimo.
- `por_unidade` no consolidado = breakdown da margem por LE.
- `transferenciasNeutralizadas[]` = histórico completo dos pares
  avaliados (válidos + inválidos com motivo).

### Fail visibly

- `realizado` sem `data_realizada` válida → `ProjecaoError`.
- `geradoEm` ausente/inválido → `ProjecaoError`.
- `calendar` ausente → `ProjecaoError`.
- `cliente_id` ausente → `ProjecaoError`.
- Volatilidade com `cv` negativo → `ProjecaoError`.

## Não-escopo (Stage 5+)

- Cobertura mínima da projeção (Stage 5).
- Veredito de confiança e pontuação (Stage 6/7).
- Persistência em DB.
- Decisão sobre snapshot stale/ausente.
- Comparação `caixa_final < caixa_minimo_op`.
- Storytelling/explicabilidade narrativa.

## Smoke results

Ver [stage-4-smoke-results.md](stage-4-smoke-results.md) — números de
referência rodados sobre Gregorutt full local e sample anonimizado.
