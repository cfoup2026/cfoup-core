/**
 * Detecta unidades ativas sem `OpeningBalanceSnapshot` válido em
 * `data_referencia <= geradoEm` (§8.1 do spec).
 *
 * Aciona `MotivoInsuficiencia { tipo: 'saldo_abertura_ausente' }`,
 * que faz o Stage 7 substituir o veredito por "dados insuficientes".
 *
 * Detector puro: lê `projecao.unidades[*].caixaInicial.ausente`
 * (já calculado pelo Stage 4.1) — não duplica lógica de seleção
 * de snapshot.
 */
import type { MotivoInsuficiencia, ProjecaoCliente } from '../types/index.js';

const ACOES: MotivoInsuficiencia['acoes_sugeridas'] = [
  'confirmar_saldo',
  'revisar_conexao',
];

/**
 * Retorna lista ordenada por `legal_entity_id` lex de motivos de
 * saldo ausente. Vazia quando todas as unidades ativas têm snapshot.
 *
 * Itera apenas `projecao.unidades` (que já está filtrada por
 * `legal_entity_ids_ativas` pelo orquestrador 4.2). Unidades inativas
 * não entram nesta detecção por construção.
 */
export function detectaSaldoAbertura(
  projecao: ProjecaoCliente,
): MotivoInsuficiencia[] {
  const motivos: MotivoInsuficiencia[] = [];
  for (const u of projecao.unidades) {
    if (!u.caixaInicial.ausente) continue;
    motivos.push({
      tipo: 'saldo_abertura_ausente',
      legal_entity_id: u.legal_entity_id,
      descricao: 'Saldo de abertura indisponível para esta unidade.',
      acoes_sugeridas: ACOES,
    });
  }
  motivos.sort((a, b) => a.legal_entity_id.localeCompare(b.legal_entity_id));
  return motivos;
}
