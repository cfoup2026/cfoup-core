# CF13 — Stage 4.5: Classification Bridge

Bridge fino entre o pipeline CF13 e o Motor de Classificação do Núcleo
(`src/classification/classify.ts`). Não recria classificação; só
consome o motor existente, traduz `EventoCaixa ↔ SourceTransaction`
e mapeia `bucket → criticidade`.

**Posição cronológica:** Stage 4.5 (depois do Stage 4 commitado).
**Posição lógica no pipeline:** entre Stage 1 e Stage 2.

```
Stage 1 (parsers + adapters)
  ↓ EventoCaixa[] (criticidade='pendente' default)
Stage 4.5 — Classification Bridge
  ↓ EventoCaixa[] enriquecido (bucket_id + bucket_nome + criticidade)
Stage 2 (Motor de Histórico — recorrências sobre eventos classificados)
  ↓
Stage 3 (Reconciliação)
  ↓
Stage 4 (Projeção 13 semanas com caixa_minimo_op)
```

## TL;DR

```ts
import { NucleusClassifierAdapter, classifyEventos, runPipeline } from 'cfoup-core';

const classifier = new NucleusClassifierAdapter();

// Uso direto:
const { eventos, estatisticas } = classifyEventos({ eventos: stage1Eventos, classifier });

// Uso via pipeline orquestrado:
const out = runPipeline({
  eventos: stage1Eventos, saldos, vendas,
  cliente_id, legal_entity_ids_ativas,
  geradoEm, calendar,
  classifier,
});
```

## Por que um Bridge

- **Separação de domínios.** O motor do Núcleo (`classifyTransaction`) é
  agnóstico ao pipeline CF13. Ele opera sobre `SourceTransaction`
  (formato genérico de transação financeira). O CF13 opera sobre
  `EventoCaixa` (entidade discriminada por status). Bridge faz a
  ponte sem acoplar.
- **Substituibilidade.** A interface `ClassifierAdapter` permite trocar
  o motor (versão, implementação alternativa, mock para testes) sem
  mudar nada no resto do pipeline.
- **Single responsibility.** Bridge faz tradução + mapeamento de
  criticidade. Não classifica, não decide confiança, não emite alerta.

## Arquitetura — 3 peças

### 1. `ClassifierAdapter` (interface)

```ts
interface ClassifierAdapter {
  classify(evento: EventoCaixa): ClassificationResult | null;
}
```

`null` = motor não classificou. Sem fallback heurístico — evento
permanece `pendente_classificacao`.

### 2. `NucleusClassifierAdapter` (implementação concreta)

Envolve o `classifyTransaction` do Núcleo:

1. Traduz `EventoCaixa → SourceTransaction`.
2. Chama `classifyTransaction(sourceTx, options?)`.
3. Traduz output (`ClassificationResult` do Núcleo) → `ClassificationResult` do Bridge.
4. Aplica mapa `bucket → criticidade`.
5. Sinaliza `requiresOwnerConfirmation` via canal lateral
   (`lastRequiresConfirmation`).

### 3. `classifyEventos` (função core)

Itera eventos, delega ao adapter, monta output. Idempotente:
eventos com `bucket_id != "pendente_classificacao"` no input passam
intactos.

## Mapeamentos aprovados

### `Origem (CF13) → SourceSystem (Núcleo)`

| `EventoCaixa.origem` | `SourceTransaction.sourceSystem` | Notas |
| --- | --- | --- |
| `pluggy` | `bank` | Open banking aggregator |
| `cef` | `bank` | Extrato CEF |
| `enotas` | `invoice` | NF-e |
| `erp` | `erp` | ERP genérico |
| `contabil` | `accounting` | Lançamentos contábeis |
| `csv` | `manual` | Import genérico |
| `manual` | `manual` | Lançamento manual |
| `historico` | `manual` | Estimados (Stage 2) — fallback neutro |
| `fkn` (entrada + cliente) | `accounts_receivable` | FKN AR |
| `fkn` (saída + fornecedor) | `accounts_payable` | FKN AP |
| `fkn` (outros) | `erp` | Fallback raro |

### `Direcao (CF13) → Direction (Núcleo)`

`'entrada'` → `'inflow'`; `'saida'` → `'outflow'`.

### `Bucket (Núcleo) → Criticidade (CF13)` — aprovado em 2026-05-04

| Bucket | Criticidade | Racional |
| --- | --- | --- |
| `receita` | `pendente` | Entrada — `criticidade` serve para `caixa_minimo_op` (filtra saídas). Atribuir valor "obrigatoria" para entradas seria cosmético e potencialmente confundir Stage 5/6. |
| `deducoes` | `obrigatoria` | Impostos sobre receita. |
| `custos_diretos` | `critica_op` | Sem isso, não opera. |
| `folha` | `obrigatoria` | Passivo trabalhista. |
| `despesas_operacionais` | `critica_op` | Operação depende. |
| `caixa` | `negociavel` | Tarifas/movimentações internas. NÃO `pendente` para evitar pendências críticas falsas em transferência/saque/depósito. |
| `contas_receber` | `pendente` | Entrada (idem `receita`). |
| `contas_pagar` | `negociavel` | Termos negociáveis. |
| `despesas_financeiras` | `critica_op` | Dívida — default é grave. |
| `retiradas_socios` | `discricionaria` | Distribuição. |
| `investimentos` | `discricionaria` | CAPEX/M&A. |
| `estoque` | `critica_op` | Operação depende. |

## Decisões registradas

### `companyId ← legal_entity_id`

`SourceTransaction.companyId` recebe `EventoCaixa.legal_entity_id`
(unidade), não `cliente_id` (tenant). Razão: o motor do Núcleo aplica
regras por `companyId` (custom rules per company). No CF13 multi-LE,
cada unidade pode ter regras diferentes — granularidade de unidade
faz mais sentido.

### Confiança baixa do motor passa adiante

`confidenceLevel === 'low'` ou `'medium'` é aceito pelo Bridge — o
campo `bucket` não-null é suficiente. Stage 6 (Confiança) decide se
rebaixa o evento. Bridge não decide.

### `requiresOwnerConfirmation` é contado, não filtra

Quando o motor sinaliza `requiresOwnerConfirmation=true`, Bridge usa
o `bucket` mesmo assim e incrementa
`estatisticas.requiresOwnerConfirmationCount`. Stage 5/6 trata.

### Sem cache no v0

Spec previa cache em memória se smoke ultrapassasse 30s extras.
**Smoke Stage 4.5 mediu apenas 30ms para Bridge** sobre 24.854 eventos
do Gregorutt full. Cache desnecessário — motor é regex/lookup puro
(microsegundos por evento). Ver smoke results.

### Estimados (origem='historico') passam pelo Bridge?

No pipeline orquestrado por `runPipeline`, Bridge roda **antes** do
Stage 2, então estimados ainda não existem. Estimados nascem com
classificação herdada da recorrência base — que já foi classificada.
Idempotência cobre o caso edge "alguém roda Bridge sobre output do
Bridge novamente": eventos com `bucket_id != "pendente_classificacao"`
passam intactos.

## Cobertura — destravada pelo Stage 1.6

**Stage 1.6** (commit anterior) preserva texto observado da origem
em 3 campos opcionais de `EventoCaixa`:

- `descricao_origem` ← `Transaction.history` (CEF).
- `contraparte_nome_origem` ← `Payable.vendorName` (AP) /
  `Receivable.customerName` (AR).
- `conta_origem_nome` ← reservado para origens com plano de contas
  estruturado (Pluggy/contábil).

`NucleusClassifierAdapter` repassa esses campos para
`SourceTransaction.{description, counterpartyName, originalAccountName}`,
que o motor consome via heurística de keywords (60+ regras por
substring sobre os campos textuais).

### Resultado no Gregorutt full (smoke 4.5)

```
Eventos no input:                   24.854
Classificados pelo motor:           12.227 (49.2%)
  receita                            11.610 (95.0%)
  despesas_operacionais                 435 (3.6%)
  folha                                 182 (1.5%)
Pediram confirmação do dono:        322

Distribuição por criticidade:
  obrigatoria                           182 (1.5%)
  critica_op                            435 (3.6%)
  pendente                           11.610 (95.0%)

Cobertura cruzada:
  Saídas críticas pós-Bridge:         617 / 11.724 (5.3%)
  Estimados (Stage 2) classificados:    3 / 42 (7.1%)

Stage 4 — caixa mínimo:
  Semanas com caixa_minimo_op > 0:      8 / 13  (regressão destravada)

Tempo do Bridge:                    97 ms
```

### Por que ainda não 100%?

5.3% de saídas críticas é o teto que o motor consegue extrair com
**apenas o vendorName/history** disponível. Para subir mais é preciso:

1. **Regras explícitas por empresa** (`ClassificationOptions.rules`)
   treinadas em Stage 5+ pelo dono do dado — Bridge já aceita via
   `NucleusClassifierAdapterOptions.classifierOptions.rules`.
2. **Plano de contas estruturado** quando a origem tiver — preencher
   `conta_origem_nome` (campo reservado, ainda não usado por nenhum
   adapter atual). Aumenta drasticamente a cobertura para sistemas
   contábeis que estruturam categorias.
3. **Account code hints** — passar `accountCodeHints` via
   `classifierOptions` mapeia códigos de conta originais para
   `StandardCategoryCode`, que o motor traduz para bucket.

## Estatísticas exportadas (`ClassificationStats`)

Identidade obrigatória:

```
classificados + naoClassificados + jaClassificadosNoInput === totalEventos
Σ porBucket.values() === classificados
Σ porCriticidade.values() === classificados
requiresOwnerConfirmationCount ⊆ classificados
```

`tempoTotalMs` é observabilidade pura — não afeta determinismo do
output (mas o valor varia entre runs).

## Smoke results (Gregorutt full, 2026-05-01, pós Stage 1.6)

Ver tabela em "Resultado no Gregorutt full" acima. Tempo do Bridge
**97 ms** sobre 24.854 eventos (regex/lookup puro). Pipeline completo
1→Bridge→2→3→4 em ~234s solo / ~280s sob parallel test execution.

### Antes vs depois do Stage 1.6

| Métrica | Pré-1.6 | Pós-1.6 |
| --- | --- | --- |
| Classificados | 11.610 (46.7%) | 12.227 (49.2%) |
| Buckets de saída | 0 | folha:182 + despesas_operacionais:435 |
| Saídas críticas pós-Bridge | 0 | 617 |
| Estimados classificados | 0 / 42 | 3 / 42 |
| **Semanas com `caixa_minimo_op > 0`** | **0 / 13** | **8 / 13** |
| Tempo do Bridge | 30 ms | 97 ms |

## Não-escopo

- **Decidir cobertura.** Stage 5.
- **Decidir confiança.** Stage 6.
- **Decidir veredito.** Stage 7.
- **Persistência em DB.**
- **Heurística inline fora do motor.**
- **Modificar enum `Criticidade`.**
- **Modificar `cfoup-overview-v3` (UI).**
- **Mudar Stage 1/2/3/4 commitados.**
