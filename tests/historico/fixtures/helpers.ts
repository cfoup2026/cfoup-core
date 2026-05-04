import type {
  Criticidade,
  Direcao,
  EventoCaixa,
  EventoConfirmado,
  EventoEstimado,
  EventoPendente,
  EventoRealizado,
} from '../../../src/types/index.js';

/** Construtor de Date UTC à meia-noite. */
export function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const DEFAULT_CTX = {
  cliente_id: 'cli_test',
  legal_entity_id: 'le_test',
} as const;

/** Constrói um evento `realizado` com defaults sensatos. */
export function makeRealizado(args: {
  id: string;
  valor: number;
  direcao: Direcao;
  data_vencimento?: Date;
  data_realizada: Date;
  contraparte_id?: string;
  bucket_id?: string;
  cliente_id?: string;
  legal_entity_id?: string;
  criticidade?: Criticidade;
  competencia?: string;
}): EventoRealizado {
  const ev: EventoRealizado = {
    id: args.id,
    valor: args.valor,
    direcao: args.direcao,
    data_esperada: args.data_realizada,
    bucket_id: args.bucket_id ?? 'pendente_classificacao',
    bucket_nome: 'Pendente',
    cliente_id: args.cliente_id ?? DEFAULT_CTX.cliente_id,
    legal_entity_id: args.legal_entity_id ?? DEFAULT_CTX.legal_entity_id,
    origem: 'fkn',
    criticidade: args.criticidade ?? 'pendente',
    confianca: 'alta',
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: new Date('2026-05-01T12:00:00.000Z'),
    criado_por: 'sistema',
    status: 'realizado',
    data_realizada: args.data_realizada,
  };
  if (args.data_vencimento !== undefined) ev.data_vencimento = args.data_vencimento;
  if (args.contraparte_id !== undefined) ev.contraparte_id = args.contraparte_id;
  if (args.competencia !== undefined) ev.competencia = args.competencia;
  return ev;
}

/** Constrói um evento `confirmado` com defaults. */
export function makeConfirmado(args: {
  id: string;
  valor: number;
  direcao: Direcao;
  data_vencimento: Date;
  contraparte_id?: string;
  bucket_id?: string;
  legal_entity_id?: string;
}): EventoConfirmado {
  const ev: EventoConfirmado = {
    id: args.id,
    valor: args.valor,
    direcao: args.direcao,
    data_esperada: args.data_vencimento,
    bucket_id: args.bucket_id ?? 'pendente_classificacao',
    bucket_nome: 'Pendente',
    cliente_id: DEFAULT_CTX.cliente_id,
    legal_entity_id: args.legal_entity_id ?? DEFAULT_CTX.legal_entity_id,
    origem: 'fkn',
    criticidade: 'pendente',
    confianca: 'alta',
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: new Date('2026-05-01T12:00:00.000Z'),
    criado_por: 'sistema',
    status: 'confirmado',
    data_realizada: null,
    data_vencimento: args.data_vencimento,
  };
  if (args.contraparte_id !== undefined) ev.contraparte_id = args.contraparte_id;
  return ev;
}

/** Helpers para os outros status (raros nos testes da 2.1, só pra completude). */
export function makeEstimado(id: string, direcao: Direcao, valor: number): EventoEstimado {
  return {
    id,
    valor,
    direcao,
    data_esperada: utcDate(2026, 5, 1),
    bucket_id: 'pendente_classificacao',
    bucket_nome: 'Pendente',
    cliente_id: DEFAULT_CTX.cliente_id,
    legal_entity_id: DEFAULT_CTX.legal_entity_id,
    origem: 'manual',
    criticidade: 'pendente',
    confianca: 'media',
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: new Date('2026-05-01T12:00:00.000Z'),
    criado_por: 'sistema',
    status: 'estimado',
    data_realizada: null,
  };
}

export function makePendente(id: string, direcao: Direcao, valor: number): EventoPendente {
  return {
    id,
    valor,
    direcao,
    data_esperada: utcDate(2026, 5, 1),
    bucket_id: 'pendente_classificacao',
    bucket_nome: 'Pendente',
    cliente_id: DEFAULT_CTX.cliente_id,
    legal_entity_id: DEFAULT_CTX.legal_entity_id,
    origem: 'manual',
    criticidade: 'pendente',
    confianca: 'baixa',
    confianca_origem: 'sistema',
    is_transferencia: false,
    criado_em: new Date('2026-05-01T12:00:00.000Z'),
    criado_por: 'sistema',
    status: 'pendente',
    data_realizada: null,
  };
}

/** Marker para tipos exóticos da assertion. */
export type AnyEvento = EventoCaixa;
