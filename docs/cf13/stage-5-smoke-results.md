# CF13 — Stage 5: Smoke results

Captura dos números do smoke `tests/integration/smoke-cf13-stage5.test.ts`
em modo `full` (Gregorutt local) e `sample` (CI anonimizado).

```bash
pnpm test -- --run tests/integration/smoke-cf13-stage5
# sample mode:
CFOUP_SMOKE_MODE=sample pnpm test -- --run tests/integration/smoke-cf13-stage5
```

## Run de referência

| | Data | Duração solo | Duração suite paralela |
| --- | --- | --- | --- |
| Full Gregorutt local | 2026-05-01 | ~55s | ~280s |
| Sample anonimizado | 2026-05-01 | ~560ms | ~600ms |

## Full — Gregorutt local

```
=== CF13 Stage 5 — Smoke com Cobertura ===
Modo: full

[Stage 1 base]
Total eventos:                      24.854

[Stage 4.5 — Bridge]
Classificados:                      12.227 (49.2%)

[Stage 4 — Projeção]
Caixa inicial consolidado:          R$ 66.941
Caixa final semana 13:              R$ 76.914

[Stage 5 — Cobertura]
Status:                             cobertura_insuficiente

  Motivos de insuficiência:
    banco_sem_dado_recente              1

  Pendências detectadas:
    semana_zerada                             0
    recorrencia_ausente                       1
    pendentes_classificacao_agregados        24
    TOTAL                                    25

  Pendentes-classificação:
    Total eventos:                  282
    Valor total:                    R$ 528.380
    Buckets agregados:              24
    Top 5 (LE / semana / direcao):
      companhia_1 / 2026-W19 / entrada: 38 ev, R$ 73.407
      companhia_1 / 2026-W20 / entrada: 31 ev, R$ 52.895
      companhia_1 / 2026-W21 / entrada: 24 ev, R$ 50.112
      companhia_1 / 2026-W18 / entrada: 27 ev, R$ 42.381
      companhia_1 / 2026-W18 / saida: 20 ev, R$ 40.181

  Recorrências (Stage 2):
    Ativas + confiança não-baixa:   20
    Ausentes detectadas (semanas):  1

  Distribuição de ações sugeridas:
    reclassificar_eventos_pendentes          24 pendências
    adicionar_evento_manual                   1 pendências
    verificar_recorrencia                     1 pendências

  Cobertura por unidade:
    companhia_1              25 pendências
    Semanas distintas com pendência: 13

---
Determinismo: OK (validado em assertion)
Tempo total: 54.859 ms
```

### Leitura

- **Status `cobertura_insuficiente`** por `banco_sem_dado_recente`.
  Fixture full tem extratos CEF até `Mar26` (último evento ~31 dias
  antes de `geradoEm=2026-05-01`). Stage 5 detecta corretamente — é
  achado real do dataset, não bug. Em produção com extratos diários
  via Pluggy o status seria `cobertura_com_confianca_reduzida` ou
  `cobertura_completa`.
- **24 pendentes-classificação agregados** somam **282 eventos /
  R$ 528.380** distribuídos em 13 semanas. ~50% dos eventos do
  Gregorutt continuam pendente após o Bridge (limitação do motor
  sobre AP/CEF saídas sem `description` — documentado no Stage 4.5).
- **1 recorrência ausente:** Stage 2 detectou 506 recorrências, das
  quais 20 são ativas + confiança alta/média. Apenas 1 das elegíveis
  caiu em semana sem evento correspondente na janela das 13 semanas.
- **0 semanas zeradas** — Gregorutt tem cobertura ampla de eventos.

### Critérios de aceite verdes

1. ✅ `pnpm typecheck` clean.
2. ✅ Pipeline 1→Bridge→2→3→4→5 executa sem throw.
3. ✅ Status válido (um dos 3 valores).
4. ✅ Pendentes-classificação agregados com shape correto.
5. ✅ Linguagem de produto: nada de "bloqueante", "buraco", "input
   obrigatório", "sem isso", "precisa preencher".
6. ✅ Estatísticas batem (`Σ porTipo = pendencias.length`,
   `motivosInsuficienciaCount = motivos.length`).
7. ✅ Stage 5 não muta `confianca` em nenhum evento.
8. ✅ Imutabilidade: input do Stage 1 não mutado.
9. ✅ Determinismo: 2 runs → `deepEqual` em todas as estruturas
   (`bridged`, `historico`, `reconciliacao`, `comercial`, `projecao`,
   `cobertura`).
10. ✅ Tempo total < 540s.

## Sample — CI anonimizado

```
[Stage 5 — Cobertura]
Status:                             cobertura_insuficiente

  Motivos de insuficiência:
    saldo_abertura_ausente OU banco_sem_dado_recente

  Pendências detectadas:
    semana_zerada                            12
    recorrencia_ausente                       0
    pendentes_classificacao_agregados         0
    TOTAL                                    12

Tempo total: ~547 ms
```

### Leitura sample

- Sample tem ~2k eventos, todos no PASSADO (último CEF é Apr/2025;
  extratos AR/AP terminam ~2026-04-20). A janela `2026-W18..W30` tem
  poucos eventos confirmados/estimados — 12 semanas zeradas (idx 1..12).
- Sem agregados de pendentes-classificação porque os eventos
  classificáveis estão atrasados (fora da grade) e os poucos na grade
  já foram classificados pelo Bridge ou são receita (criticidade
  pendente, mas filtro do agregador não considera receita+entrada
  sozinhos).
- Determinismo verde, ações sugeridas presentes.

## Notas de manutenção

- **Quando Pluggy/extratos diários** estiverem ingeridos no full
  Gregorutt, `banco_sem_dado_recente` deixará de disparar e o status
  passará a ser `cobertura_com_confianca_reduzida`. Atualizar este
  doc.
- **Quando classificação avançar** (decisão de v0.1: motor preencher
  AP/CEF saídas sem description via regras de empresa), o número de
  pendentes-classificação cairá. Atualizar.
- **Smoke 5 sob parallel suite** chega a ~280s no full (vs ~55s solo)
  porque Stages 4 e 4.5 também rodam suas próprias instâncias do
  pipeline pesado simultaneamente. Solo time é a métrica
  representativa de hardware isolado.
