# CF13 — Smoke Estágio 1

Como rodar e como gerar o sample anonimizado.

## TL;DR

```bash
# Local (full Gregorutt) — exige fixtures locais
pnpm test tests/integration/smoke-cf13-stage1.test.ts

# CI (sample) — força modo sample
CFOUP_SMOKE_MODE=sample pnpm test tests/integration/smoke-cf13-stage1.test.ts
```

CI define `process.env.CI` automaticamente; o smoke detecta isso e usa o
sample sem nenhuma flag adicional.

## O que o smoke valida

Pipeline completo Estágio 1 contra dados reais Gregorutt:

```
parsers (FKN AP/AR, CEF TXT/PDF)
   → adapters (1.2)
      → calendário operacional (1.3)
         → EventoCaixa[] válido + OpeningBalanceSnapshot[]
```

11 asserções obrigatórias (§4 do prompt 1.4):

1. Contagens batem com a fonte (6.880 AP, 11.611 AR no full).
2. Schema válido — todo evento passa o type guard.
3. Calendário aplicado em 100% dos não-realizados.
4. Realizados têm `data_esperada = data_realizada`.
5. `data_vencimento` preservada quando deslocado.
6. Determinismo — rodar 2× → mesmos IDs/valores/datas.
7. IDs únicos.
8. Bucket técnico universal (`pendente_classificacao`).
9. Origem correta por adapter.
10. Status coerente (FKN AP/AR mistura; CEF 100% realizado).
11. Saldos do CEF (PDF) viram `OpeningBalanceSnapshot[]` válidos.

## Layout de fixtures

```
tests/fixtures/
├─ gregorutt_cp_2023_ate_20abr2026.csv      ← committed (AP, full)
├─ gregorutt_cr_2023_ate_20abr2026.csv      ← committed (AR, full)
├─ gregorutt/                                ← gitignored (local only)
│  └─ Bcos/
│     ├─ CEF Apr25.txt                       (12 .txt mensais, ~30–40KB cada)
│     ├─ CEF Mai25.txt
│     ├─ … até CEF Mar26.txt
│     ├─ CEF Apr26 com Saldo.pdf             (3 PDFs com SALDO ANTERIOR/DIA)
│     ├─ CEF Mar25 com Saldo.pdf
│     └─ CEF Mar26 com Saldo.pdf
└─ gregorutt-sample/                         ← committed (CI)
   ├─ ap-sample.csv                          (slice de ~1000 linhas)
   ├─ ar-sample.csv                          (slice de ~1000 linhas)
   ├─ cef-sample.txt                         (1 mês, do fixture já commitado)
   └─ cef-sample-com-saldo.pdf               (1 mês com SALDO)
```

`tests/fixtures/gregorutt/` está em `.gitignore` — fixtures full não vão
pro repo (continuação da política de não vazar dados de cliente além do
que já está committed em AP/AR).

## Como popular `tests/fixtures/gregorutt/` localmente

Os arquivos vêm do arquivo "Gregorutt - test data" entregue pelo cliente:

```powershell
$src = "C:\Users\ronal\Desktop\_archive_AI_CFO_old\Gregorutt - test data\Bcos"
$dst = "tests\fixtures\gregorutt\Bcos"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item "$src\*.txt", "$src\*.pdf" -Destination $dst -Force
```

Após isso, `pnpm test tests/integration/smoke-cf13-stage1.test.ts` deve
finalizar verde em ~3-5s.

Sem os fixtures locais, o teste é pulado via `it.skipIf`.

## Como gerar/atualizar o sample

O sample é uma fatia das fixtures full + um PDF com saldo. Comandos
PowerShell para regenerar:

```powershell
# Slices de 1.005 linhas (preserva encoding original windows-1252)
function Slice-FileByLines {
  param([string]$Source, [string]$Dest, [int]$Lines)
  $bytes = [System.IO.File]::ReadAllBytes($Source)
  $newlines = 0; $idx = 0
  while ($idx -lt $bytes.Length -and $newlines -lt $Lines) {
    if ($bytes[$idx] -eq 0x0A) { $newlines++ }
    $idx++
  }
  [System.IO.File]::WriteAllBytes($Dest, $bytes[0..($idx-1)])
}

$sample = "tests\fixtures\gregorutt-sample"
Slice-FileByLines "tests\fixtures\gregorutt_cp_2023_ate_20abr2026.csv" "$sample\ap-sample.csv" 1005
Slice-FileByLines "tests\fixtures\gregorutt_cr_2023_ate_20abr2026.csv" "$sample\ar-sample.csv" 1005
Copy-Item "tests\fixtures\cef_apr25.txt" "$sample\cef-sample.txt" -Force
Copy-Item "tests\fixtures\cef_apr26_com_saldo.pdf" "$sample\cef-sample-com-saldo.pdf" -Force
```

A função `Slice-FileByLines` lê em bytes para preservar a codificação
windows-1252 do FKN — o slice por linhas evita corromper acentos no
caminho.

## Modo sample em CI

Asserções relaxadas no sample:
- Counts: `> 0` em vez do exato 6.880/11.611.
- Tempo: sem limite (sample é pequeno).
- Demais asserções idênticas.

`process.env.CI` ativa o modo automaticamente; rodar local com
`CFOUP_SMOKE_MODE=sample` força o mesmo caminho.

## Limitações conhecidas (TODOs documentados)

1. **Zero-value rows em AR**: O parser FKN AR retorna 11.611 receivables;
   1 deles tem `amount=0` (provavelmente título cancelado). O adapter
   rejeita por design (princípio do nucleus). O smoke pré-filtra com log
   visível. Adapter count final: 11.610.

2. **`accountId` ausente em PDFs Gregorutt**: O parser CEF PDF do nucleus
   tem regex `/Conta\s*:?\s*\d+/i` que não casa com o formato dos PDFs
   Gregorutt. O smoke injeta o accountId canônico extraído do TXT
   (`canonicalAccountId = cefTxtParsed[0].ok[0].accountId`). Refatorar o
   parser para reconhecer o cabeçalho Gregorutt fica como TODO de quando
   um segundo banco for integrado.

3. **`tx.id` colide entre arquivos CEF**: O parser numera linhas a partir
   de 1 em cada arquivo. Múltiplos arquivos colidem. O smoke prefixa
   `tx.id` com o stem do arquivo antes de chamar o adapter. Cleaner v2:
   parser deveria aceitar um `sourceFile` opcional.

## Reprodutibilidade do relatório

O smoke imprime sempre o mesmo bloco no console (modulo tempos). Para
arquivar o output:

```bash
pnpm test tests/integration/smoke-cf13-stage1.test.ts 2>&1 | tee \
  docs/cf13/stage-1-smoke-results-$(date +%Y%m%d).txt
```
