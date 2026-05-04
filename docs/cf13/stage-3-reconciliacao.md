# CF13 — Stage 3: Reconciliação (3.1 + 3.1.1 + 3.2)

Motor completo do estágio 3 — banco↔CP/CR, transferência interna e
Vendas↔AR. O que está dentro/fora de escopo, decisões registradas.

## TL;DR

Stage 3 ingere `EventoCaixa[]` (saída de Stage 1+2) + `VendaComercial[]`
(estrutura paralela vinda do `fknVendasAdapter`) e produz:

```ts
{
  reconciliacao: {                          // 3.1 + 3.1.1 + transferência
    eventos: EventoCaixa[];                 // pós-promote, pós-absorvido, pós-transferência
    pendencias: PendenciaReconciliacao[];   // ambiguidade/duplicidade/transferência_ambigua
    eventosBancariosAbsorvidos: AbsorcaoBancaria[];
    estatisticas: ReconciliacaoEstatisticas;
    reconciliadoEm: Date;
  };
  comercial: {                              // 3.2 Vendas↔AR
    vendas: VendaComercial[];               // input com reconciliado_com preenchido
    pendencias: PendenciaComercial[];       // venda_sem_ar / ar_sem_venda / venda_ambigua
    estatisticas: ReconciliacaoComercialEstatisticas;
    reconciliadoEm: Date;
  };
}
```

Pipeline encadeado:

```
Stage 1 (parsers + adapters + calendário)
  ↓ EventoCaixa[] base + OpeningBalanceSnapshot[]
Stage 2 (Motor de Histórico — 2.1 stats + 2.2 estimados)
  ↓ EventoCaixa[] + estimados (origem='historico')
Stage 3.1 (banco↔CP/CR P1 — confirmado↔CEF, ±5d)
Stage 3.1.1 (banco↔CP/CR P2 — realizado_titulo↔CEF, ±2d)
  ↓ EventoCaixa[] reconciliado, CEFs absorvidos para fora
Stage 3.2 detecção transferência interna (perna↔perna, ±2d, ±R$0.02)
  ↓ EventoCaixa[] com is_transferencia + transferencia_par_id
Stage 3.2 reconciliação Vendas↔AR (chave forte 120d / fraca 45d)
  ↓ VendaComercial[] com reconciliado_com
```

## Como rodar

```ts
import {
  BrazilCalendarPolicy,
  MotorHistorico,
  MotorReconciliacao,
  fknVendasAdapter,
  parseFKNVendas,
} from 'cfoup-core';

const calendar = new BrazilCalendarPolicy();
const ctx = { cliente_id, legal_entity_id, source_company_code, calendar };

// Stage 1 + 2
const stage1 = /* ap + ar + cef adapters */;
const historico = new MotorHistorico({ geradoEm, janelaSemanas: 13, calendar })
  .run(stage1);
const eventosEntrada = [...stage1, ...historico.eventosEstimados];

// Vendas comercial (estrutura paralela ao caixa)
const sales = parseFKNVendas(rowsCSV).ok;
const vendas = fknVendasAdapter(sales, ctx);

// Stage 3
const motor = new MotorReconciliacao({ reconciliadoEm: new Date() });
const { reconciliacao, comercial } = motor.run(eventosEntrada, vendas);
```

## 3.1 — Reconciliação banco↔CP/CR (Passada 1)

### Critérios de match (P1)

`confirmado` (FKN/manual/erp/...) ↔ `realizado` com `origem='cef'`:

| Eixo | Regra |
| --- | --- |
| `cliente_id` + `legal_entity_id` | iguais |
| `direcao` | igual |
| Valor | tolerância `max(R$ 5, 1%)` sobre o confirmado |
| Data | janela ±5 dias entre `data_realizada` (CEF) e `data_esperada` (confirmado) |
| `contraparte_id` | igual quando ambos têm; ignorado quando algum está vazio |

### Política

- 0 candidatos → CEF segue para P2.
- 1 candidato livre → match: confirmado promovido a `realizado` (mesmo
  `id`, mesmo valor de título, `data_realizada` do CEF, `confianca='alta'`,
  `reconciliado_com=cef.id`). CEF vai para `eventosBancariosAbsorvidos`.
- 1 candidato já matched → pendência `duplicidade_confirmado`.
- 2+ candidatos → pendência `ambiguidade_realizado_para_confirmado`.

### Imutabilidade e auditoria

- Confirmado é "promovido" via construção de novo `EventoCaixa` — input
  jamais mutado.
- `eventosBancariosAbsorvidos[]` registra par `(evento_bancario_id,
  promovido_para_id)` — drill-down completo, nada é perdido.

## 3.1.1 — Passada 2 (FKN-realizado ↔ CEF restante)

Resolve a duplicação real "FKN baixou + CEF lançou": mesmo dinheiro
visto em duas fontes. Sem P2, o caixa contava o pagamento duas vezes.

### Critérios (mais apertados que P1)

`realizado` com origem em lado-A (FKN/manual/erp/...) ↔ CEF sobrante:

| Eixo | Regra |
| --- | --- |
| `cliente_id`+`legal_entity_id`+`direcao` | iguais |
| Valor | tolerância `max(R$ 5, 1%)` |
| Data | ±2 dias entre `data_realizada` do título e `data_realizada` do CEF |
| `contraparte_id` | igual quando ambos têm |

Janela menor que P1 porque ambos os lados já têm data efetiva (não há
folga de "promessa de pagamento").

### Política

- 1 candidato livre → match: título recebe `reconciliado_com=cef.id` +
  `reconciliado_em`. CEF vai para absorvidos.
- 1 candidato já matched (encadeamento P2) → pendência
  `duplicidade_cef_titulo`.
- 2+ candidatos → pendência `ambiguidade_realizado_titulo_para_cef`.

### Interpretação §3.C vs §7.9

A spec tem ambiguidade entre §3.C (1 título + 2+ CEFs = ambiguidade,
sem match) e §7.9 (1 título + 2+ CEFs = 1 match + duplicidade). Adotamos
**§3.C como normativa**: 2+ candidatos → ambiguidade pura, sem match
automático. Política conservadora — qualquer decisão automática nesse
cenário pode escolher errado.

## 3.2 — Detecção de transferência interna

Marca pares de eventos opostos entre duas `legal_entity_id`s do mesmo
`cliente_id`. Razão: no consolidado do cliente, transferência neutraliza
— dinheiro só andou de bolso.

### Critérios (estritos)

| Eixo | Regra |
| --- | --- |
| `status` | ambas as pernas em `realizado` |
| `cliente_id` | iguais (mesmo tenant) |
| `legal_entity_id` | DIFERENTES (intra-unidade não é transferência interna) |
| `direcao` | OPOSTAS (uma `entrada`, outra `saida`) |
| Valor | tolerância apenas de centavos (`±R$ 0.02`) — sem 1% |
| Data | ±2 dias entre `data_realizada`s — sem 5d |

### Política 1:1 estrita com pré-detecção de ambiguidade

Algoritmo em duas passadas para evitar greedy:

1. **Mapa de candidatos** — para cada evento, lista vizinhos válidos.
2. **Bloqueio por ambiguidade** — eventos com 2+ candidatos geram
   pendência `transferencia_ambigua`. Todos os envolvidos no grupo
   ficam bloqueados (não entram em match), com pendência única
   dedupada por chave ordenada de IDs.
3. **Match mútuo 1:1** — só casa A↔B se ambos têm exatamente 1
   candidato e são candidatos um do outro.

Sem isso, um evento "perna A" com degree 1 cuja única ponta tem degree
2+ consumiria silenciosamente a ambiguidade.

### Marcação

Eventos casados ganham `is_transferencia=true` + `transferencia_par_id`
cruzado. Imutável: input jamais mutado, eventos casados são clones.

## 3.2 — Reconciliação Vendas↔AR

Enrichment unilateral: vendas ganham `reconciliado_com` apontando para o
AR; AR não muda. Drill-down inverso vem por
`vendas.find(v => v.reconciliado_com === ar.id)`.

### Filtragem inicial

ARs candidatos: `direcao='entrada'` + `origem='fkn'` +
`contraparte_tipo='cliente'`, em qualquer status (`confirmado` ou
`realizado`).

### Política em duas vias

| Caso | Via | Janela | Outras condições |
| --- | --- | --- | --- |
| `documento_ref` presente E IGUAL nos dois lados | **Forte** | AR.dataRef em `[emissao, emissao+120d]` | cliente, valor `max(R$5, 1%)` |
| Qualquer outro caso (ausente em pelo menos um lado, ou presente em ambos com domínios diferentes) | **Fraca** | `±45d` entre emissao e dataRef | cliente, valor `max(R$5, 1%)` |

`AR.dataRef` = `data_vencimento` quando presente, senão `data_realizada`
(AR realizado direto sem vencimento prévio).

### Por que fall-through quando doc_refs diferem?

FKN grava `NOTA` na venda (ex: `115683`) e `DUPLIC` no AR (ex:
`018794/1`). Ambos populados, semanticamente distintos. Tratá-los como
chave forte falharia 100% das vezes em qualquer instalação FKN; cair
em Via 2 (chave fraca, 45d) é o comportamento útil. Sub-caso (a) e (b)
da Via 2 cobrem o spec literal; sub-caso (c) é o fall-through real.

### Política 1:1 estrita

- 0 ARs → pendência `venda_sem_ar`.
- 1 AR livre → match.
- 2+ ARs → pendência `venda_ambigua` (sem match).
- AR não consumido por nenhuma venda → pendência `ar_sem_venda`.

### Performance

ARs indexados por `(cliente_id|legal_entity_id|contraparte_id)`. Vendas
com contraparte buscam só o bucket relevante + ARs sem contraparte
(regra "checa contraparte só se ambos têm"). Reduz iteração de
`O(V×A)` para `O(V × candidatosPorCliente)` na prática.

## Orquestrador `MotorReconciliacao`

```ts
new MotorReconciliacao({ reconciliadoEm }).run(eventos, vendas?)
```

Encadeia, em ordem fixa:

1. `reconciliaBancoCpCr` (P1 + P2) → produz `eventos` reconciliados.
2. `detectaTransferenciaInterna` sobre os reconciliados — eventos
   absorvidos pela 3.1 já estão fora da entrada da transferência,
   evitando casar transferência com perna fantasma.
3. `reconciliaVendasAr` usa os eventos com transferência marcada.

Pendências de transferência ficam em `reconciliacao.pendencias` (mesma
estrutura `PendenciaReconciliacao`); pendências comerciais ficam
separadas em `comercial.pendencias` (`PendenciaComercial` — vendas e
ARs separados por campo).

## Decisões e invariantes

### `is_transferencia` apenas em `realizado`

Confirmados podem virar transferência apenas no próximo ciclo, depois de
virarem realizados. v0 mantém estrito — sinal de transferência exige
movimento bancário observado, não promessa.

### Vendas nunca somam no caixa

Invariante absoluta: `Σvendas + Σar` no caixa duplicaria a receita.
Garantido por:
- `fknVendasAdapter` retorna `VendaComercial[]` — tipo distinto de
  `EventoCaixa[]`, TS impede atribuição.
- `reconciliaVendasAr` enriquece vendas, não cria evento de caixa.
- `MotorReconciliacao.run` retorna duas estruturas separadas.

### Estimados (`origem='historico'`) intocados

Stage 2 produz estimados para projeção; estágio 3 não reconcilia, não
marca transferência, não vincula a venda comercial. Estimados são
projeções, não dados confirmados.

### Determinismo

Mesma entrada + `reconciliadoEm` injetado → output `deepEqual`.
Garantido por:
- Sort estável (data asc → id lex) em todos os loops principais.
- Pendência ID determinístico via sort de `eventos_relacionados`.
- Iteração `Map`/`Set` em ordem ordenada (clienteIds.sort() etc).

### Auditoria

- `eventosBancariosAbsorvidos`: par CEF→promovido para drill-down.
- `transferencia_par_id` cruzado: navegação 1:1 entre pernas.
- `VendaComercial.reconciliado_com`: link unilateral para AR.

Reconstruir a verdade por re-execução é o teste último — `deepEqual`
em duas runs prova que toda decisão é função pura do input.

## Não-escopo (Stage 4+)

- Projeção 13 semanas (Stage 4).
- Veredito de cobertura/confiança.
- Persistência em DB.
- Ajuste de saldo de caixa em tempo real.
- Storytelling/explicabilidade narrativa.

## Smoke results

Ver [stage-3-smoke-results.md](stage-3-smoke-results.md) — números de
referência rodados sobre Gregorutt full local e sample anonimizado.
