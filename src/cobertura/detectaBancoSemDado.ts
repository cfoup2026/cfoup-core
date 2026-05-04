/**
 * Detecta unidades ativas com banco conhecido cujo último evento
 * `realizado` (CEF ou manual) é > 7 dias antes de `geradoEm` (§8.1).
 *
 * Aciona `MotivoInsuficiencia { tipo: 'banco_sem_dado_recente' }`.
 *
 * **Definição de "banco conhecido":** unidade tem ao menos um indício
 * de banco — ou um `OpeningBalanceSnapshot` com `origem='cef'`, ou ao
 * menos um evento `origem='cef'` no histórico (mesmo antigo).
 * Unidades sem indício de banco não disparam (não são "banco ativo").
 *
 * **Exceção:** se a unidade tem evento `origem='manual'` `realizado`
 * dentro da janela de 7 dias, considera-se que houve cobertura via
 * lançamento manual — não dispara.
 */
import type {
  EventoCaixa,
  MotivoInsuficiencia,
  OpeningBalanceSnapshot,
} from '../types/index.js';

const DAY_MS = 86_400_000;
const JANELA_DIAS = 7;
const ACOES: MotivoInsuficiencia['acoes_sugeridas'] = [
  'revisar_conexao',
  'declarar_conta_inativa',
  'adicionar_evento_manual',
];

export interface DetectaBancoSemDadoInput {
  eventos: readonly EventoCaixa[];
  saldos: readonly OpeningBalanceSnapshot[];
  cliente_id: string;
  legal_entity_ids_ativas: readonly string[];
  geradoEm: Date;
}

export function detectaBancoSemDado(
  input: DetectaBancoSemDadoInput,
): MotivoInsuficiencia[] {
  const limite = input.geradoEm.getTime() - JANELA_DIAS * DAY_MS;
  const motivos: MotivoInsuficiencia[] = [];

  for (const id of [...input.legal_entity_ids_ativas].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const eventosUnidade = input.eventos.filter(
      (e) =>
        e.cliente_id === input.cliente_id && e.legal_entity_id === id,
    );

    /* "Banco conhecido": existe snapshot CEF para a unidade ou ao menos
     *  um evento CEF (mesmo antigo). Unidades sem indício de banco não
     *  são candidatas — `banco_sem_dado_recente` exige banco. */
    const temSnapshotCef = input.saldos.some(
      (s) =>
        s.cliente_id === input.cliente_id &&
        s.legal_entity_id === id &&
        s.origem === 'cef',
    );
    const temEventoCef = eventosUnidade.some(
      (e) => e.origem === 'cef' && e.status === 'realizado',
    );
    if (!temSnapshotCef && !temEventoCef) continue;

    /* Algum evento CEF realizado dentro da janela? */
    const cefsRealizados = eventosUnidade.filter(
      (e) => e.origem === 'cef' && e.status === 'realizado',
    );
    const cefRecente = cefsRealizados.some((e) => {
      if (e.status !== 'realizado') return false;
      return e.data_realizada.getTime() >= limite;
    });
    if (cefRecente) continue;

    /* Exceção: lançamento manual recente cobre o período. */
    const manualRecente = eventosUnidade.some((e) => {
      if (e.origem !== 'manual') return false;
      if (e.status !== 'realizado') return false;
      return e.data_realizada.getTime() >= limite;
    });
    if (manualRecente) continue;

    /* Determina `ultima_data_observada` apenas dos CEFs realizados
     *  (semântica do motivo é "banco" — manual não é "banco"). */
    let ultimaData: Date | undefined;
    for (const e of cefsRealizados) {
      if (e.status !== 'realizado') continue;
      if (
        ultimaData === undefined ||
        e.data_realizada.getTime() > ultimaData.getTime()
      ) {
        ultimaData = e.data_realizada;
      }
    }

    const motivo: MotivoInsuficiencia = {
      tipo: 'banco_sem_dado_recente',
      legal_entity_id: id,
      descricao:
        'Sem evento bancário recente nesta unidade. Confirme conexão ou registre lançamentos manuais.',
      acoes_sugeridas: ACOES,
    };
    if (ultimaData !== undefined) motivo.ultima_data_observada = ultimaData;
    motivos.push(motivo);
  }

  motivos.sort((a, b) => a.legal_entity_id.localeCompare(b.legal_entity_id));
  return motivos;
}
