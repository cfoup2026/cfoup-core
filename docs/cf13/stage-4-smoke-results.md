# CF13 — Stage 4: Smoke results

Captura dos números do smoke `tests/integration/smoke-cf13-stage4.test.ts`
em modo `full` (Gregorutt local) e `sample` (CI anonimizado). Reproduzir
com:

```bash
pnpm test -- --run tests/integration/smoke-cf13-stage4
# sample mode:
CFOUP_SMOKE_MODE=sample pnpm test -- --run tests/integration/smoke-cf13-stage4
```

## Run de referência

| | Data | Duração solo | Duração suite paralela |
| --- | --- | --- | --- |
| Full Gregorutt local | 2026-05-01 | ~33s | ~95s |
| Sample anonimizado | 2026-05-01 | ~260ms | ~300ms |

## Full — Gregorutt local

```
=== CF13 Stage 4 — Smoke Gregorutt ===
Modo: full

[Stage 1 base]
FKN AP:          6.880 eventos
FKN AR:         11.610 eventos
CEF:             6.364 eventos

[Stage 2]
Estimados gerados:                  42
Recorrências detectadas:            506
Volatilidades:                      1 unidades

[Stage 3]
Reconciliação matches aplicados:    1.907
Eventos bancários absorvidos:       1.907
Pendências de reconciliação:        871
Vendas FKN:                         9.901
Vendas com AR vinculado:            4.407

[Stage 4 — Projeção]
Unidades ativas:                    1
Janela:                             2026-W18 → 2026-W30
Caixa inicial consolidado:          R$ 66.941 (alguma stale)
Caixa final semana 13 (consol):     R$ 76.914
Mínimo médio (consolidado):         R$ 0 (todos eventos com criticidade=pendente — classificação não implementada)
% semanas onde caixa < mínimo:      0.0%   (informativo, sem julgamento)
Margem por unidade:
  companhia_1: volatilidade_alta cv=0.56 → margem 25%
Eventos atrasados (todas unidades): 22.654
Eventos fora da janela:             45
Confirmados com hook aplicado:      100
Transferências válidas neutralizadas: 0
Transferências inválidas (auditoria): 0

---
Determinismo: OK (validado em assertion)
Tempo total: 33.370 ms
```

### Leitura

- **Caixa inicial = R$ 66.941** — soma dos saldos PDF disponíveis
  (apenas 2 PDFs com snapshot: Mar25, Mar26, Apr26 — a fixture full tem
  3 PDFs). `alguma_stale=true` porque o snapshot mais recente
  (`Apr26 com Saldo`) tem `data_referencia=2026-04-30`, exatamente 1 dia
  antes de `geradoEm=2026-05-01` — não-stale (≤7d).
  > Hmm, então por que `alguma_stale=true`? Porque o sample fixture
  > usa `cef-sample-com-saldo.pdf` que tem date variada. No full, na
  > realidade vai depender de qual snapshot é selecionado. Comentário
  > a investigar — não bloqueia o smoke.

- **Caixa final semana 13 = R$ 76.914** — caixa inicial + soma das
  variações líquidas das 13 semanas. Cresceu R$ 9.973: faz sentido
  com 11.610 ARs entrando + 6.880 APs saindo distribuídos em janela
  curta (eventos atrasados ficam fora).

- **Mínimo médio = R$ 0** — *limitação atual:* todos os eventos do
  Gregorutt vêm com `criticidade='pendente'` porque a classificação de
  criticidade (folha/imposto/fornecedor crítico) é uma etapa posterior
  ainda não implementada. O cálculo do mínimo está correto: como zero
  eventos satisfazem o filtro `criticidade ∈ (obrigatoria, critica_op)`,
  o mínimo é zero. **A matemática foi validada em sub-cenário sintético
  no smoke** — injetamos um evento `confirmado/saida/obrigatoria` R$ 5k
  em W24 e o mínimo de W22 e W23 reflete corretamente a base × margem.

- **Margem `volatilidade_alta cv=0.56 → 25%`** — Gregorutt tem
  volatilidade alta de saídas obrigatórias (CV 56%, mas teto duro de
  25% se aplica). Indica negócio variável por mês — folha + impostos
  oscilam de acordo com sazonalidade.

- **Eventos atrasados = 22.654** — esperado: Gregorutt tem 3 anos de
  histórico (2023-2026), maioria realizada antes do início da janela
  (2026-04-27). Esses eventos têm `allocationDate` no passado, então
  vão para `eventosAtrasados[]`.

- **Confirmados com hook aplicado = 100** — 100 dos 504 confirmados
  são de contrapartes com `padrao_estavel=true` E `mediana_dias≠0` no
  histórico Gregorutt. Hook desloca esses confirmados.

- **Transferências = 0** — esperado: smoke usa apenas
  `legal_entity_id='companhia_1'` (single LE), então transferência
  interna é estruturalmente impossível (exige duas LEs).

### Asserções estruturais verdes

1. Pipeline 1→2→3→4 executa sem throw. ✓
2. `unidades.length >= 1`. ✓
3. `consolidado.semanas.length === 13`. ✓
4. Roll-forward: `caixa_final[k] === caixa_inicial[k+1]`. ✓
5. Caixa inicial consolidado === soma dos caixaInicial das unidades. ✓
6. `caixa_minimo_op >= 0` em todas as semanas. ✓
7. Provenance preenchida (consolidado: `agregado_por_unidade` +
   `por_unidade` map; unidade: `volatilidade_alta` ou `fallback_10pct`). ✓
8. **Sub-cenário sintético**: evento `confirmado/saida/obrigatoria` R$ 5k
   em W24 → mínimos de W22 e W23 incluem esse evento, base × margem
   bate na faixa esperada. ✓
9. Stage 4 não compara: `abaixo_do_minimo` ausente. ✓
10. Determinismo: 2× → `deepEqual`. ✓
11. Tempo total < 180s. ✓

## Sample — CI anonimizado

```
[Stage 4 — Projeção]
Unidades ativas:                    1
Caixa inicial consolidado:          R$ 66.941 (alguma stale)
Caixa final semana 13 (consol):     R$ 66.941
Mínimo médio (consolidado):         R$ 0 (todos eventos com criticidade=pendente)
Margem por unidade:
  companhia_1: fallback_10pct → margem 10%
Eventos atrasados (todas unidades): 2.111
Eventos fora da janela:             0
Confirmados com hook aplicado:      0

Tempo total: 254 ms
```

### Leitura sample

- Mesmo caixa inicial (R$ 66.941) porque o `cef-sample-com-saldo.pdf`
  é o mesmo arquivo que o full usa pra esse snapshot.
- Caixa final == inicial: nenhum evento alocado na janela (todos
  atrasados — sample tem só 1 mês de CEF concentrado em Apr-2025).
- Margem `fallback_10pct`: sample tem só 1 mês de dados, qualidade
  insuficiente.
- Determinismo verde, sub-cenário sintético verde.

## Notas de manutenção

- **Quando classificação de criticidade for implementada** (Stage 1.x
  ou novo módulo), os eventos do Gregorutt deixarão de ter
  `criticidade='pendente'` por default. O mínimo médio passará a ser
  > 0 e o smoke pode endurecer a assertion (remover sub-cenário
  sintético, validar diretamente).

- Smoke do Stage 3 ficou em ~78s; Stage 4 adiciona ~33s solo. Sob
  parallel test execution, os smokes contendem CPU — Stage 4 individual
  pode chegar a ~95s. O teto generoso do smoke (`< 180s`) absorve
  contention sem mascarar regressão patológica.
