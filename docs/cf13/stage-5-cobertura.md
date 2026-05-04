# CF13 — Stage 5: Cobertura mínima da projeção

Stage 5 detecta dois tipos de problema sobre a projeção do Stage 4:
**cobertura insuficiente** (que aciona "dados insuficientes" no
veredito futuro) e **cobertura com confiança reduzida** (pendências
informativas que não bloqueiam veredito).

Stage 5 só **detecta e lista** — não rebaixa confiança (Stage 6) nem
emite veredito (Stage 7). Saída é `Pendencia[]` + `MotivoInsuficiencia[]`
prontos para consumo nos próximos estágios.

## TL;DR

Stage 5 ingere o output do pipeline 1→4.5 e produz `CoberturaResult`:

```ts
{
  status: 'cobertura_insuficiente'         // motivos.length > 0
        | 'cobertura_com_confianca_reduzida' // sem motivos, com pendências
        | 'cobertura_completa';              // ambos vazios
  pendencias: Pendencia[];                   // ordenadas (LE, semana, tipo, id)
  motivosInsuficiencia: MotivoInsuficiencia[]; // ordenados (tipo, LE)
  estatisticas: { ... };
  detectadoEm: Date;
}
```

Pipeline encadeado (orquestrado por `runPipeline`):

```
Stage 1 (parsers + adapters)
  ↓
Stage 4.5 (Classification Bridge)
  ↓
Stage 2 (Motor de Histórico)
  ↓
Stage 3 (Reconciliação + Vendas↔AR)
  ↓
Stage 4 (Projeção 13 semanas)
  ↓
Stage 5 (MotorCobertura — DETECTA, não decide)
  ↓
Stage 6/7 futuros (Confiança, Veredito)
```

## Como rodar

```ts
import { runPipeline } from 'cfoup-core';

const out = runPipeline({
  eventos: stage1Eventos,
  saldos,
  vendas,
  cliente_id: 'cliente_x',
  legal_entity_ids_ativas: ['unidade_a'],
  geradoEm: new Date(),
  reconciliadoEm: new Date(),
  detectadoEm: new Date(), // injetável para determinismo
  classifier,
});

// out.cobertura tem o resultado do Stage 5.
```

Ou direto, sem orquestrador:

```ts
import { MotorCobertura } from 'cfoup-core';

const motor = new MotorCobertura({ detectadoEm });
const r = motor.run({
  eventos, historico, projecao, saldos,
  cliente_id, legal_entity_ids_ativas,
  geradoEm,
});
```

## Detecção em 5 frentes

### 1. Saldo de abertura ausente — `cobertura_insuficiente`

Para cada `legal_entity_id` ativa, lê `projecao.unidades[*].caixaInicial.ausente`
(já calculado pelo Stage 4.1). True → `MotivoInsuficiencia`.

**Não duplica lógica de seleção de snapshot** — apenas consome o
resultado do Stage 4.1.

Ações sugeridas: `[confirmar_saldo, revisar_conexao]`.

### 2. Banco sem dado recente — `cobertura_insuficiente`

Para cada unidade ativa **com banco conhecido**, busca o último
evento `realizado` `origem='cef'`. Se > 7 dias antes de `geradoEm`,
emite motivo.

**Definição de "banco conhecido":** unidade tem ao menos um indício —
ou `OpeningBalanceSnapshot` `origem='cef'`, ou ao menos um evento
`origem='cef'` no histórico (mesmo antigo). Unidades sem indício não
são candidatas.

**Exceção:** evento `origem='manual'` `realizado` dentro da janela
de 7 dias é considerado cobertura via lançamento manual — não dispara.

Janela: `(geradoEm - data_realizada) <= 7 days` → OK; `> 7 days` →
dispara.

Ações sugeridas: `[revisar_conexao, declarar_conta_inativa, adicionar_evento_manual]`.

### 3. Semana zerada — `cobertura_com_confianca_reduzida`

Para cada `(legal_entity_id, semana_iso)` da projeção, se
`evento_ids.length + eventos_pendentes_com_data_ids.length === 0` E
**não é a primeira semana** (idx 0 contém `geradoEm` e pode ter
poucos dias úteis), emite pendência.

Ações sugeridas: `[confirmar_que_era_esperado, adicionar_evento_manual]`.

### 4. Recorrência ausente — `cobertura_com_confianca_reduzida`

Para cada recorrência elegível, projeta próximas ocorrências dentro
da janela das 13 semanas. Se a semana esperada não tem evento
`(contraparte_id, bucket_id)` correspondente em **nenhum status**
(realizado, confirmado, estimado, pendente), emite pendência.

**Critérios de elegibilidade:**
- `confianca IN ('alta', 'media')`. Baixa não dispara.
- `ativa === true`.
- **Saídas:** `bucket_id ∈ BUCKETS_OBRIGACAO_FIXA` =
  `{folha, deducoes, despesas_financeiras}` (lista hardcoded —
  TODO de v0.1: motor de classificação emitir flag `obrigacao_fixa`).
- **Entradas:** sem filtro de bucket — recebíveis recorrentes
  (assinatura, mensalidade, contrato) são "esperados" mesmo sem
  bucket fixo. Spec §3.C.3.

**Trava anti-duplicação:** sintônica com a do Stage 2.2 — qualquer
evento na semana com `(contraparte_id, bucket_id)` correspondente
cobre a recorrência, mesmo se ainda pendente de confirmação.

**Ocorrências fora da janela:** descartadas. Recorrência mensal cuja
próxima data cai depois de W30 não gera pendência.

`valor_esperado` carrega `recorrencia.valor_mediano` — **não é
estimativa nova**, é repetição do valor histórico já calculado pelo
Stage 2.

Ações sugeridas: `[adicionar_evento_manual, verificar_recorrencia]`.

### 5. Pendentes-classificação agregados — `cobertura_com_confianca_reduzida`

Eventos com `bucket_id === 'pendente_classificacao'` OU
`criticidade === 'pendente'` na grade da projeção.

**Granularidade fixa:** uma pendência por
`(legal_entity_id, semana_iso, direcao)`.

**Por que agregar:** Gregorutt produz ~12k pendentes-classificação.
Listar individualmente vira ruído inutilizável. Agregação por
semana/unidade/direção dá visão acionável.

Refinamento (agregação por bucket dentro da unidade) fica pra v0.1.

**Escopo:** apenas eventos NA GRADE da semana — atrasados e fora da
janela ficam de fora.

Ações sugeridas: `[reclassificar_eventos_pendentes]`.

## Status — exclusivo entre 3 valores

| `pendencias` | `motivosInsuficiencia` | `status` |
| --- | --- | --- |
| qualquer | ≥ 1 | `cobertura_insuficiente` |
| ≥ 1 | 0 | `cobertura_com_confianca_reduzida` |
| 0 | 0 | `cobertura_completa` |

**Importante:** mesmo com `cobertura_insuficiente`, pendências
continuam sendo detectadas e reportadas. Stage 7 que decide se
substitui o veredito por "dados insuficientes" — Stage 5 só prepara
o material.

## Decisões registradas

### Stage 5 não rebaixa confiança

`EventoCaixa.confianca` permanece intocada. `CoberturaResult` não tem
campo `confianca`. Confiança é Stage 6 — separação rígida.

### Lista de buckets "fixos" hardcoded

`BUCKETS_OBRIGACAO_FIXA = {folha, deducoes, despesas_financeiras}` é
decisão temporária. **TODO de v0.1**: motor de classificação podia
emitir flag `obrigacao_fixa: boolean` por bucket, evitando essa
decisão local. Documentado no JSDoc de `detectaRecorrenciaAusente`.

### Recebíveis sem filtro de bucket

3.C.3 do spec diz "mesma lógica de 3.C.2 mas pra entradas". Buckets
típicos de entrada (`receita`, `contas_receber`) não estão em
`BUCKETS_OBRIGACAO_FIXA`. Interpretei: filtro composto
`direcao=entrada` substitui o filtro de bucket. Recebíveis
recorrentes (assinatura, mensalidade, contrato) são "esperados"
mesmo sem bucket fixo.

### "Banco conhecido" exige evidência

`banco_sem_dado_recente` só dispara se a unidade tem ao menos um
indício de banco — `OpeningBalanceSnapshot` CEF ou evento CEF
histórico. Spec diz "unidade ativa cuja conta bancária conhecida";
conservadoramente, requeri evidência para evitar falso positivo em
unidades 100% off-line.

### `MotorCobertura` é wrapper fino

Toda lógica em `detectaCobertura` (5.1). Motor existe para simetria
com `MotorHistorico`/`MotorReconciliacao` e injeção de timestamps
determinísticos via `opts.detectadoEm`.

### Imutabilidade

Stage 5 não muta nada. `EventoCaixa[]`, `ProjecaoCliente`,
`HistoricoOperacional` recebidos passam como-estão; `CoberturaResult`
é estrutura nova.

### Determinismo

- `pendencias[]` ordenado por `(legal_entity_id, semana_iso, tipo, id)`.
- `motivosInsuficiencia[]` ordenado por `(tipo, legal_entity_id)`.
- IDs determinísticos: `pend_<tipo>_<legal_entity_id>_<semana_iso>_<qualifier>`.
- Mesmas datas injetadas + mesmo input → mesmo output.

## Linguagem de produto (§8.3 spec)

`descricao` em pendências/motivos é factual, sem storytelling.
**Proibidos:** "bloqueante", "buraco", "input obrigatório",
"sem isso", "precisa preencher". Telas downstream traduzem cada enum
de `acoes_sugeridas` para PT-BR contextual.

Asserção textual no smoke valida que a saída não contém essas
palavras.

## Não-escopo (Stage 6/7+)

- Rebaixar confiança (Stage 6).
- Emitir veredito (Stage 7).
- Substituir veredito por "dados insuficientes" (Stage 7 lê o
  `status='cobertura_insuficiente'` e decide).
- Persistir `CoberturaResult`.
- Tela de pendências.
- Estimar valores faltantes (`valor_esperado` em
  `recorrencia_ausente` é repetição do histórico, não estimativa).

## Smoke results

Ver [stage-5-smoke-results.md](stage-5-smoke-results.md) — números de
referência rodados sobre Gregorutt full e sample.
