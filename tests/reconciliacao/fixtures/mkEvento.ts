/**
 * Fábrica de `EventoCaixa` para testes da reconciliação.
 *
 * Mantém defaults sensatos (cliente_id/legal_entity_id fixos) e exige
 * só os campos discriminantes — caller foca no que importa para o caso
 * de teste sem repetir 15 campos comuns.
 */
import type {
  ContraparteTipo,
  Criticidade,
  Direcao,
  EventoCaixa,
  EventoConfirmado,
  EventoEstimado,
  EventoPendente,
  EventoRealizado,
  Origem,
  Status,
} from '../../../src/types/index.js';

const DEFAULTS = {
  cliente_id: 'cli_test',
  legal_entity_id: 'le_test',
  bucket_id: 'pendente_classificacao',
  bucket_nome: 'Pendente',
  criticidade: 'pendente' as Criticidade,
  criado_em: new Date('2026-04-01T00:00:00.000Z'),
  criado_por: 'sistema',
} as const;

export interface MkEventoArgs {
  id: string;
  status: Status;
  origem: Origem;
  direcao: Direcao;
  valor: number;
  data_esperada: Date;

  // Status-specific dates (caller fornece o que faz sentido para o status)
  data_realizada?: Date;
  data_vencimento?: Date;

  // Identificação
  cliente_id?: string;
  legal_entity_id?: string;
  bucket_id?: string;
  contraparte_id?: string;
  contraparte_tipo?: ContraparteTipo;
  origem_ref?: string;
  documento_ref?: string;

  // Audit (testes que querem simular já-reconciliado)
  reconciliado_com?: string;
  reconciliado_em?: Date;
}

export function mkEvento(args: MkEventoArgs): EventoCaixa {
  const cliente_id = args.cliente_id ?? DEFAULTS.cliente_id;
  const legal_entity_id = args.legal_entity_id ?? DEFAULTS.legal_entity_id;
  const bucket_id = args.bucket_id ?? DEFAULTS.bucket_id;

  const baseCommon = {
    id: args.id,
    valor: args.valor,
    direcao: args.direcao,
    data_esperada: args.data_esperada,
    bucket_id,
    bucket_nome: DEFAULTS.bucket_nome,
    cliente_id,
    legal_entity_id,
    origem: args.origem,
    criticidade: DEFAULTS.criticidade,
    confianca: 'alta' as const,
    confianca_origem: 'sistema' as const,
    is_transferencia: false,
    criado_em: DEFAULTS.criado_em,
    criado_por: DEFAULTS.criado_por,
  };

  const result = (() => {
    switch (args.status) {
      case 'confirmado': {
        if (args.data_vencimento === undefined) {
          throw new Error(
            `mkEvento(${args.id}): data_vencimento é obrigatório em status='confirmado'`,
          );
        }
        const ev: EventoConfirmado = {
          ...baseCommon,
          status: 'confirmado',
          data_realizada: null,
          data_vencimento: args.data_vencimento,
        };
        return ev;
      }
      case 'realizado': {
        if (args.data_realizada === undefined) {
          throw new Error(
            `mkEvento(${args.id}): data_realizada é obrigatório em status='realizado'`,
          );
        }
        const ev: EventoRealizado = {
          ...baseCommon,
          status: 'realizado',
          data_realizada: args.data_realizada,
        };
        if (args.data_vencimento !== undefined)
          ev.data_vencimento = args.data_vencimento;
        return ev;
      }
      case 'estimado': {
        const ev: EventoEstimado = {
          ...baseCommon,
          status: 'estimado',
          data_realizada: null,
        };
        if (args.data_vencimento !== undefined)
          ev.data_vencimento = args.data_vencimento;
        return ev;
      }
      case 'pendente': {
        const ev: EventoPendente = {
          ...baseCommon,
          status: 'pendente',
          data_realizada: null,
        };
        if (args.data_vencimento !== undefined)
          ev.data_vencimento = args.data_vencimento;
        return ev;
      }
    }
  })();

  // Optionals (todas as variantes aceitam pelos campos da base).
  if (args.contraparte_id !== undefined) result.contraparte_id = args.contraparte_id;
  if (args.contraparte_tipo !== undefined)
    result.contraparte_tipo = args.contraparte_tipo;
  if (args.origem_ref !== undefined) result.origem_ref = args.origem_ref;
  if (args.documento_ref !== undefined)
    result.documento_ref = args.documento_ref;
  if (args.reconciliado_com !== undefined)
    result.reconciliado_com = args.reconciliado_com;
  if (args.reconciliado_em !== undefined)
    result.reconciliado_em = args.reconciliado_em;

  return result;
}

export const utc = (y: number, m: number, d: number): Date =>
  new Date(Date.UTC(y, m - 1, d));
