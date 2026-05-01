# CF13 — Stage 3: Smoke results

Captura dos números do smoke `tests/integration/smoke-cf13-stage3.test.ts`
em modo `full` (Gregorutt local) e `sample` (CI anonimizado). Reproduzir
com:

```bash
pnpm test -- --run tests/integration/smoke-cf13-stage3
# sample mode:
CFOUP_SMOKE_MODE=sample pnpm test -- --run tests/integration/smoke-cf13-stage3
```

## Run de referência

| | Data | Duração solo | Duração suite paralela |
| --- | --- | --- | --- |
| Full Gregorutt local | 2026-05-01 | ~41s | ~68s |
| Sample anonimizado | 2026-05-01 | ~160ms | ~200ms |

## Full — Gregorutt local

```
=== CF13 Stage 3 — Smoke Gregorutt ===
Modo: full

[Stage 1 base]
FKN AP:          6.880 eventos
FKN AR:         11.610 eventos
CEF:             6.364 eventos
Total Stage 1:  24.854 (realizado: 24.350 / confirmado: 504)

[Stage 2]
Estimados gerados:                  42
Recorrências detectadas:            506 (alta: 4, media: 16)
Contrapartes com padrão estável:    85

[Stage 3.1 — banco ↔ CP/CR (P1 + P2)]
Matches aplicados:                  1.907 (P1: 12, P2: 1.895)
Eventos absorvidos:                 1.907
CEF não absorvidos (tarifas/IOF):   4.457
Pendências de reconciliação:        871

[Stage 3.2 — transferência interna]
Pares de transferência marcados:    0
Pendências de transferência:        0

[Stage 3.2 — Vendas ↔ AR]
Vendas FKN:                         9.901
Vendas com AR vinculado:            4.407
Vendas sem AR:                      4.726
AR sem venda:                       7.203
Pendências de venda ambígua:        768

---
Determinismo: OK (validado em assertion)
Tempo total: 41.157 ms
```

### Leitura

- **P1 baixo, P2 dominante** (12 vs 1.895): faz sentido — o histórico
  do Gregorutt é majoritariamente já realizado (24.350 realizados vs
  504 confirmados). P1 só tem 504 confirmados pra casar; P2 tem
  ~17.500 títulos realizados pra casar com 6.364 CEFs.
- **CEF não absorvido = 4.457** — tarifas, IOF, transferências
  avulsas, débitos sem origem em título. Esperado pra 12 meses de
  extrato.
- **Transferência interna = 0** — esperado: o smoke usa um único
  `legal_entity_id` ('companhia_1') no `AdapterContext`. Detecção
  exige LEs diferentes; multi-unidade real exigirá ingestão por LE
  (próximo passo do uso operacional).
- **Vendas matched ~ 45%** — Via 2 (fraca, ±45 dias) é o caminho
  efetivo, já que vendas guardam NOTA em `documento_ref` e AR guarda
  DUPLIC. Os ~50% de vendas sem AR refletem (a) vendas à vista que
  fecharam direto no caixa e (b) ARs além do horizonte de 45d.

### Asserções estruturais (12) verdes

1. Pipeline executa sem throw.
2. Conservação: 24.854 (entrada) = 22.947 (saída) + 1.907 (absorvidos). ✓
3. Reconciliação ativa: 1.907 ≥ 1. ✓
4. CEF não absorvido > 0: 4.457. ✓
5. Transferências quando existem têm par cruzado correto (estrutural). ✓
6. `is_transferencia=true` apenas em `realizado`. ✓
7. Vendas↔AR ativa: 4.407 ≥ 1. ✓
8. `VendaComercial[]` não vaza pra `EventoCaixa[]` (sem campo
   `status`/`direcao`/`data_realizada`, IDs não colidem). ✓
9. Pendências capturadas em ambas estruturas. ✓
10. Estimados (`origem='historico'`) intocados — sem
    `is_transferencia`, sem `reconciliado_com`, sem aparecer em
    pendências comerciais. ✓
11. Determinismo: `motor.run(...)` 2× → `deepEqual`. ✓
12. Auditoria: `|absorvidos| === matchesAplicados`, cada absorção
    referencia evento bancário (fora do output) e promovido (no
    output). ✓

## Sample — CI anonimizado

```
=== CF13 Stage 3 — Smoke Gregorutt ===
Modo: sample

[Stage 1 base]
FKN AP:            897 eventos
FKN AR:            787 eventos
CEF:               427 eventos
Total Stage 1:   2.111 (realizado: 2.107 / confirmado: 4)

[Stage 2]
Estimados gerados:                  0
Recorrências detectadas:            83 (alta: 0, media: 0)
Contrapartes com padrão estável:    9

[Stage 3.1 — banco ↔ CP/CR (P1 + P2)]
Matches aplicados:                  0 (P1: 0, P2: 0)
Eventos absorvidos:                 0
CEF não absorvidos (tarifas/IOF):   427
Pendências de reconciliação:        0

[Stage 3.2 — transferência interna]
Pares de transferência marcados:    0
Pendências de transferência:        0

[Stage 3.2 — Vendas ↔ AR]
Vendas FKN:                         876
Vendas com AR vinculado:            20
Vendas sem AR:                      855
AR sem venda:                       767
Pendências de venda ambígua:        1

---
Determinismo: OK (validado em assertion)
Tempo total: 159 ms
```

### Leitura sample

- Sample tem só 1 mês de CEF (`cef-sample.txt` ≈ Apr-2025) e ~3 anos
  de AP/AR cortados em ~1.000 linhas cada. AP/AR/Vendas cobrem
  2023-2026; CEF cobre 1 mês — a interseção temporal pra match P1/P2
  é mínima, daí 0 matches bancários. Este é um trade-off conhecido do
  sample: prova fluxo, não cobertura.
- 20 matches de Vendas↔AR já provam a Via 2 funcionando em CI.
- Asserções estruturais (12) passam todas; expectativas numéricas de
  reconciliação são `if (!SAMPLE_MODE)` — só exigidas em full local.

## Notas de manutenção

- Os números acima ficarão estáveis enquanto Gregorutt full não receber
  novos exports. Se a fixture for atualizada, atualizar este doc.
- Para investigar uma divergência, comparar `reconciliacao.pendencias`
  e `comercial.pendencias` na ordem em que aparecem — IDs são
  determinísticos (sorted), facilitando bisseção.
